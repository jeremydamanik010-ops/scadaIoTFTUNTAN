// ============================================================
// config/mqtt.js — MQTT Client
// EMQX Cloud + Supabase
// ============================================================

require('dotenv').config();

const mqtt = require('mqtt');
const db = require('./database');

let mqttClient = null;


// ============================================================
// MQTT TOPICS
// ============================================================

const TOPICS = [
  'scada/RTU-01/sensor',
  'scada/RTU-01/status'
];


// ============================================================
// CONNECT MQTT — EMQX CLOUD
// ============================================================

function connectMQTT() {

  const host = process.env.MQTT_HOST;
  const port = parseInt(process.env.MQTT_PORT || '8883', 10);

  if (!host) {
    console.error('❌ MQTT_HOST belum diatur');
    return null;
  }

  const mqttUrl = `mqtts://${host}:${port}`;

  mqttClient = mqtt.connect(mqttUrl, {

    username: process.env.scadaiot,
    password: process.env.ftuntan123,

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

    console.log(
      '✅ MQTT terhubung ke EMQX Cloud:',
      `${host}:${port}`
    );

    mqttClient.subscribe(
      TOPICS,
      {
        qos: 0
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

      const raw = message.toString();

      console.log(
        `📨 [${topic}] ${raw}`
      );

      try {

        const payload =
          JSON.parse(raw);

        const parts =
          topic.split('/');

        const rtuId =
          parts[1];

        const type =
          parts[2];


        if (type === 'sensor') {

          await saveSensorData(
            rtuId,
            payload,
            topic
          );

        }


        if (type === 'status') {

          await saveStatusLog(
            rtuId,
            payload
          );

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

    console.error(
      '❌ MQTT error:',
      err.message
    );

  });


  mqttClient.on('reconnect', () => {

    console.log(
      '🔄 MQTT mencoba reconnect ke EMQX...'
    );

  });


  mqttClient.on('offline', () => {

    console.warn(
      '⚠️ MQTT client offline'
    );

  });


  mqttClient.on('close', () => {

    console.warn(
      '⚠️ Koneksi MQTT ditutup'
    );

  });


  return mqttClient;
}


// ============================================================
// SIMPAN SENSOR KE SUPABASE
// ============================================================

async function saveSensorData(
  rtuId,
  payload,
  topic
) {

  const suhu =
    payload.suhu ?? null;

  const humidity =
    payload.humidity ?? null;

  const waterLevel =
    payload.water_level ?? null;


  // ==========================================================
  // PENTING:
  // Gunakan nilai asli yang dikirim RTU / simulator.
  // Jangan generate random lagi di backend.
  // ==========================================================

  const tankVolume =
    payload.tank_volume !== undefined &&
    payload.tank_volume !== null
      ? Number(payload.tank_volume)
      : null;


  const pumpStatus =
    String(
      payload.pump_status ?? 'OFF'
    ).toUpperCase();


  const heaterStatus =
    String(
      payload.heater_status ?? 'OFF'
    ).toUpperCase();


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


  // ==========================================================
  // INSERT SUPABASE
  // ==========================================================

  const {
    data,
    error
  } = await db
    .from('sensor_data')
    .insert({

      rtu_id: rtuId,

      water_temp: suhu,

      humidity: humidity,

      water_level: waterLevel,

      tank_volume: tankVolume,

      pump_status: pumpStatus,

      heater_status: heaterStatus,

      rtu_status: rtuStatus,

      mqtt_topic: topic

    })
    .select()
    .single();


  if (error) {

    console.error(
      '❌ Gagal simpan sensor ke Supabase:',
      error.message
    );

    throw error;

  }


  console.log(
    `💾 Supabase — ` +
    `suhu:${suhu}°C | ` +
    `volume:${tankVolume}% | ` +
    `pompa:${pumpStatus} | ` +
    `heater:${heaterStatus}`
  );


  return data;
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
// PUBLISH COMMAND
// ============================================================

function publishCommand(
  topic,
  message
) {

  if (
    !mqttClient ||
    !mqttClient.connected
  ) {

    console.log(
      '❌ MQTT belum terkoneksi ke broker'
    );

    return false;
  }


  mqttClient.publish(
    topic,
    JSON.stringify(message),
    {
      qos: 0
    },
    err => {

      if (err) {

        console.error(
          '❌ MQTT publish gagal:',
          err.message
        );

        return;
      }


      console.log(
        '📤 MQTT Publish:',
        topic,
        message
      );

    }
  );


  return true;
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
  connectMQTT,
  publishCommand
};