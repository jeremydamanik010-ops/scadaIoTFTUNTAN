// Supabase audit log; failures MUST NEVER delay MQTT sensor display or actuator ACK.
const db = require('../config/database');
const {packetIdOrNew,isoOrNull,diffMs,clockQuality} = require('./communication-metrics');
let lastStorageWarning = 0;
function background(promise) {
  Promise.resolve(promise).catch(err => {
    if (Date.now()-lastStorageWarning>30000) {
      console.warn('⚠️ Pencatatan komunikasi gagal; cek migrasi 003:', err.message);
      lastStorageWarning=Date.now();
    }
  });
}
function recordSensor(rtuId, payload, normalized, receivedAt, validationStatus='VALID') {
  const packetId = packetIdOrNew(payload.packet_id);
  const rtuSent = isoOrNull(payload.rtu_sent_at);
  const quality = clockQuality(payload.time_sync_status);
  const record={packet_id:packetId,rtu_id:rtuId,session_id:typeof payload.session_id==='string' && /^[a-f0-9-]{36}$/i.test(payload.session_id)?payload.session_id:null,packet_seq:Number.isSafeInteger(payload.packet_seq)&&payload.packet_seq>=0?payload.packet_seq:null,direction:'RTU_TO_MTU',event_type:'sensor',
    rtu_sent_at:rtuSent,backend_received_at:receivedAt,clock_quality:quality,
    delay_rtu_backend_est_ms:diffMs(receivedAt,rtuSent),
    validation_status: validationStatus==='INVALID'?'INVALID':'VALID',
    sensor_payload:normalized?{suhu:normalized.water_temp,tank_volume:normalized.tank_volume,
      destination_volume:normalized.destination_volume,valve1_status:normalized.valve1_status,
      valve2_status:normalized.valve2_status,heater_status:normalized.heater_status,
      process_phase:normalized.process_phase}:null};
  background(db.from('communication_logs').insert(record).then(({error})=>{if(error && error.code !== '23505')throw error;}));
  return {packet_id:packetId,rtu_sent_at:rtuSent,backend_received_at:receivedAt,clock_quality:quality};
}
function recordCommand(data) {
  const quality = clockQuality(data.ack?.time_sync_status);
  const rtuReceived=isoOrNull(data.ack?.rtu_received_at);
  const ackSent=isoOrNull(data.ack?.rtu_ack_sent_at);
  const record={packet_id:data.commandId,rtu_id:data.rtuId,direction:'MTU_TO_RTU',event_type:'command',
    command_device:String(data.device || '').slice(0,40),command_payload:data.commandPayload || {},
    user_id:data.userId || null,mtu_sent_at:isoOrNull(data.clientSentAt),
    backend_request_received_at:isoOrNull(data.backendRequestReceivedAt),
    backend_command_sent_at:data.backendSentAt,rtu_command_received_at:rtuReceived,
    rtu_ack_sent_at:ackSent,backend_ack_received_at:data.backendAckAt,
    backend_rtt_ms:data.rttMs,delay_mtu_rtu_est_ms:diffMs(rtuReceived,data.clientSentAt),
    delay_backend_rtu_est_ms:diffMs(rtuReceived,data.backendSentAt),
    clock_quality:quality,outcome:data.outcome,
    error_message:data.errorMessage ? String(data.errorMessage).slice(0,300) : null};
  background(db.from('communication_logs').insert(record).then(({error})=>{if(error && error.code !== '23505')throw error;}));
}
async function recordBrowserReceipts(rtuId, rows, userId) {
  const unique=new Set(); let count=0;
  for(const row of rows) {
    const id=row?.packet_id;
    const received=isoOrNull(row?.browser_received_at);
    if(typeof id!=='string' || !/^[a-f\d-]{20,80}$/i.test(id) || !received || unique.has(id)) continue;
    unique.add(id);
    // First browser receipt wins. No browser can overwrite another's prior timestamp.
    const {data:existing,error:e1}=await db.from('communication_logs')
      .select('packet_id,rtu_sent_at').eq('packet_id',id).eq('rtu_id',rtuId)
      .eq('event_type','sensor').is('browser_received_at',null).maybeSingle();
    if(e1) throw e1;
    if(!existing)continue;
    const update={browser_received_at:received,browser_reported_at:new Date().toISOString(),
      browser_user_id:userId,
      delay_rtu_browser_est_ms:diffMs(received,existing.rtu_sent_at)};
    const {error:e2}=await db.from('communication_logs').update(update).eq('packet_id',id)
      .eq('rtu_id',rtuId).is('browser_received_at',null);
    if(e2)throw e2;
    count++;
  }
  return count;
}
function recordDeliveryReport(rtuId, payload) {
  if (!payload || payload.event !== 'delivery_report' ||
      typeof payload.session_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(payload.session_id) ||
      typeof payload.window_start !== 'string' || typeof payload.window_end !== 'string' ||
      !Number.isSafeInteger(payload.sensor_sent_count) || payload.sensor_sent_count < 0 || payload.sensor_sent_count > 100000 ||
      !Array.isArray(payload.command_received_ids) || payload.command_received_ids.length > 200 ||
      payload.command_received_ids.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) ||
      typeof payload.bucket_complete !== 'boolean' ||
      !payload.command_received_times || typeof payload.command_received_times !== 'object' || Array.isArray(payload.command_received_times) ||
      Object.entries(payload.command_received_times).some(([id,time])=>!payload.command_received_ids.includes(id)||!isoOrNull(time)))
    throw new Error('Laporan paket RTU tidak valid');
  const a=isoOrNull(payload.window_start), b=isoOrNull(payload.window_end);
  if(!a||!b||Date.parse(b)-Date.parse(a)!==10000||Date.parse(a)%10000!==0)throw new Error('Interval laporan RTU harus 10 detik UTC');
  const row={rtu_id:rtuId,session_id:payload.session_id,window_start:a,window_end:b,
    sensor_sent_count:payload.sensor_sent_count,bucket_complete:payload.bucket_complete,
    command_received_ids:[...new Set(payload.command_received_ids)],
    command_received_times:payload.command_received_times,clock_quality:clockQuality(payload.time_sync_status)};
  background(db.from('communication_sender_windows').upsert(row,{onConflict:'rtu_id,session_id,window_start'})
    .then(({error})=>{if(error)throw error;}));
}
module.exports={recordSensor,recordCommand,recordBrowserReceipts,recordDeliveryReport};
