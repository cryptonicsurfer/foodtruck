#!/bin/bash
# Directus-ändringar för den publika kontrollsidan /idag och avbokningsloggen.
# Körs på glsfbg, via Directus API (ingen SQL, ingen omstart). Först staging, sedan prod.
#
#   bash public-schedule-schema.sh staging apply        # http://127.0.0.1:8056
#   bash public-schedule-schema.sh prod apply           # http://127.0.0.1:8055
#   bash public-schedule-schema.sh <miljö> status       # visar vad som finns, ändrar inget
#   bash public-schedule-schema.sh <miljö> revert       # tar bort exakt det apply lade till
#   bash public-schedule-schema.sh <miljö> addresses    # föreslår adress för platser som saknar (ändrar inget)
#   bash public-schedule-schema.sh <miljö> addresses-apply
#   bash public-schedule-schema.sh <miljö> backfill FIL # läser in historiska avbokningar (JSON-lista)
#
# Admin-token: en statisk token som Paul skapar på sitt eget admin-konto i Directus
# (Users → ditt konto → Token → generera, spara) och lägger i ~/.directus-admin-token-<miljö>
# (chmod 600). Directus loggar då ändringarna på Pauls konto. Ta bort token efteråt.
#
# apply lägger till:
#   - collection foodtruck_cancelled_bookings (avbokningsloggen) + relationer till foodtrucks och spaces
#   - policyn "Foodtruck public schedule": läsa NAMNGIVNA fält i spaces, foodtrucks,
#     foodtruck_bookings och space_blocked_dates, skapa + läsa i avbokningsloggen. Inget annat,
#     ingen app-åtkomst. Inga ägare, inga e-postadresser.
#   - rollen "Foodtruck public schedule" med den policyn
#   - användaren foodtruck.public@falkenberg.se (inget lösenord) med en statisk token.
#     Token skrivs till ~/.foodtruck-public-token-<miljö> (600) och skrivs aldrig ut.
#
# En NY roll och policy: inga befintliga roller, policyer eller behörigheter ändras, så
# inloggningen i KW, CRM och de andra apparna påverkas inte.
set -euo pipefail

ENV="${1:?staging|prod}"; ACTION="${2:?apply|status|revert|addresses|addresses-apply|backfill}"
case "$ENV" in
  staging) URL=http://127.0.0.1:8056 ;;
  prod) URL=http://127.0.0.1:8055 ;;
  *) echo "miljö: staging eller prod"; exit 1 ;;
esac
TOKEN_FILE=~/.directus-admin-token-$ENV
AGENT_TOKEN_FILE=~/.foodtruck-public-token-$ENV
[ -s "$TOKEN_FILE" ] || { echo "FEL: $TOKEN_FILE saknas (se toppen av skriptet)"; exit 1; }
ADMIN=$(cat "$TOKEN_FILE")

COLL=foodtruck_cancelled_bookings
POLICY_NAME="Foodtruck public schedule"
ROLE_NAME="Foodtruck public schedule"
AGENT_EMAIL=foodtruck.public@falkenberg.se

api() {  # api METHOD PATH [JSON] → body på stdout, avbryter vid fel
  local out code
  out=$(curl -sSg -w '\n%{http_code}' -X "$1" "$URL$2" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' ${3:+-d "$3"})
  code=${out##*$'\n'}; out=${out%$'\n'*}
  if [ "$code" -ge 300 ]; then echo "FEL $1 $2 → $code: $(echo "$out" | jq -c '.errors[0].message' 2>/dev/null || echo "$out")" >&2; return 1; fi
  echo "$out"
}
q() { local body; body=$(api GET "$1") || exit 1; echo "$body" | jq -r "$2"; }

# Vem kör? (ska vara en administratör) — stoppar här om Directus inte svarar eller token är fel
ME=$(q "/users/me?fields=email,role.name" '.data.email + " (" + .data.role.name + ")"') || exit 1
echo "== $ENV ($URL) som $ME"

# Varje uppslag svarar eller stoppar HELA skriptet (körs i huvudskalet, aldrig i $(...)).
die() { echo "FEL: $*" >&2; exit 1; }
lookup() {  # lookup VAR PATH JQ
  local out
  out=$(api GET "$2") || die "uppslaget $2 misslyckades"
  printf -v "$1" '%s' "$(echo "$out" | jq -r "$3")"
}
coll_exists() { local n; lookup n "/collections" "[.data[] | select(.collection==\"$COLL\")] | length"; [[ "$n" =~ ^[0-9]+$ ]] || die "oväntat svar"; [ "$n" != 0 ]; }
uri() { jq -rn --arg v "$1" '$v|@uri'; }
policy_id() { lookup PID "/policies?filter[name][_eq]=$(uri "$POLICY_NAME")&fields=id" '.data[0].id // empty'; }
role_id()   { lookup RID "/roles?filter[name][_eq]=$(uri "$ROLE_NAME")&fields=id" '.data[0].id // empty'; }
agent_id()  { lookup AID "/users?filter[email][_eq]=$AGENT_EMAIL&fields=id" '.data[0].id // empty'; }

# Vad servicekontot får läsa: collection → fält. Inget utöver detta.
READS=(
  "spaces:id,name,address,location,time_slots"
  "foodtrucks:id,name,image"
  "foodtruck_bookings:id,foodtruck,space,start,end,date_created"
  "space_blocked_dates:id,space,date,time_slot,status"
)

code() { curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $1" "$URL$2"; }

checks() {
  local at; at=$(cat "$AGENT_TOKEN_FILE" 2>/dev/null || true)
  [ -n "$at" ] || { echo "  (ingen token i $AGENT_TOKEN_FILE, hoppar över kontrollerna)"; return 0; }
  echo "  koll: bokningar       $(code "$at" "/items/foodtruck_bookings?limit=1&fields=id,start,foodtruck.name,space") (ska vara 200)"
  echo "  koll: platser         $(code "$at" "/items/spaces?limit=1&fields=id,name,location") (ska vara 200)"
  echo "  koll: spärrar         $(code "$at" "/items/space_blocked_dates?limit=1&fields=id,date") (ska vara 200)"
  echo "  koll: avbokningslogg  $(code "$at" "/items/$COLL?limit=1") (ska vara 200)"
  echo "  koll: ägare via truck $(code "$at" "/items/foodtrucks?limit=1&fields=id,user") (ska vara 403)"
  echo "  koll: users           $(code "$at" "/users?limit=1&fields=email") (ska vara 403)"
  local n; n=$(curl -s -H "Authorization: Bearer $at" "$URL/users?limit=5&fields=email" | jq -r '[.data[]? | select(.email != null)] | length' 2>/dev/null || echo "?")
  echo "  koll: e-postadresser synliga för kontot: $n (ska vara 0)"
  echo "  koll: radera bokning  $(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: Bearer $at" "$URL/items/foodtruck_bookings/0") (ska vara 403)"
}

status() {
  coll_exists && echo "  avbokningsloggen: finns" || echo "  avbokningsloggen: saknas"
  policy_id; role_id; agent_id
  echo "  policy: ${PID:-saknas}"; echo "  roll: ${RID:-saknas}"; echo "  konto: ${AID:-saknas}"
  if coll_exists; then local n; lookup n "/items/$COLL?aggregate[count]=*" '.data[0].count'; echo "  rader i avbokningsloggen: $n"; fi
  local a; lookup a "/items/spaces?filter[address][_null]=true&aggregate[count]=*" '.data[0].count'; echo "  platser utan adress: $a"
  checks
}

apply() {
  if coll_exists; then echo "  avbokningsloggen finns redan"; else
    api POST /collections "$(jq -nc --arg c "$COLL" '{
      collection: $c,
      meta: { icon: "event_busy", accountability: "all", note: "Avbokade bokningar (foodtruck). Skrivs av appen när en bokning tas bort; visas på den publika kontrollsidan /idag." },
      schema: {},
      fields: [
        { field: "id", type: "integer", meta: { hidden: true, readonly: true }, schema: { is_primary_key: true, has_auto_increment: true } },
        { field: "booking", type: "integer", meta: { interface: "input", readonly: true, width: "half", note: "Bokningens id innan den togs bort" }, schema: { is_nullable: true } },
        { field: "source", type: "string", meta: { interface: "input", readonly: true, width: "half", note: "app = loggad av appen, logg = inläst ur Directus händelselogg" }, schema: { default_value: "app" } },
        { field: "foodtruck", type: "integer", meta: { interface: "select-dropdown-m2o", special: ["m2o"], width: "half" }, schema: { is_nullable: true } },
        { field: "space", type: "integer", meta: { interface: "select-dropdown-m2o", special: ["m2o"], width: "half" }, schema: { is_nullable: true } },
        { field: "foodtruck_name", type: "string", meta: { interface: "input", readonly: true, width: "half", note: "Namnet vid avbokningen (finns kvar om foodtrucken tas bort)" }, schema: { is_nullable: true } },
        { field: "space_name", type: "string", meta: { interface: "input", readonly: true, width: "half", note: "Namnet vid avbokningen (finns kvar om platsen tas bort)" }, schema: { is_nullable: true } },
        { field: "start", type: "dateTime", meta: { interface: "datetime", width: "half", note: "Svensk klocktid, som i foodtruck_bookings" }, schema: { is_nullable: false } },
        { field: "end", type: "dateTime", meta: { interface: "datetime", width: "half" }, schema: { is_nullable: true } },
        { field: "booked_at", type: "timestamp", meta: { interface: "datetime", readonly: true, width: "half" }, schema: { is_nullable: true } },
        { field: "cancelled_at", type: "timestamp", meta: { interface: "datetime", readonly: true, width: "half" }, schema: { is_nullable: false } }
      ] }')" >/dev/null
    echo "  + avbokningsloggen $COLL"
  fi
  # Varje del nedan kontrolleras för sig, så att apply kan köras om efter ett avbrott
  # och då lägger till exakt det som saknas.
  local rel
  for rel in foodtruck:foodtrucks space:spaces; do
    local n; lookup n "/relations/$COLL" "[.data[] | select(.field==\"${rel%%:*}\")] | length"
    [ "$n" != 0 ] || { api POST /relations "$(jq -nc --arg c "$COLL" --arg f "${rel%%:*}" --arg r "${rel#*:}" '{ collection: $c, field: $f, related_collection: $r, schema: { on_delete: "SET NULL" } }')" >/dev/null; echo "  + relation $COLL.${rel%%:*}"; }
  done

  policy_id
  if [ -z "$PID" ]; then
    PID=$(api POST /policies "$(jq -nc --arg n "$POLICY_NAME" '{ name: $n, icon: "visibility", description: "Publika kontrollsidan /idag: läser namngivna fält i platser, foodtrucks, bokningar och spärrar, skriver avbokningsloggen. Ingen app-åtkomst, inga personuppgifter.", app_access: false, admin_access: false, enforce_tfa: false }')" | jq -r .data.id)
    [ -n "$PID" ] && [ "$PID" != null ] || die "policyn skapades inte"
    echo "  + policy $POLICY_NAME"
  fi
  ensure_perm() {  # ensure_perm COLLECTION ACTION FIELDS(komma-separerade)
    local n; lookup n "/permissions?filter[policy][_eq]=$PID&filter[collection][_eq]=$1&filter[action][_eq]=$2&fields=id" '.data | length'
    [ "$n" != 0 ] && return 0
    api POST /permissions "$(jq -nc --arg p "$PID" --arg c "$1" --arg a "$2" --arg f "$3" '{ policy: $p, collection: $c, action: $a, fields: ($f | split(",")), permissions: {}, validation: {} }')" >/dev/null
    echo "  + rättighet $1.$2"
  }
  local r
  for r in "${READS[@]}"; do ensure_perm "${r%%:*}" read "${r#*:}"; done
  ensure_perm "$COLL" create "*"; ensure_perm "$COLL" read "*"

  role_id
  if [ -z "$RID" ]; then
    RID=$(api POST /roles "$(jq -nc --arg n "$ROLE_NAME" '{ name: $n, icon: "visibility", description: "Servicekonto för foodtrucks publika kontrollsida" }')" | jq -r .data.id)
    [ -n "$RID" ] && [ "$RID" != null ] || die "rollen skapades inte"
    echo "  + roll $ROLE_NAME"
  fi
  local linked; lookup linked "/access?filter[role][_eq]=$RID&filter[policy][_eq]=$PID&fields=id" '.data | length'
  [ "$linked" != 0 ] || { api POST /access "$(jq -nc --arg r "$RID" --arg p "$PID" '{ role: $r, policy: $p }')" >/dev/null; echo "  + rollen kopplad till policyn"; }

  agent_id
  if [ -z "$AID" ]; then
    AID=$(api POST /users "$(jq -nc --arg e "$AGENT_EMAIL" --arg r "$RID" '{ email: $e, first_name: "Foodtruck", last_name: "Publik sida", role: $r, status: "active", description: "Servicekonto, inget lösenord. Läser bokningar för /idag och skriver avbokningsloggen." }')" | jq -r .data.id)
    [ -n "$AID" ] && [ "$AID" != null ] || die "kontot skapades inte"
    echo "  + användaren $AGENT_EMAIL"
  fi
  # Token sätts i ett eget steg: saknas filen (t.ex. efter ett avbrott) får kontot en ny.
  if [ ! -s "$AGENT_TOKEN_FILE" ]; then
    local tok; tok=$(openssl rand -hex 32)
    install -m 600 /dev/null "$AGENT_TOKEN_FILE"
    api PATCH "/users/$AID" "$(jq -nc --arg t "$tok" '{ token: $t }')" >/dev/null || { rm -f "$AGENT_TOKEN_FILE"; die "kunde inte sätta token"; }
    printf '%s' "$tok" > "$AGENT_TOKEN_FILE"
    echo "  + ny token i $AGENT_TOKEN_FILE (en tidigare token för kontot gäller inte längre)"
  fi
}

revert() {
  # Loggen går inte att återskapa: finns det rader krävs ett uttryckligt ja.
  if coll_exists; then
    local n; lookup n "/items/$COLL?aggregate[count]=*" '.data[0].count'
    if [ "$n" != 0 ]; then
      local svar; read -r -p "  revert raderar avbokningsloggen med $n rader i $ENV. Skriv 'radera' för att fortsätta: " svar
      [ "$svar" = radera ] || die "avbrutet, inget ändrat"
    fi
  fi
  agent_id; [ -n "$AID" ] && { api DELETE "/users/$AID" >/dev/null || die "kunde inte ta bort kontot"; rm -f "$AGENT_TOKEN_FILE"; echo "  - konto"; }
  role_id; [ -n "$RID" ] && { api DELETE "/roles/$RID" >/dev/null || die "kunde inte ta bort rollen"; echo "  - roll"; }
  policy_id; [ -n "$PID" ] && { api DELETE "/policies/$PID" >/dev/null || die "kunde inte ta bort policyn"; echo "  - policy (och dess rättigheter)"; }
  coll_exists && { api DELETE "/collections/$COLL" >/dev/null; echo "  - avbokningsloggen (med alla rader)"; }
  true
}

# Koordinater → adress via OpenStreetMap Nominatim (en fråga per sekund, egen User-Agent).
# Bara koordinaten skickas. Samma etikett som lib/assistant/geo.ts: "Klittervägen, Skrea".
addresses() {
  local write="$1" rows; rows=$(api GET "/items/spaces?filter[address][_null]=true&filter[location][_nnull]=true&fields=id,name,location&limit=-1&sort=name") || die "kunde inte läsa platserna"
  local n; n=$(echo "$rows" | jq '.data | length'); echo "  $n platser saknar adress"
  echo "$rows" | jq -c '.data[]' | while read -r s; do
    local id name lng lat label
    id=$(echo "$s" | jq -r .id); name=$(echo "$s" | jq -r .name)
    lng=$(echo "$s" | jq -r '.location.coordinates[0]'); lat=$(echo "$s" | jq -r '.location.coordinates[1]')
    label=$(curl -sS -m 8 -H "User-Agent: foodtruck.businessfalkenberg.se schema-skript (businessfalkenberg@gmail.com)" -H "Accept-Language: sv" \
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=$lat&lon=$lng" \
      | jq -r '.address as $a | [($a.road // $a.pedestrian // $a.square // $a.footway), ($a.suburb // $a.neighbourhood // $a.quarter // $a.village // $a.hamlet // $a.town // $a.city)] | map(select(. != null)) | join(", ")' 2>/dev/null || true)
    if [ -z "$label" ]; then echo "  ? $name: inget svar"; else
      echo "  $name → $label"
      [ "$write" = 1 ] && api PATCH "/items/spaces/$id" "$(jq -nc --arg a "$label" '{ address: $a }')" >/dev/null
    fi
    sleep 1.1
  done
  [ "$write" = 1 ] && echo "  sparat. Adresserna kan rättas i appen (/admin → Platser) eller i Directus." || echo "  inget ändrat. Kör addresses-apply för att spara."
}

backfill() {
  local file="${1:?backfill FIL (JSON-lista)}"; [ -s "$file" ] || die "$file saknas"
  coll_exists || die "kör apply först"
  local have; lookup have "/items/$COLL?filter[source][_eq]=logg&aggregate[count]=*" '.data[0].count'
  [ "$have" = 0 ] || die "$have inlästa rader finns redan (source=logg). Ta bort dem först om du vill läsa in igen."
  local n; n=$(jq 'length' "$file")
  # source sätts alltid här, så att spärren ovan gäller vad filen än innehåller
  api POST "/items/$COLL?fields=id" "$(jq -c 'map(. + { source: "logg" })' "$file")" >/dev/null
  echo "  + $n historiska avbokningar inlästa"
}

case "$ACTION" in
  status) status ;;
  apply) apply; status ;;
  revert) revert; status ;;
  addresses) addresses 0 ;;
  addresses-apply) addresses 1 ;;
  backfill) backfill "${3:-}"; status ;;
  *) echo "apply|status|revert|addresses|addresses-apply|backfill FIL"; exit 1 ;;
esac
