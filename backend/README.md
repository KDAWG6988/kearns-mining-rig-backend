# Kearns Mining Rig — Backend

REST API for the game: accounts, cloud save sync, premium tiers, withdrawals, referrals, leaderboard.

## Run it (local)

```bash
cd backend
npm install
npm start          # serves on http://localhost:5000
```

Test it: `curl http://localhost:5000/api/health`

## Environment variables (optional)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | HTTP port |
| `JWT_SECRET` | `dev-secret-change-me` | **Set a long random string in production** — signs all auth tokens. The server refuses to start in production without one. |
| `DATA_FILE` | `./data.json` | Path to the JSON data store. On Fly this is `/data/data.json` (the persistent volume). |
| `CORS_ORIGINS` | game origins | Comma-separated list of allowed frontend origins. |
| `NODE_ENV` | — | Set to `production` on Fly; enables the JWT_SECRET startup check. |

No database server needed — data persists to `backend/data.json`. The original spec in `../BACKEND_API.md` used MongoDB; swap the `loadDB`/`saveDB` helpers in `server.js` for Mongoose calls if you outgrow the file store (schemas are already in that doc).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | none | liveness check |
| POST | `/api/auth/register` | none | body: `{username, password, email?, referredBy?}` → `{token, user}` |
| POST | `/api/auth/login` | none | body: `{username, password}` → `{token, user}` |
| GET | `/api/user/profile` | Bearer token | account info |
| POST | `/api/user/progress` | Bearer token | cloud-save the game state object |
| GET | `/api/user/progress` | Bearer token | load saved game state |
| POST | `/api/premium/subscribe` | Bearer token | body: `{tier: "bronze"\|"silver"\|"gold"}` |
| POST | `/api/withdraw` | Bearer token | body: `{amount, btcWallet}` → queued withdrawal |
| GET | `/api/withdrawals/history` | Bearer token | this user's withdrawals |
| GET | `/api/referral/link` | Bearer token | referral code + link + count |
| GET | `/api/leaderboard` | none | top 25 by ore |

Auth = `Authorization: Bearer <token>` header; tokens expire in 30 days.

## Connecting the frontend

The frontend currently saves progress only to `localStorage` (no API calls yet). To enable cloud saves, add to `src/App.vue`:

```js
const API_URL = 'http://localhost:5000/api'   // change when deployed

// after login, store the token:
// localStorage.setItem('apiToken', token)

async function cloudSave() {
  await fetch(`${API_URL}/user/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('apiToken')}` },
    body: JSON.stringify(gameState)   // the same object saveProgress() builds
  })
}
```

For production, deploy this folder to Render/Railway/Fly/Heroku, set `JWT_SECRET`, and point `API_URL` at your public URL.
