# Pixeltopia Server (shared process)

Node.js **HTTP + WebSocket** gateway. **One process** — not serverless — with gateway shards for capacity and a shared named-world registry.

## Quick start

```bash
cd server
npm install
JWT_SECRET='change-me' node index.js
# → http://127.0.0.1:8787
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | `{username,password}` → token |
| POST | `/login` | `{username,password}` → token |
| GET | `/servers` | Gateway shards (least-connections) |
| GET | `/worlds` | Named worlds |
| GET | `/health` | Liveness + capacity |
| GET | `/stats` | Connections, worlds, RSS |
| WS | `/ws?shard=gateway-1&token=...` | Game channel |

### Env

`PORT`, `JWT_SECRET`, `SHARD_COUNT` (4), `MAX_CONN_PER_SHARD` (250), `TICK_HZ` (10), `INTEREST_RADIUS` (24), `PUBLIC_HOST`.

Persistence (v1.7.0):

| Var | Default | Meaning |
|-----|---------|---------|
| `DATABASE_URL` | _(unset)_ | Postgres connection string (Neon / Supabase / any). Unset → JSON files in `server/data/` |
| `PG_DRIVER` | `pg` | `pg` = TCP :5432, `neon` = Neon serverless driver over WebSocket :443 (when :5432 is blocked) |
| `PG_POOL_MAX` | `5` | Pool size |
| `SAVE_INTERVAL_MS` | `30000` | Dirty worlds + player profiles are flushed this often |

`server/.env` (gitignored) is loaded automatically; host env vars win. See `.env.example`.

## Persistence

- **Schema migrations** run on startup (`schema_migrations` table): `users`, `sessions`, `worlds`, `profiles`, `trades`.
- **Worlds**: blocks (Int32 grid, base64), owner, World Lock owner + access list. Saved on create, every
  `SAVE_INTERVAL_MS` when dirty, when a player leaves / the world empties, and on `SIGTERM`/`SIGINT`.
- **Profiles** (per account): inventory/backpack, XP/level, badges, avatar — client sends `profile_save`,
  server returns it in `welcome.profile` on the next login.
- **Trades**: completed trades are logged (`trades` table / `data/trades.log`).
- **World Lock access** (chat): `/access <user>`, `/unaccess <user>`, `/accesslist`.

## Load test

```bash
npm start &
npm run loadtest -- 100 15
npm run loadtest -- 1000 20
```

See [../MULTIPLAYER.md](../MULTIPLAYER.md) and [../HOSTING.md](../HOSTING.md).
