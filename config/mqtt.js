// ============================================================
// config/mqtt.js — MQTT Client
// EMQX Cloud + Supabase
// ============================================================

require('dotenv').config();

const mqtt = require('mqtt');
const { randomUUID } = require('node:crypto');
const db = require('./database');
const liveTelemetry = require('../services/live-telemetry');
const liveState = require('../services/rtu-live-state');
const commLog = require('../services/communication-log');
const lastStoredAt = new Map();
// DB history is intentionally slower than live updates. Default: 2s; may be raised to 5s to save writes.
const STORE_INTERVAL_MS = Math.max(1000, Math.min(60000, Number(process.env.SCADA_HISTORY_INTERVAL_MS) || 2000));
const VERBOSE_MQTT = process.env.SCADA_VERBOSE_MQTT === 'true';

let mqttClient = null;
const pendingAcks = new Map();
const COMMAND_TIMEOUT_MS = 8000;

function failPendingCommands(reason) {
  for (const [id, pending] of pendingAcks) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
    pendingAcks.delete(id);
  }
}


// ============================================================
// MQTT TOPICS
// ============================================================

const TOPICS = [
  'scada/RTU-01/sensor',
  'scada/RTU-01/status',
  'scada/RTU-01/ack',
  'scada/RTU-01/stats'
];


// ============================================================
// CONNECT MQTT — EMQX CLOUD
// ============================================================

function connectMQTT() {

  const rawHost = String(
    process.env.MQTT_HOST || ''
  ).trim();

  // Buang mqtt://, mqtts://, dan port kalau ikut tertulis
  const host = rawHost
    .replace(/^mqtts?:\/\//i, '')
    .replace(/:\d+$/, '')
    .replace(/\/+$/, '');

  const port = parseInt(
    process.env.MQTT_PORT || '8883',
    10
  );

  if (!host) {
    console.error('❌ MQTT_HOST belum diatur');
    return null;
  }

  const mqttUrl = `mqtts://${host}:${port}`;

  console.log('🌐 MQTT Host:', host);
  console.log('🌐 MQTT URL:', mqttUrl);

  console.log('===== MQTT CONFIG CHECK =====');
  console.log('HOST:', host);
  console.log('PORT:', port);
  console.log('URL:', mqttUrl);
  console.log(
  'USERNAME tersedia:',
  !!process.env.MQTT_USERNAME
);
console.log(
  'PASSWORD tersedia:',
  !!process.env.MQTT_PASSWORD
);
console.log('=============================');

  mqttClient = mqtt.connect(mqttUrl, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,

    clientId: `scada_backend_${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    rejectUnauthorized: true
  });


  // ==========================================================
  // CONNECTED
  // ==========================================================

  mqttClient.on('connect', () => {

    liveState.brokerConnected();
    console.log(
      '✅ MQTT terhubung ke EMQX Cloud:',
      `${host}:${port}`
    );

    mqttClient.subscribe(
      TOPICS,
      {
        qos: 1
      },
      err => {

        if (err) {

          console.error(
            '❌ Gagal subscribe MQTT:',
            err.message
          );

          return;
        }

        console.log(
          '📡 Subscribe ke:',
          TOPICS.join(', ')
        );
      }
    );

  });


  // ==========================================================
  // MESSAGE
  // ==========================================================

  mqttClient.on(
    'message',
    async (topic, message) => {

      const mqttReceivedAt = new Date().toISOString(); // receipt, before JSON processing or DB access
      const raw = message.toString();

      if (VERBOSE_MQTT || (topic.endsWith('/status') || topic.endsWith('/ack'))) console.log(`📨 [${topic}] ${raw}`);

      try {

        const payload =
          JSON.parse(raw);

        const parts =
          topic.split('/');

        const rtuId =
          parts[1];

        const type =
          parts[2];


        if (type === 'ack') {
          const pending = pendingAcks.get(payload.command_id);
          if (pending && pending.rtuId === rtuId) {
            clearTimeout(pending.timer);
            pendingAcks.delete(payload.command_id);
            if (payload.applied === true) pending.resolve(payload);
            else { const rejection = new Error(String(payload.reason || 'RTU menolak perintah')); rejection.ackPayload = payload; pending.reject(rejection); }
          }
          return;
        }

        if (type === 'stats') {
          commLog.recordDeliveryReport(rtuId,payload);
          return;
        }

        if (type === 'sensor') {
          // Validate before streaming. Do not wait for a cloud database write
          // before displaying the newest value in the browser.
          let normalized;
          try { normalized = normalizeSensorData(rtuId, payload, topic); }
          catch(err) {
            // A packet can arrive via MQTT but fail validation. Still count its
            // arrival for delivery statistics if it carries session/packet ID.
            commLog.recordSensor(rtuId,payload,null,mqttReceivedAt,'INVALID');
            throw err;
          }
          // The packet ID and send time travel with the live event; never insert these
          // extra fields into the legacy sensor_data schema.
          const meta = commLog.recordSensor(rtuId, payload, normalized, mqttReceivedAt);
          liveTelemetry.publish({ type: 'telemetry', rtu_id: rtuId, data: { ...normalized, ...meta } });
          const now = Date.now();
          if (now - (lastStoredAt.get(rtuId) || 0) >= STORE_INTERVAL_MS) {
            lastStoredAt.set(rtuId, now);
            try {
              await saveSensorData(normalized);
            } catch (err) {
              // Allow a retry on the next message if Supabase is unavailable.
              lastStoredAt.delete(rtuId);
              throw err;
            }
          }
        }


        if (type === 'status') {
          // Update state + push to browser BEFORE cloud persistence.
          // A slow Supabase insert must never delay UI or actuation guards.
          const actual = liveState.acceptStatus(rtuId, payload);
          liveTelemetry.publish({ type: 'status', rtu_id: rtuId, data: { ...actual, rtu_id: rtuId } });
          await saveStatusLog(rtuId, payload);
        }

      } catch (err) {

        console.error(
          '❌ Gagal proses pesan MQTT:',
          err.message
        );

      }

    }
  );


  // ==========================================================
  // ERROR / CONNECTION EVENTS
  // ==========================================================

 mqttClient.on('error', err => {
  console.error('❌ MQTT ERROR FULL:', err);

  console.error('❌ MQTT ERROR DETAIL:', {
    name: err?.name,
    message: err?.message,
    code: err?.code,
    errno: err?.errno,
    syscall: err?.syscall,
    hostname: err?.hostname
  });
});


  mqttClient.on('reconnect', () => {

    console.log(
      '🔄 MQTT mencoba reconnect ke EMQX...'
    );

  });


  mqttClient.on('offline', () => {
    liveState.brokerDisconnected();
    liveTelemetry.publish({type:'status',rtu_id:'RTU-01',data:{rtu_id:'RTU-01',status:'offline',mode:null}});
    failPendingCommands('Koneksi MQTT terputus');

    console.warn(
      '⚠️ MQTT client offline'
    );

  });


  mqttClient.on('close', () => {
    liveState.brokerDisconnected();
    liveTelemetry.publish({type:'status',rtu_id:'RTU-01',data:{rtu_id:'RTU-01',status:'offline',mode:null}});
    failPendingCommands('Koneksi MQTT ditutup');

    console.warn(
      '⚠️ Koneksi MQTT ditutup'
    );

  });


  return mqttClient;
}


// ============================================================
// SIMPAN SENSOR KE SUPABASE
// ============================================================

function normalizeSensorData(rtuId, payload, topic) {

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Payload sensor tidak valid');
  }
  const required = ['suhu','humidity','tank_volume','valve1_status','valve2_status','heater_status'];
  if (required.some(field => payload[field] === undefined || payload[field] === null)) {
    throw new Error('Payload sensor tidak lengkap; tidak disimpan');
  }
  const suhu = Number(payload.suhu);
  const humidity = Number(payload.humidity);
  const waterLevel = payload.water_level ?? null;
  const tankVolume = Number(payload.tank_volume);
  const valve1Status = String(payload.valve1_status).toUpperCase();
  const valve2Status = String(payload.valve2_status).toUpperCase();
  const destinationVolume = Number(payload.destination_volume);
  const remainingSeconds = Number(payload.transfer_remaining_seconds);
  const phase = String(payload.process_phase || 'TIDAK_DIKETAHUI').slice(0,40);
  const heaterStatus = String(payload.heater_status).toUpperCase();
  if (!Number.isFinite(suhu) || suhu < -20 || suhu > 150 ||
      !Number.isFinite(humidity) || humidity < 0 || humidity > 100 ||
      !Number.isFinite(tankVolume) || tankVolume < 0 || tankVolume > 100 ||
      !['ON', 'OFF'].includes(valve1Status) || !['ON', 'OFF'].includes(valve2Status) || !['ON', 'OFF'].includes(heaterStatus) ||
      !Number.isFinite(destinationVolume) || destinationVolume < 0 || destinationVolume > 100 ||
      !Number.isFinite(remainingSeconds) || remainingSeconds < 0 || remainingSeconds > 60) {
    throw new Error('Nilai telemetry di luar rentang/format yang diizinkan');
  }

  // ==========================================================
  // STATUS RTU
  // ==========================================================

  let rtuStatus =
    payload.rtu_status ??
    'Connected';


  if (
    tankVolume !== null &&
    tankVolume < 20
  ) {

    rtuStatus =
      'Alarm: Volume Rendah';

  } else if (
    suhu !== null &&
    suhu > 35
  ) {

    rtuStatus =
      'Alarm: Suhu Tinggi';

  }


  return {
    rtu_id: rtuId,
    water_temp: suhu,
    humidity,
    water_level: waterLevel,
    tank_volume: tankVolume,
    valve1_status: valve1Status,
    valve2_status: valve2Status,
    heater_status: heaterStatus,
    destination_volume: destinationVolume,
    process_phase: phase,
    transfer_remaining_seconds: remainingSeconds,
    rtu_status: rtuStatus,
    mqtt_topic: topic,
    received_at: new Date().toISOString(),
    is_stale: false
  };
}

async function saveSensorData(row) {
  // received_at is database-managed in existing schema; don't pass it on insert.
  const { received_at, is_stale, ...record } = row;
  // Legacy DB column may be NOT NULL. Keep as a storage-only compatibility mirror
  // until the old pump_status column can be removed in a separate migration.
  record.pump_status = record.valve1_status;
  // Avoid a follow-up SELECT: live rendering never needs the inserted row.
  const { error } = await db
    .from('sensor_data')
    .insert(record);
  if (error) {
    console.error('❌ Gagal simpan sensor ke Supabase:', error.message);
    throw error;
  }
  return true;
}


// ============================================================
// SIMPAN STATUS RTU
// ============================================================

async function saveStatusLog(
  rtuId,
  payload
) {

  const status =
    payload.status ?? 'online';

  const mode =
    payload.mode ?? 'Otomatis';


  const {
    data,
    error
  } = await db
    .from('rtu_status_log')
    .insert({

      rtu_id: rtuId,

      status: status,

      mode: mode

    })
    .select()
    .single();


  if (error) {

    console.error(
      '❌ Gagal simpan status RTU ke Supabase:',
      error.message
    );

    throw error;

  }


  console.log(
    `💾 Supabase — Status RTU ${rtuId}: ` +
    `${status}, mode: ${mode}`
  );


  return data;
}


// ============================================================
// PUBLISH COMMAND AND WAIT FOR RTU ACK (not just MQTT broker acceptance)
// ============================================================
async function publishCommand(topic, message, requestMeta = {}) {
  if (!mqttClient || !mqttClient.connected) {
    const err = new Error('MQTT belum terkoneksi ke broker');
    err.statusCode = 503;
    throw err;
  }
  if (!/^scada\/RTU-[A-Za-z0-9-]+\/command$/.test(topic)) {
    const err = new Error('Topic command tidak diperbolehkan');
    err.statusCode = 400;
    throw err;
  }
  const commandId = randomUUID();
  const rtuId = topic.split('/')[1];
  const backendSentAt = new Date().toISOString();
  const startMonotonic = process.hrtime.bigint();
  const payload = { ...message, command_id: commandId, backend_sent_at: backendSentAt,
    mtu_sent_at: requestMeta.clientSentAt || null };
  const attempt = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingAcks.delete(commandId);
      const err = new Error('Tidak ada konfirmasi RTU. Periksa kondisi aktual sebelum mengulang perintah.');
      err.statusCode = 504;
      reject(err);
    }, COMMAND_TIMEOUT_MS);
    pendingAcks.set(commandId, { timer, resolve, reject, rtuId });
    mqttClient.publish(topic, JSON.stringify(payload), { qos: 1, retain: false }, err => {
      if (err && pendingAcks.has(commandId)) {
        clearTimeout(timer);
        pendingAcks.delete(commandId);
        err.statusCode = 503;
        reject(err);
      }
    });
  });
  try {
    const ack = await attempt;
    commLog.recordCommand({ commandId, rtuId, device:message.device,
      commandPayload:message, userId:requestMeta.userId,
      clientSentAt:requestMeta.clientSentAt,
      backendRequestReceivedAt:requestMeta.backendRequestReceivedAt,
      backendSentAt, backendAckAt:new Date().toISOString(),
      rttMs:Number(process.hrtime.bigint()-startMonotonic)/1e6,
      ack, outcome:'ACK_OK' });
    return ack;
  } catch(err) {
    commLog.recordCommand({ commandId, rtuId, device:message.device,
      commandPayload:message, userId:requestMeta.userId,
      clientSentAt:requestMeta.clientSentAt,
      backendRequestReceivedAt:requestMeta.backendRequestReceivedAt,
      backendSentAt, backendAckAt:err.ackPayload ? new Date().toISOString() : null,
      rttMs:err.ackPayload ? Number(process.hrtime.bigint()-startMonotonic)/1e6 : null,
      ack:err.ackPayload, outcome:err.ackPayload?'ACK_REJECTED':'TIMEOUT_OR_ERROR',
      errorMessage:err.message });
    throw err;
  }
}
module.exports = { connectMQTT, publishCommand };
