# SCADA IoT V1.7 — Waktu RTU / MTU, PDR / PLR per rentang waktu, Excel

## Basis dan cakupan

Patch ini diterapkan **di atas V1.6**, yang sebelumnya sudah mengandung sistem **2 valve + 1 heater** (V1.5.2). Ini hanya pengembangan Riwayat Komunikasi dan pencatatan; tidak mengubah urutan siklus otomatis, desain keseluruhan Interface, login, ataupun topik lama.

### File yang diubah

- `simulasi.js` — menyertakan session ID, nomor urut paket, timestamp RTU, serta laporan setiap **10 detik** mengenai jumlah sensor yang benar-benar dicoba dikirim dan ID/waktu penerimaan command.
- `config/mqtt.js` — subscribe tambahan `scada/RTU-01/stats`, mencatat sensor yang sampai tetapi gagal divalidasi sebagai paket diterima, dan menyimpan laporan statistik.
- `services/communication-metrics.js` — filter waktu per menit WIB, rumus PDR/PLR dan pemeriksaan kelengkapan laporan RTU.
- `services/communication-log.js` — pencatatan session, sequence, validasi paket, dan laporan jumlah paket RTU.
- `routes/communication.js` — endpoint `/history`, `/metrics`, dan `/export.xlsx` dengan filter waktu; sumber timestamp dan agregasi.
- `services/xlsx-export.js` — sel rumus Excel yang dibuat oleh server (tidak menerima rumus dari input pengguna).
- `public/dashboard.html`, `public/dashboard.css`, `public/script.js` — dua input tanggal/jam, waktu RTU/MTU di tabel, PDR/PLR di layar, dan export Excel.
- `migrations/004_delivery_reports_v1_7.sql` — skema tambahan non-destruktif.
- `tests/communication-v1.7.test.js`, `tests/communication-log-v1.7.test.js` — tes tanpa internet.

## Cara pemasangan (Windows + VS Code)

1. Cadangkan folder `SCADA backend`. Hentikan **kedua** CMD lama dengan Ctrl+C (backend dan simulator), agar jangan ada dua simulator dengan ID RTU-01 bersamaan.
2. **Pastikan** migrasi `003_communication_logs.sql` V1.6 sudah dijalankan.
3. Supabase Dashboard → **SQL Editor**, jalankan file `migrations/004_delivery_reports_v1_7.sql`. SQL ini **tidak menghapus** `sensor_data` atau riwayat lama.
4. Ekstrak ZIP ini, salin file/folder di dalamnya ke folder proyek `SCADA backend`, pilih **Replace** untuk file sama. **Jangan hapus `.git` atau `.env`**.
5. Di CMD pada folder backend jalankan:

   ```bash
   node tests/communication-v1.7.test.js
   node tests/communication-log-v1.7.test.js
   npm start
   ```

6. Di CMD kedua jalankan `node simulasi.js`.
7. Login melalui **http://localhost:3000**, masuk **Riwayat Data → Riwayat Komunikasi**. Refresh keras menggunakan Ctrl+Shift+R.
8. Biarkan simulator berjalan **lebih dari 6 menit**, lalu pilih rentang 5 menit yang **sudah seluruhnya berlalu**, misalnya 10:00–10:05 WIB, tekan **Tampilkan** lalu **Download Excel**.

> **Jangan** gunakan Live Server atau membuka file HTML langsung; selalu lewat backend Express.

## Cara membaca kolom waktu

- **RTU → MTU (sensor):** `Waktu RTU` adalah **waktu RTU mengirim** paket. `Waktu MTU/backend` adalah **waktu backend menerima** paket MQTT. `Waktu browser MTU` ada hanya jika halaman SCADA sedang terbuka dan dapat melaporkan penerimaannya.
- **MTU → RTU (perintah):** `Waktu MTU/backend` adalah **waktu backend mem-publish perintah MQTT**, `Waktu RTU` adalah waktu RTU menerima perintah (jika ACK atau laporan RTU tersedia). Kolom waktu browser merekam saat operator mengirim permintaan jika tersedia.
- Semua timestamp ditampilkan sebagai **WIB (Asia/Pontianak, UTC+7)** dengan milidetik, sedangkan database menyimpan UTC.
- **Delay satu arah lintas perangkat adalah estimasi**, bukan pengukuran pasti jika jam ESP32, backend, dan browser belum disinkronisasi. RTT backend memakai jam monotonik di sisi backend.

## Perhitungan PDR / PLR

\[
PDR(\%) = \frac{N_{diterima}}{N_{dikirim}}\times 100\%
\]
\[
PLR(\%) = \frac{N_{dikirim}-N_{diterima}}{N_{dikirim}}\times 100\%
\]

### Arah RTU → MTU

- `N_dikirim`: jumlah sensor yang dilaporkan sendiri oleh RTU dalam **bucket 10 detik**. Contoh: total 300 paket selama 5 menit.
- `N_diterima`: jumlah **packet_id unik** yang benar-benar mencapai **backend/MTU MQTT** dan tercatat di Supabase, termasuk sensor yang gagal validasi payload.
- Jika ada laporan bucket hilang, sesi terputus, RTU baru start di tengah bucket, atau durasi terlalu dekat dengan waktu sekarang, PDR/PLR **tidak dihitung (N/A)**.
- Perhitungan ini **sampai backend**, bukan PDR ke browser jika browser sedang tertutup.
- Paket yang dicoba publish hanya dihitung simulator selama koneksi broker aktif; **periode offline penuh bukan bagian dari denominator**. Untuk uji outage, perlu metrik availability terpisah.

### Arah MTU → RTU

- `N_dikirim`: perintah dengan `command_id` yang berhasil dicatat sebagai upaya publish MQTT di backend.
- `N_diterima`: perintah yang **terkonfirmasi diterima RTU**, baik dari ACK maupun laporan penerimaan RTU setiap 10 detik.
- **PDR terkonfirmasi = N_diterima / N_dikirim × 100%.**
- **PLR belum terkonfirmasi = (N_dikirim − N_diterima) / N_dikirim × 100%.** Jika ACK maupun laporan RTU hilang, perintah bisa saja telah diterima RTU. Angka ini **tidak boleh diklaim sebagai packet loss jaringan yang pasti**.

## Excel yang diunduh

File berisi 5 sheet:

1. **Data Sensor** — waktu RTU kirim, MTU terima, browser terima, nilai sensor, valve, session, sequence, status validasi.
2. **Delay RTU-MTU** — timestamp RTU/MTU, estimasi delay dan kualitas sinkronisasi jam.
3. **Kontrol MTU-RTU** — waktu MTU kirim, RTU terima, ACK, hasil, RTT.
4. **Statistik** — ringkasan paket dan keterangan metodologi.
5. **PDR PLR** — jumlah paket terkirim/diterima/hilang atau belum dikonfirmasi dan rumus Excel yang dapat dihitung ulang.

Batas ekspor tetap **20.000 baris per file**, rentang maksimum **31 hari**, tetapi untuk pengujian PDR dianjurkan memilih **5–30 menit** agar laporan 10 detik dapat diperiksa. Jika periode berisi lebih banyak dari 20.000 baris, pilih interval lebih kecil.

## Catatan penting untuk skripsi / ESP32

- **Data sebelum V1.7 tidak dapat dihitung PDR/PLR secara retrospektif**, karena log penerima tidak mengetahui berapa banyak paket yang gagal mencapai MTU.
- Firmware ESP32 yang nanti digunakan **harus mengikuti protokol tambahan**: `packet_id`, `session_id`, `packet_seq`, `rtu_sent_at` pada sensor; `rtu_received_at` pada ACK; dan publish **`scada/RTU-01/stats` setiap 10 detik**, mencakup `window_start`, `window_end`, `sensor_sent_count`, `bucket_complete`, `command_received_ids`, dan `command_received_times`. Gunakan NTP dan catat sinkronisasi jam untuk menganalisis delay satu arah.
- Meskipun UI bisa menampilkan nilai PDR/PLR, **ukur dan validasi end-to-end di broker/hardware asli sebelum digunakan sebagai hasil Bab IV**.
- Simulator menggunakan jam OS lokal (`time_sync_status:local_os`), bukan bukti sinkronisasi NTP antara ESP32 dan server.
- Jaga agar `.env`, token, dan credential tidak masuk ZIP/repository publik.
