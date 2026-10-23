# Pixeltopia Multiplayer (shared server)

**Not serverless.** One Node.js process hosts:

- HTTP auth (`/register`, `/login`)
- Gateway shards for capacity (`/servers`, least-connections)
- Shared **named world registry** (authoritative tile grid)
- Realtime WebSocket gameplay (`/ws`)

Default capacity: `SHARD_COUNT=4` × `MAX_CONN_PER_SHARD=250` = **1000** concurrent connections.

## Run locally

```bash
cd server
npm install
JWT_SECRET='change-me' npm start
# → http://127.0.0.1:8787
```

Godot desktop uses `http://127.0.0.1:8787`. Android emulator: `http://10.0.2.2:8787`.

### Load test

```bash
npm run loadtest -- 100 15
ulimit -n 4096
npm run loadtest -- 1000 20
```

## Client flow

1. Login / Register  
2. Pick a **gateway** from `/servers` (same process)  
3. World select: create / join named world (default `START`)  
4. Play: punch/place sync, chat, trade, World Lock  

Offline mode still works without the server.

## WebSocket protocol (summary)

| Client → Server | Server → Client |
|-----------------|-----------------|
| `join_world` / `create_world` / `travel` | `welcome`, `world_state`, `worlds` |
| `move` `{x,y}` tiles | `snap` nearby players |
| `punch` / `place` | `tile` broadcasts |
| `chat` | `chat` |
| `trade_*` | `trade` events |
| `inv_sync` | (soft mirror for trade checks) |

See `server/README.md` and `HOSTING.md` for env knobs and free hosting.
