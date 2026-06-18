# Foodtruck — VPS deploy runbook (migrated off Frej's Vercel)

Self-hosted on the `glsfbg` VPS in Docker behind Caddy, like the rest of the
fleet. Replaces the old Vercel deploy (`foodtruck-zeta.vercel.app`).

- **Public URL:** https://foodtruck.businessfalkenberg.se
- **Container:** `foodtruck` — host `127.0.0.1:3009` → container `:3000`
- **Backend:** Directus at https://cms.businessfalkenberg.se (same VPS)
- **Repo / branch deployed:** `cryptonicsurfer/foodtruck` → `main`

## Status as of this prep

- ✅ DNS: `foodtruck.businessfalkenberg.se` → A `46.246.38.24` (old Vercel CNAME
  gone — public resolvers return only the A record).
- ✅ `/booking` crash fixed (null time-slot guard), build verified.
- ✅ Dockerfile + docker-compose.yml validated locally (image builds, `/` and
  `/booking` both return 200).
- ⏳ Needs Paul (sudo): add the Caddy block + reload Caddy, and run the container
  on the VPS.

---

## Step 1 — get the code onto the VPS

```bash
ssh -A glsfbg          # -A = agent forwarding, needed for git clone over SSH
cd ~
git clone git@github.com:cryptonicsurfer/foodtruck.git
cd foodtruck
```

(If it's already cloned: `cd ~/foodtruck && git checkout main && git pull`.)

## Step 2 — create the `.env` on the VPS

`.env` is gitignored, so it does NOT arrive via git. Create it by hand:

```bash
cat > ~/foodtruck/.env <<'EOF'
APP_URL=https://foodtruck.businessfalkenberg.se
NEXT_PUBLIC_APP_URL=https://foodtruck.businessfalkenberg.se
DIRECTUS_URL=https://cms.businessfalkenberg.se
NEXT_PUBLIC_DIRECTUS_URL=https://cms.businessfalkenberg.se
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSyAeQYmStP2N-9VgmMpNcNVkzl1GV6HC8JM
NEXT_PUBLIC_GOOGLE_MAP_ID=DEMO_MAP_ID
EOF
```

⚠️ **Google Maps key:** this is Paul's key from `~/.env.secrets`. For the map to
render, the key's *HTTP referrer restrictions* in Google Cloud Console
(APIs & Services → Credentials) must include `foodtruck.businessfalkenberg.se/*`.
Everything except the map works without this. (Frej's original prod key was not
retrievable — it lives only in his Vercel project.)

## Step 3 — build & run the container

```bash
cd ~/foodtruck
docker compose up -d --build
docker compose logs -f      # watch for "✓ Ready", Ctrl-C to stop watching
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3009/   # expect 200
```

## Step 4 — Caddy block  (needs sudo)

Add this to `/etc/caddy/Caddyfile` (e.g. near the other businessfalkenberg apps):

```caddy
# Foodtruck booking app
foodtruck.businessfalkenberg.se {
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
	reverse_proxy localhost:3009
}
```

> Note: we deliberately do **not** `import security_headers` here. That shared
> snippet's CSP (`connect-src 'self' wss://chat…`) would block the Google Maps
> JS API and tiles. Same reasoning as the `invest.falkenberg.se` block. The app
> ran without a strict CSP on Vercel, so this preserves known-good behavior.

Validate and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo journalctl -u caddy -f      # watch the Let's Encrypt cert get issued
```

DNS already points at the VPS, so Caddy issues the TLS cert on the first request.

## Step 5 — verify

```bash
curl -sI https://foodtruck.businessfalkenberg.se/ | head -5   # 200 + valid TLS
```

Open https://foodtruck.businessfalkenberg.se/booking in a browser, log in, and
confirm the booking grid renders (no client-side exception) and the map loads.

---

## Future deploys

```bash
ssh -A glsfbg
cd ~/foodtruck
git pull
docker compose up -d --build
```

## Notes / follow-ups

- **Frej's Vercel deploy** (`foodtruck-zeta.vercel.app`) is now orphaned — no DNS
  points to it. It can keep running harmlessly; ask Frej to delete it when
  convenient. It has **no DB write power on its own** — the app holds no service
  token; all writes go through per-user Directus logins, and Directus is on this
  VPS. The only standing backend access is whoever has a Directus *user* account.
- **Port 3009** was free on the VPS (3008 = bidrag-screener, 3010 = miljo-halsa).
- Internal container port stays 3000 to match the rest of the fleet; host maps
  3009→3000.
