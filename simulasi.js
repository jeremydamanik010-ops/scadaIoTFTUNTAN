// ============================================================
// simulasi.js
// Simulator RTU-01 — EMQX Cloud
// Mode Otomatis + Manual
// ============================================================

require('dotenv').config();

const mqtt = require('mqtt');


// ============================================================
// KONFIGURASI EMQX
// ============================================================

const MQTT_HOST = process.env.MQTT_HOST;
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '8883', 10);

const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;


// ============================================================
// TOPIC
// ============================================================

const SENSOR_TOPIC =
    'scada/RTU-01/sensor';

const STATUS_TOPIC =
    'scada/RTU-01/status';

// Topic kontrol utama
const COMMAND_TOPIC =
    'scada/RTU-01/command';

// Kita subscribe juga ke format terpisah
// supaya kompatibel kalau backend memakai topic ini.
const MODE_TOPIC =
    'scada/RTU-01/mode';

const PUMP_TOPIC =
    'scada/RTU-01/pump';

const HEATER_TOPIC =
    'scada/RTU-01/heater';


// ============================================================
// VALIDASI ENV
// ============================================================

if (
    !MQTT_HOST ||
    !MQTT_USERNAME ||
    !MQTT_PASSWORD
) {

    console.error(
        '❌ MQTT configuration belum lengkap di .env'
    );

    process.exit(1);
}


// ============================================================
// MQTT URL
// ============================================================

const MQTT_URL =
    `mqtts://${MQTT_HOST}:${MQTT_PORT}`;

console.log(
    '🌐 Menghubungkan simulator ke:',
    MQTT_URL
);


// ============================================================
// CONNECT EMQX
// ============================================================

const client = mqtt.connect(
    MQTT_URL,
    {
        username: MQTT_USERNAME,
        password: MQTT_PASSWORD,

        clientId:
            `simulator_RTU01_${Date.now()}`,

        clean: true,

        reconnectPeriod: 5000,

        connectTimeout: 30000,

        rejectUnauthorized: true
    }
);


// ============================================================
// STATE SIMULATOR
// ============================================================

let suhu = 28.0;
let humidity = 70.0;
let tankVolume = 80.0;

let mode = 'Otomatis';

let pumpStatus = 'OFF';
let heaterStatus = 'OFF';

let sensorTimer = null;


// ============================================================
// MQTT CONNECTED
// ============================================================

client.on('connect', () => {

    console.log('');
    console.log('========================================');
    console.log(' 🧪 RTU-01 SIMULATOR — EMQX CLOUD');
    console.log('========================================');
    console.log(
        `✅ Terhubung ke ${MQTT_HOST}:${MQTT_PORT}`
    );
    console.log(
        '📡 Sensor:',
        SENSOR_TOPIC
    );
    console.log(
        '📡 Status:',
        STATUS_TOPIC
    );
    console.log(
        '🎮 Command:',
        COMMAND_TOPIC
    );
    console.log('========================================');
    console.log('');


    // ========================================================
    // SUBSCRIBE CONTROL
    // ========================================================

    client.subscribe(
        [
            COMMAND_TOPIC,
            MODE_TOPIC,
            PUMP_TOPIC,
            HEATER_TOPIC
        ],
        {
            qos: 0
        },
        err => {

            if (err) {

                console.error(
                    '❌ Gagal subscribe command:',
                    err.message
                );

                return;
            }

            console.log(
                '✅ Simulator siap menerima perintah kontrol'
            );
        }
    );


    // ========================================================
    // STATUS AWAL
    // ========================================================

    publishStatus();


    // Hindari membuat interval berkali-kali
    // saat reconnect MQTT
    if (!sensorTimer) {

        publishSensor();

        sensorTimer = setInterval(
            publishSensor,
            5000
        );
    }
});


// ============================================================
// TERIMA PERINTAH DARI RAILWAY
// ============================================================

client.on(
    'message',
    (topic, message) => {

        let payload;

        try {

            payload =
                JSON.parse(
                    message.toString()
                );

        } catch (err) {

            console.error(
                '❌ Command bukan JSON valid:',
                message.toString()
            );

            return;
        }


        console.log(
            `📥 COMMAND [${topic}]`,
            payload
        );


        // ====================================================
        // FORMAT:
        // scada/RTU-01/command
        //
        // { device:"pump", status:"ON" }
        // { device:"heater", status:"OFF" }
        // { device:"mode", mode:"Manual" }
        // ====================================================

        if (topic === COMMAND_TOPIC) {

            const device =
                String(
                    payload.device ?? ''
                ).toLowerCase();


            if (device === 'mode') {

                setMode(
                    payload.mode ??
                    payload.status ??
                    payload.command
                );

            }


            if (device === 'pump') {

                setPump(
                    payload.status ??
                    payload.command
                );

            }


            if (device === 'heater') {

                setHeater(
                    payload.status ??
                    payload.command
                );

            }

        }


        // ====================================================
        // SUPPORT TOPIC TERPISAH
        // ====================================================

        if (topic === MODE_TOPIC) {

            setMode(
                payload.mode ??
                payload.status ??
                payload.command
            );

        }


        if (topic === PUMP_TOPIC) {

            setPump(
                payload.status ??
                payload.command
            );

        }


        if (topic === HEATER_TOPIC) {

            setHeater(
                payload.status ??
                payload.command
            );

        }
    }
);


// ============================================================
// MODE
// ============================================================

function setMode(value) {

    if (!value) return;


    const requested =
        String(value).toLowerCase();


    if (
        requested === 'manual'
    ) {

        mode = 'Manual';

    } else if (
        requested === 'otomatis' ||
        requested === 'automatic' ||
        requested === 'auto'
    ) {

        mode = 'Otomatis';

        // Begitu kembali Otomatis,
        // RTU mengambil alih actuator
        applyAutomaticControl();

    } else {

        console.warn(
            '⚠️ Mode tidak dikenal:',
            value
        );

        return;
    }


    console.log(
        `🔄 MODE → ${mode}`
    );


    publishStatus();

    // Kirim kondisi terbaru supaya dashboard
    // langsung sinkron.
    publishSensor(false);
}


// ============================================================
// PUMP MANUAL
// ============================================================

function setPump(value) {

    const requested =
        String(value ?? '')
            .toUpperCase();


    if (
        requested !== 'ON' &&
        requested !== 'OFF'
    ) {

        console.warn(
            '⚠️ Status pump tidak valid:',
            value
        );

        return;
    }


    if (mode !== 'Manual') {

        console.log(
            '⚠️ Perintah pump diabaikan karena mode Otomatis'
        );

        return;
    }


    pumpStatus = requested;


    console.log(
        `💧 PUMP → ${pumpStatus}`
    );


    // Langsung publish feedback
    publishSensor(false);
}


// ============================================================
// HEATER MANUAL
// ============================================================

function setHeater(value) {

    const requested =
        String(value ?? '')
            .toUpperCase();


    if (
        requested !== 'ON' &&
        requested !== 'OFF'
    ) {

        console.warn(
            '⚠️ Status heater tidak valid:',
            value
        );

        return;
    }


    if (mode !== 'Manual') {

        console.log(
            '⚠️ Perintah heater diabaikan karena mode Otomatis'
        );

        return;
    }


    heaterStatus = requested;


    console.log(
        `🔥 HEATER → ${heaterStatus}`
    );


    publishSensor(false);
}


// ============================================================
// LOGIKA OTOMATIS
// ============================================================

function applyAutomaticControl() {

    if (mode !== 'Otomatis') {
        return;
    }


    // PUMP
    // ON ketika volume rendah
    // OFF ketika tanki sudah cukup penuh

    if (tankVolume < 40) {

        pumpStatus = 'ON';

    } else if (tankVolume >= 80) {

        pumpStatus = 'OFF';
    }


    // HEATER
    // ON jika suhu rendah
    // OFF ketika suhu sudah cukup

    if (suhu < 28) {

        heaterStatus = 'ON';

    } else if (suhu >= 30) {

        heaterStatus = 'OFF';
    }
}


// ============================================================
// SIMULASI PROSES
// ============================================================

function updateSimulation() {

    // --------------------------------------------------------
    // HUMIDITY
    // --------------------------------------------------------

    humidity +=
        (Math.random() - 0.5) * 2;

    humidity =
        Math.max(
            50,
            Math.min(
                90,
                humidity
            )
        );


    // --------------------------------------------------------
    // KONTROL OTOMATIS
    // --------------------------------------------------------

    if (mode === 'Otomatis') {

        applyAutomaticControl();
    }


    // --------------------------------------------------------
    // SIMULASI VOLUME
    //
    // Pump ON  → air bertambah
    // Pump OFF → air perlahan berkurang
    // --------------------------------------------------------

    if (pumpStatus === 'ON') {

        tankVolume +=
            1 + Math.random() * 2;

    } else {

        tankVolume -=
            Math.random() * 1.2;
    }


    tankVolume =
        Math.max(
            0,
            Math.min(
                100,
                tankVolume
            )
        );


    // --------------------------------------------------------
    // SIMULASI SUHU
    //
    // Heater ON → suhu naik
    // Heater OFF → suhu berubah perlahan
    // --------------------------------------------------------

    if (heaterStatus === 'ON') {

        suhu +=
            0.2 + Math.random() * 0.4;

    } else {

        suhu +=
            (Math.random() - 0.55) * 0.3;
    }


    suhu =
        Math.max(
            24,
            Math.min(
                35,
                suhu
            )
        );
}


// ============================================================
// PUBLISH SENSOR
// ============================================================

function publishSensor(
    updateValues = true
) {

    if (!client.connected) {
        return;
    }


    if (updateValues) {

        updateSimulation();
    }


    // ========================================================
    // WATER LEVEL
    // ========================================================

    let waterLevel;


    if (tankVolume >= 60) {

        waterLevel = 'HIGH';

    } else if (
        tankVolume >= 40
    ) {

        waterLevel = 'MEDIUM';

    } else {

        waterLevel = 'LOW';
    }


    // ========================================================
    // PAYLOAD
    // ========================================================

    const payload = {

        suhu:
            Number(
                suhu.toFixed(2)
            ),

        humidity:
            Number(
                humidity.toFixed(2)
            ),

        water_level:
            waterLevel,

        tank_volume:
            Number(
                tankVolume.toFixed(2)
            ),

        pump_status:
            pumpStatus,

        heater_status:
            heaterStatus
    };


    client.publish(
        SENSOR_TOPIC,
        JSON.stringify(payload),
        {
            qos: 0
        }
    );


    console.log(
        `📤 SENSOR [${mode}]`,
        payload
    );
}


// ============================================================
// PUBLISH STATUS
// ============================================================

function publishStatus() {

    if (!client.connected) {
        return;
    }


    const payload = {

        status: 'online',

        mode: mode
    };


    client.publish(
        STATUS_TOPIC,
        JSON.stringify(payload),
        {
            qos: 0
        }
    );


    console.log(
        '📤 STATUS:',
        payload
    );
}


// ============================================================
// MQTT EVENTS
// ============================================================

client.on(
    'reconnect',
    () => {

        console.log(
            '🔄 Simulator mencoba reconnect ke EMQX...'
        );
    }
);


client.on(
    'offline',
    () => {

        console.log(
            '⚠️ Simulator offline'
        );
    }
);


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
// STOP CTRL+C
// ============================================================

process.on(
    'SIGINT',
    () => {

        console.log('');
        console.log(
            '🛑 RTU Simulator dihentikan'
        );


        if (sensorTimer) {

            clearInterval(
                sensorTimer
            );
        }


        if (client.connected) {

            client.publish(
                STATUS_TOPIC,
                JSON.stringify({
                    status: 'offline',
                    mode: mode
                }),
                {
                    qos: 0
                },
                () => {

                    client.end();

                    process.exit(0);
                }
            );

        } else {

            client.end();

            process.exit(0);
        }
    }
);