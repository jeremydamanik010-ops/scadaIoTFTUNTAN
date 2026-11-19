# Panduan Patch SCADA IoT V1.7.2 — Perbaikan Perhitungan PDR & PLR

## 1. Akar Masalah (Berdasarkan Screenshot & Audit Kode Aktual)

1. **Pesan `Menunggu laporan RTU untuk akhir rentang (minimal 15 detik)` pada `RTU -> MTU (sensor)`:**
   `public/script.js` mengatur nilai awal `Waktu selesai (WIB)` dengan jeda hanya 15 detik (`Date.now() - 15000`). Saat halaman dibuka setelah detik ke-15 (atau jika jam laptop lebih cepat beberapa detik dari server Railway), `Waktu selesai` jatuh ke menit berjalan sehingga langsung ditolak batas tunggu 15 detik di server. Selain itu, waktu default tidak diperbarui otomatis saat tab **Riwayat Data** dibuka belakangan.
2. **Pesan `Arah tidak dipilih` pada `MTU -> RTU (perintah)`:**
   Ketika dropdown **Arah komunikasi** dipilih `RTU -> MTU (Sensor)` (atau `MTU -> RTU`), endpoint `GET /api/communication/:id/metrics` di `routes/communication.js` mengosongkan arah pasangannya (`null`), padahal kedua kartu PDR/PLR selalu tampil berdampingan di layar.
3. **RTU aktif sebagian dalam rentang menit yang dipilih (contoh 14:21:00–14:23:20 dalam rentang 14:21–14:26):**
   `calculateUplink()` di `services/communication-metrics.js` menolak seluruh rentang jika ada satu saja bucket 10 detik kosong atau belum penuh (misalnya RTU baru mulai di detik ke-02 atau berhenti sebelum akhir menit). Patch ini **tetap mempertahankan validasi ketat penuh (`valid: true` hanya bila 100% bucket lengkap)** sesuai metodologi, tetapi menambahkan perhitungan **parsial jujur** khusus dari bucket 10 detik yang benar-benar lengkap (`bucket_complete = true`) dengan mencocokkan numerator hanya pada bucket dan sesi yang sama. Jika 0 bucket lengkap, hasil tetap **N/A / Belum dapat dihitung** (tidak pernah mengarang 100% atau 0%).
4. **Konfirmasi perintah `MTU -> RTU` tanpa `rtu_received_at`:**
   `calculateDownlink()` di `services/communication-metrics.js` kini juga mengakui perintah berstatus `ACK_OK` / `ACK_REJECTED` sebagai terkonfirmasi diterima RTU (tidak hanya mengandalkan `rtu_received_at`), sementara perintah `TIMEOUT_OR_ERROR` tetap dihitung belum terkonfirmasi (PLR).
5. **Sinkronisasi batas bucket 10 detik di `simulasi.js`:**
   `publishSensor()` kini memakai satu timestamp `now` untuk `closeElapsedBuckets(now)` dan `sensorPayload(now)` agar paket di batas detik `:09.999` / `:10.000` tidak terpecah antar bucket.

## 2. Basis Versi & Daftar File

* **Basis kode:** Snapshot source aktual Anda (V1.7.1 di atas commit lokal yang dilaporkan `f8af580`).
* **File DIGANTI (4 file):**
  * `services/communication-metrics.js`
  * `routes/communication.js`
  * `public/script.js`
  * `simulasi.js`
* **File DITAMBAHKAN (2 file):**
  * `tests/pdr-plr-fix-v1.7.2.test.js`
  * `PANDUAN_PATCH_PDR_PLR_V1_7_2.md`
* **File TIDAK DISENTUH:** `server.js`, `config/database.js`, `config/mqtt.js`, `routes/auth.js`, `routes/rtu.js`, `routes/sensor.js`, `services/process-control.js`, `services/setpoint-policy.js`, `services/xlsx-export.js`, `public/dashboard.html`, `public/dashboard.css`, `public/login.*`, `.env`, `.git`, `package.json`, `migrations/*`.

## 3. Kebutuhan Migrasi / Dependency / Railway Variables

* **`npm install`:** TIDAK perlu.
* **Update Railway Variables / `.env`:** TIDAK perlu.
* **Restart backend & simulator:** YA, wajib restart setelah menempel file.
* **Migrasi Supabase:** Tidak ada file SQL baru, **tetapi pastikan tabel `communication_sender_windows` (migrasi `004_delivery_reports_v1_7.sql`) sudah ada** di project Supabase yang dipakai Railway. Cek aman (read-only) di Supabase SQL Editor:

```sql
SELECT
  to_regclass('public.communication_logs') AS communication_logs,
  to_regclass('public.communication_sender_windows') AS communication_sender_windows;
```

Jika `communication_sender_windows` masih `NULL`, jalankan `migrations/004_delivery_reports_v1_7.sql` di Supabase SQL Editor (jangan jalankan `DROP TABLE`).

## 4. Cara Pasang Patch di Windows (Copy-Paste / Replace)

1. Hentikan proses backend (`npm start`) dan simulator (`node simulasi.js`) di Windows CMD dengan `Ctrl+C`.
2. **Backup** minimal 4 file lama berikut ke folder lain (misalnya `C:\Users\User\OneDrive\SCADA-IoT\backup_v1_7_1`):
   * `services\communication-metrics.js`
   * `routes\communication.js`
   * `public\script.js`
   * `simulasi.js`
   *(Jangan menghapus atau memindahkan `.env` dan `.git`.)*
3. Klik kanan `SCADA_PATCH_PDR_PLR_V1_7_2.zip` -> **Extract All...** ke folder sementara (misalnya di `Downloads`).
4. **Buka folder hasil ekstrak**, salin semua isi DI DALAMNYA (`public`, `routes`, `services`, `tests`, `simulasi.js`, `PANDUAN_PATCH_PDR_PLR_V1_7_2.md`). Jangan menyalin folder pembungkus luarnya.
5. Tempel (**Paste**) ke:
   `C:\Users\User\OneDrive\SCADA-IoT\SCADA backend`
6. Saat Windows menanyakan konflik nama file, pilih **Replace the files in the destination**.

## 5. Verifikasi Lokal di Windows CMD

Buka Windows CMD lalu jalankan satu blok perintah berikut:

```cmd
cd /d "C:\Users\User\OneDrive\SCADA-IoT\SCADA backend"
node --check services\communication-metrics.js
node --check routes\communication.js
node --check public\script.js
node --check simulasi.js
node tests\pdr-plr-fix-v1.7.2.test.js
node tests\riwayat-tanggal-v1.7.1.test.js
node tests\communication-log-v1.7.test.js
npm test
```

**Hasil yang diharapkan:**
* Semua perintah `node --check` selesai tanpa output error.
* `node tests\pdr-plr-fix-v1.7.2.test.js` mencetak `PASS V1.7.2`.
* `node tests\riwayat-tanggal-v1.7.1.test.js` dan `node tests\communication-log-v1.7.test.js` mencetak `OK`.
* `npm test` selesai dengan semua test `PASS`.

Setelah lulus, jalankan server lokal di **CMD 1**:

```cmd
cd /d "C:\Users\User\OneDrive\SCADA-IoT\SCADA backend"
npm start
```

Buka **CMD 2** (pastikan hanya **1 publisher `RTU-01`** aktif, jangan bersamaan dengan ESP32):

```cmd
cd /d "C:\Users\User\OneDrive\SCADA-IoT\SCADA backend"
node simulasi.js
```

## 6. Cara Uji PDR & PLR di Browser (Lokal & Railway)

1. Buka `http://localhost:3000`, login, lalu tekan **`Ctrl+Shift+R`** agar `public/script.js` baru termuat (bukan cache lama).
2. Biarkan `simulasi.js` berjalan minimal **2 menit** (agar minimal beberapa bucket 10 detik lengkap tersimpan di `communication_sender_windows`).
3. Selama waktu itu, kirim minimal **1–2 perintah** dari dashboard/Interface (misalnya ubah mode Manual/Otomatis, ubah setpoint, atau klik Valve 1/Heater di mode Manual) supaya ada data `MTU -> RTU (perintah)` untuk dihitung.
4. Tunggu sekitar **1 menit**, buka tab **Riwayat Data**, lalu klik **Tampilkan** (cek baik saat dropdown `Semua`, `RTU -> MTU (Sensor)`, maupun `MTU -> RTU (Perintah)`).
5. Verifikasi:
   * Kartu **RTU -> MTU (sensor)** menampilkan nilai **PDR %** dan **PLR %** (penuh bila seluruh rentang terisi, atau label `(parsial)` + jumlah bucket lengkap bila RTU aktif sebagian rentang).
   * Kartu **MTU -> RTU (perintah)** ikut mengkalkulasi **PDR %** dan **PLR %** jika ada perintah dalam rentang tersebut (tidak lagi muncul `Arah tidak dipilih`).
   * Klik **Download Excel (.xlsx)** dan pastikan sheet `PDR PLR` & `Statistik` terbuka normal.
   * Uji regresi cepat: login, mode Manual/Otomatis, interlock Valve 1 & Valve 2 tidak ON bersamaan, heater tetap aman.

## 7. Push ke GitHub & Cek Deployment Railway (Windows CMD)

```cmd
cd /d "C:\Users\User\OneDrive\SCADA-IoT\SCADA backend"
git status
git ls-files .env
git add services\communication-metrics.js routes\communication.js public\script.js simulasi.js tests\pdr-plr-fix-v1.7.2.test.js PANDUAN_PATCH_PDR_PLR_V1_7_2.md
git diff --cached --name-only
git diff --cached --check
git commit -m "Fix PDR/PLR calculation V1.7.2 (partial complete buckets, dual-card metrics, 60s window)"
git push origin main
git rev-parse --short HEAD
```

*Pastikan `git ls-files .env` kosong sebelum `git commit` / `git push`.*

**Cek di Railway Dashboard:**
1. Masuk ke Railway Dashboard -> project aktif -> klik service backend Node.js.
2. Buka tab **Deployments** -> pastikan commit SHA deployment terbaru **sama persis** dengan hasil `git rev-parse --short HEAD` dan statusnya **Success**.
3. Buka URL produksi Railway Anda, lakukan hard refresh **`Ctrl+Shift+R`**, lalu ulangi verifikasi Riwayat Komunikasi (dengan `simulasi.js` V1.7.2 berjalan).

## 8. Langkah Rollback Jika Gagal

1. Hentikan proses lokal (`Ctrl+C`).
2. Salin kembali 4 file lama (`services\communication-metrics.js`, `routes\communication.js`, `public\script.js`, `simulasi.js`) dari folder backup ke `C:\Users\User\OneDrive\SCADA-IoT\SCADA backend` (pilih **Replace**). Jangan hapus `.env` atau `.git`.
3. Jika sudah terlanjur di-push ke GitHub dan bermasalah di Railway, revert aman tanpa `push --force`:

```cmd
cd /d "C:\Users\User\OneDrive\SCADA-IoT\SCADA backend"
git revert HEAD --no-edit
git push origin main
```

4. Jika masih menemukan error setelah pemasangan, kirimkan: hasil output CMD, tangkapan layar kartu PDR/PLR, dan hasil query `SELECT count(*) FROM public.communication_sender_windows;` (tanpa token/password).
