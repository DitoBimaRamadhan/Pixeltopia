# Pixeltopia Server (auth + shards)

Node.js **HTTP + WebSocket** gateway for Pixeltopia. Free-tier friendly: one process, multiple **shards**, least-connections balancing, interest culling, tick caps, optional permessage-deflate.

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
| POST | `/register` | `{username,password}` → `{token,username,userId}` |
| POST | `/login` | `{username,password}` → `{token,...}` |
| GET | `/servers` | Joinable shards sorted by least connections |
| GET | `/health` | Liveness |
| GET | `/stats` | Connections + RSS |
| WS | `/ws?shard=world-1&token=...` | Game channel |

Passwords are **scrypt**-hashed in `data/users.json`. Set `JWT_SECRET` in production (default is local-dev only).

### Env knobs

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8787` | Listen port |
| `JWT_SECRET` | dev default | HMAC secret |
| `SHARD_COUNT` | `4` | Logical worlds in one process |
| `MAX_CONN_PER_SHARD` | `250` | Cap per shard (4×250 ≈ 1000) |
| `TICK_HZ` | `10` | Snapshot rate (lower = less CPU) |
| `INTEREST_RADIUS` | `24` | Only nearby players in snaps |
| `COMPRESS_WS` | on | permessage-deflate |
| `PUBLIC_HOST` | `127.0.0.1` | Host shown in `/servers` |

## Load test

```bash
npm start &
npm run loadtest -- 100 15
# estimate 1000:
npm run loadtest -- 1000 20
```

See [HOSTING.md](../HOSTING.md) for free hosting and scale-down strategy.

## Client

Godot client uses `Session.api_base_url` (desktop `http://127.0.0.1:8787`, Android emulator `http://10.0.2.2:8787`). If unreachable, **Mainkan Offline** still works with a local session.
