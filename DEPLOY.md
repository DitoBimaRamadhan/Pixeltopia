# Pixeltopia v1.7.0 — online database + public server

```
APK ──HTTPS/WSS──► pixeltopia-server (Render free, Node + ws, long-lived WebSockets)
                        │
                        └──► Postgres (Neon free) — users, sessions, worlds, profiles, trades
```

## 1. Database (Neon, free)

A Neon Postgres project (region `aws-ap-southeast-1`, Singapore) was created with
`npx neon@latest claim create`. Unclaimed Neon projects expire after ~72 h, so **claim it**:
sign in at Neon via the claim link, then copy the **pooled connection string** from
Neon Console → *Connect*. Any Postgres works (Supabase: Project → Settings → Database → URI).

The server creates/upgrades its tables on startup (`schema_migrations`), no manual SQL needed.

## 2. Server — Deno Deploy (free, no credit card, GitHub login) — recommended

The Node server runs unchanged on Deno Deploy (Node compat; `server/package.json` has
`"type": "commonjs"`). Build/run config lives in the root `deno.json`:
install `cd server && deno install`, entrypoint `./server/index.js`, cwd `./server`.
With `DENO_DEPLOY` set and no `PORT`, the server listens on 8000.

1. <https://console.deno.com> → **Continue with GitHub** → create an organization (any slug).
2. **New App** → GitHub → repo `DitoBimaRamadhan/Pixeltopia`, branch `main`
   (install the Deno Deploy GitHub app for that repo if asked). App directory: repo root.
   The config is read from `deno.json` (dashboard build fields are locked — that's expected).
3. App → **Settings → Environment Variables** (context *Production*, mark as secret):
   - `DATABASE_URL` = Neon **pooled** connection string
   - `PG_DRIVER` = `neon` (Postgres over WebSocket :443)
   - `JWT_SECRET` = long random string
   - optional: `SHARD_COUNT=2`, `MAX_CONN_PER_SHARD=150`
   Then redeploy (Builds → *Deploy Default Branch*).
4. URL is `https://<app>.<org>.deno.net`. Check `/health` → `"storage":"postgres","runtime":"deno"`.
5. Put that URL in `scripts/auth/session.gd` → `DEFAULT_ONLINE_URL` (or in-game Server → Custom).

Free plan: 1M requests, 20 GiB egress, 10 CPU-h, 150 GiB-h memory per month. The app scales to
zero when idle (cold start < 1 s); open WebSockets + the server's 25 s ping keep it alive.
Instances can be evicted/restarted at any time — worlds are flushed to Postgres every 30 s and
on SIGINT, and the client should reconnect.

## 2b. Docker hosts (Back4app Containers free, Zeabur, HF Spaces, VPS)

Root `Dockerfile` (+ `.dockerignore`, only `server/` is copied) listens on `$PORT` (default 8080).
Back4app: <https://containers.back4app.com> → Login with GitHub → *Deploy a web app* → repo →
root dir `./`, port `8080`, env `DATABASE_URL`, `PG_DRIVER=neon`, `JWT_SECRET`.
The server derives its public `wss://` address from `X-Forwarded-Proto/Host`; override with
`PUBLIC_HOST`, `PUBLIC_PORT`, `PUBLIC_PROTO` if needed.

## 2c. Server (Render free web service) — needs a card for verification


1. Open <https://render.com/deploy?repo=https://github.com/DitoBimaRamadhan/Pixeltopia>
   and sign in (GitHub login is fine). Render reads `render.yaml`.
2. When asked for `DATABASE_URL`, paste the Neon connection string. `JWT_SECRET` is generated.
3. Apply. The service is `pixeltopia-server` → `https://pixeltopia-server.onrender.com`
   (if Render adds a suffix, set that URL in the game: Login → **Server** → Custom).
4. Check `https://pixeltopia-server.onrender.com/health` → `"storage":"postgres"`.

Free Render instances sleep after ~15 min without traffic; the first request wakes them (~30–60 s).
World state is flushed to Postgres on SIGTERM, so nothing is lost when it sleeps.

### Alternatives (Dockerfile in `server/`)

- **Fly.io**: `cd server && fly launch --copy-config --no-deploy && fly secrets set DATABASE_URL=... JWT_SECRET=... && fly deploy`
- **Koyeb / Railway**: deploy the GitHub repo with root/work dir `server` (Dockerfile or `npm start`),
  set `DATABASE_URL` and `JWT_SECRET`, expose port `8787` (or the platform's `PORT`).

## 3. Game client

- Default server: `Session.DEFAULT_ONLINE_URL` (`https://pixeltopia-server.ditobimaramadhan.deno.net`). Saved `*.onrender.com` addresses (retired) are migrated to Online on launch.
- Login screen → **Server** button: *Online* / *Lokal* (`127.0.0.1:8787`, emulator `10.0.2.2:8787`) / *Custom URL*.
  The choice is saved in `user://pixeltopia_session.cfg`.
