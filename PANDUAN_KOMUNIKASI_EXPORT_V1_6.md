# SCADA IoT V1.6 — Riwayat Komunikasi & Ekspor Excel (.xlsx)

Patch incremental untuk **SCADA IoT V1.5.2**, tetap memakai **1 RTU-01, Valve 1, Valve 2, dan heater**. UI lama tetap ada; komponen baru hanya ditambahkan ke **Riwayat Data**. Tidak perlu mengubah paket npm/dependensi, `.env` lama, atau file database lama.

## Instalasi (WAJIB berurutan)

1. **Backup** seluruh folder proyek `SCADA backend`. Hentikan `npm start` dan `node simulasi.js` (`Ctrl+C`).
2. Login ke **Supabase Dashboard → SQL Editor**. Jalankan `migrations/003_communication_logs.sql`. Ini membuat tabel **communication_logs** (tidak menghapus `sensor_data` atau riwayat lama).
3. Pastikan backend memakai **SUPABASE_SERVICE_ROLE_KEY** pada file `.env` atau environment hosting. Jangan menyalin secret ke frontend/GitHub. Tabel memakai RLS dan hanya server privileged client yang bisa akses langsung. Jika `.env` hanya berisi anon/publishable key untuk database admin, pencatatan akan ditolak.
4. Salin file-file kode dari ZIP patch sesuai path foldernya ke `SCADA backend` lama, dengan Replace jika diminta. **Jangan menghapus `.env`, `.git` atau folder lain.**
5. Jalankan `node tests/communication-v1.6.test.js`, lalu `npm test` dari folder proyek (setelah npm dependencies terinstal dengan `npm ci` bila diperlukan).
6. Jalankan **CMD 1:** `npm start`; **CMD 2:** `node simulasi.js`.
7. Buka `http://localhost:3000`, login, lalu refresh `Ctrl+Shift+R`. Buka **Riwayat Data → Riwayat Komunikasi & Export Excel**. Pilih tanggal dan arah, klik **Tampilkan**, lalu **Download Excel (.xlsx)**.

## Isi file Excel

1. **Data Sensor**: packet ID, waktu RTU kirim, backend terima, browser terima, suhu, volume, Valve 1/2, heater, fase.
2. **Delay RTU-MTU**: waktu relevan, selisih waktu terestimasi dan mutu jam.
3. **Kontrol MTU-RTU**: command ID, perintah, waktu MTU kirim, backend terima/publish, RTU terima dan ACK, RTT backend, hasil.
4. **Statistik**: jumlah baris, jumlah perintah berhasil/gagal, RTT min/rata-rata/max dan batasan interpretasi.

**Batas ekspor:** pilih rentang maksimum **31 hari inklusif** per berkas; maksimum **20.000 baris**. Jika lebih, backend memberi pesan agar mempersempit rentang tanggal, **tidak diam-diam memotong data**. Waktu dalam sheet **UTC ISO 8601 (milidetik)**. Filter tanggal website mengikuti kalender **WIB (UTC+7)**.

## Cara menghitung delay secara benar

- **RTU → Backend (estimasi)** = `backend_received_at - rtu_sent_at`.
- **RTU → Browser MTU (estimasi)** = `browser_received_at - rtu_sent_at`.
- **MTU → RTU (estimasi)** = `rtu_received_at - mtu_sent_at`.
- **Backend → RTU (estimasi)** = `rtu_received_at - backend_sent_at`.
- **RTT backend (pengukuran kuat)** = waktu monotonik sejak backend publish command MQTT hingga menerima ACK RTU. Mencakup perjalanan dua arah dan waktu pemrosesan RTU; **bukan one-way delay**.

**WAJIB UNTUK SKRIPSI:** Semua nilai *one-way* adalah **estimasi lintas jam**, tidak boleh diperlakukan sebagai delay presisi jika sinkronisasi jam ESP32, server dan browser belum dibuktikan. Kolom `clock_quality=unverified` menandakan sinkronisasi belum diverifikasi. Nilai negatif mungkin muncul akibat clock skew; jangan dikoreksi secara acak. Simpan hasil mentah. RTT backend (monotonic) tidak memerlukan sinkronisasi dua perangkat.

**Simulator V1.6:** menggunakan `time_sync_status=local_os`, maka mutu data jam = **unverified**, meskipun backend dan simulator kebetulan di laptop sama. Firmware ESP32 perlu **NTP** dan mencatat status sinkronisasi secara akurat; pengujian jaringan sesungguhnya masih harus dilakukan.

## Payload MQTT tambahan

**RTU sensor** `scada/RTU-01/sensor` (semua field sensor lama V1.5.2 dipertahankan):

```json
{
  "packet_id":"64f61d1d-52d8-4ae3-9f23-56952fb535e1",
  "rtu_sent_at":"2026-11-05T10:00:00.123Z",
  "time_sync_status":"ntp_synced",
  "suhu":35.2,"humidity":70,"water_level":"MEDIUM",
  "tank_volume":60,"destination_volume":10,
  "valve1_status":"OFF","valve2_status":"OFF","heater_status":"OFF",
  "process_phase":"MEMANASKAN","transfer_remaining_seconds":0
}
```

**Backend command** `scada/RTU-01/command`: menyertakan `command_id`, `device`, data kontrol, `backend_sent_at`, `mtu_sent_at`.

**RTU ACK** `scada/RTU-01/ack`: field lama tetap ada; tambah:

```json
{
  "command_id":"<command UUID persis dari backend>",
  "device":"heater", "applied":true,"status":"ON","mode":"Manual",
  "rtu_received_at":"2026-11-05T10:00:05.100Z",
  "rtu_ack_sent_at":"2026-11-05T10:00:05.130Z",
  "time_sync_status":"ntp_synced"
}
```

**JANGAN menulis `ntp_synced` kecuali sinkronisasi jam benar-benar dilakukan.** Nilai `packet_id` harus unik per paket. Waktu sensor/ACK sebaiknya dicatat sedekat mungkin dengan event fisik. Firmware ESP32 fisik **belum termasuk patch ini**, perlu menyesuaikan payload tersebut saat hardware digunakan.

## Keamanan dan batasan

- Endpoint baru berada di `/api/communication/RTU-01/...` dengan autentikasi Supabase dan pembatasan peran operator/admin.
- Spreadsheet dihasilkan backend tanpa library tambahan; tidak membuka database secara langsung dari browser.
- Waktu penerimaan browser hanya tersedia **jika browser terhubung** dan laporan waktu berhasil disimpan di server. Jika website tertutup, sel browser tetap kosong.
- Pesan lama sebelum pemasangan V1.6 **tidak memiliki timestamp asal dan tidak otomatis direkonstruksi**.
- Paket yang gagal sampai backend tidak tercatat; **jangan menyimpulkan packet delivery rate / packet loss** dari log penerimaan saja. Untuk PDR/PLR perlu counter pengiriman ESP32 dan periode pengujian yang jelas.
- Supabase Free dapat terbebani log frekuensi tinggi (1 data/detik ≈86.400 data/hari). Pantau kuota dan tambahkan kebijakan retensi/partisi saat digunakan terus-menerus.
- Perintah kontrol dan state machine Valve 1/Valve 2/Heater **tidak diubah**; hanya ditambah metadata, pencatatan dan ekspor.

## Troubleshooting

- `relation communication_logs does not exist` → jalankan migrasi `003` lalu cek SQL Editor berhasil.
- `permission denied` / RLS insert → cek server memakai service-role key, bukan anon key sebagai admin client.
- Ekspor Excel 401 → login ulang; 403 → akun bukan operator/admin; 413 → kurangi rentang tanggal.
- Tanggal browser kosong → harus ada dashboard terbuka saat paket datang dan koneksi SSE aktif.
- Nilai delay negatif/besar → periksa sinkronisasi NTP/perbedaan jam, jangan dihapus tanpa dokumentasi.
- Tabel hanya menampilkan baris terbaru hingga 30; file Excel memuat lebih banyak, selama berada dalam batas 20.000.
- Jika CMD menunjukkan `Pencatatan komunikasi gagal` tetapi dashboard masih bergerak, berarti jalur MQTT live sehat tetapi penyimpanan log gagal. Periksa SQL dan kebijakan akses.
