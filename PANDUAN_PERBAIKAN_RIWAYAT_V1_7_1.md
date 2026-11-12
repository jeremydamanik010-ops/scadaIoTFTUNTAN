# SCADA IoT V1.7.1 — Fix format tanggal dan jam riwayat komunikasi

## Penyebab

Screenshot error **"Tanggal harus YYYY-MM-DD"** berasal dari validator **V1.6** yang hanya menerima `2026-11-10`. Form Riwayat Data pada V1.7 mengirim tanggal **beserta jam**, misalnya `2026-11-10T00:25`. Backend V1.7 sebenarnya sudah menyediakan `parseTimeWindow()`, sehingga error itu menunjukkan backend masih memakai salah satu file versi lama atau proses Node.js belum di-restart.

## File yang perlu diganti

- `routes/communication.js` — versi V1.7 dengan filter jam WIB dan endpoint `/metrics` untuk PDR/PLR.
- `services/communication-metrics.js` — parser menerima datetime WIB; fungsi lama `parseDateWindow` juga kompatibel jika dipanggil dengan datetime V1.7.
- `tests/riwayat-tanggal-v1.7.1.test.js` — tes tambahan (opsional namun disarankan).

**Tidak perlu mengganti** `simulasi.js`, `public/script.js`, `public/dashboard.html`, `.env`, Supabase, atau MQTT untuk masalah tanggal ini, dengan syarat file frontend memang sudah V1.7 seperti pada screenshot.

## Langkah Windows

1. Hentikan semua backend Node.js lama di CMD (`Ctrl+C`). Pastikan hanya satu server berjalan di port 3000.
2. Backup `routes/communication.js` dan `services/communication-metrics.js` lama.
3. Ekstrak ZIP ini. Tempel isinya ke folder `SCADA backend` mengikuti struktur foldernya, lalu pilih **Replace**.
4. Dari CMD di folder `SCADA backend`, jalankan:

   ```cmd
   node tests/riwayat-tanggal-v1.7.1.test.js
   npm start
   ```

5. Refresh website di `http://localhost:3000` dengan `Ctrl+Shift+R`. Pilih 10 November 2026 00:25 sampai 00:30 WIB dan klik **Tampilkan**.
6. Jika sudah tidak ada error format tanggal tetapi data kosong, cek bahwa migrasi V1.6 (`003`) dan V1.7 (`004`) sudah diterapkan dan simulator V1.7 telah mengirim laporan.

## Periksa langsung dengan browser

Lakukan login lalu tekan F12 > Network, klik Tampilkan, cari request
`/api/communication/RTU-01/history?from=2026-11-10T00%3A25&to=2026-11-10T00%3A30&direction=all`
serta `/metrics?...`. **Status 200** berarti backend mengenali rentang waktu. **Status 401/403** menunjukkan masalah akses, **404** kemungkinan file routes lama, dan **500** kemungkinan DB/migrasi. Jangan kirim Bearer token dari Network.

**Catatan penelitian:** hasil PDR/PLR tetap hanya tersedia bila laporan paket terkirim RTU lengkap selama seluruh rentang dan telah tersimpan di Supabase. Error format tanggal bukan alasan untuk mengubah rumus PDR/PLR.
