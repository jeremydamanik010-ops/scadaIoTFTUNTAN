# SCADA IoT IMTS-V1 — Patch V1.5: Dua Valve + Heater

**Dasar:** gabungan V1.1 + V1.2 + V1.3 + V1.4 serta simulator V1.4 hotfix yang terakhir diberikan. Patch ini **bukan** salinan seluruh repository. Jangan mengganti/menghapus file lain di luar paket.

## Arsitektur dipertahankan

`Web MTU → Node.js/Express → MQTT EMQX → RTU-01 (ESP32/simulator) → Valve 1, Valve 2, Heater`.

- **Valve 1 (Pipa 1)**: dari tangki sumber ke tangki utama.
- **Heater**: memanaskan air dalam tangki utama.
- **Valve 2 (Pipa 2)**: dari tangki utama ke tangki penampungan.
- Tetap **satu RTU-01**, topic `scada/RTU-01/{sensor,status,command,ack}`, mode Manual/Otomatis, autentikasi, ACK MQTT, dashboard, grafik, dan riwayat.

## Siklus Otomatis (state machine)

1. **MENGISI**: Valve 1 ON selama volume tangki utama **kurang dari** setpoint volume. Valve 2 dan heater OFF. Air baru (diasumsikan 22 °C) menurunkan suhu campuran. Valve 1 OFF di target.
2. **MEMANASKAN**: Valve 1 dan 2 OFF, heater ON ketika suhu di bawah setpoint (dengan proteksi air minimal). Heater OFF saat suhu mencapai setpoint.
3. **MEMINDAHKAN**: Hanya bila **dua setpoint tercapai**, Valve 2 ON **selama 60 detik waktu nyata**. Valve 1/heater OFF; air keluar, volume turun, suhu menurun sedikit dalam model simulasi. Countdown dikirim setiap update sensor.
4. **ULANGI**: setelah 60 detik Valve 2 OFF; sistem mulai mengisi dan memanaskan lagi. Valve 2 boleh menutup **lebih awal** jika tangki utama hampir kosong (≤5%) atau tangki penampungan penuh (≥98%).

Angka laju aliran dan model termal adalah **asumsi simulasi**, bukan hasil kalibrasi hardware. Tangki penampungan disimulasikan menerima air saat Valve 2 terbuka, lalu dikosongkan bertahap ke proses downstream saat Valve 2 tertutup agar siklus dapat terus berulang.

**Manual:** operator mengendalikan Valve 1, Valve 2, heater terpisah lewat website. RTU menolak Valve 1 ON saat Valve 2 ON, menolak Valve 2 ON saat Valve 1/heater ON, serta memblok heater ketika air terlalu rendah atau suhu terlalu tinggi. Saat beralih mode, output direset OFF terlebih dahulu. Perubahan setpoint tetap boleh dalam Manual tetapi tidak menggerakkan aktuator secara otomatis.

**Proteksi fisik wajib**: Valve 1/Valve 2 harus fail-closed saat catu daya hilang; kontrol heater membutuhkan proteksi kering, temperatur berlebih, dan interlock nyata di firmware/rangkaian, bukan hanya pada simulasi. Jangan menjalankan heater fisik tanpa proteksi yang teruji. Valve tidak memompa air dengan sendirinya: Pipa 1/2 memerlukan beda ketinggian/tekanan sumber yang mencukupi.

## Instalasi (backup dahulu)

1. **Stop** backend dan semua simulator lama (`Ctrl+C`). Pastikan hanya **satu** simulator/ESP32 menggunakan RTU-01; versi lama yang memakai `pump` tidak kompatibel.
2. Buka Supabase Dashboard → SQL Editor; **jalankan sekali** `migrations/002_two_valves_process.sql`. Migrasi bersifat additive: menambah kolom status Valve 1/2, volume tangki penampungan, fase proses, countdown. **Tidak menghapus** tabel/riwayat/kolom `pump_status`. Kolom pump lama hanya dipakai sebagai alias penyimpanan untuk kompatibilitas jika ada constraint NOT NULL.
3. Backup folder `SCADA backend`; ekstrak ZIP patch lalu **salin file menurut path-nya** ke folder lama (Replace bila diminta). Pertahankan `.env`, `.git`, folder sumber lain yang tidak ada dalam ZIP.
4. CMD pada folder project:
   ```bash
   npm test
   npm start
   ```
5. CMD kedua:
   ```bash
   node simulasi.js
   ```
6. Buka **http://localhost:3000** melalui server (jangan buka file HTML langsung atau Live Server), lalu refresh **Ctrl+Shift+R**. Login → Interface. Pastikan tombol Valve 1/2 di dua pipa, heater, setpoint, label fase, dan countdown terlihat.

**Tidak perlu mengubah `.env` atau `package-lock.json`.** Dependensi dan topik MQTT tetap sama. Saat pengujian waktu, gunakan `SIMULATOR_SPEED_FACTOR=1` (atau biarkan tidak diatur) dan `SIMULATOR_INTERVAL_MS=1000` default. Waktu buka Valve 2 menggunakan jam nyata **60 detik**, bukan `SIMULATOR_SPEED_FACTOR`.

## API dan MQTT baru

API untuk Manual:
- `POST /api/rtu/RTU-01/valve1` body `{ "status": "ON" }`
- `POST /api/rtu/RTU-01/valve2` body `{ "status": "OFF" }`
- `POST /api/rtu/RTU-01/heater` (tidak berubah)

Endpoint `/api/rtu/RTU-01/pump` **dihapus**. Endpoint mode/setpoints tetap.

Backend mengirim ke `scada/RTU-01/command`:
```json
{"command_id":"<uuid>","device":"valve1","status":"ON"}
```
RTU mengembalikan ACK pada `scada/RTU-01/ack`:
```json
{"command_id":"<uuid>","device":"valve1","applied":true,"status":"ON","mode":"Manual"}
```
Payload telemetry pada `scada/RTU-01/sensor`:
```json
{
  "suhu": 30,
  "humidity": 70,
  "water_level": "HIGH",
  "tank_volume": 80,
  "destination_volume": 30,
  "valve1_status": "OFF",
  "valve2_status": "ON",
  "heater_status": "OFF",
  "process_phase": "MEMINDAHKAN",
  "transfer_remaining_seconds": 42
}
```
Status `scada/RTU-01/status` tetap melaporkan `status`, `mode`, kedua setpoint; juga boleh melaporkan fase dan sisa waktu.

## Batasan & pengujian

- **Firmware ESP32 belum diberikan**, jadi belum ada flashing/mapping GPIO baru. Firmware perlu mengikuti kontrak MQTT di atas, menerapkan state machine lokal, fail-safe, timer 60 detik berbasis `millis()`, dan ACK setelah perubahan benar-benar diterapkan.
- Migrasi Supabase perlu dijalankan sebelum V1.5. Perlu dilakukan pengujian end-to-end dengan akun EMQX/Supabase dan hardware asli.
- Ketika RTU offline, operator masih dapat **memilih** mode (tersimpan Supabase), tetapi **tidak boleh menyalakan valve/heater** sampai RTU online. Mode tersimpan offline tetap tidak otomatis dikirim saat reconnect.
- Kecepatan simulasi dan penurunan suhu pada air yang keluar adalah model sederhana; untuk skripsi, parameter debit, perpindahan panas, dan timing sensor perlu dikalibrasi.
