// ============================================================
// config/mqtt.js — MQTT Client
// Subscribe ke broker, terima data ESP8266,
// simpan data ke Supabase
// ============================================================

require('dotenv').config();

const mqtt = require('mqtt');
const db   = require('./database');

let mqttClient = null;


// ============================================================
// TOPIC MQTT
// ============================================================

const TOPICS = [
  'scada/RTU-01/sensor',
  'scada/RTU-01/status',
];


// ============================================================
// CONNECT MQTT
// ============================================================

function connectMQTT() {

  mqttClient = mqtt.connect(
    process.env.MQTT_HOST || 'mqtt://localhost',
    {
      port: parseInt(process.env.MQTT_PORT) || 1883,
      clientId: `scada_backend_${Date.now()}`,
      reconnectPeriod: 3000,
    }
  );


  // ----------------------------------------------------------
  // MQTT CONNECTED
  // ----------------------------------------------------------

  mqttClient.on('connect', () => {

    console.log(
      '✅ MQTT terhubung ke broker:',
      process.env.MQTT_HOST
    );

    mqttClient.subscribe(TOPICS, err => {

      if (err) {

        console.error(
          '❌ Gagal subscribe:',
          err.message
        );

      } else {

        console.log(
          '📡 Subscribe ke:',
          TOPICS.join(', ')
        );

      }

    });

  });


  // ----------------------------------------------------------
  // TERIMA PESAN MQTT
  // ----------------------------------------------------------

  mqttClient.on('message', async (topic, message) => {

    const raw = message.toString();

    console.log(`📨 [${topic}] ${raw}`);

    try {

      const payload = JSON.parse(raw);

      const parts = topic.split('/');

      const rtuId = parts[1];
      const type  = parts[2];


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
        '❌ Gagal proses pesan:',
        err.message
      );

    }

  });


  // ----------------------------------------------------------
  // MQTT ERROR
  // ----------------------------------------------------------

  mqttClient.on(
    'error',
    err => console.error(
      '❌ MQTT error:',
      err.message
    )
  );


  mqttClient.on(
    'disconnect',
    () => console.warn(
      '⚠️ MQTT terputus, reconnecting...'
    )
  );


  return mqttClient;
}


// ============================================================
// SIMPAN DATA SENSOR KE SUPABASE
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


  // ----------------------------------------------------------
  // HITUNG VOLUME
  // ----------------------------------------------------------
  // Untuk sementara masih mengikuti sistem lama:
  //
  // HIGH = 60–100%
  // LOW  = 0–39%
  //
  // Nanti kalau sensor volume sudah benar-benar digunakan,
  // bagian ini bisa kita ganti dengan nilai sensor asli.
  // ----------------------------------------------------------

  let tankVolume = null;


  if (waterLevel === 'HIGH') {

    tankVolume =
      parseFloat(
        (Math.random() * 40 + 60).toFixed(1)
      );

  }


  if (waterLevel === 'LOW') {

    tankVolume =
      parseFloat(
        (Math.random() * 39).toFixed(1)
      );

  }


  // ----------------------------------------------------------
  // LOGIKA AKTUATOR
  // ----------------------------------------------------------

  const pumpStatus =
    tankVolume !== null &&
    tankVolume < 40
      ? 'ON'
      : 'OFF';


  const heaterStatus =
    suhu !== null &&
    suhu < 28
      ? 'ON'
      : 'OFF';


  // ----------------------------------------------------------
  // STATUS RTU
  // ----------------------------------------------------------

  let rtuStatus = 'Connected';


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


  // ----------------------------------------------------------
  // INSERT KE SUPABASE
  // ----------------------------------------------------------

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
      mqtt_topic: topic,
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
    `💾 Supabase — suhu:${suhu}°C | ` +
    `volume:${tankVolume}% | ` +
    `pompa:${pumpStatus} | ` +
    `heater:${heaterStatus}`
  );


  return data;
}


// ============================================================
// SIMPAN STATUS RTU KE SUPABASE
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
      mode: mode,
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
// Tetap menggunakan MQTT
// ============================================================

function publishCommand(
  topic,
  message
) {

  if (!mqttClient) {

    console.log(
      'MQTT belum terkoneksi'
    );

    return false;

  }


  mqttClient.publish(
    topic,
    JSON.stringify(message)
  );


  console.log(
    '📤 MQTT Publish:',
    topic,
    message
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