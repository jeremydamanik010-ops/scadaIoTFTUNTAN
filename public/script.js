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
      ...(options.method?.toUpperCase()==='POST' && endpoint.startsWith('/api/rtu/') ? { 'X-SCADA-Client-Sent-At': new Date().toISOString() } : {}),
      ...(options.headers || {})
    }
  });

  // Token kadaluarsa / tidak valid
  if (res.status === 401) {
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
    if (typeof setDefaultCommWindow === "function") setDefaultCommWindow(false);
    loadHistoryData();
    loadCommunicationHistory();
  }
}

openPage("Dashboard");

// ============================================================
// MODE — operator preference saved even when RTU is offline.
// Never confuse desired mode with reported RTU/hardware mode.
// ============================================================
let isAutomatic = null;  // ACTUAL RTU mode only, null when offline.
let desiredMode = null;
let isRTUOnline = false;
let currentValve1Status = "OFF";
let currentValve2Status = "OFF";
let currentHeaterStatus = "OFF";
let modeRequestInFlight = false;
let controlRequestInFlight = false;
let modeStreamEpoch = 0; // Prevent old HTTP replies replacing newer MQTT status.
let setpointRequestInFlight = false;
let appliedSetpointSnapshot = null;
function displaySetpointState(state = {}) {
  const t = state.temperature_setpoint;
  const v = state.volume_setpoint;
  const known = state.is_online && Number.isFinite(t) && Number.isFinite(v);
  const temp = document.getElementById('temperatureSetpoint');
  const volume = document.getElementById('volumeSetpoint');
  if (known) {
    appliedSetpointSnapshot = {temperature_setpoint:t,volume_setpoint:v};
    if (temp && temp.dataset.dirty !== 'true') temp.value = String(t);
    if (volume && volume.dataset.dirty !== 'true') volume.value = String(v);
  }
  const tLabel = document.getElementById('appliedTemperatureSetpoint');
  const vLabel = document.getElementById('appliedVolumeSetpoint');
  const status = document.getElementById('setpointSyncStatus');
  const save = document.getElementById('saveSetpointBtn');
  if (tLabel) tLabel.textContent = known ? `Suhu aktif di RTU: ${t} °C` : 'Suhu aktif di RTU: tidak diketahui';
  if (vLabel) vLabel.textContent = known ? `Volume aktif di RTU: ${v} %` : 'Volume aktif di RTU: tidak diketahui';
  if (status) status.textContent = !state.is_online ? 'RTU offline — belum bisa kirim setpoint' :
    known ? 'Setpoint aktual dikonfirmasi RTU' : 'RTU online — menunggu laporan setpoint dari firmware';
  if (save) save.disabled = !state.is_online || setpointRequestInFlight || modeRequestInFlight;
}
for (const id of ['temperatureSetpoint','volumeSetpoint']) {
  document.getElementById(id)?.addEventListener('input',ev => { ev.target.dataset.dirty = 'true'; });
}
async function saveSetpoints(event) {
  event.preventDefault();
  if (!isRTUOnline || setpointRequestInFlight) {
    showToast('⚠️ RTU harus online untuk menerapkan batas suhu dan volume.','error');
    return;
  }
  const temperatureInput = document.getElementById('temperatureSetpoint')?.value?.trim();
  const volumeInput = document.getElementById('volumeSetpoint')?.value?.trim();
  const t = Number(temperatureInput);
  const v = Number(volumeInput);
  if (!temperatureInput || !volumeInput ||
      !Number.isFinite(t) || t < 0 || t > 90 ||
      !Number.isFinite(v) || v < 15 || v > 98) {
    showToast('⚠️ Masukkan suhu 0–90 °C dan volume 15–98 % sesuai batas aman simulasi.','error');
    return;
  }
  setpointRequestInFlight = true;
  const btn = document.getElementById('saveSetpointBtn');
  if (btn) btn.disabled = true;
  try {
    const result = await apiFetch('/api/rtu/RTU-01/setpoints', {
      method:'POST',
      body:JSON.stringify({temperature_setpoint:t,volume_setpoint:v})
    });
    if (!result?.success || !result.acknowledged) {
      showToast('❌ '+(result?.message || 'Setpoint belum diterapkan RTU'),'error');
      return;
    }
    for (const id of ['temperatureSetpoint','volumeSetpoint']) {
      const el = document.getElementById(id);
      if (el) el.dataset.dirty = 'false';
    }
    // ACK returns confirmed targets. Await new status to verify current RTU values.
    showToast('✅ Batas suhu dan volume telah dikonfirmasi RTU.');
    await refreshRTUState();
  } catch(err) {
    console.error('Setpoint gagal dikirim:',err);
    showToast('❌ Gagal mengirim batas ke RTU','error');
  } finally {
    setpointRequestInFlight = false;
    if (btn) btn.disabled = !isRTUOnline;
  }
}


function displayModeState(state = {}) {
  const actual = state.is_online && ['Manual', 'Otomatis'].includes(state.mode) ? state.mode : null;
  const desired = ['Manual','Otomatis'].includes(state.desired_mode) ? state.desired_mode : null;
  const display = desired || actual;
  isRTUOnline = !!state.is_online;
  displaySetpointState(state);
  isAutomatic = actual === 'Otomatis' ? true : actual === 'Manual' ? false : null;
  desiredMode = desired;
  const pending = !!desired && (!isRTUOnline || desired !== actual);
  const indicator = document.getElementById('modeIndicator');
  const modeText = document.getElementById('modeText');
  const systemMode = document.getElementById('systemMode');
  const requested = document.getElementById('desiredMode');
  const sync = document.getElementById('modeSyncStatus');
  const apply = document.getElementById('applyModeBtn');
  if (indicator) indicator.className = 'indicator ' + (!isRTUOnline || pending ? 'gray' : isAutomatic ? 'green' : 'red');
  if (modeText) modeText.textContent = display ? `Mode ${display}${pending ? ' (pilihan)' : ''}` : 'Pilih Mode';
  if (systemMode) systemMode.textContent = actual || 'Tidak diketahui (RTU offline)';
  const interfaceRtuText = document.getElementById('interfaceRtuText');
  if (interfaceRtuText) interfaceRtuText.textContent = isRTUOnline ? 'RTU-01 ONLINE' : 'RTU-01 OFFLINE';
  const interfaceBadge = interfaceRtuText?.closest('.connection-badge');
  if (interfaceBadge) interfaceBadge.style.opacity = isRTUOnline ? '1' : '0.55';
  if (requested) requested.textContent = desired || 'Belum dipilih';
  if (sync) sync.textContent = pending ?
    (isRTUOnline ? 'Belum diterapkan — tekan Terapkan Mode' : 'Tersimpan — menunggu RTU online') :
    (isRTUOnline ? 'Mode RTU terkonfirmasi' : 'RTU offline');
  if (apply) apply.hidden = !(pending && isRTUOnline);
  for (const mode of ['Manual','Otomatis']) {
    const button = document.getElementById('selectMode' + mode);
    if (button) {
      button.classList.toggle('selected-mode',display === mode);
      button.disabled = modeRequestInFlight;
    }
  }
  // Actuator controls remain disabled until RTU confirms Manual and is online.
  const canControl = isRTUOnline && isAutomatic === false;
  for (const id of ['valve1Btn','valve2Btn','heaterBtn']) {
    const btn = document.getElementById(id);
    if (btn) { btn.disabled = !canControl; btn.title = canControl ? 'Kontrol aktuator Manual' : 'Kontrol hanya ketika RTU online dalam mode Manual'; }
  }
}

async function refreshRTUState() {
  if (modeRequestInFlight) return;
  const startedAtEpoch = modeStreamEpoch;
  try {
    const result = await apiFetch('/api/rtu/RTU-01/state');
    if (!result?.success) throw new Error(result?.message || 'Tidak ada respon');
    if (!modeRequestInFlight && startedAtEpoch === modeStreamEpoch) displayModeState(result.data);
  } catch(err) {
    console.warn('Tidak bisa membaca status RTU:',err.message);
    const sync = document.getElementById('modeSyncStatus');
    if (sync) sync.textContent = 'Status RTU tidak dapat dimuat';
  }
}

async function selectMode(mode) {
  if (!['Manual','Otomatis'].includes(mode) || modeRequestInFlight || controlRequestInFlight) return;
  modeRequestInFlight = true;
  for (const id of ['selectModeManual','selectModeOtomatis']) {
    const btn = document.getElementById(id); if (btn) btn.disabled = true;
  }
  try {
    const result = await apiFetch('/api/rtu/RTU-01/mode', {
      method:'POST', body:JSON.stringify({mode})
    });
    if (!result?.success) {
      showToast('❌ ' + (result?.message || 'Tidak bisa menyimpan pilihan mode'), 'error');
      return;
    }
    showToast(result.acknowledged ? `✅ RTU mengonfirmasi mode ${mode}` :
      `🟠 Mode ${mode} tersimpan, belum diterapkan pada RTU`);
  } catch(err) {
    console.error('Gagal menyimpan mode:',err);
    showToast('❌ Gagal menyimpan pilihan mode','error');
  } finally {
    modeRequestInFlight = false;
    await refreshRTUState();
  }
}

async function toggleMode() {
  const current = desiredMode || (isAutomatic === null ? null : isAutomatic ? 'Otomatis' : 'Manual');
  if (!current) {
    showToast('Pilih Manual atau Otomatis pada panel Status Sistem.');
    return;
  }
  return selectMode(current === 'Manual' ? 'Otomatis' : 'Manual');
}

async function applySavedMode() {
  if (!isRTUOnline || !desiredMode || modeRequestInFlight) return;
  modeRequestInFlight = true;
  try {
    const result = await apiFetch('/api/rtu/RTU-01/mode/apply', {method:'POST'});
    if (!result?.success || !result.acknowledged) {
      showToast('⚠️ ' + (result?.message || 'RTU belum mengonfirmasi mode'), 'error');
      return;
    }
    showToast('✅ RTU mengonfirmasi mode '+desiredMode);
  } catch(err) {
    console.error('Gagal menerapkan mode:',err);
    showToast('❌ Gagal mengirim perintah mode','error');
  } finally {
    modeRequestInFlight = false;
    await refreshRTUState();
  }
}

async function sendActuatorCommand(device) {
  if (!isRTUOnline || isAutomatic !== false) {
    showToast('⚠️ RTU harus online dan benar-benar berada dalam mode Manual.', 'error');
    return;
  }
  if (controlRequestInFlight || modeRequestInFlight) return;
  controlRequestInFlight = true;
  const actual = device === 'valve1' ? currentValve1Status : device === 'valve2' ? currentValve2Status : currentHeaterStatus;
  const requested = actual === 'ON' ? 'OFF' : 'ON';
  try {
    const result = await apiFetch(`/api/rtu/RTU-01/${device}`, {
      method:'POST', body:JSON.stringify({status:requested})
    });
    if (!result?.success || !result.acknowledged) {
      showToast('❌ ' + (result?.message || 'RTU tidak mengonfirmasi perintah'),'error');
      return;
    }
    showToast(`✅ RTU mengonfirmasi ${device} ${requested}.`);
    // RTU ACK reports the state actually applied. Update quickly even if SSE is reconnecting.
    const confirmed = String(result.status || '').toUpperCase();
    if (['ON', 'OFF'].includes(confirmed)) {
      if (device === 'valve1') { currentValve1Status = confirmed; applyValveVisual(1, confirmed); }
      else if (device === 'valve2') { currentValve2Status = confirmed; applyValveVisual(2, confirmed); }
      else { currentHeaterStatus = confirmed; applyHeaterVisual(confirmed); }
      const a = document.getElementById(device === 'heater' ? 'heaterStatus' : `${device}Status`);
      const b = document.getElementById(device === 'heater' ? 'heaterStatus2' : `${device}Status2`);
      if (a) a.textContent = confirmed;
      if (b) b.textContent = confirmed;
    }
    // Live MQTT sensor events verify/reconcile this state. Avoid blocking on Supabase.
    if (!streamConnected) fetchAndUpdateDashboard().catch(console.warn);
  } catch(err) {
    console.error('Gagal kontrol aktuator:',err);
    showToast('❌ Gagal mengirim perintah','error');
  } finally { controlRequestInFlight = false; }
}
async function controlValve1() { return sendActuatorCommand('valve1'); }
async function controlValve2() { return sendActuatorCommand('valve2'); }
async function controlHeater() { return sendActuatorCommand('heater'); }

refreshRTUState();
setInterval(refreshRTUState,10000); // MQTT status events refresh immediately; slower DB safety fallback.

// ============================================================
// VISUAL VALVES — flow Pipa 1 and Pipa 2 are independent.
// ============================================================
function applyValveVisual(number, status) {
  const active = status === 'ON';
  document.getElementById(`valve${number}Module`)?.classList.toggle('valve-open',active);
  document.getElementById(`valve${number}Btn`)?.classList.toggle('on',active);
  document.getElementById(`valve${number}Flow`)?.classList.toggle('active',active);
  document.getElementById(`valve${number}Dot`)?.classList.toggle('on',active);
  const label = document.getElementById(`valve${number}Text`);
  if (label) label.textContent=status;
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
    Date.now() - i * 1000
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
      animation: false,

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
      animation: false,

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
          suggestedMin: 0,
          suggestedMax: 40,

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

// Shared renderer for initial database snapshot and direct MQTT streaming frames.
let lastRenderedSampleMs = 0;
function renderSensorReading(sensor) {
  const sampleMs = Date.parse(sensor?.received_at || '');
  if (!sensor?.is_stale && Number.isFinite(sampleMs)) {
    if (sampleMs <= lastRenderedSampleMs) return;
    lastRenderedSampleMs = sampleMs;
  }
  try {
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

    const valve1Status = String(sensor.valve1_status ?? "OFF").toUpperCase();
    const valve2Status = String(sensor.valve2_status ?? "OFF").toUpperCase();

    const heaterStatus = String(
      sensor.heater_status ??
      sensor.heaterStatus ??
      "OFF"
    ).toUpperCase();

    const sensorStale = sensor.is_stale === true;
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
    // STATUS VALVE 1 / VALVE 2
    // ========================================================

    for (const [n,valveStatus] of [[1,valve1Status],[2,valve2Status]]) {
      const el=document.getElementById(`valve${n}Status`);
      if (el) {
        el.textContent=sensorStale?'Tidak diketahui':valveStatus;
        el.style.color=sensorStale?'#aaaaaa':valveStatus==='ON'?'#00ff85':'#ff5555';
      }
    }

    // ========================================================
    // STATUS HEATER
    // ========================================================

    const heaterStatusEl =
      document.getElementById("heaterStatus");

    if (heaterStatusEl) {
      heaterStatusEl.textContent = sensorStale ? "Tidak diketahui" : heaterStatus;
      heaterStatusEl.style.color = sensorStale ? "#aaaaaa" :
        heaterStatus === "ON" ? "#00ff85" : "#ff5555";
    }

    // ========================================================
    // STATUS RTU
    // ========================================================

    const rtuStatusEl =
      document.getElementById("rtuStatus");

    if (rtuStatusEl) {

      if (sensorStale) {
        rtuStatusEl.textContent = "🔴 Offline / data lama";
      } else if (rtuStatus === "Connected") {

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

    const destinationWater=document.getElementById('destinationWater');
    if(destinationWater && Number.isFinite(Number(sensor.destination_volume))) {
      destinationWater.style.height=`${Math.max(0,Math.min(100,Number(sensor.destination_volume)))}%`;
    }
    const phase=document.getElementById('processPhase');
    if(phase) phase.textContent=sensorStale?'Fase proses: data lama':`Fase: ${sensor.process_phase||'Tidak diketahui'}`;
    const timer=document.getElementById('transferTimer');
    if(timer) timer.textContent=!sensorStale && sensor.process_phase==='MEMINDAHKAN'
      ?`Valve 2 ditutup dalam ${Number(sensor.transfer_remaining_seconds)||0} detik`:'';

    const heaterStatus2El =
      document.getElementById("heaterStatus2");

    if (heaterStatus2El) {
      heaterStatus2El.textContent = sensorStale ? "Tidak diketahui" : heaterStatus;
    }

    // ========================================================
    // SINKRON STATUS
    // ========================================================

    if (!sensorStale) {
      currentValve1Status = valve1Status;
      currentValve2Status = valve2Status;
      currentHeaterStatus = heaterStatus;
      applyValveVisual(1,valve1Status);
      applyValveVisual(2,valve2Status);
      applyHeaterVisual(heaterStatus);
    } else {
      applyValveVisual(1,'OFF');
      applyValveVisual(2,'OFF');
      applyHeaterVisual('OFF');
      for (const id of ['valve1Text','valve2Text','heaterText']) {
        const el=document.getElementById(id);
        if(el) el.textContent='Tidak diketahui';
      }
    }

    // Avoid graphing stale readings as if they were newly measured.
    if (sensorStale) return;

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

    // Never queue up animations when readings arrive every second.
    volumeChart.update('none');
    temperatureChart.update('none');

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


// Database is only used as initial snapshot or fallback when stream is unavailable.
let snapshotInFlight = false;
async function fetchAndUpdateDashboard() {
  if (snapshotInFlight) return;
  snapshotInFlight = true;
  try {
    const data = await apiFetch('/api/sensor/latest');
    if (!data?.success || !Array.isArray(data.data) || data.data.length === 0) return;
    const sensor = data.data.find(row => row.rtu_id === 'RTU-01') || data.data[0];
    // Do not let an old database snapshot overwrite newer MQTT readings.
    if (streamLastEventAt && Date.now() - streamLastEventAt < 5000) return;
    renderSensorReading(sensor);
  } catch (err) {
    console.error('Gagal membaca snapshot database:', err);
  } finally {
    snapshotInFlight = false;
  }
}

// ============================================================
// LIVE MQTT -> BACKEND -> SSE/FETCH STREAM -> DASHBOARD
// Fallback polling is used only while stream is disconnected.
// ============================================================
let streamConnected = false;
let streamLastEventAt = 0;
let lastLiveSensor = null;
const liveConnectionLabel = document.getElementById('liveConnectionStatus');
function renderLiveConnectionStatus() {
  if (!liveConnectionLabel) return;
  if (!streamConnected) {
    liveConnectionLabel.textContent = 'Koneksi data live terputus — mencoba menghubungkan ulang';
    return;
  }
  if (!streamLastEventAt) {
    liveConnectionLabel.textContent = 'Stream terhubung — menunggu data dari RTU';
    return;
  }
  const age = Math.floor((Date.now() - streamLastEventAt) / 1000);
  liveConnectionLabel.textContent = age <= 3 ? `Data live aktif · diterima ${age} detik lalu` :
    `Stream terhubung, belum ada data baru selama ${age} detik`;
}
fetchAndUpdateDashboard();

// Only query Supabase when stream is unavailable. Check freshness once per second.
let lastFallbackPollAt = 0;
setInterval(() => {
  if (!streamConnected && Date.now() - lastFallbackPollAt >= 2000) {
    lastFallbackPollAt = Date.now();
    fetchAndUpdateDashboard();
  }
  if (lastLiveSensor && Date.now() - streamLastEventAt > 20000) {
    renderSensorReading({ ...lastLiveSensor, is_stale: true });
    lastLiveSensor = null;
  }
  renderLiveConnectionStatus();
}, 1000);

async function connectLiveSensorStream() {
  let retryMs = 2000;
  while (sessionStorage.getItem('scada_token') === token) {
    try {
      const response = await fetch(`${API_URL}/api/sensor/stream`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'text/event-stream' },
        cache: 'no-store'
      });
      if (response.status === 401 || response.status === 403) {
        sessionStorage.clear();
        window.location.href = 'login.html';
        return;
      }
      if (!response.ok || !response.body) throw new Error(`Live stream HTTP ${response.status}`);
      streamConnected = true;
      renderLiveConnectionStatus();
      retryMs = 2000;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) throw new Error('Live stream closed');
        buffer += decoder.decode(value, { stream: true });
        // Normalize after appending: CRLF may be split across HTTP chunks.
        buffer = buffer.replace(/\r\n/g, '\n');
        if (buffer.length > 65536) throw new Error('Live stream buffer too large');
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const packet = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const eventName = packet.split('\n').find(line => line.startsWith('event: '))?.slice(7);
          const raw = packet.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
          if (!raw) continue;
          let payload;
          try { payload = JSON.parse(raw); } catch { continue; }
          if (eventName === 'telemetry' && payload.rtu_id === 'RTU-01') {
            const browserReceivedAt = new Date().toISOString();
            streamLastEventAt = Date.now();
            queueBrowserReceipt(payload.packet_id,browserReceivedAt);
            lastLiveSensor = payload;
            renderSensorReading(payload);
            renderLiveConnectionStatus();
          } else if (eventName === 'status' && (!payload.rtu_id || payload.rtu_id === 'RTU-01')) {
            // Show confirmed RTU mode instantly, without waiting for Supabase.
            modeStreamEpoch += 1;
            displayModeState({
              is_online: payload.status === 'online',
              mode: payload.mode,
              desired_mode: desiredMode,
              temperature_setpoint: payload.temperature_setpoint,
              volume_setpoint: payload.volume_setpoint
            });
            refreshRTUState();
          }
        }
      }
    } catch (err) {
      console.warn('Live stream terputus, mencoba reconnect:', err.message);
    } finally {
      streamConnected = false;
      renderLiveConnectionStatus();
    }
    await new Promise(resolve => setTimeout(resolve, retryMs));
    retryMs = Math.min(retryMs * 2, 15000);
  }
}
connectLiveSensorStream();

// ============================================================
// V1.7.2 — time-window analysis, separate RTU/MTU timestamps and PDR/PLR.
const commWibInput=ms=>new Date(ms+7*3600000).toISOString().slice(0,16);
const commFromInput=document.getElementById('commFrom');
const commToInput=document.getElementById('commTo');
function setDefaultCommWindow(force=false){
  if(!commFromInput||!commToInput)return;
  if(!force&&(commFromInput.dataset.userEdited==='true'||commToInput.dataset.userEdited==='true'))return;
  // Gunakan batas akhir minimal 1 menit sebelum waktu sekarang agar selalu melewati batas tunggu 15 detik backend.
  const endMs=Math.floor((Date.now()-60000)/60000)*60000;
  commFromInput.value=commWibInput(endMs-5*60000);
  commToInput.value=commWibInput(endMs);
}
for(const el of [commFromInput,commToInput]){
  el?.addEventListener('change',()=>{el.dataset.userEdited='true';});
}
setDefaultCommWindow(true);
const escComm=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const commClock=x=>x?new Date(x).toLocaleString('id-ID',{timeZone:'Asia/Pontianak',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3}):'—';
const commShortClock=x=>x?new Date(x).toLocaleTimeString('id-ID',{timeZone:'Asia/Pontianak',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const commNumber=x=>x==null||!Number.isFinite(Number(x))?'—':Number(x).toFixed(2);
const commConfig=()=>({from:commFromInput?.value,to:commToInput?.value,
  direction:document.getElementById('commDirection')?.value||'all'});
function commEndpoint(suffix){return `/api/communication/RTU-01/${suffix}?${new URLSearchParams(commConfig())}`;}
function commValidateWindow(){
  const f=commFromInput?.value,t=commToInput?.value;
  if(!f||!t)throw new Error('Isi waktu mulai dan selesai');
  const start=new Date(f+':00+07:00').getTime(),end=new Date(t+':00+07:00').getTime();
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error('Waktu selesai harus setelah waktu mulai');
  if(end-start>31*86400000)throw new Error('Maksimal rentang 31 hari');
}
function commRateCard(label,m){
  if(m?.valid===true){
    const status=`<strong>PDR ${commNumber(m.pdr)}% · PLR ${commNumber(m.plr)}%</strong>`;
    const desc=`${m.sent} terkirim · ${m.received} diterima/terkonfirmasi · ${m.lost} hilang/belum terkonfirmasi`;
    return `<div class="communication-rate-item"><b>${escComm(label)}</b>${status}<small>${escComm(desc)}</small></div>`;
  }
  if(m?.partial?.valid===true){
    const p=m.partial;
    const status=`<strong>PDR ${commNumber(p.pdr)}% · PLR ${commNumber(p.plr)}% (parsial)</strong>`;
    const range=`${commShortClock(p.covered_from)}–${commShortClock(p.covered_to)} WIB`;
    const desc=`${p.sent} terkirim · ${p.received} diterima · ${p.lost} hilang · ${p.complete_buckets}/${p.expected_buckets} bucket 10 dtk lengkap (${range})`;
    return `<div class="communication-rate-item"><b>${escComm(label)}</b>${status}<small>${escComm(desc)}</small></div>`;
  }
  const status='<strong>Belum dapat dihitung</strong>';
  const desc=m?.reason||'Data belum tersedia pada rentang ini';
  return `<div class="communication-rate-item"><b>${escComm(label)}</b>${status}<small>${escComm(desc)}</small></div>`;
}
async function loadCommunicationHistory(){
  const tbody=document.getElementById('communicationHistory');if(!tbody)return;
  const note=document.getElementById('commInfo');
  const rates=document.getElementById('commRates');
  try{
    commValidateWindow();
    if(note)note.textContent='Mengambil riwayat komunikasi dan statistik pengiriman…';
    const [result,metricResult]=await Promise.all([
      apiFetch(commEndpoint('history')),apiFetch(commEndpoint('metrics'))]);
    if(!result?.success)throw new Error(result?.message||'Riwayat komunikasi gagal dimuat');
    if(!metricResult?.success)throw new Error(metricResult?.message||'Statistik komunikasi gagal dimuat');
    tbody.innerHTML=(result.data||[]).map(r=>{
      const isSensor=r.event_type==='sensor';
      const rtuTime=isSensor?r.rtu_sent_at:r.rtu_command_received_at;
      const mtuTime=isSensor?r.backend_received_at:r.backend_command_sent_at;
      const browserTime=isSensor?r.browser_received_at:r.mtu_sent_at;
      const delay=isSensor?r.delay_rtu_backend_est_ms:r.delay_backend_rtu_est_ms;
      return `<tr><td>${isSensor?'RTU → MTU':'MTU → RTU'}</td>`+
        `<td>${escComm(commClock(rtuTime))}</td><td>${escComm(commClock(mtuTime))}</td>`+
        `<td>${escComm(commClock(browserTime))}</td>`+
        `<td>${escComm(isSensor?'Sensor':r.command_device||'Perintah')}</td>`+
        `<td title="${escComm(r.packet_id)}">${escComm(String(r.packet_id).slice(0,16))}…</td>`+
        `<td>${escComm(commNumber(delay))}</td><td>${escComm(commNumber(r.backend_rtt_ms))}</td>`+
        `<td>${escComm(r.outcome||r.clock_quality||'unverified')}</td></tr>`;
    }).join('')||'<tr><td colspan="9">Belum ada data komunikasi dalam rentang yang dipilih.</td></tr>';
    if(rates){const m=metricResult.metrics||{};
      rates.innerHTML=commRateCard('RTU → MTU (sensor)',m.uplink)+commRateCard('MTU → RTU (perintah)',m.downlink);}
    if(note)note.textContent=`${result.total??0} paket/perintah dicatat; ${result.data?.length||0} baris terakhir ditampilkan. Waktu dalam WIB. Excel memuat data hingga 20.000 baris.`;
  }catch(err){
    if(note)note.textContent='Gagal memuat komunikasi: '+err.message;
    if(rates)rates.textContent='PDR/PLR belum tersedia.';
  }
}
async function exportCommunicationExcel(){
  const btn=document.getElementById('exportCommBtn'),note=document.getElementById('commInfo');
  if(btn)btn.disabled=true;
  try{
    commValidateWindow();
    if(note)note.textContent='Membuat file Excel beserta PDR/PLR dari rentang waktu yang dipilih…';
    const res=await fetch(API_URL+commEndpoint('export.xlsx'),{
      headers:{'Authorization':`Bearer ${token}`},cache:'no-store'
    });
    if(!res.ok){let message='HTTP '+res.status;try{message=(await res.json()).message||message;}catch{}throw new Error(message);}
    const blob=await res.blob();
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    const filter=commConfig();
    a.href=url;a.download=`SCADA_RTU-01_${filter.from.replace(/:/g,'-')}_${filter.to.replace(/:/g,'-')}.xlsx`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    if(note)note.textContent='File Excel berhasil dibuat dan proses download dimulai.';
  }catch(err){if(note)note.textContent='Export gagal: '+err.message;showToast('Export Excel gagal: '+err.message,'error');}
  finally{if(btn)btn.disabled=false;}
}
const browserReceipts=[];
function queueBrowserReceipt(packetId,when) {
  if(typeof packetId!=='string'||!packetId) return;
  if(browserReceipts.length>=40)browserReceipts.shift();
  browserReceipts.push({packet_id:packetId,browser_received_at:when});
}
let receiptsSending=false;
async function flushBrowserReceipts() {
  if(receiptsSending || !browserReceipts.length || !token) return;
  receiptsSending=true;
  const batch=browserReceipts.splice(0,20);
  try{
    const res=await fetch(`${API_URL}/api/communication/RTU-01/receipts`,{
      method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({receipts:batch}),keepalive:true
    });
    if(!res.ok)throw new Error('HTTP '+res.status);
  }catch(err){console.warn('Receipt browser belum tercatat:',err.message);}
  finally{receiptsSending=false;}
}
setInterval(flushBrowserReceipts,2000);

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

// Historical rows are refreshed only while the History page is visible.
let historyRequestInFlight = false;
let historyLastRequestAt = 0;
async function loadHistoryData(options = {}) {

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

  if (historyRequestInFlight) return;
  historyRequestInFlight = true;
  historyLastRequestAt = Date.now();
  if (!options.silent) tbody.innerHTML = `
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

        const valve1 = String(row.valve1_status ?? 'Tidak diketahui').toUpperCase();
        const valve2 = String(row.valve2_status ?? 'Tidak diketahui').toUpperCase();

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
                  valve1 === "ON"
                    ? "#00ff85"
                    : "#ff5555"
                };
              "
            >
              ${valve1}
            </td>
            <td style="font-weight:bold;color:${valve2 === 'ON' ? '#00ff85' : '#ff5555'}">
              ${valve2}
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
  } finally {
    historyRequestInFlight = false;
  }
}
// Auto-refresh history only when the table is open. No unnecessary background queries.
setInterval(() => {
  const page = document.getElementById('historyPage');
  if (page && page.style.display !== 'none' &&
      Date.now() - historyLastRequestAt >= 3000) {
    loadHistoryData({silent:true});
  }
}, 1000);
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