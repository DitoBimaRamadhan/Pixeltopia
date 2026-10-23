// Tes end-to-end: menjalankan server sendiri (port acak, data sementara) lalu menguji
// akun/login, sesi tunggal, gameplay multiplayer, toko gem, World Lock + /access, dan persistensi restart.
//   npm test                                      -> backend JSON
//   TEST_DATABASE_URL=postgresql://... npm test   -> juga diulang dengan backend PostgreSQL
//   TEST_URL=ws://host:port npm test              -> tes dasar ke server yang sudah jalan (tanpa restart)
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../public/shared');
const { ok, sleep, result, startServer, stopServer, client } = require('./helpers');

const rnd = () => Math.floor(Math.random() * 1e6);
const PASS = 'rahasia123';

async function login(url, name, pass = PASS, kind = 'login') {
  const c = client(url, name); await c.open;
  c.send({ t: kind, name, pass });
  const r = await c.wait((m) => m.t === 'auth' || m.t === 'autherr', 4000, kind + ' ' + name);
  c.token = r.token; c.res = r;
  return c;
}
async function join(c, world) {
  c.send({ t: 'join', world });
  const w = await c.wait((m) => m.t === 'welcome', 4000, 'welcome ' + c.name);
  c.welcome = w; return w;
}
const airAbove = (world, col) => { let y = 0; while (world.tiles[(y + 1) * world.w + col] === 0) y++; return y; };

async function suite(label, env, remoteUrl) {
  console.log(`\n===== ${label} =====`);
  let proc = null, url = remoteUrl;
  if (!remoteUrl) {
    const port = 3200 + Math.floor(Math.random() * 500);
    url = 'ws://127.0.0.1:' + port;
    env = { ...env, PORT: String(port), START_GEMS: '500' };
    proc = await startServer(env);
  }
  const WORLD = 'TEST' + rnd();
  const nA = 'alice' + rnd(), nB = 'bob' + rnd();

  // ---------- Akun ----------
  console.log('[akun & login]');
  const pre = client(url, 'x'); await pre.open;
  pre.send({ t: 'join', world: WORLD });
  ok((await pre.wait((m) => m.t === 'autherr', 2000, 'join tanpa login')).msg.match(/login/i), 'Join tanpa login ditolak');
  pre.send({ t: 'register', name: 'zz' + rnd(), pass: '123' });
  ok(/Password/.test((await pre.wait((m) => m.t === 'autherr', 2000, 'pass pendek')).msg), 'Password terlalu pendek ditolak');
  await pre.close();

  let A = await login(url, nA, PASS, 'register');
  ok(A.res.t === 'auth' && typeof A.token === 'string' && A.token.length >= 32, 'Register akun A -> dapat token sesi');
  const B = await login(url, nB, PASS, 'register');
  ok(B.res.t === 'auth', 'Register akun B');
  const dup = await login(url, nA.toUpperCase(), PASS, 'register');
  ok(dup.res.t === 'autherr' && /dipakai/.test(dup.res.msg), 'Register nama yang sudah dipakai ditolak');
  await dup.close();
  const bad = await login(url, nA, 'salahsalah');
  ok(bad.res.t === 'autherr' && /salah/.test(bad.res.msg), 'Login dengan password salah ditolak');
  await bad.close();

  // Sesi tunggal: login kedua menendang sesi pertama.
  const oldToken = A.token;
  const A2 = await login(url, nA);
  ok(A2.res.t === 'auth' && A2.token !== oldToken, 'Login ulang dengan password benar -> token baru');
  const kicked = await A.wait((m) => m.t === 'err' && m.fatal, 2000, 'kick');
  ok(kicked.kicked === true, 'Sesi lama ditendang (satu sesi per akun)');
  await sleep(100); ok(A.closed, 'Koneksi sesi lama ditutup server');
  const stale = client(url, nA); await stale.open;
  stale.send({ t: 'resume', name: nA, token: oldToken });
  ok((await stale.wait((m) => m.t === 'auth' || m.t === 'autherr', 2000, 'resume lama')).t === 'autherr', 'Token lama tidak berlaku lagi');
  await sleep(350);
  stale.send({ t: 'resume', name: nA, token: A2.token });
  const res = await stale.wait((m) => m.t === 'auth' || m.t === 'autherr', 2000, 'resume baru');
  ok(res.t === 'auth', 'Resume dengan token terbaru berhasil (auto-login)');
  A = stale; A.token = res.token;
  await A2.wait((m) => m.t === 'err' && m.fatal, 2000, 'kick A2'); await A2.close();

  // ---------- Gameplay dasar ----------
  console.log('[multiplayer]');
  const wa = await join(A, WORLD);
  const wb = await join(B, WORLD);
  ok(wa.world.tiles.length === 100 * 60 && wb.world.name === WORLD, 'Kedua client masuk ke world yang sama (100x60)');
  ok(wb.players.some((p) => p.id === wa.id), 'B melihat A di daftar pemain');
  await A.wait((m) => m.t === 'pjoin' && m.p.id === wb.id, 2000, 'A sees B join');
  ok(true, 'A menerima event B join');
  ok(wa.world.owner === null, 'World baru belum dikunci');
  const world = wa.world, w = world.w;
  ok(world.tiles.slice(w * (world.h - 1)).every((t) => t === 1), 'Baris paling bawah = bedrock');

  const me = wa.players.find((p) => p.id === wa.id);
  const col = Math.floor((me.x + S.PHYS.PW / 2) / S.TILE);
  const tx = col + 2, ty = airAbove(world, tx);
  A.send({ t: 'place', x: tx, y: ty, item: 2 });
  const seen = await B.wait((m) => m.t === 'tile' && m.x === tx && m.y === ty, 2000, 'B sees placed block');
  ok(seen.id === 2, `A menaruh Dirt di (${tx},${ty}) -> B melihatnya`);
  const invA = await A.wait((m) => m.t === 'inv', 2000, 'inv after place');
  ok(invA.inv[2] === 19, 'Inventori A berkurang (20 -> 19 Dirt)');
  for (let i = 0; i < 3; i++) { A.send({ t: 'punch', x: tx, y: ty }); await sleep(160); }
  ok(!!(await B.wait((m) => m.t === 'tile' && m.x === tx && m.y === ty && m.id === 0, 2000, 'B sees break')), 'A memukul 3x -> blok hancur, B melihatnya');
  const loot = await A.wait((m) => m.t === 'loot', 2000, 'loot');
  ok(loot.gems > 0, `Drop gems: +${loot.gems}`);
  A.send({ t: 'place', x: tx + 30, y: ty, item: 2 });
  ok(/jauh/i.test((await A.wait((m) => m.t === 'err', 2000, 'reach')).msg), 'Server menolak aksi di luar jangkauan');
  await sleep(120);
  A.send({ t: 'place', x: tx, y: ty, item: 6 });
  ok(/inventori/i.test((await A.wait((m) => m.t === 'err', 2000, 'inv err')).msg), 'Server menolak item yang tidak dimiliki');
  await sleep(120);
  A.send({ t: 'move', x: me.x + 2000, y: me.y, f: 1 });
  ok(Math.abs((await A.wait((m) => m.t === 'pos', 2000, 'tp')).x - me.x) < 1, 'Server menolak teleport');
  await sleep(100);
  A.send({ t: 'move', x: me.x + 3, y: me.y, f: 1 });
  ok(Math.abs((await B.wait((m) => m.t === 'pmove' && m.id === wa.id, 2000, 'move')).x - (me.x + 3)) < 0.01, 'B melihat A bergerak');
  A.send({ t: 'place', x: tx, y: ty, item: 102 });
  const tree = await B.wait((m) => m.t === 'tree' && m.x === tx && m.y === ty, 2000, 'tree');
  ok(tree.tree && tree.tree.type === 2, 'A menanam Dirt Seed -> B melihat pohon');
  await sleep(120);
  A.send({ t: 'place', x: tx, y: ty, item: 103 });
  ok(!!(await B.wait((m) => m.t === 'tree' && m.x === tx && m.tree && m.tree.type === 6, 2000, 'splice')), 'Splice Dirt + Rock -> pohon Brick');
  A.send({ t: 'chat', msg: 'halo dari tes' });
  ok((await B.wait((m) => m.t === 'chat' && m.msg === 'halo dari tes', 2000, 'chat')).from === nA, 'Chat world diterima B');

  // ---------- Toko & World Lock ----------
  console.log('[toko & world lock]');
  const lockIdx = S.SHOP.findIndex((s) => s.id === S.WORLD_LOCK);
  const gemsBefore = (A.msgs.filter((m) => m.t === 'inv').pop() || invA).gems;
  A.msgs = A.msgs.filter((m) => m.t !== 'inv');
  A.send({ t: 'buy', i: lockIdx });
  await A.wait((m) => m.t === 'bought', 2000, 'bought');
  const invL = await A.wait((m) => m.t === 'inv' && m.inv[S.WORLD_LOCK] === 1, 2000, 'inv lock');
  ok(invL.gems === gemsBefore - S.SHOP[lockIdx].price, `Beli World Lock seharga ${S.SHOP[lockIdx].price} gem`);
  const lx = col + 3, ly = airAbove(world, lx);
  await sleep(150);
  A.send({ t: 'place', x: lx, y: ly, item: S.WORLD_LOCK });
  const lk = await B.wait((m) => m.t === 'lock', 2000, 'lock broadcast');
  ok(lk.owner === nA.toLowerCase(), 'A menaruh World Lock -> A jadi pemilik (B menerima info lock)');

  const bx = col - 2, by = airAbove(world, bx);
  B.send({ t: 'place', x: bx, y: by, item: 2 });
  ok(/dikunci/.test((await B.wait((m) => m.t === 'err', 2000, 'B place denied')).msg), 'B (bukan pemilik) tidak bisa menaruh blok');
  await sleep(150);
  B.send({ t: 'punch', x: bx, y: by + 1 });
  ok(/dikunci/.test((await B.wait((m) => m.t === 'err', 2000, 'B punch denied')).msg), 'B tidak bisa memukul/menghancurkan blok');
  await sleep(150);
  B.send({ t: 'punch', x: tx, y: ty });
  ok(/dikunci/.test((await B.wait((m) => m.t === 'err', 2000, 'B harvest denied')).msg), 'B tidak bisa memanen pohon');
  B.send({ t: 'chat', msg: `/access add ${nB}` });
  ok(/pemilik/.test((await B.wait((m) => m.t === 'chat' && m.from === '*' && /pemilik|akses/i.test(m.msg), 2000, 'B access deny')).msg), 'B tidak bisa memberi dirinya /access');

  A.send({ t: 'chat', msg: `/access add ${nB}` });
  await A.wait((m) => m.t === 'chat' && /bisa membangun/.test(m.msg), 2000, 'access add');
  const la = await B.wait((m) => m.t === 'lock' && m.access.includes(nB.toLowerCase()), 2000, 'lock access');
  ok(!!la, 'A: /access add B -> B mendapat akses');
  await sleep(150);
  B.send({ t: 'place', x: bx, y: by, item: 2 });
  ok((await A.wait((m) => m.t === 'tile' && m.x === bx && m.y === by, 2000, 'B place ok')).id === 2, 'B dengan akses bisa menaruh blok');
  await sleep(150);
  B.send({ t: 'punch', x: lx, y: ly });
  ok(/pemilik/.test((await B.wait((m) => m.t === 'err', 2000, 'B lock break')).msg), 'B (akses) tetap tidak bisa mencabut World Lock');
  await sleep(450);
  B.send({ t: 'buy', i: lockIdx }); await B.wait((m) => m.t === 'bought', 2000, 'B buy lock');
  await sleep(150);
  B.send({ t: 'place', x: bx, y: by - 1, item: S.WORLD_LOCK });
  ok(/sudah punya/.test((await B.wait((m) => m.t === 'err', 2000, '2nd lock')).msg), 'World Lock kedua di world yang sama ditolak');
  A.send({ t: 'chat', msg: `/access remove ${nB}` });
  await B.wait((m) => m.t === 'lock' && !m.access.includes(nB.toLowerCase()), 2000, 'access removed');
  await sleep(150);
  B.send({ t: 'punch', x: bx, y: by });
  ok(/dikunci/.test((await B.wait((m) => m.t === 'err', 2000, 'B after remove')).msg), '/access remove -> B ditolak lagi');

  // ---------- Persistensi (restart server) ----------
  if (proc) {
    console.log('[persistensi]');
    const gemsA = invL.gems;
    await A.close(); await B.close(); await sleep(300);
    await stopServer(proc);
    proc = await startServer(env);
    const A3 = await login(url, nA);
    ok(A3.res.t === 'auth', 'Setelah restart: login dengan password tetap bisa (akun tersimpan)');
    const w3 = await join(A3, WORLD);
    ok(w3.world.owner === nA.toLowerCase(), 'Setelah restart: World Lock & pemilik tersimpan');
    ok(w3.world.tiles[by * w3.world.w + bx] === 2 && w3.world.trees[tx + ',' + ty] && w3.world.trees[tx + ',' + ty].type === 6, 'Setelah restart: blok & pohon tersimpan');
    ok(w3.gems === gemsA && !w3.inv[S.WORLD_LOCK], 'Setelah restart: gem & inventori tersimpan');
    // Pemilik mencabut lock -> world bebas, lock kembali ke inventori.
    for (let i = 0; i < S.BLOCKS[S.WORLD_LOCK].hp; i++) { A3.send({ t: 'punch', x: lx, y: ly }); await sleep(160); }
    const un = await A3.wait((m) => m.t === 'lock', 2000, 'unlock');
    const invU = await A3.wait((m) => m.t === 'inv' && m.inv[S.WORLD_LOCK] === 1, 2000, 'lock back');
    ok(un.owner === null && !!invU, 'Pemilik mencabut World Lock -> world bebas, lock kembali ke inventori');
    await A3.close();
    await stopServer(proc);
  } else { await A.close(); await B.close(); }
}

(async () => {
  const remote = process.env.TEST_URL;
  if (remote) await suite('server remote ' + remote, {}, remote);
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-e2e-'));
    await suite('backend JSON', { DATA_DIR: dir, DATABASE_URL: '' });
    fs.rmSync(dir, { recursive: true, force: true });
    if (process.env.TEST_DATABASE_URL) await suite('backend PostgreSQL', { DATABASE_URL: process.env.TEST_DATABASE_URL });
    else console.log('\n(Lewati e2e PostgreSQL: set TEST_DATABASE_URL untuk menguji)');
  }
  const r = result();
  console.log(`\nHasil: ${r.passed} lulus, ${r.failed} gagal`);
  process.exit(r.failed ? 1 : 0);
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
