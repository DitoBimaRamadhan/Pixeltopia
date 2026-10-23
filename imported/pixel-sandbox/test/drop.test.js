// Tes v1.3: DROP (jatuhkan item ke world -> bisa dipungut) dan RECYCLE (buang item).
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../public/shared');
const { ok, sleep, result, startServer, stopServer, client } = require('./helpers');

const rnd = () => Math.floor(Math.random() * 1e6);
const PASS = 'rahasia123';

async function login(url, name) {
  const c = client(url, name); await c.open;
  c.st = { inv: {}, gems: 0 };
  c.ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'inv' || m.t === 'welcome') { c.st.inv = m.inv; c.st.gems = m.gems; } });
  c.send({ t: 'register', name, pass: PASS });
  const r = await c.wait((m) => m.t === 'auth' || m.t === 'autherr', 4000, 'register ' + name);
  if (r.t !== 'auth') throw new Error('auth gagal ' + name + ': ' + r.msg);
  return c;
}
async function join(c, world) {
  await sleep(520); c.send({ t: 'join', world });
  const w = await c.wait((m) => m.t === 'welcome', 4000, 'welcome ' + c.name);
  c.welcome = w; c.me = w.players.find((p) => p.id === w.id);
  return w;
}

(async () => {
  console.log('\n===== FITUR v1.3: drop & recycle =====');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-dr-'));
  const port = 4400 + Math.floor(Math.random() * 400);
  const url = 'ws://127.0.0.1:' + port;
  const proc = await startServer({ DATA_DIR: dir, DATABASE_URL: '', PORT: String(port), START_GEMS: '500' });
  const W = 'DR' + rnd();
  const A = await login(url, 'drA' + rnd()), B = await login(url, 'drB' + rnd()), C = await login(url, 'drC' + rnd());
  await join(A, W); await join(B, W);
  await sleep(220); A.send({ t: 'buy', i: S.SHOP.findIndex((s) => s.id === 2) });
  await A.wait((m) => m.t === 'bought', 2000, 'buy dirt');
  const d0 = A.st.inv[2];
  ok(d0 >= 10, 'A punya Dirt untuk dijatuhkan');

  await sleep(260); A.send({ t: 'drop', id: 2, n: 4 });
  const dm = await B.wait((m) => m.t === 'drop', 2000, 'drop broadcast');
  await sleep(100);
  ok(A.st.inv[2] === d0 - 4, 'DROP: item berkurang dari inventori penjatuh');
  ok(dm.d.id === 2 && dm.d.n === 4, 'DROP: pemain lain melihat item tergeletak (broadcast drop)');

  await sleep(260); A.send({ t: 'drop', id: 2, n: 999 });
  ok(/tidak cukup/.test((await A.wait((m) => m.t === 'err', 2000, 'drop too many')).msg), 'DROP lebih dari yang dimiliki ditolak');

  const wc = await join(C, W);
  ok((wc.world.drops || []).some((d) => d.k === dm.d.k && d.n === 4), 'Pemain yang baru masuk melihat item tergeletak (welcome)');

  // B jalan ke posisi item -> otomatis memungut.
  const b0 = B.st.inv[2] || 0;
  await sleep(400);
  B.send({ t: 'move', x: dm.d.x - S.PHYS.PW / 2, y: B.me.y, f: 1 });
  const pk = await B.wait((m) => m.t === 'picked', 2000, 'picked');
  const ud = await A.wait((m) => m.t === 'undrop' && m.k === dm.d.k, 2000, 'undrop');
  await sleep(100);
  ok(pk.id === 2 && pk.n === 4 && (B.st.inv[2] || 0) === b0 + 4, 'Pemain lain memungut item (masuk inventori)');
  ok(!!ud, 'Item hilang dari world setelah dipungut (broadcast undrop)');

  // RECYCLE
  const a1 = A.st.inv[2];
  await sleep(260); A.send({ t: 'trash', id: 2, n: 3 });
  const tr = await A.wait((m) => m.t === 'trashed', 2000, 'trashed');
  await sleep(80);
  ok(tr.n === 3 && A.st.inv[2] === a1 - 3, 'RECYCLE: item dibuang dari inventori');
  await sleep(260); A.send({ t: 'trash', id: 2, n: -5 });
  await sleep(260); A.send({ t: 'trash', id: 2, n: 1e6 });
  ok(/tidak cukup/.test((await A.wait((m) => m.t === 'err', 2000, 'trash too many')).msg) && A.st.inv[2] === a1 - 3, 'RECYCLE jumlah tidak valid ditolak');

  await A.close(); await B.close(); await C.close();
  await stopServer(proc);
  fs.rmSync(dir, { recursive: true, force: true });
  const r = result();
  console.log(`\nHasil drop/recycle: ${r.passed} lulus, ${r.failed} gagal`);
  process.exit(r.failed ? 1 : 0);
})().catch((e) => { console.error('GAGAL:', e.stack || e.message); process.exit(1); });
