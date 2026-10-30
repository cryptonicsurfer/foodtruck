#!/bin/bash
# Directus-ändringar för admin-assistenten (specs/admin-assistent.md, fas 2 v1).
# Körs på glsfbg, via Directus API (ingen SQL, ingen omstart). Först staging, sedan prod.
#
#   bash assistant-schema.sh staging apply     # http://127.0.0.1:8056
#   bash assistant-schema.sh prod apply        # http://127.0.0.1:8055
#   bash assistant-schema.sh <miljö> status    # visar vad som finns, ändrar inget
#   bash assistant-schema.sh <miljö> revert    # tar bort exakt det apply lade till
#
# Admin-token: en statisk token som Paul skapar på sitt eget admin-konto i Directus
# (Users → ditt konto → Token → generera, spara) och lägger i ~/.directus-admin-token-<miljö>
# (chmod 600). Directus loggar då ändringarna på Pauls konto. Ta bort token efteråt.
#
# apply lägger till:
#   - collection foodtruck_assistant_actions (loggen) + relation user → directus_users
#   - fälten spaces.address (text) och spaces.aliases (json, taggar)
#   - policyn "Foodtruck assistant log": create/read/update på loggen, inget annat, ingen app-åtkomst
#   - rollen "Foodtruck assistant" med den policyn
#   - användaren foodtruck.agent@falkenberg.se (inget lösenord) med en statisk token.
#     Token skrivs till ~/.foodtruck-assistant-token-<miljö> (600) och skrivs aldrig ut.
set -euo pipefail

ENV="${1:?staging|prod}"; ACTION="${2:?apply|status|revert}"
case "$ENV" in
  staging) URL=http://127.0.0.1:8056 ;;
  prod) URL=http://127.0.0.1:8055 ;;
  *) echo "miljö: staging eller prod"; exit 1 ;;
esac
TOKEN_FILE=~/.directus-admin-token-$ENV
AGENT_TOKEN_FILE=~/.foodtruck-assistant-token-$ENV
[ -s "$TOKEN_FILE" ] || { echo "FEL: $TOKEN_FILE saknas (se toppen av skriptet)"; exit 1; }
ADMIN=$(cat "$TOKEN_FILE")

COLL=foodtruck_assistant_actions
POLICY_NAME="Foodtruck assistant log"
ROLE_NAME="Foodtruck assistant"
AGENT_EMAIL=foodtruck.agent@falkenberg.se

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

# Every lookup either answers or stops the script (a failed call must never read as "finns")
count() { local n; n=$(q "$1" "$2") || exit 1; [[ "$n" =~ ^[0-9]+$ ]] || { echo "FEL: oväntat svar från $1" >&2; exit 1; }; echo "$n"; }
coll_exists()   { [ "$(count "/collections/$COLL" '[.data] | length' 2>/dev/null || echo 0)" != 0 ]; }
field_exists()  { [ "$(count "/fields/spaces" "[.data[] | select(.field==\"$1\")] | length")" != 0 ]; }
policy_id()     { q "/policies?filter[name][_eq]=$(jq -rn --arg v "$POLICY_NAME" '$v|@uri')&fields=id" '.data[0].id // empty'; }
role_id()       { q "/roles?filter[name][_eq]=$(jq -rn --arg v "$ROLE_NAME" '$v|@uri')&fields=id" '.data[0].id // empty'; }
agent_id()      { q "/users?filter[email][_eq]=$AGENT_EMAIL&fields=id" '.data[0].id // empty'; }

status() {
  coll_exists && echo "  loggen: finns" || echo "  loggen: saknas"
  for f in address aliases; do field_exists $f && echo "  spaces.$f: finns" || echo "  spaces.$f: saknas"; done
  echo "  policy: $(policy_id || true)"; echo "  roll: $(role_id || true)"; echo "  agent: $(agent_id || true)"
  # Får Head of Foodtruck-policyn uppdatera de nya fälten? (fields "*" räcker)
  echo "  Head of food truck spaces → spaces.update fält: $(q '/permissions?filter[policy][_eq]=4160d6aa-eefe-4d9e-ac2b-c32ac66b83d1&filter[collection][_eq]=spaces&filter[action][_eq]=update&fields=fields' '.data[0].fields | tostring')"
}

apply() {
  if coll_exists; then echo "  loggen finns redan"; else
    api POST /collections "$(jq -nc --arg c "$COLL" '{
      collection: $c,
      meta: { icon: "smart_toy", accountability: "all", note: "Admin-assistentens logg (foodtruck). Skrivs bara av foodtruck.agent. specs/admin-assistent.md", sort_field: null, archive_field: null },
      schema: {},
      fields: [
        { field: "id", type: "uuid", meta: { special: ["uuid"], readonly: true, hidden: true }, schema: { is_primary_key: true, has_auto_increment: false } },
        { field: "status", type: "string", meta: { interface: "input", width: "half" }, schema: { default_value: "pending", is_nullable: false } },
        { field: "user", type: "uuid", meta: { interface: "select-dropdown-m2o", special: ["m2o"], display: "user", width: "half" }, schema: {} },
        { field: "prompt", type: "text", meta: { interface: "input-multiline" }, schema: {} },
        { field: "proposal", type: "json", meta: { interface: "input-code", options: { language: "json" }, special: ["cast-json"] }, schema: {} },
        { field: "card", type: "json", meta: { interface: "input-code", options: { language: "json" }, special: ["cast-json"] }, schema: {} },
        { field: "result", type: "json", meta: { interface: "input-code", options: { language: "json" }, special: ["cast-json"] }, schema: {} },
        { field: "date_created", type: "timestamp", meta: { special: ["date-created"], readonly: true, width: "half" }, schema: {} },
        { field: "executed_at", type: "timestamp", meta: { readonly: true, width: "half" }, schema: {} }
      ] }')" >/dev/null
    api POST /relations "$(jq -nc --arg c "$COLL" '{ collection: $c, field: "user", related_collection: "directus_users", schema: { on_delete: "SET NULL" } }')" >/dev/null
    echo "  + loggen $COLL"
  fi
  field_exists address || { api POST /fields/spaces '{"field":"address","type":"string","meta":{"interface":"input","note":"Adress (omvänd geokodning, admin-assistenten)","width":"full"},"schema":{"is_nullable":true}}' >/dev/null; echo "  + spaces.address"; }
  field_exists aliases || { api POST /fields/spaces '{"field":"aliases","type":"json","meta":{"interface":"tags","special":["cast-json"],"note":"Smeknamn kollegorna använder (\"vid stortorget\"). Admin-assistenten söker på dem.","width":"full"},"schema":{"is_nullable":true}}' >/dev/null; echo "  + spaces.aliases"; }

  PID=$(policy_id)
  if [ -z "$PID" ]; then
    PID=$(api POST /policies "$(jq -nc --arg n "$POLICY_NAME" '{ name: $n, icon: "smart_toy", description: "Bara admin-assistentens logg. Ingen app-åtkomst, inga andra collections.", app_access: false, admin_access: false, enforce_tfa: false }')" | jq -r .data.id)
    for action in create read update; do
      api POST /permissions "$(jq -nc --arg p "$PID" --arg c "$COLL" --arg a "$action" '{ policy: $p, collection: $c, action: $a, fields: ["*"], permissions: {}, validation: {} }')" >/dev/null
    done
    echo "  + policy $POLICY_NAME (create/read/update på $COLL)"
  fi
  RID=$(role_id)
  if [ -z "$RID" ]; then
    RID=$(api POST /roles "$(jq -nc --arg n "$ROLE_NAME" '{ name: $n, icon: "smart_toy", description: "Servicekonto för foodtrucks admin-assistent" }')" | jq -r .data.id)
    api POST /access "$(jq -nc --arg r "$RID" --arg p "$PID" '{ role: $r, policy: $p }')" >/dev/null
    echo "  + roll $ROLE_NAME"
  fi
  if [ -z "$(agent_id)" ]; then
    local tok; tok=$(openssl rand -hex 32)
    api POST /users "$(jq -nc --arg e "$AGENT_EMAIL" --arg r "$RID" --arg t "$tok" '{ email: $e, first_name: "Foodtruck", last_name: "Agent", role: $r, status: "active", token: $t, description: "Servicekonto, inget lösenord. Skriver bara admin-assistentens logg." }')" >/dev/null
    install -m 600 /dev/null "$AGENT_TOKEN_FILE"; printf '%s' "$tok" > "$AGENT_TOKEN_FILE"
    echo "  + användaren $AGENT_EMAIL (token i $AGENT_TOKEN_FILE)"
  fi
  # Kontroll: agenten når loggen men inget annat
  local at; at=$(cat "$AGENT_TOKEN_FILE" 2>/dev/null || true)
  if [ -n "$at" ]; then
    echo "  koll: agent → loggen $(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $at" "$URL/items/$COLL?limit=1") (ska vara 200)"
    echo "  koll: agent → spaces $(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $at" "$URL/items/spaces?limit=1") (ska vara 403)"
    echo "  koll: agent → users  $(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $at" "$URL/users?limit=1") (ska vara 403 eller tom)"
  fi
}

revert() {
  local id
  id=$(agent_id); [ -n "$id" ] && { api DELETE "/users/$id" >/dev/null; rm -f "$AGENT_TOKEN_FILE"; echo "  - agent"; }
  id=$(role_id); [ -n "$id" ] && { api DELETE "/roles/$id" >/dev/null; echo "  - roll"; }
  id=$(policy_id); [ -n "$id" ] && { api DELETE "/policies/$id" >/dev/null; echo "  - policy (och dess rättigheter)"; }
  for f in aliases address; do field_exists $f && { api DELETE "/fields/spaces/$f" >/dev/null; echo "  - spaces.$f"; }; done
  coll_exists && { api DELETE "/collections/$COLL" >/dev/null; echo "  - loggen (med alla rader)"; }
  true
}

case "$ACTION" in
  status) status ;;
  apply) apply; status ;;
  revert) revert; status ;;
  *) echo "apply|status|revert"; exit 1 ;;
esac
