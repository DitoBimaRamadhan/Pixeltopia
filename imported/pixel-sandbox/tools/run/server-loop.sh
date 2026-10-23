#!/usr/bin/env bash
# Menjalankan server game terus-menerus (restart otomatis bila crash). Storage JSON lokal.
cd "$(dirname "$0")/../.."
unset DATABASE_URL
export PORT=3000
while true; do
  echo "[$(date -u +%FT%TZ)] starting server" >> logs/server.log
  node server/index.js >> logs/server.log 2>&1
  echo "[$(date -u +%FT%TZ)] server exited ($?), restart in 2s" >> logs/server.log
  sleep 2
done
