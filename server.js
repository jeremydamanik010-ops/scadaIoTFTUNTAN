// ============================================================
// server.js — Entry point SCADA IoT Backend
// ============================================================

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const sensorRoutes = require('./routes/sensor');
const rtuRoutes = require('./routes/rtu');

const { connectMQTT } = require('./config/mqtt');

// ============================================================
// APP & PORT
// ============================================================

const app = express();
const PORT = process.env.PORT || 3000;


// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors({
    origin: '*'
}));

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));


// ============================================================
// REQUEST LOGGER
// ============================================================

app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});


// ============================================================
// FRONTEND STATIC FILES
// ============================================================

app.use(
    express.static(
        path.join(__dirname, 'public')
    )
);


// Halaman utama
app.get('/', (req, res) => {
    res.sendFile(
        path.join(
            __dirname,
            'public',
            'login.html'
        )
    );
});


// ============================================================
// API ROUTES
// ============================================================

app.use('/api/auth', authRoutes);

app.use('/api/sensor', sensorRoutes);

app.use('/api/rtu', rtuRoutes);


// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/api/health', (req, res) => {

    res.json({
        success: true,
        message: 'SCADA IoT Backend berjalan normal',
        waktu: new Date().toLocaleString('id-ID')
    });

});


// ============================================================
// 404 HANDLER
// ============================================================

app.use((req, res) => {

    res.status(404).json({
        success: false,
        message: `Route ${req.path} tidak ditemukan`
    });

});


// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, '0.0.0.0', () => {

    console.log('');
    console.log('========================================');
    console.log('  🚀 SCADA IoT Backend');
    console.log(`  Port   : ${PORT}`);
    console.log(`  Local  : http://localhost:${PORT}`);
    console.log(`  Health : http://localhost:${PORT}/api/health`);
    console.log('========================================');
    console.log('');

});


// ============================================================
// MQTT CONNECTION
// ============================================================

connectMQTT();