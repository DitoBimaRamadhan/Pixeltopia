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

## Load test

```bash
npm start &
npm run loadtest -- 100 15
npm run loadtest -- 1000 20
```

See [../MULTIPLAYER.md](../MULTIPLAYER.md) and [../HOSTING.md](../HOSTING.md).
