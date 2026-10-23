// Tes v1.4: data pemain & world selamat saat server di-restart (SIGTERM = redeploy Render) walau pemain masih online.
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../public/shared');
const { ok, sleep, result, startServer, stopServer, client } = require('./helpers');

const rnd = () => Math.floor(Math.random() * 1e6);
const PASS = 'rahasia123';
async function auth(url, name, kind, extra = {}) {
  const c = client(url, name); await c.open;
  c.st = { inv: {}, gems: 0 };
  c.ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'inv' || m.t === 'welcome') { c.st.inv = m.inv; c.st.gems = m.gems; } });
  c.send({ t: kind, name, pass: PASS, ...extra });
  const r = await c.wait((m) => m.t === 'auth' || m.t === 'autherr', 4000, kind);
  if (r.t !== 'auth') throw new Error('auth gagal: ' + r.msg);
  c.token = r.token; return c;
}
async function join(c, world) {
  await sleep(520); c.send({ t: 'join', world });
  const w = await c.wait((m) => m.t === 'welcome', 4000, 'welcome');
  c.welcome = w; c.me = w.players.find((p) => p.id === w.id); c.tiles = w.world.tiles.slice(); c.W = w.world.w;
  c.ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'tile') c.tiles[m.y * c.W + m.x] = m.id; });
  return w;
}

(async () => {
  console.log('\n===== v1.4: data aman saat restart/redeploy =====');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ps-'));
  const port = 4900 + Math.floor(Math.random() * 400);
  const url = 'ws://127.0.0.1:' + port;
  const env = { DATA_DIR: dir, DATABASE_URL: '', PORT: String(port), START_GEMS: '500' };
  let proc = await startServer(env);
  const name = 'per' + rnd(), W = 'PS' + rnd();
  const A = await auth(url, name, 'register');
  await join(A, W);
  await sleep(220); A.send({ t: 'buy', i: S.SHOP.findIndex((s) => s.id === 300) });
  await A.wait((m) => m.t === 'bought', 2000, 'buy');
  await sleep(160); A.send({ t: 'equip', slot: 'hat', id: 300 });
  await A.wait((m) => m.t === 'peq', 2000, 'peq');
  // Taruh dirt di udara dekat pemain.
  const tx = Math.floor((A.me.x + S.PHYS.PW / 2) / S.TILE) + 1, ty = Math.floor(A.me.y / S.TILE) - 1;
  await sleep(150); A.send({ t: 'place', x: tx, y: ty, item: 2 });
  const pl = await A.wait((m) => (m.t === 'tile' && m.x === tx && m.y === ty) || m.t === 'err', 2000, 'place');
  await sleep(300); A.send({ t: 'drop', id: 2, n: 3 });
  await A.wait((m) => m.t === 'drop', 2000, 'drop');
  await sleep(150);
  const before = { inv: { ...A.st.inv }, gems: A.st.gems, tile: A.tiles[ty * A.W + tx] };
  ok(pl.t === 'tile' && before.tile === 2, 'Blok ditaruh sebelum restart');
  // Restart TANPA disconnect dulu (langsung SIGTERM, < 5 dtk setelah perubahan -> belum ada flush berkala).
  await stopServer(proc);
  ok(proc.exitCode === 0, 'Server keluar bersih (exit 0) setelah SIGTERM');
  proc = await startServer(env);
  // Token hilang pun tetap bisa: login dengan password.
  const B = await auth(url, name, 'login');
  const w = await join(B, W);
  ok(JSON.stringify(B.st.inv) === JSON.stringify(before.inv), 'Inventori sama setelah restart: ' + JSON.stringify(B.st.inv));
  ok(B.st.gems === before.gems, `Gem sama setelah restart (${before.gems} -> ${B.st.gems})`);
  ok(w.equip.hat === 300, 'Pakaian yang dipakai tetap tersimpan');
  ok(w.world.tiles[ty * w.world.w + tx] === 2, 'Blok yang ditaruh tetap ada di world');
  ok((w.world.drops || []).some((d) => d.id === 2 && d.n === 3), 'Item yang dijatuhkan tetap tergeletak setelah restart');
  B.close(); A.close();
  await stopServer(proc);
  fs.rmSync(dir, { recursive: true, force: true });
  const r = result(); console.log(`\nHasil: ${r.passed} lulus, ${r.failed} gagal`);
  process.exit(r.failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
