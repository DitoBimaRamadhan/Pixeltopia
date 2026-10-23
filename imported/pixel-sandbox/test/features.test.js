// Tes fitur v1.2: trade (termasuk anti-duplikasi), teman & PM, pakaian, papan, pintu/air, daftar world.
//   npm test                                    -> backend JSON (server lokal sementara)
//   TEST_DATABASE_URL=postgresql://... npm test -> juga diulang dengan backend PostgreSQL
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../public/shared');
const { ok, sleep, result, startServer, stopServer, client } = require('./helpers');

const rnd = () => Math.floor(Math.random() * 1e6);
const PASS = 'rahasia123';
const T = S.TILE;

// Client + pelacak state (inventori/gem terbaru) yang tidak mengonsumsi antrian pesan.
async function login(url, name, kind = 'login') {
  const c = client(url, name); await c.open;
  c.st = { inv: {}, gems: 0 };
  c.ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'inv' || m.t === 'welcome') { c.st.inv = m.inv; c.st.gems = m.gems; } });
  c.send({ t: kind, name, pass: PASS });
  const r = await c.wait((m) => m.t === 'auth' || m.t === 'autherr', 4000, kind + ' ' + name);
  if (r.t !== 'auth') throw new Error('auth gagal ' + name + ': ' + r.msg);
  return c;
}
async function join(c, world) {
  await sleep(520);
  c.send({ t: 'join', world });
  const w = await c.wait((m) => m.t === 'welcome', 4000, 'welcome ' + c.name);
  c.welcome = w; c.me = w.players.find((p) => p.id === w.id); c.tiles = w.world.tiles.slice(); c.W = w.world.w;
  c.ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'tile') c.tiles[m.y * c.W + m.x] = m.id; });
  return w;
}
const drain = (c, t) => { c.msgs = c.msgs.filter((m) => m.t !== t); };
const tradeState = (c, pred, label) => c.wait((m) => m.t === 'trade' && pred(m), 2500, label);
async function buy(c, id) {
  const i = S.SHOP.findIndex((s) => s.id === id);
  await sleep(220); c.send({ t: 'buy', i });
  await c.wait((m) => m.t === 'bought' && m.id === id, 2000, 'buy ' + id);
}
// Kosongkan tile (pukul sampai hancur) lewat client c.
async function clear(c, x, y) {
  const id = c.tiles[y * c.W + x]; if (!id) return;
  for (let i = 0; i < S.BLOCKS[id].hp; i++) { c.send({ t: 'punch', x, y }); await sleep(150); }
  await c.wait((m) => m.t === 'tile' && m.x === x && m.y === y && m.id === 0, 2000, 'clear');
}
async function place(c, x, y, item) {
  await sleep(110); drain(c, 'err'); c.send({ t: 'place', x, y, item });
  return c.wait((m) => (m.t === 'tile' && m.x === x && m.y === y) || m.t === 'err', 2000, 'place ' + item);
}
async function move(c, x, y) { // gerak; kembalikan 'ok' atau 'rejected'
  await sleep(120); drain(c, 'pos');
  c.send({ t: 'move', x, y, f: 1 });
  try { await c.wait((m) => m.t === 'pos', 400, 'pos'); return 'rejected'; } catch (e) { c.me.x = x; c.me.y = y; return 'ok'; }
}

async function suite(label, env) {
  console.log(`\n===== FITUR v1.2: ${label} =====`);
  const port = 3800 + Math.floor(Math.random() * 500);
  const url = 'ws://127.0.0.1:' + port;
  env = { ...env, PORT: String(port), START_GEMS: '500' };
  let proc = await startServer(env);
  const W1 = 'FT' + rnd(), W2 = 'FU' + rnd();
  const nA = 'ana' + rnd(), nB = 'budi' + rnd(), nC = 'cici' + rnd();
  const A = await login(url, nA, 'register'), B = await login(url, nB, 'register'), C = await login(url, nC, 'register');
  const wa = await join(A, W1); await join(B, W1);
  await A.wait((m) => m.t === 'pjoin', 2000, 'pjoin');

  // ---------- Pakaian ----------
  console.log('[pakaian]');
  await buy(A, 300);
  ok(A.st.inv[300] === 1 && A.st.gems === 500 - S.COSMETICS[300].price, 'Beli Topi Jerami di toko (gem berkurang, masuk inventori)');
  await sleep(160); A.send({ t: 'equip', slot: 'hat', id: 300 });
  const peq = await B.wait((m) => m.t === 'peq' && m.id === wa.id, 2000, 'peq');
  ok(peq.eq.hat === 300, 'A memakai topi -> B melihat pakaian A (broadcast peq)');
  await sleep(160); A.send({ t: 'equip', slot: 'hat', id: 301 });
  ok(/belum punya/.test((await A.wait((m) => m.t === 'err', 2000, 'eq unowned')).msg), 'Memakai pakaian yang tidak dimiliki ditolak');
  await sleep(160); A.send({ t: 'equip', slot: 'shirt', id: 300 });
  ok(/tidak cocok/.test((await A.wait((m) => m.t === 'err', 2000, 'eq slot')).msg), 'Pakaian di slot yang salah ditolak');
  const C0 = await join(C, W1);
  ok(C0.players.find((p) => p.id === wa.id).eq.hat === 300, 'Pemain yang baru masuk melihat pakaian A (welcome)');
  await sleep(550); await join(C, W2);

  // ---------- Trade ----------
  console.log('[trade]');
  await sleep(120); A.send({ t: 'chat', msg: '/trade ' + nB });
  const req = await B.wait((m) => m.t === 'tradereq', 2000, 'tradereq');
  ok(req.name === nA, '/trade NAMA -> B menerima permintaan trade dari A');
  B.send({ t: 'trade', op: 'accept', id: req.from });
  let sa = await tradeState(A, (m) => m.st === 'open', 'open A');
  ok(sa.with.name === nB && sa.v === 1, 'B menerima -> jendela trade terbuka di kedua pihak');
  await sleep(70); A.send({ t: 'trade', op: 'offer', items: { 2: 150 }, gems: 0 });
  ok(/tidak cukup/.test((await A.wait((m) => m.t === 'err', 2000, 'over')).msg), 'Menawarkan item melebihi milik ditolak');
  await sleep(70); A.send({ t: 'trade', op: 'offer', items: { 2: -3 }, gems: 0 });
  ok(/tidak valid/.test((await A.wait((m) => m.t === 'err', 2000, 'neg')).msg), 'Jumlah negatif ditolak');
  await sleep(70); A.send({ t: 'trade', op: 'offer', items: {}, gems: 1e9 });
  ok(/Gem tidak cukup/.test((await A.wait((m) => m.t === 'err', 2000, 'gems')).msg), 'Gem melebihi saldo ditolak');
  await sleep(70); A.send({ t: 'trade', op: 'offer', items: { 2: 1.5 }, gems: 0 });
  ok(/tidak valid/.test((await A.wait((m) => m.t === 'err', 2000, 'frac')).msg), 'Jumlah pecahan ditolak');

  const a0 = { ...A.st.inv }, ga0 = A.st.gems, b0 = { ...B.st.inv }, gb0 = B.st.gems;
  await sleep(70); A.send({ t: 'trade', op: 'offer', items: { 2: 5, 300: 1 }, gems: 10 });
  await sleep(70); B.send({ t: 'trade', op: 'offer', items: { 102: 1 }, gems: 3 });
  sa = await tradeState(A, (m) => m.them.items[102] === 1, 'B offer seen');
  ok(sa.me.items[2] === 5 && sa.me.gems === 10 && sa.them.gems === 3, 'Kedua pihak melihat tawaran masing-masing');
  await sleep(70); A.send({ t: 'trade', op: 'confirm', v: sa.v });
  ok(/mengunci/.test((await A.wait((m) => m.t === 'err', 2000, 'confirm early')).msg), 'Konfirmasi sebelum kedua pihak mengunci ditolak');
  await sleep(70); A.send({ t: 'trade', op: 'lock', v: sa.v });
  await sleep(70); B.send({ t: 'trade', op: 'lock', v: sa.v });
  sa = await tradeState(A, (m) => m.me.locked && m.them.locked, 'both locked');
  const vOld = sa.v;
  await sleep(70); A.send({ t: 'trade', op: 'offer', items: { 2: 6, 300: 1 }, gems: 10 }); // ganti tawaran setelah lock
  const sb = await tradeState(B, (m) => m.them.items[2] === 6, 'B sees change');
  ok(!sb.me.locked && !sb.them.locked && sb.v > vOld, 'Mengubah tawaran setelah dikunci -> kunci kedua pihak direset (anti-tipu)');
  await sleep(70); B.send({ t: 'trade', op: 'lock', v: vOld });
  const sStale = await tradeState(B, (m) => m.v === sb.v, 'stale lock');
  ok(!sStale.me.locked, 'Kunci dengan versi tawaran lama diabaikan');
  for (const c of [A, B]) { await sleep(70); c.send({ t: 'trade', op: 'lock', v: sb.v }); }
  await tradeState(B, (m) => m.me.locked && m.them.locked, 'relocked');
  await sleep(70); A.send({ t: 'trade', op: 'confirm', v: sb.v });
  await sleep(70); B.send({ t: 'trade', op: 'confirm', v: sb.v });
  await sleep(70); B.send({ t: 'trade', op: 'confirm', v: sb.v }); // konfirmasi ganda
  await sleep(70); A.send({ t: 'trade', op: 'confirm', v: sb.v });
  const dA = await A.wait((m) => m.t === 'trade' && m.st === 'done', 2000, 'done A');
  await B.wait((m) => m.t === 'trade' && m.st === 'done', 2000, 'done B');
  ok(dA.got.items[102] === 1 && dA.gave.items[2] === 6, 'Kedua pihak konfirmasi -> trade selesai');
  await sleep(250);
  ok(A.st.inv[2] === a0[2] - 6 && A.st.inv[102] === a0[102] + 1 && !A.st.inv[300] && A.st.gems === ga0 - 10 + 3, 'Inventori & gem A tepat setelah trade');
  ok(B.st.inv[2] === b0[2] + 6 && B.st.inv[102] === b0[102] - 1 && B.st.inv[300] === 1 && B.st.gems === gb0 - 3 + 10, 'Inventori & gem B tepat setelah trade');
  ok(A.st.inv[2] + B.st.inv[2] === a0[2] + b0[2] && A.st.gems + B.st.gems === ga0 + gb0, 'Total item & gem kekal (tidak ada duplikasi dari konfirmasi ganda)');
  ok(A.msgs.filter((m) => m.t === 'trade' && m.st === 'done').length === 0 && B.msgs.filter((m) => m.t === 'trade' && m.st === 'done').length === 0, 'Swap hanya terjadi sekali');
  const unq = await B.wait((m) => m.t === 'peq' && m.id === wa.id, 2000, 'unequip');
  ok(!unq.eq.hat, 'Topi yang di-trade otomatis dilepas dari A');
  await sleep(160); B.send({ t: 'equip', slot: 'hat', id: 300 });
  ok((await A.wait((m) => m.t === 'peq' && m.id === B.welcome.id, 2000, 'B equip')).eq.hat === 300, 'B memakai topi hasil trade');

  // Anti-dupe: item dipakai (ditaruh) setelah dikunci -> eksekusi gagal, tidak ada perubahan.
  await sleep(120); B.send({ t: 'trade', op: 'req', id: wa.id });
  const r2 = await A.wait((m) => m.t === 'tradereq', 2000, 'req2');
  await sleep(70); A.send({ t: 'trade', op: 'accept', id: r2.from });
  await tradeState(A, (m) => m.st === 'open', 'open2');
  const myDirt = A.st.inv[2];
  await sleep(70); A.send({ t: 'trade', op: 'offer', items: { 2: myDirt }, gems: 0 });
  const s2 = await tradeState(B, (m) => m.them.items[2] === myDirt, 'offer2');
  for (const c of [A, B]) { await sleep(70); c.send({ t: 'trade', op: 'lock', v: s2.v }); }
  await tradeState(A, (m) => m.me.locked && m.them.locked, 'locked2');
  const col = Math.floor((A.me.x + S.PHYS.PW / 2) / T), row = Math.floor((A.me.y + S.PHYS.PH / 2) / T);
  let ax = col + 2, ay = 0; while (A.tiles[(ay + 1) * A.W + ax] === 0) ay++;
  await place(A, ax, ay, 2); // dirt berkurang 1
  const aBefore = { ...A.st.inv }, bBefore = { ...B.st.inv };
  for (const c of [A, B]) { await sleep(70); c.send({ t: 'trade', op: 'confirm', v: s2.v }); }
  const cx = await A.wait((m) => m.t === 'trade' && m.st === 'cancel', 2000, 'cancel exec');
  ok(/tidak punya/.test(cx.msg), 'Item yang sudah dipakai setelah dikunci -> trade dibatalkan saat eksekusi');
  await sleep(150);
  ok(A.st.inv[2] === aBefore[2] && B.st.inv[2] === bBefore[2], 'Tidak ada item berpindah/terduplikasi saat trade gagal');

  // Putus koneksi saat trade -> batal.
  await sleep(550); await join(C, W1);
  await sleep(120); C.send({ t: 'trade', op: 'req', name: nA });
  const r3 = await A.wait((m) => m.t === 'tradereq', 2000, 'req3');
  await sleep(70); A.send({ t: 'trade', op: 'accept', id: r3.from });
  await tradeState(C, (m) => m.st === 'open', 'open3');
  const cInv = { ...C.st.inv };
  await sleep(70); C.send({ t: 'trade', op: 'offer', items: { 2: 5 }, gems: 0 });
  await tradeState(A, (m) => m.them.items[2] === 5, 'offer3');
  await C.close();
  ok(/keluar/.test((await A.wait((m) => m.t === 'trade' && m.st === 'cancel', 2000, 'disc cancel')).msg), 'Pemain putus koneksi saat trade -> trade batal untuk pihak lain');
  const C2 = await login(url, nC); await join(C2, W2);
  ok(C2.st.inv[2] === cInv[2], 'Inventori pemain yang putus tetap utuh');
  await sleep(120); A.send({ t: 'trade', op: 'req', name: nC });
  ok(/tidak ada di world ini/.test((await A.wait((m) => m.t === 'err', 2000, 'other world')).msg), 'Trade dengan pemain di world lain ditolak');

  // ---------- Teman & PM ----------
  console.log('[teman & PM]');
  await sleep(450); A.send({ t: 'chat', msg: '/teman add ' + nB });
  ok((await B.wait((m) => m.t === 'freq', 2000, 'freq')).from === nA, '/teman add -> B menerima permintaan teman');
  const fB = await B.wait((m) => m.t === 'friends' && m.reqs.includes(nA), 2000, 'reqs');
  ok(!!fB, 'Permintaan tampil di daftar B');
  await sleep(300); B.send({ t: 'friend', op: 'accept', name: nA });
  const fA = await A.wait((m) => m.t === 'friends' && m.list.some((f) => f.name === nB), 2000, 'list A');
  const fa = fA.list.find((f) => f.name === nB);
  ok(fa.online && fa.world === W1, 'B menerima -> A melihat B di daftar teman (online, world)');
  await join(A, W2);
  await sleep(300); B.send({ t: 'friend', op: 'list' });
  const fB2 = await B.wait((m) => m.t === 'friends' && m.list.some((f) => f.name === nA && f.world === W2), 2000, 'list B');
  ok(!!fB2, 'Daftar teman menunjukkan world teman terkini');
  await sleep(450); B.send({ t: 'chat', msg: `/msg ${nA} halo rahasia` });
  const pm = await A.wait((m) => m.t === 'pm', 2000, 'pm');
  ok(pm.from === nB && pm.msg === 'halo rahasia', '/msg ke pemain di world lain diterima');
  ok(!!(await B.wait((m) => m.t === 'pm' && m.to === nA, 2000, 'pm echo')), 'Pengirim menerima salinan PM');
  await sleep(200);
  ok(!C2.msgs.some((m) => m.t === 'pm' || (m.t === 'chat' && /rahasia/.test(m.msg))), 'PM tidak bocor ke pemain lain');
  await sleep(450); B.send({ t: 'pm', to: 'tidakada' + rnd(), msg: 'x' });
  ok(/tidak sedang online/.test((await B.wait((m) => m.t === 'chat' && m.from === '*' && /online/.test(m.msg), 2000, 'pm off')).msg), 'PM ke pemain offline ditolak');
  await sleep(300); C2.send({ t: 'friend', op: 'add', name: nA });
  await A.wait((m) => m.t === 'freq' && m.from === nC, 2000, 'freq C');
  await sleep(300); A.send({ t: 'friend', op: 'decline', name: nC });
  ok(!!(await A.wait((m) => m.t === 'friends' && !m.reqs.includes(nC), 2000, 'decline')), 'Tolak permintaan teman');

  // ---------- Daftar world ----------
  console.log('[world populer]');
  await sleep(850); B.send({ t: 'worlds' });
  const wl = await B.wait((m) => m.t === 'worldlist', 2000, 'worldlist');
  const i1 = wl.list.findIndex((w) => w.name === W1), i2 = wl.list.findIndex((w) => w.name === W2);
  ok(i2 >= 0 && i1 >= 0 && wl.list[i2].players === 2 && wl.list[i1].players === 1, 'Daftar world berisi jumlah pemain per world');
  ok(i2 < i1, 'World diurutkan dari pemain terbanyak');

  // ---------- Pintu, air, papan ----------
  console.log('[pintu, air, papan]');
  await join(A, W1); await sleep(100);
  const sp = A.me; const pc = Math.floor((sp.x + S.PHYS.PW / 2) / T), pr = Math.floor((sp.y + S.PHYS.PH - 1) / T);
  await clear(A, pc + 1, pr);
  let r = await place(A, pc + 1, pr, 9);
  ok(r.t === 'err' && /tidak ada/.test(r.msg), 'Menaruh pintu tanpa punya ditolak');
  await buy(A, 9); await buy(A, 11); await buy(A, 10);
  r = await place(A, pc + 1, pr, 9);
  ok(r.t === 'tile' && r.id === 9, 'Pintu ditaruh');
  B.me = { ...sp }; await sleep(50);
  // B kembali ke spawn (posisi sama dengan A)
  ok((await move(A, sp.x + 8, sp.y)) === 'ok', 'World tidak terkunci: pemain bisa berjalan masuk ke pintu');
  ok((await move(A, sp.x, sp.y)) === 'ok', 'Keluar dari pintu');
  await clear(A, pc - 1, pr);
  r = await place(A, pc - 1, pr, 11);
  ok(r.t === 'tile' && r.id === 11 && !S.BLOCKS[11].solid && S.BLOCKS[11].liquid, 'Air ditaruh (blok cair, tidak padat)');
  ok((await move(A, sp.x - 8, sp.y)) === 'ok', 'Pemain bisa masuk ke air (tidak padat)');
  ok((await move(A, sp.x, sp.y)) === 'ok', 'Keluar dari air');
  r = await place(A, pc - 1, pr, 2);
  ok(r.t === 'err' && /terisi/.test(r.msg), 'Tidak bisa menaruh blok di atas air');
  ok(S.PHYS.WATER_MOVE < 1 && S.PHYS.WATER_MAX_FALL < S.PHYS.MAX_FALL, 'Fisika air: gerak lebih lambat & tenggelam pelan (konstanta shared)');
  // Papan
  await clear(A, pc - 2, pr);
  r = await place(A, pc - 2, pr, 10);
  ok(r.t === 'tile' && r.id === 10, 'Papan ditaruh');
  ok(!!(await A.wait((m) => m.t === 'signedit', 2000, 'signedit')), 'Penaruh papan diminta menulis teks');
  const evil = 'Halo\u0000\u202e <script>x</script> ' + 'z'.repeat(300);
  await sleep(50); A.send({ t: 'sign', x: pc - 2, y: pr, text: evil });
  const sg = await B.wait((m) => m.t === 'sign' && m.x === pc - 2, 2000, 'sign B');
  ok(sg.text.length <= S.SIGN_MAX && !/[<>\u0000\u202e]/.test(sg.text) && sg.text.startsWith('Halo'), `Teks papan disanitasi & dibatasi ${S.SIGN_MAX} karakter`);
  await sleep(350); A.send({ t: 'sign', x: pc + 1, y: pr, text: 'bukan papan' });
  ok(/bukan papan/.test((await A.wait((m) => m.t === 'err', 2000, 'not sign')).msg), 'Mengisi teks pada blok bukan papan ditolak');
  await sleep(350); A.send({ t: 'chat', msg: '/sign Selamat datang!' });
  ok((await B.wait((m) => m.t === 'sign' && m.x === pc - 2, 2000, '/sign')).text === 'Selamat datang!', '/sign TEKS mengubah papan terdekat');
  // Kunci world -> pintu hanya untuk pemilik/akses
  await buy(A, S.WORLD_LOCK);
  let lx = pc + 3, ly = 0; while (A.tiles[(ly + 1) * A.W + lx] === 0) ly++;
  r = await place(A, lx, ly, S.WORLD_LOCK);
  ok(r.t === 'tile', 'A mengunci world');
  await B.wait((m) => m.t === 'lock' && m.owner, 2000, 'lock B');
  // B ke spawn: rejoin
  await join(B, W1); B.me = B.welcome.players.find((p) => p.id === B.welcome.id);
  ok((await move(B, B.me.x + 8, B.me.y)) === 'rejected', 'World terkunci: pemain tanpa akses tidak bisa melewati pintu');
  ok((await move(A, sp.x + 8, sp.y)) === 'ok', 'Pemilik tetap bisa melewati pintu');
  await move(A, sp.x, sp.y);
  await sleep(350); drain(B, 'err'); B.send({ t: 'sign', x: pc - 2, y: pr, text: 'coret' });
  ok(/dikunci/.test((await B.wait((m) => m.t === 'err', 2000, 'B sign')).msg), 'Pemain tanpa akses tidak bisa mengubah papan');
  await sleep(450); A.send({ t: 'chat', msg: '/access add ' + nB });
  await B.wait((m) => m.t === 'lock' && m.access.includes(nB.toLowerCase()), 2000, 'access');
  ok((await move(B, B.me.x + 8, B.me.y)) === 'ok', 'Setelah /access, B bisa melewati pintu');

  // ---------- Persistensi ----------
  console.log('[persistensi v1.2]');
  await A.close(); await B.close(); await C2.close(); await sleep(400);
  await stopServer(proc);
  proc = await startServer(env);
  const B3 = await login(url, nB);
  const fr = await B3.wait((m) => m.t === 'friends', 2000, 'friends after restart');
  ok(fr.list.some((f) => f.name === nA && !f.online), 'Setelah restart: daftar teman tersimpan (A offline)');
  const w3 = await join(B3, W1);
  ok(w3.equip.hat === 300 && w3.players.find((p) => p.id === w3.id).eq.hat === 300, 'Setelah restart: pakaian terpasang tersimpan');
  ok(w3.world.signs[(pc - 2) + ',' + pr] === 'Selamat datang!', 'Setelah restart: teks papan tersimpan');
  ok(w3.world.tiles[pr * w3.world.w + pc + 1] === 9 && w3.world.tiles[pr * w3.world.w + pc - 1] === 11, 'Setelah restart: pintu & air tersimpan');
  ok(B3.st.inv[2] === B.st.inv[2] && B3.st.gems === B.st.gems, 'Setelah restart: hasil trade tersimpan');
  await sleep(300); B3.send({ t: 'friend', op: 'remove', name: nA });
  ok(!!(await B3.wait((m) => m.t === 'friends' && !m.list.some((f) => f.name === nA), 2000, 'remove')), 'Hapus teman');
  await sleep(850); B3.send({ t: 'worlds' });
  const wl2 = await B3.wait((m) => m.t === 'worldlist', 2000, 'wl2');
  ok(wl2.list.some((w) => w.name === W2 && w.players === 0), 'Daftar world memuat world tersimpan yang sedang kosong (aktivitas terbaru)');
  await B3.close();
  await stopServer(proc);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ft-'));
  await suite('backend JSON', { DATA_DIR: dir, DATABASE_URL: '' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (process.env.TEST_DATABASE_URL) await suite('backend PostgreSQL', { DATABASE_URL: process.env.TEST_DATABASE_URL });
  else console.log('\n(Lewati fitur PostgreSQL: set TEST_DATABASE_URL untuk menguji)');
  const r = result();
  console.log(`\nHasil fitur: ${r.passed} lulus, ${r.failed} gagal`);
  process.exit(r.failed ? 1 : 0);
})().catch((e) => { console.error('GAGAL:', e.stack || e.message); process.exit(1); });
