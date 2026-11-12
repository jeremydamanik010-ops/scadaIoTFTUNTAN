// ============================================================
// routes/sensor.js — API Data Sensor
// SUPABASE VERSION
//
// GET /api/sensor/latest
// GET /api/sensor/history
// GET /api/sensor/summary
// ============================================================

const express = require('express');
const supabase = require('../config/database');
const authMiddleware = require('../middleware/auth');
const liveTelemetry = require('../services/live-telemetry');

const router = express.Router();

// Semua route sensor membutuhkan login
router.use(authMiddleware);

// Push events directly from MQTT reception to authenticated browser clients.
// fetch() streaming is used rather than EventSource so Bearer token stays in a header.
router.get('/stream', (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();
    res.write('retry: 2000\n: connected\n\n');

    let closed = false;
    function send(event) {
        if (closed || res.destroyed) return;
        // Slow clients must not cause indefinite server memory accumulation.
        if (res.writableLength > 200000) { res.end(); return; }
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }
    const unsubscribe = liveTelemetry.subscribe(event => {
        if (event.rtu_id === 'RTU-01') send(event);
    });
    const keepAlive = setInterval(() => {
        if (!closed && !res.destroyed) res.write(': heartbeat\n\n');
    }, 15000);
    function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
    }
    // Node's IncomingMessage 'close' may fire after request completion,
    // long before the SSE response ends. Listen on the response instead.
    res.on('close', cleanup);
});



// ============================================================
// GET /api/sensor/latest
// ============================================================

router.get('/latest', async (req, res) => {

    try {

        const {
            data,
            error
        } = await supabase
            .from('sensor_data')
            .select(`
                id,
                rtu_id,
                water_temp,
                humidity,
                water_level,
                tank_volume,
                valve1_status,
                valve2_status,
                heater_status,
                destination_volume,
                process_phase,
                transfer_remaining_seconds,
                rtu_status,
                mqtt_topic,
                received_at
            `)
            .eq('rtu_id', 'RTU-01')
            .order('received_at', {
                ascending: false
            })
            .limit(1);

        if (error) {

            console.error(
                '❌ Supabase latest error:',
                error
            );

            return res.status(500).json({
                success: false,
                message: error.message
            });
        }

        console.log(
            '📡 DATA LATEST SUPABASE:',
            data
        );

        return res.json({
            success: true,
            data: (data || []).map(row => ({
                ...row,
                is_stale: !Number.isFinite(Date.parse(row.received_at)) ||
                    Date.now() - Date.parse(row.received_at) > 20000
            }))
        });

    } catch (err) {

        console.error(
            '❌ Latest sensor error:',
            err
        );

        return res.status(500).json({
            success: false,
            message: 'Gagal ambil data terbaru'
        });
    }
});


// ============================================================
// GET /api/sensor/history
//
// /api/sensor/history?rtu_id=RTU-01&limit=20&hours=24
// ============================================================

router.get('/history', async (req, res) => {

    const rtu_id = 'RTU-01'; // scope penelitian saat ini

    const limit = Math.max(1, Math.min(500, Number.parseInt(req.query.limit, 10) || 20));
    const hours = Math.max(1, Math.min(168, Number.parseInt(req.query.hours, 10) || 24));

    try {

        const since =
            new Date(
                Date.now() -
                hours * 60 * 60 * 1000
            ).toISOString();

        const {
            data,
            error
        } = await supabase
            .from('sensor_data')
            .select(`
                id,
                rtu_id,
                water_temp,
                humidity,
                water_level,
                tank_volume,
                valve1_status,
                valve2_status,
                heater_status,
                destination_volume,
                process_phase,
                transfer_remaining_seconds,
                rtu_status,
                mqtt_topic,
                received_at
            `)
            .eq('rtu_id', rtu_id)
            .gte('received_at', since)
            .order('received_at', {
                ascending: false
            })
            .limit(limit);

        if (error) {

            console.error(
                '❌ Supabase history error:',
                error
            );

            return res.status(500).json({
                success: false,
                message: error.message
            });
        }

        console.log(
            `📚 HISTORY ${rtu_id}:`,
            data?.length || 0,
            'data'
        );

        return res.json({
            success: true,
            total: data?.length || 0,
            data: data || []
        });

    } catch (err) {

        console.error(
            '❌ History error:',
            err
        );

        return res.status(500).json({
            success: false,
            message: 'Gagal ambil riwayat data'
        });
    }
});


// ============================================================
// GET /api/sensor/summary
// ============================================================

router.get('/summary', async (req, res) => {

    try {

        const startOfDay =
            new Date();

        startOfDay.setHours(
            0,
            0,
            0,
            0
        );

        const {
            data,
            error
        } = await supabase
            .from('sensor_data')
            .select(`
                water_temp,
                tank_volume,
                valve1_status,
                valve2_status,
                heater_status,
                destination_volume,
                process_phase,
                transfer_remaining_seconds,
                received_at
            `)
            .eq('rtu_id', 'RTU-01')
            .gte(
                'received_at',
                startOfDay.toISOString()
            );

        if (error) {
            throw error;
        }

        const rows =
            data || [];

        if (rows.length === 0) {

            return res.json({
                success: true,
                data: []
            });
        }

        const suhu =
            rows
                .map(r =>
                    Number(r.water_temp)
                )
                .filter(Number.isFinite);

        const volume =
            rows
                .map(r =>
                    Number(r.tank_volume)
                )
                .filter(Number.isFinite);

        const valve1On = rows.filter(r => r.valve1_status === 'ON').length;
        const valve2On = rows.filter(r => r.valve2_status === 'ON').length;

        const heaterOn =
            rows.filter(
                r =>
                    r.heater_status === 'ON'
            ).length;

        const summary = {

            rtu_id: 'RTU-01',

            avg_suhu:
                suhu.length
                    ? Number(
                        (
                            suhu.reduce(
                                (a, b) =>
                                    a + b,
                                0
                            ) /
                            suhu.length
                        ).toFixed(2)
                    )
                    : 0,

            min_suhu:
                suhu.length
                    ? Math.min(...suhu)
                    : 0,

            max_suhu:
                suhu.length
                    ? Math.max(...suhu)
                    : 0,

            avg_volume:
                volume.length
                    ? Number(
                        (
                            volume.reduce(
                                (a, b) =>
                                    a + b,
                                0
                            ) /
                            volume.length
                        ).toFixed(2)
                    )
                    : 0,

            min_volume:
                volume.length
                    ? Math.min(...volume)
                    : 0,

            max_volume:
                volume.length
                    ? Math.max(...volume)
                    : 0,

            valve1_on_count:
                valve1On,
            valve2_on_count:
                valve2On,

            heater_on_count:
                heaterOn,

            total_data:
                rows.length,

            terakhir_update:
                rows[0]?.received_at || null
        };

        return res.json({
            success: true,
            data: [summary]
        });

    } catch (err) {

        console.error(
            '❌ Summary error:',
            err
        );

        return res.status(500).json({
            success: false,
            message: 'Gagal ambil ringkasan'
        });
    }
});


module.exports = router;