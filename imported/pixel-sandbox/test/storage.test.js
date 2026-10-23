// Tes unit storage (backend JSON & PostgreSQL) + hashing password.
// Postgres diuji bila TEST_DATABASE_URL di-set, mis.:
//   TEST_DATABASE_URL=postgresql://pixel:pixel@localhost:5432/pixel npm test
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStorage } = require('../server/storage');
const auth = require('../server/auth');
const { ok, result } = require('./helpers');

async function testBackend(label, opts) {
  console.log(`\n[storage: ${label}]`);
  const id = 'T' + Math.floor(Math.random() * 1e9);
  const pname = 'st_' + Math.floor(Math.random() * 1e6);
  let st = createStorage(opts);
  await st.init();
  ok(st.kind === label, `backend terpilih = ${label}`);
  ok((await st.loadWorld(id)) === null, 'world belum ada -> null');
  const world = { name: id, w: 2, h: 1, tiles: [1, 2], trees: { '0,0': { type: 2 } }, owner: 'alice', access: ['bob'] };
  st.saveWorld(id, world);                 // sengaja tanpa await: antrian harus menjamin urutan
  const back = await st.loadWorld(id);
  ok(back && back.tiles[1] === 2 && back.owner === 'alice' && back.access[0] === 'bob', 'save lalu load world (urutan terjaga)');
  world.tiles[1] = 3; await st.saveWorld(id, world);
  ok((await st.loadWorld(id)).tiles[1] === 3, 'update world (upsert)');

  ok(await st.createPlayer(pname, { name: pname, gems: 5, inv: { 2: 1 } }), 'createPlayer akun baru');
  ok(!(await st.createPlayer(pname.toUpperCase(), { name: 'x' })), 'createPlayer nama sama (beda huruf besar) ditolak');
  const [a, b] = await Promise.all([
    st.updatePlayer(pname, (r) => { r.gems += 10; }),
    st.updatePlayer(pname, (r) => { r.session = { hash: 'abc' }; })
  ]);
  const p = await st.loadPlayer(pname);
  ok(p.gems === 15 && p.session.hash === 'abc' && p.inv[2] === 1, 'updatePlayer atomik (2 update paralel tidak saling menimpa)');
  ok((await st.updatePlayer('tidakada_' + id, (r) => r)) === null, 'updatePlayer akun tak ada -> null');
  const lw = await st.listWorlds(100);
  ok(Array.isArray(lw) && lw.some((w) => w.name === id && w.updatedAt > Date.now() - 600000), 'listWorlds memuat world tersimpan + waktu aktivitas');
  await st.updatePlayer(pname, (r) => { r.friends = ['Teman1']; r.freqs = ['Peminta']; r.equip = { hat: 300 }; });
  const fp = await st.loadPlayer(pname);
  ok(fp.friends[0] === 'Teman1' && fp.freqs[0] === 'Peminta' && fp.equip.hat === 300, 'data teman & pakaian tersimpan di record pemain');
  await st.close();

  // Data permanen: buka instance baru (seperti server restart).
  st = createStorage(opts); await st.init();
  ok((await st.loadWorld(id)).tiles[1] === 3 && (await st.loadPlayer(pname)).gems === 15, 'data tetap ada setelah storage dibuka ulang (restart)');
  await st.deleteWorld(id); await st.deletePlayer(pname);
  ok((await st.loadWorld(id)) === null, 'bersih-bersih data tes');
  await st.close();
}

(async () => {
  console.log('[auth]');
  const h = await auth.hashPassword('rahasia123');
  ok(/^scrypt\$/.test(h) && !h.includes('rahasia123'), 'password di-hash scrypt (bukan plaintext)');
  ok(await auth.verifyPassword('rahasia123', h), 'password benar diterima');
  ok(!(await auth.verifyPassword('salah', h)), 'password salah ditolak');
  ok(h !== (await auth.hashPassword('rahasia123')), 'salt acak (hash berbeda tiap kali)');
  const t = auth.newToken();
  ok(auth.verifyToken(t, auth.hashToken(t)) && !auth.verifyToken(t + 'x', auth.hashToken(t)), 'token sesi diverifikasi via hash');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-store-'));
  await testBackend('json', { databaseUrl: '', dataDir: dir });
  fs.rmSync(dir, { recursive: true, force: true });
  const pg = process.env.TEST_DATABASE_URL;
  if (pg) await testBackend('postgres', { databaseUrl: pg });
  else console.log('\n[storage: postgres] DILEWATI (set TEST_DATABASE_URL untuk menguji)');

  const r = result();
  console.log(`\nStorage: ${r.passed} lulus, ${r.failed} gagal`);
  process.exit(r.failed ? 1 : 0);
})().catch((e) => { console.error('GAGAL:', e); process.exit(1); });
