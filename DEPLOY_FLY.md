# Deploy the Kearns Mining Rig backend to Fly.io

App: `kearns-mining-rig-backend` · Region: `iad` · Public URL after deploy: `https://kearns-mining-rig-backend.fly.dev` · Custom domain target: `api.kearns6988.com`

## What changed vs. the original zip (2026-11-10)

- `Dockerfile` + `fly.toml` added (the zip had neither).
- `server.js` hardened for production:
  - `DATA_FILE` env var — data lives on the Fly volume at `/data/data.json` so accounts survive restarts.
  - CORS restricted to the game origins (`kearns6988.com`, `www.kearns6988.com`, `kearns-mining-rig.vercel.app`, Capacitor `capacitor://localhost`, `http://localhost`). Override with `CORS_ORIGINS`.
  - Rate limiting on `/api/auth/*` (50 requests / 15 min per IP).
  - Progress saves validated: must be an object, `ore`/`level` must be non-negative numbers.
  - Withdrawal minimum is 0.001 BTC, matching the frontend.
  - The server refuses to start in production without a real `JWT_SECRET`.
- Withdrawals are still queue-only: `POST /api/withdraw` records a `pending` request and nothing ever pays it out. No Lightning integration exists yet — payouts stay disabled until wallet setup and payout rules are verified.

## Prerequisites

- `flyctl` installed and logged in (`flyctl auth login`), or `FLY_API_TOKEN` set.
- The Fly app must exist in the `justin-kearns` organization (or your default org).

## Deploy steps (run from this folder)

```bash
# 1. Create the app (first time only)
fly apps create kearns-mining-rig-backend

# 2. Persistent volume for the data file (first time only, 1 GB)
fly volumes create backend_data --region iad --size 1 --app kearns-mining-rig-backend

# 3. Secrets — generate a real JWT secret; never commit one
fly secrets set JWT_SECRET="$(openssl rand -hex 32)" --app kearns-mining-rig-backend

# 4. Deploy
fly deploy --app kearns-mining-rig-backend

# 5. Verify
curl https://kearns-mining-rig-backend.fly.dev/api/health
```

## Point api.kearns6988.com at it

After the deploy is live and healthy, in the Northwest Registered Agent / Business Identity DNS panel set:

- `api` → CNAME `kearns-mining-rig-backend.fly.dev` (or the A/AAAA records Fly shows for the app — use exactly what Fly displays).

Then verify `https://api.kearns6988.com/api/health` returns `{"status":"ok",...}`.

## Notes

- Deployed from GitHub via the Fly dashboard launch flow (2026-11-13). First deploy built fine but the machine crashed because JWT_SECRET was not set yet; the secret is set in the dashboard and applies on the next deploy.
- The app listens on port 5000; Fly terminates TLS and forwards to it.
- `min_machines_running = 1` keeps one machine up so the JSON store is always reachable (the free allowance covers one shared-cpu-1x machine).
- If the volume is ever lost, `data.json` starts empty — accounts are in that file, so keep a backup of it (`fly ssh sftp` to copy it down) before risky changes.
