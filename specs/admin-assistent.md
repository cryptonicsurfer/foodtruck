# Admin-assistent: fritext in, bekräftat kort ut

Status (2026-10-30): **fas 1 punkt 3–4 byggd** (PR `feat/admin-impact-warnings`).
Resten väntar på reglerna från Gata & trafik (de nya Head of Foodtruck), se fas 0.

**Grundkrav från Paul:** det ska vara så enkelt som möjligt för kollegorna. De säger
"platsen vid sanddynevägen" eller "vid stortorget", inte namnet i databasen. De ska
kunna skapa platser och foodtruckers utan att kunna systemet.

## Problemet

De som administrerar foodtruck (Head of Foodtruck) är inte vana systemanvändare och
ska inte behöva lära sig reglerna. Resultatet i dag:

- Platserna fick 2026-01-07 en tid, 10:00–03:00, medan systemet byggdes för två pass
  (Morgon/Lunch 06–15, Kväll 16–03). Ingen märkte att admin-vyerna och spärrarna
  fortfarande räknar med två pass.
- En kvällsspärr (J-dagen 2026-11-06, Rådhustorget 5) bet inte på heldagstiden, och
  en foodtruck kunde boka 10:00–03:00 samma dag. Spärren är borttagen sedan dess, men
  samma sak händer med varje morgon- eller kvällsspärr så länge passen ser ut så här.
- 538 heldagsspärrar, en rad per dag, för "El saknas" på Klittervägen. Det saknas ett
  sätt att säga "stängd under en period", och dubbletter uppstod när listan kapades
  vid 100 rader.
- Ingen äger reglerna, och när något går fel vet ingen vem som ändrade vad eller varför.

## Idén

En chattruta i `/admin`. Användaren skriver vad hon vill ("spärra Rådhustorget kvällen
9/11, det är firande"). Agenten tolkar och slår upp platser, bokningar och spärrar.
Sedan **föreslår** den en ändring. Användaren får ett kort med exakt vad som händer
och vad det krockar med, och trycker Bekräfta eller Avbryt.

**Modellen skriver aldrig själv.** Skrivverktygen skapar bara förslag. Kortet räknas
fram i kod, inte i modellens text. Själva ändringen körs av en vanlig endpoint när
användaren trycker Bekräfta, och där är ingen modell inblandad. Det är samma idé som
CRM:ets `confirm-guard.ts`, men strängare: där gäller kortet bara borttagningar, här
gäller det **alla** skrivningar.

## Grundprinciper

1. **Reglerna är data, inte kod i agenten.** Paul ger nya regler till Claude i chatten,
   och de blir en ändring i `lib/foodtruck-policy.ts` → PR → deploy, några minuter.
   Git-historiken visar vem som ändrade vad och när. Agenten läser policyn. Den
   uppfinner inga regler och ändrar dem inte.
2. **Konsekvensanalysen är deterministisk.** En funktion, `analyzeImpact(change)`,
   räknar ut berörda bokningar, spärrar som slutar gälla och policybrott. Samma
   funktion används av korten **och** av de vanliga admin-dialogerna, så även den som
   klickar själv får varningen.
3. **Användarens egen behörighet.** Agenten anropar Directus med användarens token.
   Den kan aldrig göra mer än personen får göra i Directus.
4. **Varje åtgärd loggas med varför.** Fritexten, förslaget och utfallet sparas.
   Directus loggar redan *vad* som ändrades; det här ger *vem bad om det och varför*.

## Fas 0 — reglerna (Gata & trafik, ingen kod)

Få svar på:

- Pass per plats: två (morgon/lunch + kväll), en heldag, eller olika per plats? Klockslag?
- Ska kvällsspärr och morgonspärr finnas, eller bara heldag?
- Vad händer med en befintlig bokning när en spärr läggs på samma tid: får den stå
  kvar (som nu), ska den avbokas, eller ska foodtruckern kontaktas?
- Långa avstängningar ("el saknas"): stänga perioden, eller ta bort platsen helt,
  som en kollega har föreslagit?
- Vem äger reglerna framöver? En namngiven person.

Svaren skrivs in i `lib/foodtruck-policy.ts`:

```ts
export const POLICY = {
  version: "2026-11-xx",
  owner: "…",                       // vem som beslutade
  slotTemplates: {                  // tillåtna pass att välja bland när en plats skapas
    standard: [{ start: "06:00", end: "15:00", description: "Morgon/Lunch" },
               { start: "16:00", end: "03:00", description: "Kväll" }],
  },
  rules: [
    // severity "stopp" = går inte att bekräfta; "varning" = syns på kortet, får bekräftas
    { id: "slot-template", severity: "varning", text: "Platser ska ha passen i en mall" },
    { id: "block-over-booking", severity: "varning", text: "Spärr på en bokad tid" },
    …
  ],
  text: `…regeltexten i klartext, som agenten får i systemprompten…`,
} as const
```

`foodtruck_rules` (max bokningar, dagar framåt, sista minuten) ligger kvar i Directus
som i dag. Det är siffror som admin redan ändrar i appen.

## Fas 1 — deterministisk grund (ingen AI)

Ger effekt redan utan agenten.

1. **Spärr per platsens faktiska pass.** `space_blocked_dates.time_slot` blir
   `all_day` eller passets starttid (`"16:00"`) i stället för `morning`/`evening`.
   Matchningen i `lib/booking-rules.ts` blir "heldag eller samma pass". Befintliga
   `morning`/`evening`-rader migreras till passet de träffar, eller listas för beslut
   när inget pass matchar (som J-dagen var).
2. **Stängningsperioder.** En ny collection `space_closures` (space, from, to, reason,
   status). `isSpaceBlocked()` och UI-reglerna kollar både spärrar och perioder. De 538
   "El saknas"-raderna slås ihop till perioder och arkiveras.
3. ✅ **Konsekvenskontroller** i `lib/booking-rules.ts` (`slotsCoveredByBlock`,
   `bookingsUnderBlock`, `blockDatesOfBooking`, `bookingsOutsideSlots`, `blockReach`,
   `blocksChangingReach`, testade med `pnpm test`). Spärrdialogen visar platsens pass,
   varnar för bokningar som spärren landar på (båda lägena, en heldagsspärr också för
   bokningar från dagen innan som går över midnatt) och stoppar en spärr som inte
   träffar något pass (J-dagen). Platsdialogen varnar när nya pass gör att framtida
   bokningar inte längre passar (start och slut jämförs), när morgon-/kvällsspärrar
   slutar gälla, slutar stänga hela dagen eller börjar gälla igen. Kunde bokningarna
   inte hämtas säger dialogerna det i stället för att se krockfria ut. Agentens
   `analyzeImpact()` byggs av samma funktioner.
   **Bara i UI:t än så länge:** `adminCreateSpaceBlockedDate` och Directus-admin
   släpper fortfarande igenom en spärr utan effekt. Regeln ska in i `analyzeImpact()`
   och i confirm-steget (fas 2) så att servern stoppar den.
4. ✅ **Admin-schemat** visar bokningens riktiga klockslag (t.ex. "10–03" med klockikon
   för heldagspass) i stället för hårdkodat "Morgon/Lunch (06–15)".

Schemaändringar i Directus görs via API eller admin-UI, inte via SQL (se CLAUDE.md:
direkt-SQL kräver en Directus-omstart = auth-avbrott i hela flottan). De är
delad CMS-ändring, så Paul godkänner först.

## Fas 2 — agenten

### Modell

TensorX `deepseek/deepseek-v4.1-flash-1017` med `reasoning_effort: medium` (krävs, se
crm-mistral-flow CLAUDE.md → Modellkedja), och Mistral som fallback. Det är samma
kedja som CRM:et: EU-hostat, beprövat på verktygsanrop i flera steg.

- Egen TensorX-nyckel för foodtruck (inte CRM:ets) med kostnadstak, i VPS-`.env`. Inte
  i imagen.
- `openai`-SDK:n **exakt låst** till samma version som CRM:ets lockfil. Kör
  socket.dev-koll enligt `~/CLAUDE.md`.
- `server/llm-client.ts` i CRM:et är förlagan: primär + fallback, timeout 60 s,
  `maxRetries: 1`, och identisk systemprompt varje tur (prefix-cachen).

### Transport

Ingen WebSocket. `POST /api/admin-assistant` tar emot samtalet (historiken hålls i
klienten), kör agentloopen till högst N steg och svarar med text och eventuella
förslag. Varje anrop kontrollerar `hasAdminAccess()` och Origin, med samma CSRF-spärr
som i övriga appar.

### Peka ut en plats — det viktigaste steget

Kollegorna säger "platsen vid sanddynevägen", "vid stortorget" eller "den vid
Bacchus", inte det exakta namnet. Agenten får därför **aldrig agera på en plats som
användaren inte har bekräftat**.

1. `find_space(query)` returnerar kandidater med rik metadata: namn, beskrivning,
   koordinater, **adress** (gatuadress + område, t.ex. "Klittervägen, Skrea strand"),
   närmaste gata och landmärke, **alias**, pass, säsong och antal kommande bokningar.
   Matchningen sker i kod (namn, alias, adress, beskrivning, fuzzy) och vid behov via
   geokodning av frasen ("vid stortorget" → punkt → närmaste platser inom ~300 m).
2. Agenten visar ett **platskort**, inte bara text:

   > Jag tolkar det som att du menar den här platsen:
   > **Klittervägen plats E, Skrea strand** — [minikarta med nål]
   > Klittervägen, Skrea strand · pass 10–03 · 3 kommande bokningar
   > [Ja, den] [Nej, en annan]

   Vid "Nej, en annan" visas övriga kandidater som kort, och sist "Välj på kartan".
3. Flera platser i samma begäran ("Klittervägen C och D") ger ett kort med båda, och
   användaren bekräftar listan i ett klick.
4. **Alias lär sig:** när användaren bekräftar att "sanddynevägen" = Klittervägen E
   föreslår agenten att spara "sanddynevägen" som alias, via ett eget litet kort.
   Nästa gång blir träffen direkt.

Platskortet är en egen komponent (`SpacePreviewCard`) med en liten statisk
MapLibre-karta (interaktion avstängd), samma kartstil som resten av appen.

**Datakrav:** `spaces.address` (text) och `spaces.aliases` (lista med text). Adressen
fylls i en gång per plats genom omvänd geokodning av koordinaterna och därefter när
platsen flyttas. Geokodning via OSM Nominatim (eller Photon): bara platsfras och
koordinater skickas, ingen persondata. Följ användarvillkoren (egen User-Agent, max
1 anrop/s, cacha svaren); volymen här är några anrop i veckan.

### Verktyg

Läsa (körs direkt):

| Verktyg | Gör |
|---|---|
| `find_space` | Kandidater för en fras, med metadata enligt ovan (se föregående avsnitt) |
| `list_spaces` | Platser med pass, säsong, stängningsperioder, adress och alias |
| `list_foodtrucks` | Foodtrucks med namn, aktiv/inaktiv, ägarens namn och antal kommande bokningar |
| `list_bookings` | Bokningar i ett datumintervall, valfritt per plats |
| `list_blocks` | Spärrar och perioder i ett intervall |
| `get_rules` | `foodtruck_rules` + `POLICY` |

Föreslå (skapar ett kort, skriver inget):

| Verktyg | Kort |
|---|---|
| `propose_block` | Platser × datum/intervall × pass eller heldag, orsak |
| `propose_unblock` | Vilka spärrar eller perioder som hävs |
| `propose_closure` | Stäng plats(er) en period |
| `propose_update_space` | Före → efter för pass, säsong, namn och beskrivning |
| `propose_create_space` | Ny plats, se "Skapa plats" nedan |
| `propose_update_rules` | Före → efter för `foodtruck_rules` |
| `propose_add_alias` | Spara ett smeknamn på en plats |
| `propose_create_foodtrucker` | Ny foodtrucker, se nedan |
| `propose_deactivate_foodtruck` | Inaktivera (förstahandsval när någon "ska bort") |
| `propose_delete_foodtrucker` | Ta bort foodtruck och konto, med `requireText`-kort |

Utanför ramen i v1: avbokningar, borttagning av platser och att skapa Head of
Foodtruck. Dessa görs som i dag (det sista i Directus).

### Skapa plats

Användaren säger t.ex. "lägg till en plats vid Tullbron, el finns, bara sommar".
Agenten samlar in det som krävs och frågar efter det som saknas, en sak i taget:

- **Läge:** frasen geokodas till en punkt. Kortet visar minikartan med nålen och
  adressen, plus "Flytta nålen" som öppnar kartväljaren (`SpaceLocationPicker`).
  Modellen hittar aldrig på koordinater, de kommer från geokodningen eller från
  användarens klick.
- **Namn:** agenten föreslår ett utifrån adressen och befintliga namn ("Tullbron
  plats 1"), och användaren kan ändra det på kortet.
- **Pass:** från policyns mall (`POLICY.slotTemplates`). Avviker användaren från
  mallen visas policyvarningen.
- **Säsong, beskrivning (el, vatten), alias.**

Kortet visar alla fält före Bekräfta. Fält som är fel ändras direkt på kortet, inte
genom ny chatt.

### Skapa och ta bort foodtruckers

- **Skapa:** e-post, för- och efternamn och foodtruckens namn. Agenten skapar konto
  (rollen Foodtrucker, hårdkodad i `createFoodTruckUser`) och foodtruck i ett steg
  från ett kort. **Inga lösenord i chatten:** kontot skapas utan lösenord och
  foodtruckern får en Directus-inbjudan per mejl och väljer sitt eget lösenord.
  Verifiera innan bygget att Head of Foodtruck-policyn får bjuda in och att mejlet
  går fram via Gmail-SMTP:n. Annars används återställningsflödet
  (`requestPasswordReset`) direkt efter att kontot skapats.
- **Dubblettkoll:** finns e-posten redan, eller en foodtruck med liknande namn, visar
  kortet det och föreslår att koppla eller återaktivera i stället.
- **Ta bort:** agenten föreslår först inaktivering, som är reversibel och döljer
  foodtrucken. Begär användaren uttryckligen borttagning visas ett kort med kommande
  bokningar och kravet att skriva "bekräfta" (samma `requireText` som i dag).
  `adminDeleteFoodTruck` tar inte bort bokningarna, så kortet säger vad som händer
  med dem. Det beslutet tas i fas 0.

### Kortet

Byggs av `analyzeImpact()`. Exempel:

> **Spärra Rådhustorget plats 5 och 6 · 9 nov 2026 · Kväll (16–03)**
> Orsak: "Firande"
> ⚠️ Krockar med 1 bokning: [foodtruck], plats 5, 16–03
> ⚠️ Policy: "Spärr på en bokad tid", och bokningen ligger kvar (avbokas inte)
> [Bekräfta] [Avbryt]

Ett policybrott med `stopp` ger ett kort utan Bekräfta-knapp, med texten: "Det här
strider mot regeln … Kontakta [owner]."

### Bekräftelse och logg

En ny collection `foodtruck_assistant_actions`: user, prompt (användarens fritext),
proposal (json), impact (json), status (`pending` | `confirmed` | `cancelled` |
`expired` | `failed`), created, executed, result.

Loggen skrivs **bara av servern**, med ett eget servicekonto (statisk Directus-token
med create/update på just den här collectionen, inget annat). Användarens token får
inte skriva i den: med create kunde en användare annars själv lägga in rader med valfri
status och user, och utan update kan confirm-steget inte flytta raden från `pending`.

`POST /api/admin-assistant/confirm {id}` gör följande:

1. Kontrollerar att förslaget tillhör samma användare och är yngre än 10 minuter, och
   **tar** det atomärt: en uppdatering `pending` → `confirmed` med filtret
   `status = pending`. Ändrades ingen rad har någon annan (eller ett dubbelklick)
   redan tagit det, och inget körs.
2. Kör `analyzeImpact()` igen. Har läget ändrats (någon har bokat under tiden) visas
   ett nytt kort, och inget körs.
3. Kör ändringen via de befintliga admin-actions (`adminCreateSpaceBlockedDate` osv.)
   med användarens token, så att Directus behörigheter gäller som i dag. Spärrar utan
   effekt (se fas 1 punkt 3) stoppas här.
4. Skriver resultatet (`executed`/`failed`) till loggen med servicekontot.

Head of Foodtruck-policyn får bara read på loggen, och bara egna rader. Ingen
användare får create/update/delete där, så loggen går inte att ändra i efterhand.
`space_closures` får create/read/update som spärrarna i dag.

### Säkerhet

- Text i data (platsbeskrivningar, spärrorsaker, foodtrucknamn) kan innehålla
  instruktioner. Värsta fallet är ett felaktigt *förslag*, och kortet visar exakt vad
  som händer. Inget skrivs utan ett mänskligt klick.
- Taket per användare: X anrop per timme och max N verktygssteg per tur.
- Inga personuppgifter i systemprompten. Verktygen returnerar foodtrucknamn och
  ägarens namn, aldrig e-post. E-post som användaren själv skriver i chatten
  (`propose_create_foodtrucker`) går däremot via modellen (EU-hostad, se modellval).
  Kortet visar e-posten i ett redigerbart fält, och det är fältets värde som skickas
  vid Bekräfta. Den som inte vill skicka e-post via modellen skriver bara namnet och
  fyller i e-posten direkt på kortet.

### UI

Knappen "Assistent" i `/admin` öppnar en sidopanel (inte en modal, så att schemat
syns bredvid). Gränssnittet är på svenska och har tre exempelfrågor som tomt läge.
Korten visas i flödet.

## Fas 3 — test och pilot

- Enhetstester för `analyzeImpact()` och policykontrollerna.
- Scenarier (~15 svenska prompts) mot staging-Directus (runbooken ligger i bf-ops)
  med förväntade förslag.
  Bland dem: J-dagen, "El saknas" okt–mars för C och D, firandet 9/11, "ändra
  Rådhustorget till heldag" (ska ge en policyvarning), en tvetydig plats ("torget"
  → agenten frågar, gissar inte) och ett datum i det förflutna.
- Pilot med de två nya Head of Foodtruck och en titt i loggen efter två veckor.

## Öppna frågor

- Svaren i fas 0. Utan dem byggs bara fas 1 punkt 3–4, som gäller oavsett regler.
- Ska Head of Foodtruck kunna skapas via assistenten? I dag sker det bara i Directus.
- Bokningar när en foodtruck tas bort: avboka, behåll eller blockera borttagning?
- Ska foodtruckern få ett mejl när en spärr läggs på en bokad tid? I dag skickar
  appen inga mejl själv, utan bara Directus gör det (lösenordsåterställning).
