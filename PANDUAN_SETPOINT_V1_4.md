# SCADA IoT — Patch Setpoint Dinamis V1.4

Basis patch: **SCADA IoT V1.3** (V1.1 mode offline + V1.2 SSE + V1.3 optimasi). Hanya file yang berubah ditaruh dalam ZIP. **Jangan mengganti seluruh repository.**

## Tujuan

Di menu **Interface**, operator mengisi dan mengirim **batas suhu air** (20–38 °C) dan **batas volume** (20–95%). Keduanya adalah **target atas**, bukan dua ambang bebas. Contoh: suhu **30 °C** dan volume **80%**. Konfigurasi hanya berlaku setelah **RTU-01 online** dan mengonfirmasi **kedua** nilai melalui ACK MQTT.

### Algoritma RTU (ESP32/simulator)

- **Mode Otomatis**: Heater **ON** ketika suhu ≤ setpoint − **1°C**, **OFF** ketika suhu ≥ setpoint; pompa **ON** ketika volume ≤ setpoint − **5 poin persentase**, **OFF** ketika volume ≥ setpoint. Pada area hysteresis, keadaan sebelumnya dipertahankan.
- **Mode Manual**: Setpoint boleh diganti/disimpan, tetapi **tidak** mengambil alih tombol kontrol manual; setpoint baru digunakan ketika kembali ke Otomatis.
- **Interlock independen**: heater **OFF** jika volume < **15%** atau suhu ≥ **40°C**; pompa **OFF** jika volume ≥ **98%**, termasuk ketika Manual pada simulator. Nilai ini contoh proteksi program penelitian, bukan pengganti proteksi listrik/termal fisik.
- **RTU offline**: bidang input dapat diedit, namun tombol mengirim dinonaktifkan. Perintah **tidak diantre** untuk dieksekusi otomatis ketika koneksi pulih. Pemilihan *mode* offline V1.1 tetap ada dan tidak berubah.

## Cara memasang

1. Backup folder `SCADA backend` di laptop.
2. Ekstrak ZIP; **salin hanya file/folder isi patch** ke akar folder `SCADA backend`, ikuti struktur direktori, dan pilih *Replace* pada file yang namanya sama.
3. Jangan menghapus `.git` atau `.env` dan jangan memasukkan secret ke GitHub.
4. Tidak perlu migrasi SQL, mengganti `.env`, atau menginstal dependency baru untuk fitur ini.
5. Pada CMD proyek:
   ```bash
   npm test
   node tests/realtime-v1.3.test.js
   node tests/setpoints-v1.4.test.js
   node tests/setpoint-api-v1.4.test.js
   npm start
   ```
6. Buka CMD kedua (folder sama): `node simulasi.js`.
7. Login di `http://localhost:3000`, buka **Interface**, masukkan suhu **32**, volume **70**, tekan **Simpan & Kirim ke RTU**.
8. Periksa indikator "Suhu aktif di RTU / Volume aktif di RTU" serta log `🎯 SETPOINT RTU` pada simulator. Di Otomatis, pengendalian berubah sesuai ambang; di Manual, tombol aktuator tetap independen.
9. Tekan `Ctrl+Shift+R` di browser setelah mengganti file CSS/JS. Jika setpoint masih "tidak diketahui", pastikan simulator versi V1.4 benar-benar aktif dan status MQTT mengandung dua field setpoint.

**Hindari** menjalankan dua `node simulasi.js` bersamaan: dua simulator dengan ID `RTU-01` pada broker yang sama dapat saling bertentangan.

### File yang ada dalam patch

- `public/dashboard.html` — dua input baru dan panel status setpoint di bawah diagram Interface.
- `public/dashboard.css` — styling panel responsif.
- `public/script.js` — kirim REST API, validasi input, pembaruan status dari SSE/status RTU, hindari menimpa nilai yang sedang diketik.
- `routes/rtu.js` — endpoint `POST /api/rtu/RTU-01/setpoints` dengan validasi role, offline guard, dan ACK yang cocok.
- `services/setpoint-policy.js` — kebijakan batas, hysteresis, dan interlock untuk simulator/backend.
- `services/rtu-live-state.js` — membaca setpoint aktual dari topic status MQTT.
- `simulasi.js` — menerima perintah, menyimpan target lokal di `simulasi-setpoints.json`, menjalankan kontrol dan mengirim ACK/status.
- `.gitignore` — mengecualikan `simulasi-setpoints.json`.
- `tests/setpoints-v1.4.test.js`, `tests/setpoint-api-v1.4.test.js` — tes tanpa cloud/ESP32.

### Format MQTT untuk firmware ESP32

Backend mengirim ke **`scada/RTU-01/command`** (QoS 1, retain false):

```json
{
  "device": "setpoints",
  "command_id": "<UUID-dari-backend>",
  "temperature_setpoint": 30,
  "volume_setpoint": 80
}
```

ESP32 wajib memvalidasi dua angka, kemudian **menyimpan setpoint ke NVS/Preferences** dan baru mengirim **ACK** ke `scada/RTU-01/ack`:

```json
{
  "command_id": "<UUID-yang-sama>",
  "device": "setpoints",
  "applied": true,
  "temperature_setpoint": 30,
  "volume_setpoint": 80
}
```

Jika tidak valid/gagal disimpan, kirim `applied:false` + `reason` (tanpa mengklaim perubahan berhasil). Setelah berhasil diterapkan, ESP32 harus mengirim status aktual ke `scada/RTU-01/status`:

```json
{
  "status": "online",
  "mode": "Otomatis",
  "temperature_setpoint": 30,
  "volume_setpoint": 80
}
```

**Firmware ESP32 fisik belum ada di berkas handover**, jadi patch ini baru **berfungsi end-to-end pada simulator**. Pada hardware ESP32, callback MQTT, penyimpanan NVS, sensor aktual, dan kontrol dua relay harus menerapkan kontrak di atas sebelum fitur bisa digunakan secara fisik. Jangan mengubah relay ESP32 tanpa mengetahui pin dan active-high/active-low modul yang benar. Perilaku keselamatan harus diuji di hardware dan tidak boleh hanya bergantung pada software.

### Jika terjadi error

- HTTP `409`: RTU offline; jangan mengandalkan mode pilihan operator sebagai indikator RTU online.
- HTTP `400`: nilai input di luar batas atau bukan angka.
- HTTP `502`/`504`: ACK RTU tidak cocok, ditolak, atau melewati timeout; periksa log simulator/ESP32 dan broker, jangan menyimpulkan aktuator sudah berubah.
- Nilai di website masih lama: cek topic `scada/RTU-01/status` memuat `temperature_setpoint` dan `volume_setpoint`; periksa koneksi SSE/Network browser.
- Reboot simulator: target terakhir disimpan ke `simulasi-setpoints.json` (local file, tidak ikut Git). Firmware fisik perlu NVS untuk ketahanan setelah reboot.

Pengujian proyek *tidak* mengukur delay jaringan aktual; pengukuran respons harus dilakukan terpisah ketika cloud dan ESP32 tersedia.
