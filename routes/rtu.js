// RTU API — mode selection allowed offline, actuation always requires online RTU.
const express = require('express');
const db = require('../config/database');
const authMiddleware = require('../middleware/auth');
const {authorizedOperator} = require('../middleware/rtu-access');
const {publishCommand} = require('../config/mqtt');
const {readActualState, readDesiredMode, saveDesiredMode, combineState} = require('../services/rtu-mode');
const {validateSetpoints} = require('../services/setpoint-policy');
const router = express.Router();
router.use((req,res,next)=>{req.scadaRequestReceivedAt=new Date().toISOString();next();});
router.use(authMiddleware);
function requestMeta(req){return {clientSentAt:req.get('X-SCADA-Client-Sent-At'),backendRequestReceivedAt:req.scadaRequestReceivedAt,userId:req.user?.id};}

router.get('/', async (req,res) => {
  try {
    const allowed = (process.env.SCADA_ALLOWED_RTUS || 'RTU-01').split(',').map(s=>s.trim());
    const {data:devices,error} = await db.from('rtu_devices').select('*').in('rtu_id',allowed);
    if (error) throw error;
    const result = await Promise.all((devices || []).map(async device => {
      const [actual,saved] = await Promise.all([readActualState(device.rtu_id), readDesiredMode(device.rtu_id)]);
      return {...device, ...combineState(actual,saved), status_updated:actual.last_seen};
    }));
    return res.json({success:true,data:result});
  } catch(err) {
    console.error('RTU list error:',err);
    return res.status(500).json({success:false,message:'Gagal mengambil data RTU'});
  }
});

router.get('/:id/state', authorizedOperator, async (req,res) => {
  try {
    const [actual,saved] = await Promise.all([readActualState(req.params.id),readDesiredMode(req.params.id)]);
    return res.json({success:true,data:combineState(actual,saved)});
  } catch(err) {
    console.error('RTU state error:',err);
    return res.status(500).json({success:false,message:'Gagal membaca status/mode RTU; periksa migrasi rtu_mode_preferences'});
  }
});

async function confirmMode(req,res,mode) {
  try {
    const actual = await readActualState(req.params.id);
    if (!actual.is_online) {
      return res.status(202).json({success:true,acknowledged:false,pending:true,desired_mode:mode,
        message:'Mode pilihan disimpan. RTU offline; belum diterapkan. Saat online tekan Terapkan Mode.'});
    }
    if (actual.mode === mode) {
      return res.json({success:true,acknowledged:true,pending:false,desired_mode:mode,
        message:'RTU sudah berada dalam mode pilihan.'});
    }
    try {
      const result = await publishCommand(`scada/${req.params.id}/command`,{device:'mode',mode},requestMeta(req));
      return res.json({success:true,acknowledged:true,pending:false,desired_mode:mode,
        mode:result.mode || mode,command_id:result.command_id,
        message:'RTU mengonfirmasi perintah. Status aktual diperbarui dari telemetry.'});
    } catch(err) {
      console.warn('Mode disimpan, konfirmasi RTU gagal:',err.message);
      return res.status(202).json({success:true,acknowledged:false,pending:true,desired_mode:mode,
        message:'Pilihan tersimpan, tetapi RTU belum mengonfirmasi: '+err.message});
    }
  } catch(err) {
    console.error('RTU mode error:',err);
    return res.status(500).json({success:false,message:'Gagal memproses mode RTU'});
  }
}

router.post('/:id/mode',authorizedOperator,async(req,res) => {
  const mode = req.body?.mode;
  if (!['Otomatis','Manual'].includes(mode)) {
    return res.status(400).json({success:false,message:'Mode harus Otomatis atau Manual'});
  }
  try { await saveDesiredMode(req.params.id,mode); }
  catch(err) {
    console.error('Save desired mode error:',err);
    return res.status(500).json({success:false,message:'Gagal menyimpan pilihan mode; jalankan migrasi SQL dahulu'});
  }
  return confirmMode(req,res,mode);
});

// No automatic replay on reconnection. Operator explicitly applies saved mode.
router.post('/:id/mode/apply',authorizedOperator,async(req,res) => {
  try {
    const saved = await readDesiredMode(req.params.id);
    if (!saved?.desired_mode) {
      return res.status(409).json({success:false,message:'Belum ada pilihan mode tersimpan'});
    }
    return confirmMode(req,res,saved.desired_mode);
  } catch(err) {
    console.error('Read desired mode error:',err);
    return res.status(500).json({success:false,message:'Gagal membaca pilihan mode'});
  }
});

// Setpoints are only marked applied after the RTU confirms both new targets.
// The RTU, not the web server, owns the automatic-control loop.
router.post('/:id/setpoints', authorizedOperator, async(req,res) => {
  let requested;
  try { requested = validateSetpoints(req.body); }
  catch(err) { return res.status(400).json({success:false,message:err.message}); }
  try {
    const actual = await readActualState(req.params.id);
    if (!actual.is_online) {
      return res.status(409).json({success:false,acknowledged:false,
        message:'RTU offline. Batas belum dikirim. Hidupkan RTU lalu tekan Simpan & Kirim lagi.'});
    }
    const confirmed = await publishCommand(`scada/${req.params.id}/command`,
      {device:'setpoints',...requested},requestMeta(req));
    if (confirmed.device !== 'setpoints' ||
        Number(confirmed.temperature_setpoint) !== requested.temperature_setpoint ||
        Number(confirmed.volume_setpoint) !== requested.volume_setpoint) {
      return res.status(502).json({success:false,acknowledged:false,
        message:'ACK RTU tidak cocok dengan batas yang dikirim.'});
    }
    return res.json({success:true,acknowledged:true,
      command_id:confirmed.command_id, data:requested,
      message:'Batas suhu dan volume sudah diterapkan oleh RTU.'});
  } catch(err) {
    console.error('RTU setpoint command error:', err.message);
    return res.status(err.statusCode || 502).json({success:false,acknowledged:false,
      message:err.statusCode === 504 ? err.message : 'RTU belum mengonfirmasi setpoint: '+err.message});
  }
});

for (const device of ['valve1','valve2','heater']) {
  router.post(`/:id/${device}`, authorizedOperator, async(req,res) => {
    const status = String(req.body?.status ?? '').toUpperCase();
    if (!['ON','OFF'].includes(status)) {
      return res.status(400).json({success:false,message:'Status harus ON atau OFF'});
    }
    try {
      const actual = await readActualState(req.params.id);
      if (!actual.is_online || actual.mode !== 'Manual') {
        return res.status(409).json({success:false,acknowledged:false,
          message:!actual.is_online ? 'RTU offline. Perintah aktuator tidak dikirim.' : 'RTU belum berada dalam mode Manual aktual.'});
      }
      const confirmed = await publishCommand(`scada/${req.params.id}/command`,{device,status},requestMeta(req));
      return res.json({success:true,acknowledged:true,command_id:confirmed.command_id,device,
        status:confirmed.status ?? status,
        message:'RTU mengonfirmasi perintah. Kondisi aktual dibaca melalui telemetry.'});
    } catch(err) {
      console.error('RTU actuator command error:',err.message);
      return res.status(err.statusCode || 502).json({success:false,acknowledged:false,
        message:err.statusCode === 504 ? err.message : 'RTU tidak dapat mengonfirmasi perintah: '+err.message});
    }
  });
}
module.exports = router;
