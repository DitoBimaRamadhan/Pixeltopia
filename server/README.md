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
| `SERVER_INV` | _(off)_ | `1` = **server-authoritative inventory** (v1.7.0, production: on). See below. |
| `MIN_PROTO` | `0` | Minimum client protocol (`proto` in `/login`, `/register` and the WS URL; v1.7.0 sends `2`). Older clients get HTTP 426 / WS `update_required` + `kicked` (close 4002) with an Indonesian "update ke v1.7.0" message. Production: `2`. |
| `UPDATE_URL` | GitHub `releases/latest` | Link shown to clients that must update |

`server/.env` (gitignored) is loaded automatically; host env vars win. See `.env.example`.

## Server-authoritative inventory (`SERVER_INV=1`)

The server owns every logged-in account's items and gems (`wallets`, `inventory_items`, `inventory_ledger`;
migrations v4–v6). The client only displays `{t:'inv', ver, items, gems}`; `inv_sync` is ignored and
`profile_save` no longer changes items.

- **Seeding**: once per account, from the old profile inventory (capped) or the starter kit (ledger `seed:<userId>`).
- **Place**: debit + world-event append in one transaction (`append_event_inv`); refunds use idempotent op ids.
- **Break / harvest rewards**: deterministic RNG per `(world, seq)` (`mulberry32(sha256("world:seq"))`), op id
  `drop:<userId>:<world>:<seq>` so a drop is applied exactly once even with several instances; the player gets
  `{t:'reward', items, gems, harvest}`. Seeds track readiness (`plants`, fertilizer boost, 3 s unripe grace).
- **Requests** `{t:'inv_req', op, req, …}` → `{t:'inv_result', op, req, ok, error?, result?}`:
  `craft`, `splice`, `shop_buy`, `shop_sell`, `quest_claim` (progress = ledger counts; one claim per quest), all
  validated against `lib/rules.js` (exported from the Godot item tables) and applied atomically.
- **Trades**: both sides settled in one transaction (`trade_settle`); if either side lacks an item nothing moves.
- **Guests**: no DB wallet. Each guest session gets an in-memory kit (starter kit **without** World Lock,
  `{t:'inv', guest:true}`); places/drops use it, it is gone on disconnect. Guests cannot trade, claim quests or
  lock worlds, so they can never create value that reaches an account.
- **Ground drops**: not implemented (rewards go straight to the wallet; Q-drop and Load are disabled online).
- Offline mode in the client is unchanged (local inventory and saves).

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
