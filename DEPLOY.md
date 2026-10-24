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

## 2. Server (Render free web service)

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

- Default server: `Session.DEFAULT_ONLINE_URL` (`https://pixeltopia-server.onrender.com`).
- Login screen → **Server** button: *Online* / *Lokal* (`127.0.0.1:8787`, emulator `10.0.2.2:8787`) / *Custom URL*.
  The choice is saved in `user://pixeltopia_session.cfg`.
