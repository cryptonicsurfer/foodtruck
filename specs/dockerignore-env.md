# .env ska inte bakas in i Docker-imagen

**Mål:** Prod-imagen innehöll `/app/.env` (kontrollerat 2026-10-24 på glsfbg). Orsaken var att `.dockerignore` saknade `.env`. Därför fick `COPY . .` med filen, `next build` läste den och standalone-outputen kopierade den till `/app/.env`. Efter ändringen kommer miljön bara från build-args och `env_file`.

**Scope**
- `.dockerignore` utesluter `.env`, `.env.*` (utom `.env.example`), nycklar, `.git`, `node_modules`, `.next` m.m. Mönstret kommer från crm-mistral-flow#49.
- `NEXT_PUBLIC_*` skickades redan som build-args från `docker-compose.yml` (`${VAR}` ur `.env`), med `ARG`/`ENV` i Dockerfile.
- `APP_URL` och `DIRECTUS_URL` läggs till som build-args på samma sätt. `next.config.ts` `env:` bakar in dem vid bygget, även i serverkoden. Utan `.env` i bygget skulle `APP_URL` falla tillbaka till `http://localhost:3000`, och då skulle länken i mejlet för lösenordsåterställning (`app/actions.ts:60`) gå till localhost. Det hittades vid granskningen 2026-10-25.
- En rad i `DEPLOY.md` om varför och om att städa bort den gamla imagen.

**Utanför scope:** Basimage-pinning (`node:22-slim`) och andra Dockerfile-ändringar.

**Inventering av env i koden**

| Variabel | Var | Hur den kommer in |
|---|---|---|
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_DIRECTUS_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAP_ID` | klient + server, inbakas vid build | build-arg → `ENV` i builder-steget |
| `APP_URL`, `DIRECTUS_URL` | server, inbakas vid build via `next.config.ts` `env:` | build-arg → `ENV` i builder-steget (`env_file` når dem inte) |
| `NODE_ENV` | — | Dockerfile |

**Endpoints:** inga ändras.

**Säkerhet:** prod-`.env` innehåller i dag bara URL:er och den publika Maps-nyckeln (som ändå ligger i klientbundlen). Ändringen är framåtriktad: en hemlighet som läggs i `.env` senare ska inte hamna i imagen.

**Testplan**
1. `docker compose build` lokalt med samma `.env`-värden som prod (jämfört via hash).
2. `/app` i imagen saknar `.env*`, och `find /` hittar inga `.env`-filer.
3. Varje värde (`APP_URL`, `DIRECTUS_URL`, Maps-nyckeln och `MAP_ID`) finns i lika många filer i **både** `.next/static` och `.next/server` som i prod-imagen. `http://localhost:3000` ska inte förekomma någonstans.
4. Containern startar med `--env-file` och svarar 200 på `/` och `/booking`.
