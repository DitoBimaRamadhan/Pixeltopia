#!/usr/bin/env node
'use strict';
/**
 * Open N WebSocket connections across gateway shards (shared one-process server).
 * Usage: node loadtest.js [count=100] [seconds=15]
 */
const http = require('http');
const { WebSocket } = require('ws');

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const COUNT = Number(process.argv[2] || 100);
const SECONDS = Number(process.argv[3] || 15);

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE + path, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const health = await getJson('/health');
  console.log('health', health);
  if (health.mode && health.mode !== 'shared-process') {
    console.error('FAIL: expected shared-process mode, got', health.mode);
    process.exit(1);
  }
  const servers = (await getJson('/servers')).servers || [];
  if (!servers.length) {
    console.error('FAIL: no gateway shards');
    process.exit(1);
  }
  const capacity = servers.reduce((n, s) => n + (s.maxPlayers || 0), 0);
  console.log(`shards=${servers.length} capacity=${capacity} requesting=${COUNT}`);
  if (COUNT > capacity) {
    console.warn(`WARN: COUNT ${COUNT} > capacity ${capacity}; expecting some rejects`);
  }

  const sockets = [];
  let opens = 0;
  let errors = 0;
  let welcomes = 0;
  let closes = 0;

  await new Promise((resolve) => {
    let pending = COUNT;
    const doneOne = () => {
      pending--;
      if (pending <= 0) resolve();
    };
    for (let i = 0; i < COUNT; i++) {
      const shard = servers[i % servers.length];
      const wsBase = BASE.replace(/^http/, 'ws') + `/ws?shard=${encodeURIComponent(shard.id)}`;
      const ws = new WebSocket(wsBase);
      sockets.push(ws);
      ws.on('open', () => {
        opens++;
        doneOne();
      });
      ws.on('message', (m) => {
        try {
          const j = JSON.parse(String(m));
          if (j.t === 'welcome' || j.t === 'snap' || j.t === 'world_state') welcomes++;
        } catch {}
      });
      ws.on('close', () => { closes++; });
      ws.on('error', () => {
        errors++;
        doneOne();
      });
    }
    setTimeout(resolve, 30000);
  });

  console.log(`opened=${opens}/${COUNT} errors=${errors} welcomes≈${welcomes}`);
  const start = Date.now();
  const iv = setInterval(() => {
    for (let i = 0; i < sockets.length; i++) {
      const ws = sockets[i];
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          t: 'move',
          x: (Math.random() * 40) | 0,
          y: (Math.random() * 20) | 0,
          seq: Date.now() + i,
        }));
      }
    }
  }, 250);

  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(iv);
  let stats = {};
  try { stats = await getJson('/stats'); } catch (e) { stats = { error: String(e) }; }
  console.log('stats', stats);
  console.log(`elapsed_ms=${Date.now() - start}`);
  for (const ws of sockets) try { ws.close(); } catch {}
  const target = Math.min(COUNT, capacity);
  const ok = opens >= target * 0.95 && !stats.error && stats.mode !== 'serverless';
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
