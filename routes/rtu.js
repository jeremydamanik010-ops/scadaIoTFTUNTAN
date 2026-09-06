// ============================================================
// routes/rtu.js — API Perangkat RTU
// GET  /api/rtu          → info RTU-01
// POST /api/rtu/:id/mode → ganti mode Otomatis/Manual
// ============================================================
const express        = require('express');
const db             = require('../config/database');
const authMiddleware = require('../middleware/auth');
const router         = express.Router();
const mqttClient = require('../config/mqtt');

router.use(authMiddleware);

// GET /api/rtu — Info semua RTU
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT
        d.*,
        sl.status,
        sl.mode,
        sl.changed_at AS status_updated
      FROM rtu_devices d
      LEFT JOIN rtu_status_log sl ON sl.id = (
        SELECT MAX(id) FROM rtu_status_log WHERE rtu_id = d.rtu_id
      )
      ORDER BY d.rtu_id
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('RTU list error:', err);
    res.status(500).json({ success: false, message: 'Gagal ambil data RTU' });
  }
});

// POST /api/rtu/:id/mode — Ganti mode Otomatis/Manual
// Dipanggil dari script.js saat toggleMode()
router.post('/:id/mode', async (req, res) => {
  const { id }   = req.params;
  const { mode } = req.body;

  if (!['Otomatis', 'Manual'].includes(mode)) {
    return res.status(400).json({ success: false, message: 'Mode harus "Otomatis" atau "Manual"' });
  }

  try {
    // Ambil status terakhir
    const [last] = await db.execute(
      'SELECT status FROM rtu_status_log WHERE rtu_id = ? ORDER BY id DESC LIMIT 1',
      [id]
    );
    const currentStatus = last[0]?.status ?? 'online';

    await db.execute(
      'INSERT INTO rtu_status_log (rtu_id, status, mode) VALUES (?, ?, ?)',
      [id, currentStatus, mode]
    );

    res.json({ success: true, message: `Mode RTU ${id} diubah ke ${mode}` });
  } catch (err) {
    console.error('Mode change error:', err);
    res.status(500).json({ success: false, message: 'Gagal ubah mode RTU' });
  }
});
// ============================================================
// POST /api/rtu/:id/pump
// Kontrol pompa manual
// ============================================================
router.post('/:id/pump', async (req, res) => {

  const { id } = req.params;
  const { status } = req.body;

  if (!['ON', 'OFF'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Status pompa harus ON atau OFF'
    });
  }

  try {

    console.log(`Perintah pompa ${id}: ${status}`);

    // Nanti di sini kirim MQTT ke ESP32
    // mqttClient.publish(
    //   `scada/${id}/command`,
    //   JSON.stringify({
    //      device:"pump",
    //      status:status
    //   })
    // );


    res.json({
      success:true,
      message:`Pompa ${id} ${status}`,
      status:status
    });


  } catch(err){

    console.error("Pump control error:",err);

    res.status(500).json({
      success:false,
      message:"Gagal kontrol pompa"
    });

  }

});


// ============================================================
// POST /api/rtu/:id/heater
// Kontrol heater manual
// ============================================================
router.post('/:id/heater', async (req,res)=>{

  const { id } = req.params;
  const { status } = req.body;


  if (!['ON','OFF'].includes(status)){
    return res.status(400).json({
      success:false,
      message:'Status heater harus ON atau OFF'
    });
  }


  try{

    console.log(`Perintah heater ${id}: ${status}`);


    // Nanti kirim MQTT ke ESP32
    // mqttClient.publish(
    //   `scada/${id}/command`,
    //   JSON.stringify({
    //      device:"heater",
    //      status:status
    //   })
    // );


    res.json({
      success:true,
      message:`Heater ${id} ${status}`,
      status:status
    });


  }catch(err){

    console.error("Heater control error:",err);

    res.status(500).json({
      success:false,
      message:"Gagal kontrol heater"
    });

  }

});

module.exports = router;
