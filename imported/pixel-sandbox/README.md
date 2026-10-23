# ⛏ Pixel Sandbox — Game Sandbox 2D Multiplayer

Game sandbox 2D multiplayer **orisinal** (pukul blok, kumpulkan gem & seed, tanam pohon, splice, kunci world, bangun bersama).
Semua grafis digambar dengan kode (Canvas), tanpa aset/nama dari game lain. **100% tooling & hosting gratis**:
Node.js + `ws` + `pg`, HTML5 Canvas (tanpa CDN), Capacitor untuk APK Android.

![screenshot](docs/screenshot.png)

## Fitur
- **Akun dengan password**: daftar/login, password di-hash **scrypt** (crypto bawaan Node, salt acak), token sesi
  (yang disimpan di server hanya hash SHA-256-nya). **Satu sesi per akun**: login di perangkat lain menendang sesi lama dan
  token lama tidak berlaku. Auto-login dengan token tersimpan. 5x salah password → akun dikunci sementara 1 menit.
- **World bernama** 100×60 tile, dibuat otomatis jika belum ada: rumput, tanah, batu, lava rock, bedrock.
- Pukul blok → **gem**, kadang seed/blok. Taruh blok, **tanam seed** → pohon tumbuh → panen.
- **Splicing**: Dirt+Rock=Brick, Dirt+Grass=Wood, Rock+Wood=Glass, Rock+Brick=Lava Rock,
  **Wood+Brick=Door (pintu)**, **Dirt+Wood=Sign (papan)**, **Grass+Glass=Water (air)** (taruh 2 seed berbeda di satu tile).
- **🛒 Toko gem**: World Lock (100 gem), Wood Seed, Glass Seed, Dirt, Door (20), Sign (10), Water ×5 (15), Water Seed (20), dan pakaian.
- **🚪 Pintu (Door) / 🪧 Papan (Sign) / 💧 Air (Water)**: blok baru. Bisa dibeli, di-splice, atau ditanam (seed-nya didapat saat memukul blok tsb.):
  - **Pintu**: bisa dilewati. Di world yang **dikunci**, hanya pemilik & pemain dengan akses yang bisa lewat; pemain lain
    tertahan (pintu bergambar gembok). Divalidasi di server.
  - **Papan**: setelah ditaruh, kotak edit langsung muncul. Teks maks. 100 karakter, dibersihkan di server (tanpa karakter
    kontrol/`<>`). Teks tampil saat kamu dekat (≤3,5 tile) atau saat kursor di atasnya. Ubah lewat tombol **✏️ Papan**
    (muncul saat dekat papan) atau `/sign TEKS` (papan terdekat). Di world terkunci hanya yang punya akses bisa mengubah.
  - **Air**: tidak padat dan digambar transparan. Di dalam air kamu bergerak lebih lambat, jatuh pelan, dan bisa **berenang**
    (tahan lompat).
- **👕 Pakaian (kosmetik)**: 6 slot: Topi, Wajah, Baju, Celana, Sepatu, Punggung/Sayap. 16 item orisinal (mis. Topi Jerami,
  Mahkota Kardus, Kacamata Hitam, Jaket Hijau, Jubah Merah, Sayap Bara). Sebagian dijual di toko, sebagian **drop langka**
  saat menghancurkan blok (1,5%, lava rock 5%; diumumkan di chat). Dipakai lewat panel **Pakaian** (ada preview). Pakaian
  terlihat oleh semua pemain dan tersimpan di akun. Pakaian tidak memakan slot inventori (maks 24 slot) dan bisa di-trade.
  Kalau pakaian yang dipakai di-trade, otomatis dilepas.
- **🤝 Trade**: tap pemain → **Trade**, atau `/trade NAMA` (harus di world yang sama). Pemain lain dapat ajakan **Terima/Tolak**.
  Di jendela trade, tap item inventori untuk menambah tawaran, tap item di tawaran untuk mengurangi, dan isi jumlah gem.
  Lalu kedua pihak tekan **🔒 Kunci** dan **✅ Konfirmasi**. Pertukaran **atomik di server**: setiap perubahan tawaran membuka
  kunci & konfirmasi kedua pihak (nomor versi), item/gem dicek ulang terhadap inventori saat itu, semua-atau-tidak-sama-sekali,
  lalu langsung disimpan. Trade batal otomatis bila salah satu keluar world/putus koneksi. Anti-dupe diuji otomatis.
- **👥 Teman & pesan pribadi**: panel **Teman**: tambah nama, terima/tolak permintaan, hapus teman, dan lihat status
  online + world teman. Teman diberi tahu saat kamu online. Pesan pribadi lintas world:
  `/msg NAMA PESAN` (alias `/pm`, `/w`), balas dengan `/r PESAN`, atau tombol ✉ di daftar teman.
  - `/teman add NAMA` · `/teman accept NAMA` · `/teman decline NAMA` · `/teman remove NAMA` · `/teman` (daftar). Alias: `/friend`.
- **🌍 World populer**: panel **Worlds** menampilkan world yang diurutkan menurut jumlah pemain lalu aktivitas terakhir. Tap
  untuk masuk, atau ketik nama world lalu **Masuk**. Perintah: `/worlds`.
- **🔊 Suara**: efek suara prosedural WebAudio (pukul, hancur, taruh, ambil item/gem, chat, PM, trade, klik UI, error,
  percikan air) dan musik latar pentatonik buatan kode. Tanpa file audio. Toggle **Efek suara** & **Musik** di panel
  **Suara** (disimpan di `localStorage`). Di HP, audio aktif setelah sentuhan pertama.
- **🔒 World Lock**: taruh di world yang belum dikunci → kamu jadi **pemilik**. Hanya pemilik dan pemain yang diberi akses yang
  bisa menaruh/menghancurkan blok, menanam, dan memanen. **Divalidasi di server.** Hanya pemilik yang bisa mencabut lock
  (lock kembali ke inventori, world bebas lagi). Satu lock per world.
  - `/access add NAMA` · `/access remove NAMA` · `/access list`
- **Penyimpanan permanen**: JSON lokal (default) atau **PostgreSQL** bila `DATABASE_URL` di-set (Neon/Supabase gratis).
- **Kontrol sentuh & layout responsif**: tombol ◀ ▶ ⤒, tap/tahan layar untuk memukul/menaruh, tap slot untuk memilih item, tombol 💬 chat.
- **Langsung main**: layar login sederhana (username + password, tombol Masuk/Daftar), server tetap, otomatis masuk world START; koneksi otomatis dicoba ulang saat server Render bangun.
- **Server-authoritative**: jangkauan 5 tile, kepemilikan item, izin World Lock, kecepatan gerak/teleport, tabrakan, rate-limit, cooldown.

## Kontrol
| Aksi | PC | HP / APK |
|---|---|---|
| Jalan | A/D atau ←/→ | tombol ◀ ▶ |
| Lompat | W / Space / ↑ | tombol ⤒ |
| Pakai item terpilih (Tinju = pukul, blok = taruh, seed = tanam) | Klik kiri (bisa ditahan) | Tap / tahan di layar |
| Selalu pukul | Klik kanan | pilih slot Tinju (slot 1) |
| Pilih item | 1–9, scroll, klik slot | tap slot |
| Chat / perintah | Enter | tombol 💬 |
| Menu (Toko, Pakaian, Teman, Worlds, Trade, Suara) | tombol di kanan atas | tombol ☰ |
| Interaksi pemain (Trade / Tambah teman / Pesan) | klik pemain | tap pemain |
| Pindah world | `/world NAMA` atau panel Worlds | sama |

### Semua perintah chat
| Perintah | Fungsi |
|---|---|
| `/help` | daftar perintah |
| `/world NAMA` | pindah/buat world |
| `/worlds` | daftar world populer |
| `/access add\|remove\|list NAMA` | akses World Lock (pemilik) |
| `/trade NAMA` | ajak trade pemain di world yang sama |
| `/msg NAMA PESAN` (`/pm`, `/w`) · `/r PESAN` | pesan pribadi lintas world · balas PM terakhir |
| `/teman add\|accept\|decline\|remove NAMA` · `/teman` | kelola teman (`/friend` juga bisa) |
| `/sign TEKS` | ubah teks papan terdekat |

## Menjalankan secara lokal
Butuh Node.js 20+.
```bash
npm install
npm start            # http://localhost:3000  (PORT=8080 npm start untuk port lain)
```
Buka `http://localhost:3000`, klik **Daftar Akun** (username + password min. 6 karakter), lalu main.
Buka di dua browser untuk mencoba multiplayer.

Pakai Postgres secara lokal (opsional):
```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/pixel npm start
```
Tabel `worlds` dan `players` (kolom JSONB) dibuat otomatis saat start.

### Tes otomatis
```bash
npm test                                                     # backend JSON (server tes dijalankan otomatis di port acak)
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/pixel npm test   # + diulang dengan backend PostgreSQL
TEST_URL=ws://host:port npm test                             # tes ke server yang sudah jalan (tanpa tes restart)
```
Yang diuji: hashing password & token; storage JSON/Postgres (save/load, upsert, create atomik, update paralel, data tetap ada
setelah dibuka ulang); register/login/password salah/nama dobel; satu sesi per akun & token lama tidak berlaku; gameplay
multiplayer (taruh, pukul, drop, validasi jangkauan/item/teleport, gerak, tanam, splice, chat); toko; World Lock (non-pemilik
ditolak menaruh/memukul/memanen, `/access add/remove`, akses tidak bisa mencabut lock, lock kedua ditolak); dan **restart server**
(akun, lock, blok, pohon, gem tetap ada) lalu pemilik mencabut lock.
`test/features.test.js` menguji fitur v1.2: pakaian (beli, pakai, slot salah, tidak punya, terlihat pemain lain, lepas
otomatis setelah di-trade), **trade** (item+gem, versi/kunci, konfirmasi dengan versi lama ditolak, ubah tawaran membuka kunci,
jumlah melebihi milik ditolak, trade batal saat keluar/putus, item tidak terduplikasi, inventori berubah saat trade ditolak),
teman & PM (permintaan, terima, status online/world, PM lintas world, tolak, hapus), daftar world, pintu (di world terkunci),
air, papan (teks disanitasi & dibatasi, izin), dan semua data tetap ada setelah restart, baik di backend JSON maupun Postgres.

## 📱 APK Android

### Install APK
1. Salin `PixelSandbox.apk` ke HP Android (Android 6.0+).
2. Buka file-nya. Jika diminta, izinkan **"Install dari sumber tidak dikenal"** untuk aplikasi file manager/browser yang dipakai.
3. APK ini **debug build** (ditandatangani debug key) — cocok untuk sideload/testing, bukan untuk Play Store.
   Jika sebelumnya pernah memasang APK dengan tanda tangan berbeda, uninstall dulu.

### Server di APK (tetap, tanpa pengaturan)
APK selalu terhubung ke server online resmi `https://pixel-sandbox-i1fv.onrender.com` (diatur di `public/config.js`,
`window.PS_DEFAULT_SERVER`). Pemain tidak perlu (dan tidak bisa) mengubah alamat server: buka aplikasi → isi username &
password → **Masuk** atau **Daftar** → langsung masuk world START. Sesi tersimpan, jadi pembukaan berikutnya langsung masuk.
Alamat server lama yang tersimpan dari APK versi 1.0 dihapus otomatis. Di browser, client memakai server asal halaman.
Untuk server lain (mis. PC sendiri), ubah `public/config.js` lalu build ulang APK.

> Render free tidur setelah 15 menit sepi: koneksi pertama bisa butuh ±1 menit. Aplikasi menampilkan
> "Menghubungkan ke server... (bisa sampai 1 menit)" dan mencoba ulang otomatis sampai server siap.

### Build APK sendiri (gratis)
Butuh: Node 20+, **JDK 21** (Capacitor 7 memerlukan JDK 21; JDK 17 tidak cukup untuk Capacitor 7), Android SDK command-line tools
(platform `android-35`, build-tools 35).
```bash
npm install
export ANDROID_HOME=$HOME/android-sdk        # lokasi Android SDK
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
# sekali saja jika folder android/ belum ada:  npx cap add android && python3 tools/make-icons.py
npx cap sync android                         # salin public/ ke proyek Android
cd android && ./gradlew assembleDebug
# hasil: android/app/build/outputs/apk/debug/app-debug.apk
```
Instal SDK tanpa Android Studio:
```bash
# unduh "Command line tools only" dari https://developer.android.com/studio, ekstrak ke $ANDROID_HOME/cmdline-tools/latest
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```
Cek APK: `$ANDROID_HOME/build-tools/35.0.0/aapt dump badging app-debug.apk`.

## 🌐 Main online cepat tanpa akun: Cloudflare Quick Tunnel

Cara tercepat membuat server di komputer sendiri bisa diakses dari internet (termasuk dari APK), **tanpa akun Cloudflare**:

```bash
# 1) jalankan server (storage JSON lokal; jangan set DATABASE_URL)
nohup tools/run/server-loop.sh >/dev/null 2>&1 &     # log: logs/server.log, restart otomatis bila crash
# 2) pasang cloudflared (https://github.com/cloudflare/cloudflared/releases), lalu:
nohup tools/run/tunnel-loop.sh >/dev/null 2>&1 &     # = cloudflared tunnel --url http://localhost:3000
grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' logs/tunnel.log | tail -1
```

- Alamat `https://xxxx.trycloudflare.com` itu bisa dipakai di APK dengan menjadikannya default di `public/config.js` (`window.PS_DEFAULT_SERVER`) lalu build ulang APK (`npm run apk`).
- ⚠️ **URL quick tunnel berubah setiap kali tunnel (cloudflared) di-restart** atau komputer mati. Setelah itu APK harus di-build ulang dengan URL baru. Untuk alamat tetap, pakai named tunnel (butuh akun Cloudflare + domain) atau deploy ke Render (lihat di bawah).
- Quick tunnel hanya untuk uji coba/main bareng teman: tanpa jaminan uptime, server hanya hidup selama komputer & tunnel menyala.
- cloudflared butuh koneksi keluar ke edge Cloudflare di **port 7844** (TCP/UDP). Jaringan yang memblokir port itu (mis. sebagian kantor/kampus/sandbox cloud) tidak bisa memakai quick tunnel.

## ☁️ Deploy gratis: Render + Postgres gratis (dicek Oktober 2026)

| Layanan | Free tier | Catatan |
|---|---|---|
| **Render** web service | ✅ gratis, 750 jam instance/bulan | Tidur setelah 15 menit tanpa request HTTP/pesan WebSocket, bangun ±1 menit. **Disk ephemeral** → wajib pakai Postgres untuk data permanen. |
| **Neon** Postgres (rekomendasi) | ✅ gratis permanen | 1 GB/proyek, 100 CU-jam compute/proyek/bulan, compute tidur setelah 5 menit sepi (bangun otomatis ±1 dtk). Data tidak dihapus jika kuota habis. |
| **Supabase** Postgres | ✅ gratis | 500 MB database, 2 proyek aktif; proyek **di-pause setelah 1 minggu tidak aktif** (bisa di-resume dari dashboard). |
| Render Postgres | ⚠️ gratis tapi **kedaluwarsa 30 hari** | Setelah itu 14 hari grace lalu data dihapus. Tidak disarankan untuk data permanen. |

### Langkah
1. **Buat database gratis**
   - **Neon**: daftar di https://neon.com → New Project → salin *connection string* (`postgresql://...neon.tech/neondb?sslmode=require`).
   - atau **Supabase**: https://supabase.com → New project → **Connect** → salin URI *Session pooler* (port 5432, IPv4-friendly)
     `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
2. **Push kode** ke GitHub/GitLab (`node_modules`, `data/`, build Android sudah di-`.gitignore`).
3. **Render**: https://render.com → **New → Blueprint** → pilih repo (membaca `render.yaml`), atau **New → Web Service**:
   Runtime **Node**, Build `npm install --omit=dev`, Start `npm start`, Instance **Free**, Health check `/health`.
4. **Environment variables** di Render → Environment:
   | Variabel | Wajib | Keterangan |
   |---|---|---|
   | `DATABASE_URL` | ya (di Render) | connection string Neon/Supabase. Kosong → file JSON (hilang saat Render restart). |
   | `PORT` | otomatis | di-set Render; default lokal 3000 |
   | `PGSSL` | tidak | default SSL tanpa verifikasi CA; `verify` = verifikasi penuh; `disable` = tanpa SSL (otomatis untuk localhost) |
   | `PG_POOL_MAX` | tidak | jumlah koneksi pool (default 5; free tier punya batas koneksi) |
   | `DATA_DIR` | tidak | folder data JSON (default `./data`) |
   | `START_GEMS` | tidak | gem awal akun baru (default 0; dipakai tes) |
   | `NODE_VERSION` | tidak | versi Node di Render (render.yaml: 20) |
5. Deploy → dapat URL `https://<nama>.onrender.com`. Buka di browser (WebSocket otomatis `wss://`). Untuk APK, isi URL itu di `public/config.js` lalu build ulang.
6. Log Render harus menampilkan `storage: postgres postgresql://***@...`.

Free tier cocok untuk **sedikit pemain** (beberapa sampai belasan bersamaan, 1 instance).
Alternatif gratis: jalankan server di PC sendiri + tunnel gratis (mis. Cloudflare Tunnel).

## Struktur
```
server/index.js     HTTP static + WebSocket, akun/sesi, manajer world (load/unload async), rate limit
server/auth.js      Hash password scrypt, token sesi
server/world.js     Logika game otoritatif per world (gerak, pukul, taruh, pohon, splice, World Lock, /access, toko, chat)
server/storage.js   Storage async: backend JSON lokal atau PostgreSQL (DATABASE_URL), antrian per key
public/shared.js    Definisi blok/item/toko/fisika dipakai server & client
public/game.js      Client Canvas (render, fisika lokal, input mouse/keyboard/sentuh, UI login & panel)
public/sound.js     Efek suara & musik prosedural (WebAudio)
public/config.js    Alamat server default (opsional, untuk APK)
test/               storage.test.js (unit), multiplayer.test.js & features.test.js (end-to-end), helpers.js
capacitor.config.json, android/   Proyek Android (Capacitor 7) yang membungkus public/
tools/make-icons.py Generator ikon & splash orisinal
render.yaml         Blueprint deploy Render
```

## Arsitektur & Skalabilitas (world-per-process)
Setiap `World` adalah unit mandiri (state + aturan) yang tidak bergantung pada socket. Untuk banyak server:
1. **Kepemilikan world** lewat lease Redis `SET world:<NAMA> <hostId> NX PX 30000` → satu host per world, tetap server-authoritative.
2. **Routing**: gateway/lobby membaca Redis lalu mengarahkan client ke host world tsb.
3. **Persistensi**: sudah lewat `storage.js` (Postgres bersama). Data pemain di-update atomik per field (inventori vs sesi).
4. **Lintas world**: chat global/teman lewat Redis Pub/Sub.
5. **Unload**: world kosong disimpan & dibongkar dari memori (sudah diimplementasikan).

## Keterbatasan
- Fisika dihitung di client; server hanya memvalidasi batas kecepatan & tabrakan (efek pelan di air diprediksi client).
- Teman disimpan menurut nama tampilan. PM hanya terkirim ke pemain yang sedang online (tidak ada kotak masuk offline).
- Trade hanya antar pemain di world yang sama. Pakaian adalah item inventori (bisa di-trade).
- Tidak ada reset password/email; lupa password = buat akun baru (admin bisa menghapus baris di tabel `players`).
- Akun lama dari versi tanpa password (file `data/players/*.json` tanpa `passHash`) tidak bisa login; hapus filenya agar nama bisa didaftarkan ulang.
- Save berkala tiap 5 detik: jika server mati mendadak (bukan SIGTERM), perubahan ≤5 detik terakhir bisa hilang.
- Satu instance server (tanpa sharding) — lihat bagian skalabilitas.
- APK adalah debug build (bukan rilis Play Store); belum ada ikon adaptif custom selain generator sederhana.
- Server Render free tidur saat sepi → koneksi pertama lambat.
