// ============================================================
// simulate-rtu.js
// Simulator RTU-01 untuk testing SCADA IoT
// ============================================================

require('dotenv').config();

const mqtt = require('mqtt');


// ============================================================
// KONFIGURASI
// ============================================================

const MQTT_HOST =
    process.env.MQTT_HOST || 'mqtt://localhost';

const SENSOR_TOPIC =
    'scada/RTU-01/sensor';

const STATUS_TOPIC =
    'scada/RTU-01/status';


// ============================================================
// CONNECT MQTT
// ============================================================

const client = mqtt.connect(
    MQTT_HOST,
    {
        port: parseInt(process.env.MQTT_PORT) || 1883,
        clientId: `simulator_RTU01_${Date.now()}`,
        reconnectPeriod: 3000
    }
);


// ============================================================
// DATA SIMULASI
// ============================================================

let suhu = 28.0;
let humidity = 70.0;
let tankVolume = 80.0;


// ============================================================
// MQTT CONNECTED
// ============================================================

client.on('connect', () => {

    console.log('');
    console.log('========================================');
    console.log('  🧪 RTU-01 SIMULATOR');
    console.log('========================================');
    console.log('✅ Terhubung ke MQTT:', MQTT_HOST);
    console.log('📡 Sensor topic:', SENSOR_TOPIC);
    console.log('📡 Status topic:', STATUS_TOPIC);
    console.log('========================================');
    console.log('');

    // Kirim status awal
    publishStatus();

    // Kirim data sensor setiap 5 detik
    setInterval(() => {
        publishSensor();
    }, 5000);

});


// ============================================================
// PUBLISH SENSOR
// ============================================================

function publishSensor() {

    // --------------------------------------------------------
    // Simulasi perubahan suhu
    // --------------------------------------------------------

    suhu += (Math.random() - 0.5) * 0.8;

    suhu = Math.max(
        24,
        Math.min(35, suhu)
    );


    // --------------------------------------------------------
    // Simulasi humidity
    // --------------------------------------------------------

    humidity += (Math.random() - 0.5) * 2;

    humidity = Math.max(
        50,
        Math.min(90, humidity)
    );


    // --------------------------------------------------------
    // Simulasi volume tanki
    // --------------------------------------------------------

    tankVolume -= Math.random() * 2;

    if (tankVolume < 20) {
        tankVolume = 90;
    }


    // --------------------------------------------------------
    // Water level berdasarkan volume
    // --------------------------------------------------------

    let waterLevel;

    if (tankVolume >= 60) {
        waterLevel = 'HIGH';

    } else if (tankVolume >= 40) {
        waterLevel = 'MEDIUM';

    } else {
        waterLevel = 'LOW';
    }


    // --------------------------------------------------------
    // Data yang dikirim
    // --------------------------------------------------------

    const payload = {

        suhu: Number(suhu.toFixed(2)),

        humidity: Number(
            humidity.toFixed(2)
        ),

        water_level: waterLevel,

        tank_volume: Number(
            tankVolume.toFixed(2)
        ),

        pump_status:
            tankVolume < 40
                ? 'ON'
                : 'OFF',

        heater_status:
            suhu < 28
                ? 'ON'
                : 'OFF'

    };


    client.publish(
        SENSOR_TOPIC,
        JSON.stringify(payload)
    );


    console.log(
        '📤 SENSOR:',
        payload
    );
}


// ============================================================
// PUBLISH STATUS RTU
// ============================================================

function publishStatus() {

    const payload = {

        status: 'online',

        mode: 'Otomatis'

    };


    client.publish(
        STATUS_TOPIC,
        JSON.stringify(payload)
    );


    console.log(
        '📤 STATUS:',
        payload
    );
}


// ============================================================
// MQTT ERROR
// ============================================================

client.on(
    'error',
    error => {

        console.error(
            '❌ MQTT Simulator Error:',
            error.message
        );

    }
);


// ============================================================
// MQTT DISCONNECT
// ============================================================

client.on(
    'disconnect',
    () => {

        console.log(
            '⚠️ Simulator terputus dari MQTT'
        );

    }
);


// ============================================================
// STOP DENGAN CTRL+C
// ============================================================

process.on(
    'SIGINT',
    () => {

        console.log('');
        console.log(
            '🛑 RTU Simulator dihentikan'
        );

        client.end();

        process.exit(0);

    }
);