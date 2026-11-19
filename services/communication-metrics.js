// Communication timing: wall-clock differences are ESTIMATES across devices.
// Only elapsed time on one monotonic backend clock is a robust RTT measurement.
const { randomUUID } = require('node:crypto');

function isoOrNull(value) {
  if (typeof value !== 'string' || value.length > 45) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function diffMs(end, start) {
  const a = Date.parse(end || ''), b = Date.parse(start || '');
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
}
function packetIdOrNew(value) {
  return typeof value === 'string' && /^[a-f\d-]{20,80}$/i.test(value) ? value : randomUUID();
}
function clockQuality(value) {
  return value === 'ntp_synced' ? 'ntp_synced' : 'unverified';
}
function isAllowedRtu(id) {
  return (process.env.SCADA_ALLOWED_RTUS || 'RTU-01').split(',').map(x => x.trim()).includes(id);
}
function parseDateWindow(from, to) {
  // Compatibility: the V1.6 route used this function even after the
  // V1.7 frontend started sending datetime-local values. Accept both,
  // while keeping date-only requests inclusive of the end date.
  if (typeof from === 'string' && typeof to === 'string' &&
      (from.includes('T') || to.includes('T'))) {
    return parseTimeWindow(from, to);
  }
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(from || '') || !pattern.test(to || '')) throw Object.assign(new Error('Tanggal harus YYYY-MM-DD'), {statusCode:400});
  const a = new Date(`${from}T00:00:00+07:00`);
  const b = new Date(`${to}T00:00:00+07:00`);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) ||
      new Date(a.getTime()+7*3600000).toISOString().slice(0,10) !== from ||
      new Date(b.getTime()+7*3600000).toISOString().slice(0,10) !== to || b < a ||
      (b-a)/86400000 > 30) throw Object.assign(new Error('Pilih rentang tanggal valid maksimal 31 hari'), {statusCode:400});
  return {from:a.toISOString(),to:new Date(b.getTime()+86400000).toISOString()};
}
function stats(rows) {
  const values = rows.filter(x=>x!==null && x!==undefined && x!=='').map(x=>Number(x)).filter(x=>Number.isFinite(x) && x>=0);
  return {count:values.length, min:values.length?Math.min(...values):null,
    avg:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,
    max:values.length?Math.max(...values):null};
}

// A/B may be a date (V1.6 compatibility) or a Pontianak local minute.
// Window semantics are [start, end), so adjacent exports do not overlap.
function parseTimeWindow(from, to) {
  if (typeof from !== 'string' || typeof to !== 'string') throw Object.assign(new Error('Isi waktu mulai dan selesai'),{statusCode:400});
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (dateOnly.test(from) && dateOnly.test(to)) return parseDateWindow(from,to);
  const p = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
  const parse = value => {
    const m=p.exec(value);
    if (!m) throw Object.assign(new Error('Format waktu harus YYYY-MM-DDTHH:mm (WIB / UTC+7)'),{statusCode:400});
    const [,year,month,day,hour,minute]=m.map(Number);
    if(month<1||month>12||day<1||day>31||hour>23||minute>59)throw Object.assign(new Error('Waktu tidak valid'),{statusCode:400});
    const utc=Date.UTC(year,month-1,day,hour-7,minute);
    const check=new Date(utc+7*3600000).toISOString().slice(0,16);
    if(check!==value)throw Object.assign(new Error('Tanggal/waktu tidak valid'),{statusCode:400});
    return utc;
  };
  const a=parse(from),b=parse(to);
  if(b<=a||b-a>31*86400000)throw Object.assign(new Error('Akhir harus setelah awal, maksimal 31 hari'),{statusCode:400});
  return {from:new Date(a).toISOString(),to:new Date(b).toISOString(),tz:'Asia/Pontianak'};
}
// 10-second sender reports are required for all buckets for full-window validity.
// A missing report is NOT counted as a transmitted packet with zero delivery.
// When only a subset of buckets in [from, to) are complete (e.g. RTU started mid-minute
// or stopped before window end), full-window valid stays false while `partial` reports
// exact PDR/PLR strictly over the complete 10-second buckets only.
const BUCKET_MS=10000;
function calculateUplink(rows, reports, window, now=Date.now()) {
  const from=Date.parse(window.from),to=Date.parse(window.to);
  if (from % BUCKET_MS || to % BUCKET_MS) return {valid:false,reason:'Rentang waktu harus sejajar dengan interval 10 detik'};
  if (to>now-15000)return {valid:false,reason:'Menunggu laporan RTU untuk akhir rentang (minimal 15 detik)'};
  const byBucket=new Map();
  for(const r of reports){
    const t=Date.parse(r.window_start);
    if(!Number.isFinite(t)||t<from||t>=to)continue;
    if(!byBucket.has(t))byBucket.set(t,[]);
    byBucket.get(t).push(r);
  }
  const expectedBuckets=(to-from)/BUCKET_MS;
  let allComplete=true;
  let sent=0;
  let partialSent=0;
  const reportKeys=new Set();
  const fullSessions=new Set();
  const completeBuckets=new Map();
  for(let t=from;t<to;t+=BUCKET_MS){
    const reps=byBucket.get(t)||[];
    if(!reps.length || reps.some(r=>r.bucket_complete!==true)){
      allComplete=false;
    }
    const completeReps=reps.filter(r=>r.bucket_complete===true);
    if(!completeReps.length) continue;
    let bucketValid=true;
    let bucketSent=0;
    const bucketSessions=new Set();
    for(const r of completeReps){
      const count=Number(r.sensor_sent_count);
      if(count<0 || !Number.isSafeInteger(count)){
        if(allComplete) return {valid:false,reason:'Laporan jumlah paket RTU tidak valid'};
        bucketValid=false;
        break;
      }
      const key=String(r.session_id)+':'+r.window_start;
      if(reportKeys.has(key)) continue;
      reportKeys.add(key);
      bucketSent+=count;
      bucketSessions.add(r.session_id);
      fullSessions.add(r.session_id);
    }
    if(bucketValid && bucketSessions.size){
      completeBuckets.set(t,bucketSessions);
      partialSent+=bucketSent;
      if(allComplete) sent+=bucketSent;
    }
  }
  if(allComplete){
    const unique=new Set();
    for(const r of rows){
      const ms=Date.parse(r.rtu_sent_at||'');
      if(ms>=from && ms<to && fullSessions.has(r.session_id))unique.add(r.packet_id);
    }
    const received=unique.size;
    if(received>sent)return {valid:false,reason:'Paket diterima lebih banyak dari yang dilaporkan terkirim; audit data diperlukan',sent,received};
    if(!sent)return {valid:false,reason:'RTU melaporkan 0 paket terkirim pada rentang ini',sent,received};
    return {valid:true,sent,received,lost:sent-received,pdr:received/sent*100,plr:(sent-received)/sent*100,
      complete_buckets:expectedBuckets,expected_buckets:expectedBuckets,
      method:'RTU sender reports + paket unik diterima backend MQTT'};
  }
  let partial=null;
  if(completeBuckets.size>0 && partialSent>0){
    const uniquePartial=new Set();
    for(const r of rows){
      const ms=Date.parse(r.rtu_sent_at||'');
      if(!Number.isFinite(ms)||ms<from||ms>=to)continue;
      const bucketStart=Math.floor(ms/BUCKET_MS)*BUCKET_MS;
      const allowedSessions=completeBuckets.get(bucketStart);
      if(allowedSessions && allowedSessions.has(r.session_id)) uniquePartial.add(r.packet_id);
    }
    const partialReceived=uniquePartial.size;
    if(partialReceived<=partialSent){
      const sortedTimes=[...completeBuckets.keys()].sort((a,b)=>a-b);
      partial={
        valid:true,
        sent:partialSent,
        received:partialReceived,
        lost:partialSent-partialReceived,
        pdr:partialReceived/partialSent*100,
        plr:(partialSent-partialReceived)/partialSent*100,
        complete_buckets:completeBuckets.size,
        expected_buckets:expectedBuckets,
        covered_from:new Date(sortedTimes[0]).toISOString(),
        covered_to:new Date(sortedTimes[sortedTimes.length-1]+BUCKET_MS).toISOString(),
        method:'Parsial: hanya dari bucket 10 detik RTU yang lengkap (bucket_complete=true)'
      };
    }
  }
  const reason=completeBuckets.size===0
    ? 'Belum ada laporan 10 detik RTU lengkap (scada/RTU-01/stats) pada rentang ini; pastikan migrasi 004 & RTU V1.7 aktif'
    : `Laporan jumlah paket terkirim RTU tidak lengkap untuk seluruh rentang (${completeBuckets.size}/${expectedBuckets} bucket 10 dtk lengkap)`;
  return {valid:false,reason,complete_buckets:completeBuckets.size,expected_buckets:expectedBuckets,partial};
}
// Acknowledgement/receiver reports show evidence of receipt. If both reports
// and ACK are lost, command delivery cannot be established conclusively.
function calculateDownlink(commands, reports, window, now=Date.now()) {
  const from=Date.parse(window.from),to=Date.parse(window.to);
  if(to>now-15000)return {valid:false,reason:'Menunggu ACK dan laporan penerimaan RTU (minimal 15 detik)'};
  const relevant=commands.filter(c=>{const t=Date.parse(c.backend_command_sent_at||'');return t>=from&&t<to;});
  const unique=new Map(relevant.map(c=>[c.packet_id,c]));
  if(!unique.size)return {valid:false,reason:'Belum ada perintah MQTT dikirim ke RTU pada rentang ini',sent:0,received:0};
  const reportReceived=new Set(reports.flatMap(r=>Array.isArray(r.command_received_ids)?r.command_received_ids:[]));
  let received=0;
  for(const [id,c] of unique){
    const ackConfirmed=c.outcome==='ACK_OK'||c.outcome==='ACK_REJECTED';
    if(c.rtu_command_received_at || ackConfirmed || reportReceived.has(id))received++;
  }
  const sent=unique.size, notConfirmed=sent-received;
  return {valid:true,sent,received,lost:notConfirmed,pdr:received/sent*100,plr:notConfirmed/sent*100,
    method:'PDR konfirmasi penerimaan (ACK/laporan RTU); PLR = belum terkonfirmasi, bukan bukti paket pasti hilang',isEstimate:true};
}

module.exports={isoOrNull,diffMs,packetIdOrNew,clockQuality,isAllowedRtu,parseDateWindow,parseTimeWindow,calculateUplink,calculateDownlink,BUCKET_MS,stats};
