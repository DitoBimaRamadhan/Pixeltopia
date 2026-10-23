// Lapisan penyimpanan permanen dengan 2 backend:
//   - JSON lokal (default)          -> file di DATA_DIR (default ./data)
//   - PostgreSQL (jika DATABASE_URL) -> tabel `worlds` & `players` (kolom JSONB)
// Logika game hanya memakai API async di bawah, jadi backend bisa diganti tanpa mengubah game.
//
// API (semua mengembalikan Promise):
//   init(), close()
//   loadWorld(name) -> obj|null           saveWorld(name, obj)
//   loadPlayer(name) -> obj|null          savePlayer(name, obj)
//   updatePlayer(name, fn) -> rec|null  (baca-ubah-tulis atomik)
//   createPlayer(name, obj) -> true jika baru dibuat, false jika nama sudah dipakai (atomik)
//   listWorlds(limit) -> [{ name, updatedAt }] world tersimpan, terbaru dulu (untuk daftar World populer)
// Data teman / permintaan teman / pakaian disimpan di record pemain (JSON / kolom JSONB) -> tanpa tabel baru.
// Operasi pada key yang sama diserialkan (antrian per key) supaya "save lalu load"
// selalu membaca data terbaru walau backend-nya async.
const fs = require('fs');
const path = require('path');

const norm = (name) => String(name).toLowerCase();

// ---------- Backend JSON ----------
function jsonBackend(dataDir) {
  const WORLD_DIR = path.join(dataDir, 'worlds');
  const PLAYER_DIR = path.join(dataDir, 'players');
  const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } };
  const writeJsonAtomic = (file, obj) => {
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file); // atomic replace -> file tidak korup kalau proses mati di tengah
  };
  const wf = (n) => path.join(WORLD_DIR, n + '.json');
  const pf = (n) => path.join(PLAYER_DIR, norm(n) + '.json');
  return {
    kind: 'json',
    where: dataDir,
    async init() { fs.mkdirSync(WORLD_DIR, { recursive: true }); fs.mkdirSync(PLAYER_DIR, { recursive: true }); },
    async close() {},
    async loadWorld(n) { return readJson(wf(n)); },
    async saveWorld(n, d) { writeJsonAtomic(wf(n), d); },
    async loadPlayer(n) { return readJson(pf(n)); },
    async savePlayer(n, d) { writeJsonAtomic(pf(n), d); },
    async createPlayer(n, d) {
      try { fs.writeFileSync(pf(n), JSON.stringify(d), { flag: 'wx' }); return true; } // wx = gagal jika sudah ada
      catch (e) { if (e.code === 'EEXIST') return false; throw e; }
    },
    async deletePlayer(n) { try { fs.unlinkSync(pf(n)); } catch (e) {} },
    async deleteWorld(n) { try { fs.unlinkSync(wf(n)); } catch (e) {} },
    async listWorlds(limit) {
      let files = [];
      try { files = fs.readdirSync(WORLD_DIR).filter((f) => /^[A-Z0-9]{1,24}\.json$/.test(f)); } catch (e) { return []; }
      const out = [];
      for (const f of files) { try { out.push({ name: f.slice(0, -5), updatedAt: fs.statSync(path.join(WORLD_DIR, f)).mtimeMs }); } catch (e) {} }
      return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    }
  };
}

// ---------- Backend PostgreSQL ----------
function pgBackend(url) {
  const { Pool } = require('pg');
  // Neon/Supabase/Render butuh SSL. Parameter sslmode di URL dibuang lalu diatur di sini, karena `pg`
  // memperlakukan sslmode=require sebagai verify-full (gagal untuk CA Supabase).
  //   PGSSL=disable -> tanpa SSL (otomatis untuk localhost / sslmode=disable)
  //   PGSSL=verify  -> SSL + verifikasi sertifikat penuh
  //   default       -> SSL terenkripsi tanpa verifikasi CA
  let conn = url, mode = '';
  try { const u = new URL(url); mode = u.searchParams.get('sslmode') || ''; u.searchParams.delete('sslmode'); conn = u.toString(); } catch (e) {}
  const local = /^(localhost|127\.0\.0\.1|::1)$/.test((() => { try { return new URL(url).hostname; } catch (e) { return ''; } })());
  const env = process.env.PGSSL;
  const ssl = env === 'disable' || (!env && (local || mode === 'disable')) ? false : env === 'verify' ? { rejectUnauthorized: true } : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: conn, ssl, max: Number(process.env.PG_POOL_MAX) || 5, idleTimeoutMillis: 30000 });
  pool.on('error', (e) => console.error('[pg] idle client error:', e.message));
  return {
    kind: 'postgres',
    where: url.replace(/\/\/[^@]*@/, '//***@'),
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS worlds (
        name TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS players (
        name TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      // Migrasi aman (idempoten): indeks untuk daftar world terbaru.
      await pool.query('CREATE INDEX IF NOT EXISTS worlds_updated_at_idx ON worlds (updated_at DESC)');
    },
    async listWorlds(limit) {
      const r = await pool.query('SELECT name, (EXTRACT(EPOCH FROM updated_at) * 1000)::float8 AS t FROM worlds ORDER BY updated_at DESC LIMIT $1', [limit]);
      return r.rows.map((row) => ({ name: row.name, updatedAt: Number(row.t) }));
    },
    async close() { await pool.end(); },
    async loadWorld(n) { const r = await pool.query('SELECT data FROM worlds WHERE name=$1', [n]); return r.rows[0] ? r.rows[0].data : null; },
    async saveWorld(n, d) {
      await pool.query(`INSERT INTO worlds(name,data,updated_at) VALUES($1,$2,now())
        ON CONFLICT(name) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [n, JSON.stringify(d)]);
    },
    async loadPlayer(n) { const r = await pool.query('SELECT data FROM players WHERE name=$1', [norm(n)]); return r.rows[0] ? r.rows[0].data : null; },
    async savePlayer(n, d) {
      await pool.query(`INSERT INTO players(name,data,updated_at) VALUES($1,$2,now())
        ON CONFLICT(name) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [norm(n), JSON.stringify(d)]);
    },
    async createPlayer(n, d) {
      const r = await pool.query('INSERT INTO players(name,data) VALUES($1,$2) ON CONFLICT(name) DO NOTHING', [norm(n), JSON.stringify(d)]);
      return r.rowCount === 1;
    },
    async deletePlayer(n) { await pool.query('DELETE FROM players WHERE name=$1', [norm(n)]); },
    async deleteWorld(n) { await pool.query('DELETE FROM worlds WHERE name=$1', [n]); }
  };
}

// ---------- Pembungkus: antrian per key ----------
function createStorage(opts = {}) {
  const url = opts.databaseUrl !== undefined ? opts.databaseUrl : process.env.DATABASE_URL;
  const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const b = url ? pgBackend(url) : jsonBackend(dataDir);
  const queues = new Map();
  const q = (key, fn) => {
    const prev = queues.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    const tail = next.catch(() => {});
    queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return next;
  };
  return {
    kind: b.kind, where: b.where,
    init: () => b.init(),
    close: async () => { await Promise.all([...queues.values()]); await b.close(); },
    flush: () => Promise.all([...queues.values()]),
    loadWorld: (n) => q('w:' + n, () => b.loadWorld(n)),
    saveWorld: (n, d) => q('w:' + n, () => b.saveWorld(n, d)),
    deleteWorld: (n) => q('w:' + n, () => b.deleteWorld(n)),
    listWorlds: (limit = 30) => b.listWorlds(Math.max(1, Math.min(100, limit | 0))),
    loadPlayer: (n) => q('p:' + norm(n), () => b.loadPlayer(n)),
    savePlayer: (n, d) => q('p:' + norm(n), () => b.savePlayer(n, d)),
    // Baca-ubah-tulis atomik untuk satu pemain: fn(rec) mengubah rec (atau mengembalikan rec baru);
    // kembalikan null/false dari fn untuk batal. Mencegah penimpaan field lain (mis. sesi) oleh data basi.
    updatePlayer: (n, fn) => q('p:' + norm(n), async () => {
      const rec = await b.loadPlayer(n);
      if (!rec) return null;
      const out = fn(rec);
      if (out === false || out === null) return null;
      const next = out && typeof out === 'object' ? out : rec;
      await b.savePlayer(n, next);
      return next;
    }),
    createPlayer: (n, d) => q('p:' + norm(n), () => b.createPlayer(n, d)),
    deletePlayer: (n) => q('p:' + norm(n), () => b.deletePlayer(n))
  };
}

module.exports = { createStorage };
