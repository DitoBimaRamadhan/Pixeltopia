#!/usr/bin/env node
'use strict';
/**
 * Open N WebSocket connections, send moves, report memory/stats.
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
  const servers = (await getJson('/servers')).servers;
  const shard = servers[0]?.id || 'world-1';
  const wsBase = BASE.replace(/^http/, 'ws') + `/ws?shard=${encodeURIComponent(shard)}`;

  const sockets = [];
  let opens = 0;
  let errors = 0;
  let snaps = 0;

  await new Promise((resolve) => {
    let pending = COUNT;
    for (let i = 0; i < COUNT; i++) {
      const ws = new WebSocket(wsBase);
      sockets.push(ws);
      ws.on('open', () => {
        opens++;
        pending--;
        if (pending === 0) resolve();
      });
      ws.on('message', (m) => {
        try {
          const j = JSON.parse(String(m));
          if (j.t === 'snap') snaps++;
        } catch {}
      });
      ws.on('error', () => {
        errors++;
        pending--;
        if (pending <= 0) resolve();
      });
    }
    setTimeout(resolve, 20000);
  });

  console.log(`opened=${opens}/${COUNT} errors=${errors}`);
  const start = Date.now();
  const iv = setInterval(() => {
    for (const ws of sockets) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ t: 'move', x: (Math.random() * 40) | 0, y: (Math.random() * 20) | 0, seq: Date.now() }));
      }
    }
  }, 200);

  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(iv);
  const stats = await getJson('/stats');
  console.log('stats', stats);
  console.log(`snaps_received≈${snaps} elapsed_ms=${Date.now() - start}`);
  for (const ws of sockets) try { ws.close(); } catch {}
  const ok = opens >= COUNT * 0.95 && !String(stats).includes('crash');
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
