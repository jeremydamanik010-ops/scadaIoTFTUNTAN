# SCADA IoT V1.5.1 — Valve 1/2 Bergantian (perbaikan siklus otomatis)

## Isi patch (hanya file yang berubah)

- `services/process-control.js` — memperbaiki state machine agar fase pemindahan terkunci selama 60 detik; Valve 1 **tidak bisa terbuka selama fase ini**, sekalipun volume utama turun di bawah setpoint.
- `simulasi.js` — perubahan setpoint saat pemindahan **tidak** mereset fase transfer. Perubahan setpoint diterapkan setelah fase transfer selesai. Pergantian dari Manual ke Otomatis menutup Valve 2 terlebih dahulu jika sebelumnya aktif.
- `tests/valve-interlock-v1.5.1.test.js` — pengujian baru untuk timer 60 detik, pergantian valve, pembaruan setpoint, safety stop, dan faktor percepatan simulator.

**Tidak perlu mengganti** `server.js`, `config/mqtt.js`, `routes/`, `public/`, `.env`, Supabase SQL, atau topik MQTT. Patch ini untuk simulator dan logika proses, belum mengubah firmware ESP32.

## Perilaku setelah perbaikan

1. **MENGISI**: Valve 1 ON hingga batas volume utama, Valve 2 OFF.
2. **MEMANASKAN**: Valve 1/2 OFF, heater ON sampai batas suhu, dengan interlock volume.
3. **MEMINDAHKAN**: Valve 2 ON selama **60 detik waktu nyata**, Valve 1 dan heater OFF. Penurunan volume tidak memicu pengisian selama transfer.
4. **JEDA_VALVE**: Pada detik ke-60, Valve 2 OFF, Valve 1 tetap OFF selama **1 detik** (jeda pergantian).
5. **MENGISI** kembali: Valve 1 dapat ON bila volume di bawah setpoint. Siklus berulang.

**Pengecualian keselamatan:** Jika tangki utama nyaris kosong (≤5%) atau tangki penampungan hampir penuh (≥98%), Valve 2 segera ditutup lebih awal. Fase berubah menjadi `TRANSFER_TERHENTI`; Valve 1 tetap OFF hingga jendela 60 detik berakhir, lalu melalui jeda 1 detik. Keselamatan lebih utama daripada kewajiban membuka Valve 2 selama 60 detik.

Kecepatan pemindahan simulasi kini dihitung dengan cadangan kapasitas dan berdasarkan **waktu nyata**, jadi `SIMULATOR_SPEED_FACTOR` tidak menghabiskan air sebelum 60 detik seperti sebelumnya. Durasi aktual dapat berbeda sampai interval tick simulator (default 1 detik).

## Instalasi Windows / VS Code

1. Hentikan simulator lama (`Ctrl + C`); hentikan simulator duplikat yang memakai `RTU-01`.
2. Backup folder `SCADA backend` yang berfungsi saat ini.
3. Ekstrak ZIP, lalu salin **hanya** `simulasi.js` dan `services/process-control.js` ke struktur folder proyek lama, pilih **Replace**.
4. Untuk pengujian, salin `tests/valve-interlock-v1.5.1.test.js` ke folder `tests/`.
5. Dari terminal di folder proyek, jalankan:
   ```bash
   node tests/valve-interlock-v1.5.1.test.js
   node tests/valve-cycle-v1.5.test.js
   node tests/simulator.test.js
   ```
   Opsional: `npm test` untuk tes regresi lainnya.
6. Jalankan `npm start` (backend) dan `node simulasi.js` (simulator) dalam dua terminal. Jika backend tetap berjalan, cukup restart simulator.
7. Pada website pilih mode **Otomatis**, kemudian lihat indikator `Fase` dan `Valve 1`/`Valve 2` pada Interface. Jalankan satu siklus penuh dan amati timer 60 detik.

## Hasil pengujian lokal

Lulus pengujian logika proses dengan waktu simulasi terkontrol pada faktor kecepatan 1x, 3x, dan 10x, uji interlock dua valve, safety stop, timer 60 detik, serta regresi tes simulator dan proses sebelumnya. **Belum diuji terhadap EMQX/Supabase akun pengguna atau hardware ESP32 fisik.**

**Catatan hardware:** firmware ESP32 harus mengimplementasikan state machine yang setara dan interlock keamanan fisik. Simulator bukan controller keamanan untuk valve/heater sebenarnya. Untuk hardware, utamakan feedback valve tertutup sebelum membuka valve lainnya, selain jeda waktu.
