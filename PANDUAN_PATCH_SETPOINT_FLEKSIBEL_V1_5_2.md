# SCADA IoT RTU-01 — Patch Setpoint Fleksibel V1.5.2

## Tujuan
Menghilangkan pembatas yang terlalu sempit dari versi lama (20–38 °C dan 20–95%), supaya operator dapat memilih batas proses yang lebih sesuai melalui halaman Interface. Alur V1.5.1 **tidak diubah**: Valve 1 mengisi → heater memanaskan → Valve 2 transfer sampai 60 detik → Valve 2 OFF → jeda pergantian 1 detik → isi ulang.

## Rentang versi simulator ini

- **Suhu setpoint: 0–90 °C**, resolusi 0,1°C.
- **Volume utama setpoint: 15–98%**, resolusi 0,1%.
- **Penghentian darurat heater dalam simulator pada 95 °C**, terpisah dari setpoint normal. Simulator juga tidak menambah volume melewati 98% ketika Valve 1 terbuka.
- *Batas volume 15% dan 98% sengaja dipertahankan untuk proteksi pemanasan tanpa air dan kelebihan isi.*
- **Bukan operasi fisik tanpa batas:** saat memakai ESP32, firmware dan peralatan fisik **harus** menerapkan batas keselamatan sendiri berdasarkan kapasitas tanki, jenis heater, pengukuran suhu, pressure/venting, relay, dan kebutuhan keselamatan. Jangan memakai default simulator untuk mengizinkan 90°C pada hardware tanpa validasi.

## File yang perlu diganti

| File | Perubahan |
|---|---|
| `services/setpoint-policy.js` | Validasi suhu 0–90 °C, volume 15–98%, setelan interlock simulator |
| `services/process-control.js` | Menaikkan plafon suhu simulasi dari 41 °C sesuai interlock; membatasi volume masuk di 98%; mempertahankan V1.5.1 |
| `public/dashboard.html` | Range input dan petunjuk operator |
| `public/script.js` | Validasi input dan grafik suhu adaptif (bisa di atas 40 °C) |
| `tests/flexible-setpoints-v1.5.2.test.js` | Tes setpoint baru, interlock, 60 detik, grafik/input |

**Tidak perlu mengubah** `simulasi.js`, `routes/rtu.js`, `server.js`, `.env`, struktur Supabase, maupun topic MQTT. Namun `simulasi.js` yang digunakan harus yang sudah diperbarui melalui patch V1.5.1.

## Pemasangan

1. Backup folder `SCADA backend` yang digunakan saat ini.
2. Hentikan backend (`Ctrl+C`) **dan** simulator (`Ctrl+C`).
3. Ekstrak patch. Salin folder `services/`, `public/`, dan `tests/` ke folder `SCADA backend` lama. Timpa hanya file bernama sama. **Jangan menghapus** `.git` atau `.env`.
4. Dari folder proyek, jalankan:

```bash
node tests/flexible-setpoints-v1.5.2.test.js
node tests/valve-interlock-v1.5.1.test.js
npm test
```

5. Restart CMD backend: `npm start`.
6. Jalankan CMD simulator: `node simulasi.js`.
7. Buka `http://localhost:3000`, login, lalu paksa refresh dengan `Ctrl+Shift+R`.
8. Pilih contoh suhu **60°C** dan volume **97%**, tekan **Simpan & Kirim ke RTU**, tunggu ACK, lalu pantau fase dan suhu. Anda dapat menguji 70°C, 80%, dll. tanpa lagi tertahan batas 38°C.

## Jika masih menolak suhu >38 °C

Pastikan keempat file yang diubah tadi sudah ditimpa di folder yang benar, kedua proses Node.js sudah dihentikan dan dijalankan ulang, serta cache browser telah di-refresh. Jika ditolak, lihat log pada CMD dan pastikan hanya **satu** simulator dengan identitas `RTU-01` yang aktif.

## Verifikasi yang sudah dilakukan

- Pengujian unit pada setpoint 65.5°C dan volume 97.5%, dan batas tepi 0, 90, 15, 98.
- Pengujian temperatur 70 °C tercapai pada simulator tanpa tersangkut batas lama 40°C.
- Pengujian kontrol Valve 2 60 detik dan interlock tidak menyalakan Valve 1 dan Valve 2 bersamaan.
- Pengujian regresi lama (`foundation`, `simulator`, `mode-offline`, `realtime-v1.3`, `valve-cycle-v1.5`, `valve-interlock-v1.5.1`, `setpoints-v1.4`, `setpoint-api-v1.4`) berhasil dijalankan dengan dependency mock.
- Belum diuji terhadap EMQX Cloud/Supabase yang terhubung ke akun pengguna, atau terhadap hardware fisik.
