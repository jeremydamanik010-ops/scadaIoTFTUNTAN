// ============================================================
// routes/rtu.js
// RTU API — Supabase + MQTT / EMQX
// ============================================================

const express = require('express');
const db = require('../config/database');
const authMiddleware = require('../middleware/auth');

const {
  publishCommand
} = require('../config/mqtt');

const router = express.Router();

router.use(authMiddleware);


// ============================================================
// GET /api/rtu
// Ambil daftar RTU + status terakhir
// ============================================================

router.get('/', async (req, res) => {

  try {

    // Ambil semua perangkat
    const {
      data: devices,
      error: deviceError
    } = await db
      .from('rtu_devices')
      .select('*');


    if (deviceError) {

      throw deviceError;
    }


    // Ambil semua status terbaru
    const {
      data: logs,
      error: logError
    } = await db
      .from('rtu_status_log')
      .select('*')
      .order('changed_at', {
        ascending: false
      });


    if (logError) {

      throw logError;
    }


    // Ambil status terakhir masing-masing RTU
    const latestStatus = {};

    for (const log of logs || []) {

      if (!latestStatus[log.rtu_id]) {

        latestStatus[log.rtu_id] = log;
      }
    }


    const result = (devices || []).map(device => {

      const status =
        latestStatus[device.rtu_id];

      return {

        ...device,

        status:
          status?.status ??
          'offline',

        mode:
          status?.mode ??
          'Otomatis',

        status_updated:
          status?.changed_at ??
          null
      };
    });


    return res.json({
      success: true,
      data: result
    });


  } catch (err) {

    console.error(
      'RTU list error:',
      err
    );

    return res.status(500).json({
      success: false,
      message:
        'Gagal mengambil data RTU'
    });
  }
});


// ============================================================
// POST /api/rtu/:id/mode
// Manual / Otomatis
// ============================================================

router.post(
  '/:id/mode',
  async (req, res) => {

    const { id } =
      req.params;

    const { mode } =
      req.body;


    if (
      ![
        'Otomatis',
        'Manual'
      ].includes(mode)
    ) {

      return res.status(400).json({
        success: false,
        message:
          'Mode harus Otomatis atau Manual'
      });
    }


    try {

      // ======================================================
      // SIMPAN STATUS KE SUPABASE
      // ======================================================

      const {
        data: lastStatus
      } = await db
        .from('rtu_status_log')
        .select('status')
        .eq('rtu_id', id)
        .order(
          'changed_at',
          {
            ascending: false
          }
        )
        .limit(1)
        .maybeSingle();


      const currentStatus =
        lastStatus?.status ??
        'online';


      const {
        error: insertError
      } = await db
        .from('rtu_status_log')
        .insert({

          rtu_id: id,

          status:
            currentStatus,

          mode: mode

        });


      if (insertError) {

        throw insertError;
      }


      // ======================================================
      // KIRIM MQTT KE RTU / SIMULATOR
      // ======================================================

      const sent =
        publishCommand(
          `scada/${id}/command`,
          {
            device: 'mode',
            mode: mode
          }
        );


      if (!sent) {

        return res.status(503).json({
          success: false,
          message:
            'MQTT belum terkoneksi'
        });
      }


      console.log(
        `🔄 MODE ${id} → ${mode}`
      );


      return res.json({

        success: true,

        message:
          `Mode RTU ${id} diubah ke ${mode}`,

        mode: mode
      });


    } catch (err) {

      console.error(
        'Mode change error:',
        err
      );


      return res.status(500).json({

        success: false,

        message:
          'Gagal mengubah mode RTU'
      });
    }
  }
);


// ============================================================
// POST /api/rtu/:id/pump
// ============================================================

router.post(
  '/:id/pump',
  async (req, res) => {

    const { id } =
      req.params;

    const status =
      String(
        req.body.status || ''
      ).toUpperCase();


    if (
      ![
        'ON',
        'OFF'
      ].includes(status)
    ) {

      return res.status(400).json({

        success: false,

        message:
          'Status pompa harus ON atau OFF'
      });
    }


    try {

      // ======================================================
      // PUBLISH MQTT
      // ======================================================

      const sent =
        publishCommand(
          `scada/${id}/command`,
          {

            device: 'pump',

            status: status
          }
        );


      if (!sent) {

        return res.status(503).json({

          success: false,

          message:
            'MQTT belum terkoneksi'
        });
      }


      console.log(
        `💧 PUMP ${id} → ${status}`
      );


      return res.json({

        success: true,

        message:
          `Pompa ${id} ${status}`,

        status: status
      });


    } catch (err) {

      console.error(
        'Pump control error:',
        err
      );


      return res.status(500).json({

        success: false,

        message:
          'Gagal kontrol pompa'
      });
    }
  }
);


// ============================================================
// POST /api/rtu/:id/heater
// ============================================================

router.post(
  '/:id/heater',
  async (req, res) => {

    const { id } =
      req.params;

    const status =
      String(
        req.body.status || ''
      ).toUpperCase();


    if (
      ![
        'ON',
        'OFF'
      ].includes(status)
    ) {

      return res.status(400).json({

        success: false,

        message:
          'Status heater harus ON atau OFF'
      });
    }


    try {

      // ======================================================
      // PUBLISH MQTT
      // ======================================================

      const sent =
        publishCommand(
          `scada/${id}/command`,
          {

            device: 'heater',

            status: status
          }
        );


      if (!sent) {

        return res.status(503).json({

          success: false,

          message:
            'MQTT belum terkoneksi'
        });
      }


      console.log(
        `🔥 HEATER ${id} → ${status}`
      );


      return res.json({

        success: true,

        message:
          `Heater ${id} ${status}`,

        status: status
      });


    } catch (err) {

      console.error(
        'Heater control error:',
        err
      );


      return res.status(500).json({

        success: false,

        message:
          'Gagal kontrol heater'
      });
    }
  }
);


// ============================================================
// EXPORT
// ============================================================

module.exports = router;