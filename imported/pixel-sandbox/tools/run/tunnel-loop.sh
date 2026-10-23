#!/usr/bin/env bash
# Cloudflare quick tunnel (tanpa akun) -> http://localhost:3000. URL berubah tiap restart!
cd "$(dirname "$0")/../.."
while true; do
  echo "[$(date -u +%FT%TZ)] starting tunnel" >> logs/tunnel.log
  cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:3000 >> logs/tunnel.log 2>&1
  echo "[$(date -u +%FT%TZ)] tunnel exited ($?), restart in 5s" >> logs/tunnel.log
  sleep 5
done
