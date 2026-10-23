# Pixeltopia — free-tier hosting & capacity

Target: **100–1000 concurrent** players on free / cheap hardware using one Node process with **shards**.

## Architecture (single process)

```
Clients → HTTP auth (/login,/register) + GET /servers (least-connections)
        → WebSocket /ws?shard=world-N  (interest cull + TICK_HZ snapshots)
```

- **Shards**: `SHARD_COUNT` logical worlds inside one Node process (default 4 × 250 = 1000 slots).
- **Balancer**: `/servers` sorted by least connections (client also prefers emptier).
- **Interest management**: each tick, a player only receives peers within `INTEREST_RADIUS` tiles (capped 64).
- **Tick cap**: default `TICK_HZ=10` (drop to 5 under CPU pressure).
- **Compression**: WebSocket permessage-deflate for snap payloads.
- **Compact JSON**: short keys (`i,u,x,y`) to cut bandwidth.

## Realistic FREE hosting

| Provider | Free tier notes | Suggested config | Expected capacity |
|----------|-----------------|------------------|-------------------|
| **Oracle Cloud Always Free** | 1–4 OCPU ARM / 24 GB possible | `SHARD_COUNT=4`, `TICK_HZ=10`, `MAX_CONN_PER_SHARD=250` | **~500–1000** WS if RAM ≥2 GB |
| **Railway trial / hobby** | Sleep on idle; RAM ~512 MB–1 GB | `SHARD_COUNT=2`, `TICK_HZ=5`, max 150/shard | **~100–300** |
| **Render free web** | Spins down; 512 MB | same as Railway; use background worker if available | **~100–200** |
| **Self-host / old PC / VPS $5** | Best control | full defaults | **~1000** with 1–2 GB RAM |

Set `PUBLIC_HOST` to your public DNS/IP and `JWT_SECRET` to a long random string. Never commit secrets.

### Scale-down strategy (when out of resources)

1. Lower `TICK_HZ` (10 → 5 → 2).
2. Shrink `INTEREST_RADIUS` (24 → 12).
3. Reduce `SHARD_COUNT` or `MAX_CONN_PER_SHARD` so `/servers` shows full shards and clients pick others / offline.
4. Disable `COMPRESS_WS` only if CPU > RAM pressure (compression trades CPU for bandwidth).
5. Reject new WS with `1013` when shard full (already implemented).
6. Prefer **offline / single-player** button in the client when the API is unreachable.

## Capacity estimates (approx.)

| Concurrent WS | RSS (approx.) | Notes |
|---------------|---------------|-------|
| 100 | ~80–150 MB | Comfortable on any free 512 MB box |
| 500 | ~200–350 MB | Needs ≥1 GB RAM; keep tick ≤10 |
| 1000 | ~350–500 MB | Prefer Oracle free / 2 GB VPS; 4 shards × 250 |

Run locally:

```bash
cd server && npm install && node index.js
npm run loadtest -- 100 15
npm run loadtest -- 1000 20   # may need ulimit -n 4096
```

## Client notes

- Desktop: `http://127.0.0.1:8787`
- Android emulator: `http://10.0.2.2:8787`
- Physical phone: set `Session.api_base_url` to your LAN/public URL (saved in `user://pixeltopia_session.cfg`)
- **Mainkan Offline** always available if the backend is down


## Measured on this box (2026-10-23)

| Test | Result |
|------|--------|
| `npm run loadtest -- 100 12` | **PASS** — 100/100 WS, ~112 MB RSS, no crash |
| `npm run loadtest -- 1000 12` (4 shards × 250) | **PASS** — 1000/1000 WS, ~344 MB RSS, no crash |

Estimate: free 512 MB PaaS ≈ 100–200; 1–2 GB VPS / Oracle Always Free ≈ 500–1000 with defaults.
