// ============================================================
// script.js — SCADA IoT Dashboard
// Terhubung ke Node.js backend API → Supabase database
// ============================================================

// ============================================================
// URL BACKEND NODE.JS
// ============================================================
const API_URL = window.location.origin;

// ============================================================
// SESSION GUARD — redirect ke login jika belum login
// ============================================================

const session = JSON.parse(
  sessionStorage.getItem("scada_session")
);

const token = sessionStorage.getItem("scada_token");

if (!session || !token) {
  window.location.href = "login.html";
}

// ============================================================
// HELPER: FETCH DENGAN TOKEN JWT OTOMATIS
// ============================================================

async function apiFetch(endpoint, options = {}) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,

    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  // Token kadaluarsa / tidak valid
  if (res.status === 401 || res.status === 403) {
    showToast(
      "⚠️ Sesi habis, silakan login kembali.",
      "error"
    );

    setTimeout(() => {
      sessionStorage.clear();
      window.location.href = "login.html";
    }, 2000);

    return null;
  }

  return res.json();
}

// ============================================================
// INISIALISASI DATA USER
// ============================================================

document.getElementById("userName").textContent =
  `👤 ${session.username} (${session.role})`;

document.getElementById("profileUsername").textContent =
  session.username;

document.getElementById("profileRole").textContent =
  session.role;

document.getElementById("profileJoinDate").textContent =
  session.joinDate;

// ============================================================
// LOGOUT
// ============================================================

function logout() {
  if (confirm("Yakin ingin keluar dari dashboard?")) {
    sessionStorage.clear();
    window.location.href = "login.html";
  }
}

// ============================================================
// NAVIGASI HALAMAN
// ============================================================

const PAGE_MAP = {
  "Dashboard": "dashboardContent",
  "Profil": "profilePage",
  "Riwayat Data": "historyPage",
  "Interface": "interfacePage"
};

function openPage(pageName) {
  document.getElementById("dashboardContent").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("historyPage").style.display = "none";
  document.getElementById("interfacePage").style.display = "none";

  const targetId = PAGE_MAP[pageName];

  if (targetId) {
    document.getElementById(targetId).style.display =
      targetId === "dashboardContent"
        ? "grid"
        : "block";
  }

  // Kalau buka Riwayat Data → ambil data history
  if (pageName === "Riwayat Data") {
    loadHistoryData();
  }
}

openPage("Dashboard");

// ============================================================
// MODE TOGGLE
// ============================================================

let isAutomatic = true;

let currentPumpStatus = "OFF";
let currentHeaterStatus = "OFF";

function toggleMode() {
  isAutomatic = !isAutomatic;

  const indicator = document.getElementById("modeIndicator");
  const modeText = document.getElementById("modeText");
  const systemMode = document.getElementById("systemMode");

  if (isAutomatic) {
    indicator.className = "indicator green";
    modeText.textContent = "Mode Otomatis";
    systemMode.textContent = "Otomatis";

    showToast("✅ Beralih ke Mode Otomatis");
  } else {
    indicator.className = "indicator red";
    modeText.textContent = "Mode Manual";
    systemMode.textContent = "Manual";

    showToast("⚠️ Beralih ke Mode Manual");
  }

  // Kirim mode ke backend
  apiFetch("/api/rtu/RTU-01/mode", {
    method: "POST",

    body: JSON.stringify({
      mode: isAutomatic
        ? "Otomatis"
        : "Manual"
    })
  }).catch(err => {
    console.error("Gagal kirim mode:", err);
  });
}

// ============================================================
// KONTROL MANUAL — POMPA
// ============================================================

async function controlPump() {
  if (isAutomatic) {
    showToast(
      "⚠️ Aktifkan Mode Manual dulu untuk mengendalikan pompa.",
      "error"
    );

    return;
  }

  const newStatus =
    currentPumpStatus === "ON"
      ? "OFF"
      : "ON";

  try {
    const result = await apiFetch(
      "/api/rtu/RTU-01/pump",
      {
        method: "POST",

        body: JSON.stringify({
          status: newStatus
        })
      }
    );

    if (result && result.success) {
      currentPumpStatus = newStatus;

      applyPumpVisual(newStatus);

      showToast(
        newStatus === "ON"
          ? "✅ Pompa dinyalakan"
          : "🛑 Pompa dimatikan"
      );
    } else {
      showToast(
        `❌ ${
          result?.message ||
          "Gagal mengubah status pompa"
        }`,
        "error"
      );
    }

  } catch (err) {
    console.error(
      "Gagal kirim perintah pompa:",
      err
    );

    showToast(
      "❌ Tidak bisa konek ke server.",
      "error"
    );
  }
}

// ============================================================
// KONTROL MANUAL — HEATER
// ============================================================

async function controlHeater() {
  if (isAutomatic) {
    showToast(
      "⚠️ Aktifkan Mode Manual dulu untuk mengendalikan heater.",
      "error"
    );

    return;
  }

  const newStatus =
    currentHeaterStatus === "ON"
      ? "OFF"
      : "ON";

  try {
    const result = await apiFetch(
      "/api/rtu/RTU-01/heater",
      {
        method: "POST",

        body: JSON.stringify({
          status: newStatus
        })
      }
    );

    if (result && result.success) {
      currentHeaterStatus = newStatus;

      applyHeaterVisual(newStatus);

      showToast(
        newStatus === "ON"
          ? "✅ Heater dinyalakan"
          : "🛑 Heater dimatikan"
      );
    } else {
      showToast(
        `❌ ${
          result?.message ||
          "Gagal mengubah status heater"
        }`,
        "error"
      );
    }

  } catch (err) {
    console.error(
      "Gagal kirim perintah heater:",
      err
    );

    showToast(
      "❌ Tidak bisa konek ke server.",
      "error"
    );
  }
}

// ============================================================
// VISUAL POMPA
// ============================================================

function applyPumpVisual(pumpStatus) {
  const pumpIcon = document.getElementById("pumpIcon");
  const pumpBtn = document.getElementById("pumpBtn");
  const pipe1 = document.getElementById("pipeLine");
  const pipe2 = document.getElementById("pipeLine2");
  const pipe3 = document.getElementById("pipeLine3");

  const pumpDot = document.getElementById("pumpDot");
  const pumpText = document.getElementById("pumpText");

  const isOn = pumpStatus === "ON";

  pumpIcon?.classList.toggle("rotate", isOn);
  pumpBtn?.classList.toggle("on", isOn);

  pipe1?.classList.toggle("active", isOn);
  pipe2?.classList.toggle("active", isOn);
  pipe3?.classList.toggle("active", isOn);

  pumpDot?.classList.toggle("on", isOn);

  if (pumpText) {
    pumpText.textContent = pumpStatus;
  }
}

// ============================================================
// VISUAL HEATER
// ============================================================

function applyHeaterVisual(heaterStatus) {
  const heaterIcon =
    document.getElementById("heaterIcon");

  const heaterBtn =
    document.getElementById("heaterBtn");

  const heaterDot =
    document.getElementById("heaterDot");

  const heaterText =
    document.getElementById("heaterText");

  const isOn = heaterStatus === "ON";

  heaterIcon?.classList.toggle(
    "fire",
    isOn
  );

  heaterBtn?.classList.toggle(
    "on",
    isOn
  );

  heaterDot?.classList.toggle(
    "on",
    isOn
  );

  if (heaterText) {
    heaterText.textContent = heaterStatus;
  }
}

// ============================================================
// HELPERS
// ============================================================

function formatTime(date) {
  return date.toLocaleTimeString(
    "id-ID",
    {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }
  );
}

// ============================================================
// BUFFER GRAFIK
// ============================================================

const MAX_POINTS = 10;

const volumeData = [];
const temperatureData = [];
const timeLabels = [];

for (let i = MAX_POINTS; i > 0; i--) {
  const d = new Date(
    Date.now() - i * 5000
  );

  timeLabels.push(
    formatTime(d)
  );

  volumeData.push(null);
  temperatureData.push(null);
}

// ============================================================
// CHART.JS — GRAFIK VOLUME TANKI
// ============================================================

const volumeCanvas =
  document.getElementById("volumeChart");

const volumeCtx =
  volumeCanvas.getContext("2d");

const volumeChart = new Chart(
  volumeCtx,
  {
    type: "line",

    data: {
      labels: [...timeLabels],

      datasets: [
        {
          label: "Volume Tanki (%)",

          data: [...volumeData],

          borderColor: "#00d4ff",

          backgroundColor:
            "rgba(0,212,255,.15)",

          fill: true,

          tension: 0.4,

          borderWidth: 2,

          pointRadius: 3
        }
      ]
    },

    options: {
      responsive: true,

      plugins: {
        legend: {
          labels: {
            color: "#fff"
          }
        }
      },

      scales: {
        x: {
          ticks: {
            color: "#aaddff",
            maxTicksLimit: 5
          }
        },

        y: {
          min: 0,
          max: 100,

          ticks: {
            color: "#aaddff"
          }
        }
      }
    }
  }
);

// ============================================================
// CHART.JS — GRAFIK SUHU AIR
// ============================================================

const temperatureCanvas =
  document.getElementById(
    "temperatureChart"
  );

const temperatureCtx =
  temperatureCanvas.getContext("2d");

const temperatureChart = new Chart(
  temperatureCtx,
  {
    type: "line",

    data: {
      labels: [...timeLabels],

      datasets: [
        {
          label: "Suhu Air (°C)",

          data: [...temperatureData],

          borderColor: "#00ff85",

          backgroundColor:
            "rgba(0,255,133,.15)",

          fill: true,

          tension: 0.4,

          borderWidth: 2,

          pointRadius: 3
        }
      ]
    },

    options: {
      responsive: true,

      plugins: {
        legend: {
          labels: {
            color: "#fff"
          }
        }
      },

      scales: {
        x: {
          ticks: {
            color: "#aaddff",
            maxTicksLimit: 5
          }
        },

        y: {
          min: 20,
          max: 40,

          ticks: {
            color: "#aaddff"
          }
        }
      }
    }
  }
);

// ============================================================
// FUNGSI UTAMA
// AMBIL DATA TERBARU DARI API
// ============================================================

async function fetchAndUpdateDashboard() {
  try {
    const data = await apiFetch("/api/sensor/latest");
  
    console.log("=== HASIL API LATEST ===");
    console.log(JSON.stringify(data, null, 2));

    console.log("LATEST DARI API:", data);

    if (
      !data ||
      !data.success ||
      !Array.isArray(data.data) ||
      data.data.length === 0
    ) {
      console.warn("Tidak ada data sensor dari API");
      return;
    }

    // Cari RTU-01
    const sensor =
      data.data.find(row => row.rtu_id === "RTU-01") ||
      data.data[0];

    console.log("DATA RTU-01:", sensor);

    // ========================================================
    // AMBIL FIELD SENSOR
    // ========================================================

    const volume = Number(
      sensor.tank_volume ??
      sensor.volume ??
      sensor.tankVolume ??
      0
    );

    const suhu = Number(
      sensor.suhu ??
      sensor.water_temp ??
      sensor.temperature ??
      sensor.water_temperature ??
      0
    );

    const pumpStatus = String(
      sensor.pump_status ??
      sensor.pumpStatus ??
      "OFF"
    ).toUpperCase();

    const heaterStatus = String(
      sensor.heater_status ??
      sensor.heaterStatus ??
      "OFF"
    ).toUpperCase();

    const rtuStatus = String(
      sensor.rtu_status ??
      sensor.status ??
      "Connected"
    );

    // ========================================================
    // CARD DASHBOARD
    // ========================================================

    const tankVolumeEl =
      document.getElementById("tankVolume");

    if (tankVolumeEl) {
      tankVolumeEl.textContent =
        `${volume.toFixed(1)} %`;
    }

    const waterTemperatureEl =
      document.getElementById("waterTemperature");

    if (waterTemperatureEl) {
      waterTemperatureEl.textContent =
        `${suhu.toFixed(1)} °C`;
    }

    // ========================================================
    // STATUS POMPA
    // ========================================================

    const pumpStatusEl =
      document.getElementById("pumpStatus");

    if (pumpStatusEl) {
      pumpStatusEl.textContent =
        pumpStatus;

      pumpStatusEl.style.color =
        pumpStatus === "ON"
          ? "#00ff85"
          : "#ff5555";
    }

    // ========================================================
    // STATUS HEATER
    // ========================================================

    const heaterStatusEl =
      document.getElementById("heaterStatus");

    if (heaterStatusEl) {
      heaterStatusEl.textContent =
        heaterStatus;

      heaterStatusEl.style.color =
        heaterStatus === "ON"
          ? "#00ff85"
          : "#ff5555";
    }

    // ========================================================
    // STATUS RTU
    // ========================================================

    const rtuStatusEl =
      document.getElementById("rtuStatus");

    if (rtuStatusEl) {

      if (rtuStatus === "Connected") {

        rtuStatusEl.textContent =
          "🟢 Connected";

      } else if (
        rtuStatus.includes("Volume")
      ) {

        rtuStatusEl.textContent =
          `🔴 Alarm: ${rtuStatus}`;

      } else {

        rtuStatusEl.textContent =
          `🟠 ${rtuStatus}`;
      }
    }

    // ========================================================
    // INTERFACE SCADA
    // ========================================================

    const tankPercentEl =
      document.getElementById("tankPercent");

    if (tankPercentEl) {
      tankPercentEl.textContent =
        `${volume.toFixed(1)} %`;
    }

    const waterLevelEl =
      document.getElementById("waterLevel");

    if (waterLevelEl) {
      waterLevelEl.style.height =
        `${Math.max(0, Math.min(100, volume))}%`;
    }

    const tempInterfaceEl =
      document.getElementById("tempInterface");

    if (tempInterfaceEl) {
      tempInterfaceEl.textContent =
        `${suhu.toFixed(1)} °C`;
    }

    const pumpStatus2El =
      document.getElementById("pumpStatus2");

    if (pumpStatus2El) {
      pumpStatus2El.textContent =
        pumpStatus;
    }

    const heaterStatus2El =
      document.getElementById("heaterStatus2");

    if (heaterStatus2El) {
      heaterStatus2El.textContent =
        heaterStatus;
    }

    // ========================================================
    // SINKRON STATUS
    // ========================================================

    currentPumpStatus =
      pumpStatus;

    currentHeaterStatus =
      heaterStatus;

    applyPumpVisual(
      pumpStatus
    );

    applyHeaterVisual(
      heaterStatus
    );

    // ========================================================
    // UPDATE GRAFIK
    // ========================================================

    const now =
      formatTime(new Date());

    timeLabels.push(now);
    volumeData.push(volume);
    temperatureData.push(suhu);

    if (
      timeLabels.length >
      MAX_POINTS
    ) {
      timeLabels.shift();
      volumeData.shift();
      temperatureData.shift();
    }

    volumeChart.data.labels =
      [...timeLabels];

    volumeChart.data.datasets[0].data =
      [...volumeData];

    temperatureChart.data.labels =
      [...timeLabels];

    temperatureChart.data.datasets[0].data =
      [...temperatureData];

    volumeChart.update();
    temperatureChart.update();

  } catch (err) {

    console.error(
      "Gagal ambil data sensor:",
      err
    );

    const rtuStatusEl =
      document.getElementById(
        "rtuStatus"
      );

    if (rtuStatusEl) {
      rtuStatusEl.textContent =
        "🔴 Gagal membaca data";
    }
  }
}

// ============================================================
// POLLING DATA DASHBOARD
// ============================================================

fetchAndUpdateDashboard();

setInterval(
  fetchAndUpdateDashboard,
  5000
);

// ============================================================
// RIWAYAT DATA
//
// Frontend
//     ↓
// Node.js /api/sensor/history
//     ↓
// Supabase RPC get_sensor_history()
//     ↓
// sensor_data
//
// ============================================================

async function loadHistoryData() {

  const tbody =
    document.getElementById(
      "historyData"
    );

  if (!tbody) {
    console.error(
      "Elemen #historyData tidak ditemukan"
    );
    return;
  }

  tbody.innerHTML = `
    <tr>
      <td colspan="5"
          style="
            text-align:center;
            color:#aaddff;
          ">
        ⏳ Mengambil data dari Supabase...
      </td>
    </tr>
  `;

  try {

    const response =
      await apiFetch(
        "/api/sensor/history?rtu_id=RTU-01&limit=20&hours=24"
      );

    console.log(
      "HISTORY DARI API:",
      response
    );

    if (
      !response ||
      !response.success
    ) {
      throw new Error(
        response?.message ||
        "API history gagal"
      );
    }

    const rows =
      Array.isArray(response.data)
        ? response.data
        : [];

    console.log(
      "JUMLAH DATA HISTORY:",
      rows.length
    );

    if (rows.length === 0) {

      tbody.innerHTML = `
        <tr>
          <td colspan="5"
              style="
                text-align:center;
                color:#aaddff;
              ">
            Belum ada data riwayat.
          </td>
        </tr>
      `;

      return;
    }

    tbody.innerHTML =
      rows.map(row => {

        // ====================================================
        // WAKTU
        // ====================================================

        const waktuRaw =
          row.received_at ??
          row.created_at ??
          row.timestamp ??
          row.time ??
          row.waktu;

        const waktu =
          waktuRaw
            ? new Date(
                waktuRaw
              ).toLocaleString(
                "id-ID"
              )
            : "-";

        // ====================================================
        // VOLUME
        // ====================================================

        const volume =
          Number(
            row.tank_volume ??
            row.volume ??
            row.tankVolume ??
            0
          );

        // ====================================================
        // SUHU
        // ====================================================

        const suhu =
          Number(
            row.suhu ??
            row.water_temp ??
            row.temperature ??
            row.water_temperature ??
            0
          );

        // ====================================================
        // STATUS
        // ====================================================

        const pompa =
          String(
            row.pump_status ??
            row.pumpStatus ??
            "OFF"
          ).toUpperCase();

        const heater =
          String(
            row.heater_status ??
            row.heaterStatus ??
            "OFF"
          ).toUpperCase();

        return `
          <tr>

            <td>
              ${waktu}
            </td>

            <td
              style="
                color:${
                  volume < 30
                    ? "#ffaa00"
                    : "#00ff85"
                };
              "
            >
              ${
                Number.isFinite(volume)
                  ? volume.toFixed(1)
                  : "0.0"
              } %
            </td>

            <td
              style="
                color:${
                  suhu > 35
                    ? "#ff5555"
                    : "#00ff85"
                };
              "
            >
              ${
                Number.isFinite(suhu)
                  ? suhu.toFixed(1)
                  : "0.0"
              } °C
            </td>

            <td
              style="
                font-weight:bold;
                color:${
                  pompa === "ON"
                    ? "#00ff85"
                    : "#ff5555"
                };
              "
            >
              ${pompa}
            </td>

            <td
              style="
                font-weight:bold;
                color:${
                  heater === "ON"
                    ? "#ffaa00"
                    : "#00ff85"
                };
              "
            >
              ${heater}
            </td>

          </tr>
        `;

      }).join("");

  } catch (err) {

    console.error(
      "History error:",
      err
    );

    tbody.innerHTML = `
      <tr>
        <td colspan="5"
            style="
              text-align:center;
              color:#ff5555;
            ">
          ❌ Gagal mengambil riwayat data.
        </td>
      </tr>
    `;
  }
}
// ============================================================
// GANTI PASSWORD
// ============================================================

async function changePassword() {
  const current =
    prompt(
      "Masukkan password saat ini:"
    );

  if (!current) {
    return;
  }

  const newPass =
    prompt(
      "Masukkan password baru (minimal 6 karakter):"
    );

  if (
    !newPass ||
    newPass.length < 6
  ) {
    showToast(
      "❌ Password baru minimal 6 karakter.",
      "error"
    );

    return;
  }

  const confirmPass =
    prompt(
      "Konfirmasi password baru:"
    );

  if (
    newPass !==
    confirmPass
  ) {
    showToast(
      "❌ Password dan konfirmasi tidak sama.",
      "error"
    );

    return;
  }

  try {

    const data =
      await apiFetch(
        "/api/auth/change-password",
        {
          method: "POST",

          body: JSON.stringify({
            username:
              session.username,

            oldPassword:
              current,

            newPassword:
              newPass
          })
        }
      );

    if (
      data &&
      data.success
    ) {

      showToast(
        "✅ Password berhasil diubah!"
      );

    } else {

      showToast(
        `❌ ${
          data?.message ||
          "Gagal ubah password"
        }`,
        "error"
      );
    }

  } catch (err) {

    console.error(
      "Change password error:",
      err
    );

    showToast(
      "❌ Tidak bisa konek ke server.",
      "error"
    );
  }
}

// ============================================================
// TOAST NOTIFICATION
// ============================================================

function showToast(
  message,
  type = "success"
) {
  const existing =
    document.getElementById(
      "scada-toast"
    );

  if (existing) {
    existing.remove();
  }

  const toast =
    document.createElement(
      "div"
    );

  toast.id =
    "scada-toast";

  toast.textContent =
    message;

  toast.style.cssText = `
    position: fixed;
    bottom: 2rem;
    right: 2rem;

    padding: 0.8rem 1.5rem;

    border-radius: 10px;

    color: white;

    font-weight: bold;

    font-size: 0.95rem;

    z-index: 9999;

    animation:
      fadeInUp 0.4s ease;

    background:
      ${
        type === "error"
          ? "rgba(255,85,85,0.9)"
          : "rgba(0,200,100,0.9)"
      };

    box-shadow:
      0 4px 20px
      rgba(0,0,0,0.4);
  `;

  if (
    !document.getElementById(
      "toast-style"
    )
  ) {

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "toast-style";

    style.textContent = `
      @keyframes fadeInUp {

        from {
          opacity: 0;
          transform:
            translateY(20px);
        }

        to {
          opacity: 1;
          transform:
            translateY(0);
        }

      }
    `;

    document.head.appendChild(
      style
    );
  }

  document.body.appendChild(
    toast
  );

  setTimeout(() => {

    toast.style.opacity =
      "0";

    toast.style.transition =
      "opacity 0.4s";

    setTimeout(
      () => toast.remove(),
      400
    );

  }, 3000);
}