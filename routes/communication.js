// SCADA V1.7 — authenticated communication history, PDR/PLR by time window, Excel.
const express=require('express');
const db=require('../config/database');
const auth=require('../middleware/auth');
const {authorizedOperator}=require('../middleware/rtu-access');
const {parseTimeWindow,stats,calculateUplink,calculateDownlink}=require('../services/communication-metrics');
const {recordBrowserReceipts}=require('../services/communication-log');
const {makeWorkbook}=require('../services/xlsx-export');
const router=express.Router();
router.use(auth);
router.use('/:id',authorizedOperator);
const filterDirection=raw=>['all','RTU_TO_MTU','MTU_TO_RTU'].includes(raw||'all')?(raw||'all'):null;
const MAX_EXPORT=20000;
const fetchInPages=async(makeQuery,max=MAX_EXPORT)=>{
  const result=[];
  for(let offset=0;offset<=max;offset+=1000){
    const {data,error}=await makeQuery().range(offset,offset+999);
    if(error)throw error;
    result.push(...(data||[]));
    if(result.length>max)throw Object.assign(new Error('Data melebihi batas 20.000 baris. Persempit rentang waktu.'),{statusCode:413});
    if(!data||data.length<1000)break;
  }
  return result;
};
function sensorQuery(id,w){return db.from('communication_logs').select('*').eq('rtu_id',id).eq('event_type','sensor')
  .gte('rtu_sent_at',w.from).lt('rtu_sent_at',w.to).order('rtu_sent_at',{ascending:true}).order('packet_id',{ascending:true});}
function commandQuery(id,w){return db.from('communication_logs').select('*').eq('rtu_id',id).eq('event_type','command')
  .gte('backend_command_sent_at',w.from).lt('backend_command_sent_at',w.to)
  .order('backend_command_sent_at',{ascending:true}).order('packet_id',{ascending:true});}
function reportQuery(id,w,extraMs=0){return db.from('communication_sender_windows').select('*').eq('rtu_id',id)
  .gte('window_start',w.from).lt('window_start',new Date(Date.parse(w.to)+extraMs).toISOString())
  .order('window_start',{ascending:true}).order('session_id',{ascending:true});}
async function getRows(id,w,direction){
  const [s,c]=await Promise.all([
    direction==='MTU_TO_RTU'?Promise.resolve([]):fetchInPages(()=>sensorQuery(id,w)),
    direction==='RTU_TO_MTU'?Promise.resolve([]):fetchInPages(()=>commandQuery(id,w))
  ]);
  if(s.length+c.length>MAX_EXPORT)throw Object.assign(new Error('Lebih dari 20.000 baris. Persempit rentang.'),{statusCode:413});
  if(c.length){
    const reports=await fetchInPages(()=>reportQuery(id,w,30000));
    const receiptTimes=new Map();
    for(const r of reports)for(const [cid,time] of Object.entries(r.command_received_times||{})){
      if(!receiptTimes.has(cid))receiptTimes.set(cid,time);
    }
    // ACK can be lost; independent RTU 10s reports still preserve receive time.
    for(const row of c)if(!row.rtu_command_received_at && receiptTimes.has(row.packet_id))
      row.rtu_command_received_at=receiptTimes.get(row.packet_id);
  }
  return [...s,...c].sort((a,b)=>Date.parse(a.rtu_sent_at||a.backend_command_sent_at)-Date.parse(b.rtu_sent_at||b.backend_command_sent_at));
}
async function getMetrics(id,w,direction,data){
  const reports=await fetchInPages(()=>reportQuery(id,w,30000));
  const sensors=data.filter(x=>x.event_type==='sensor');
  const commands=data.filter(x=>x.event_type==='command');
  return {
    uplink:direction==='MTU_TO_RTU'?null:calculateUplink(sensors,reports,w),
    downlink:direction==='RTU_TO_MTU'?null:calculateDownlink(commands,reports,w),
    report_count:reports.length
  };
}
function parseFilters(req){
  const direction=filterDirection(req.query.direction);
  if(!direction)throw Object.assign(new Error('Filter arah komunikasi tidak valid'),{statusCode:400});
  return {direction,window:parseTimeWindow(req.query.from,req.query.to)};
}
function responseError(res,err,context){
  console.error(context,err.message);
  return res.status(err.statusCode||500).json({success:false,message:err.statusCode?err.message:'Gagal mengambil data komunikasi. Pastikan migrasi 003 dan 004 sudah dijalankan.'});
}
router.get('/:id/history',async(req,res)=>{
  try{
    const {window,direction}=parseFilters(req);
    const limit=Math.max(1,Math.min(100,Number(req.query.limit)||30));
    const data=await getRows(req.params.id,window,direction);
    return res.json({success:true,data:data.slice(-limit).reverse(),total:data.length});
  }catch(err){return responseError(res,err,'History:');}
});
router.get('/:id/metrics',async(req,res)=>{
  try{
    const {window,direction}=parseFilters(req);
    const data=await getRows(req.params.id,window,direction);
    const metrics=await getMetrics(req.params.id,window,direction,data);
    return res.json({success:true,window,direction,metrics});
  }catch(err){return responseError(res,err,'Metrics:');}
});
router.post('/:id/receipts',async(req,res)=>{
  const rows=req.body?.receipts;
  if(!Array.isArray(rows)||rows.length>20)return res.status(400).json({success:false,message:'Maksimal 20 tanda-terima sensor per request'});
  try{const count=await recordBrowserReceipts(req.params.id,rows,req.user.id);return res.json({success:true,updated:count});}
  catch(err){return responseError(res,err,'Browser receipt:');}
});
const ms=v=>v==null?'':Math.round(Number(v)*100)/100;
const utc=v=>v?new Date(v).toISOString():'';
const wib=v=>v?new Date(Date.parse(v)+7*3600000).toISOString().replace('T',' ').replace('Z',' WIB'):'';
function deliveryRow(m,i,label){
  const n=i+2;
  const good=m?.valid===true;
  return [label,good?m.sent:'',good?m.received:'',good?m.lost:'',
    good?{formula:`IF(B${n}>0,C${n}/B${n}*100,\"\")`,cached:ms(m.pdr)}:'',
    good?{formula:`IF(B${n}>0,D${n}/B${n}*100,\"\")`,cached:ms(m.plr)}:'',
    good?'Tersedia':m?.reason||'Tidak dipilih',m?.method||'',
    label.includes('MTU → RTU')?'PDR terkonfirmasi; PLR = belum terkonfirmasi (ACK bisa hilang)':'Diterima di backend MQTT (bukan browser)'];
}
function buildTabs(data,rtuId,window,metrics){
  const sensors=data.filter(r=>r.event_type==='sensor');
  const commands=data.filter(r=>r.event_type==='command');
  const sensorColumns=['Packet ID','RTU','Waktu RTU kirim (WIB)','Waktu RTU kirim (UTC)','Waktu MTU/backend terima (WIB)','Waktu browser terima (WIB)','Suhu (°C)','Volume utama (%)','Volume penampungan (%)','Valve 1','Valve 2','Heater','Fase','Status validasi','Session ID','Sequence'];
  const delayColumns=['Packet ID','RTU kirim (WIB)','MTU/backend terima (WIB)','Browser terima (WIB)','Est RTU→Backend (ms)','Est RTU→Browser (ms)','Mutu jam','Metode'];
  const commandColumns=['Command ID','Jenis perintah','Browser MTU kirim (WIB)','Backend terima HTTP (WIB)','MTU/backend kirim MQTT (WIB)','RTU terima perintah (WIB)','RTU kirim ACK (WIB)','MTU/backend terima ACK (WIB)','Est Browser→RTU (ms)','Est Backend→RTU (ms)','RTT backend (ms)','Mutu jam','Hasil','Error'];
  const sensorRows=sensors.map(r=>[r.packet_id,r.rtu_id,wib(r.rtu_sent_at),utc(r.rtu_sent_at),wib(r.backend_received_at),wib(r.browser_received_at),r.sensor_payload?.suhu??'',r.sensor_payload?.tank_volume??'',r.sensor_payload?.destination_volume??'',r.sensor_payload?.valve1_status??'',r.sensor_payload?.valve2_status??'',r.sensor_payload?.heater_status??'',r.sensor_payload?.process_phase??'',r.validation_status??'VALID',r.session_id??'',r.packet_seq??'']);
  const delayRows=sensors.map(r=>[r.packet_id,wib(r.rtu_sent_at),wib(r.backend_received_at),wib(r.browser_received_at),ms(r.delay_rtu_backend_est_ms),ms(r.delay_rtu_browser_est_ms),r.clock_quality||'unverified','One-way estimasi lintas jam; perlu NTP dan audit offset']);
  const commandRows=commands.map(r=>[r.packet_id,r.command_device||'',wib(r.mtu_sent_at),wib(r.backend_request_received_at),wib(r.backend_command_sent_at),wib(r.rtu_command_received_at),wib(r.rtu_ack_sent_at),wib(r.backend_ack_received_at),ms(r.delay_mtu_rtu_est_ms),ms(r.delay_backend_rtu_est_ms),ms(r.backend_rtt_ms),r.clock_quality||'unverified',r.outcome||'',r.error_message||'']);
  const rtt=stats(commands.map(r=>r.backend_rtt_ms));
  const summary=[['RTU',rtuId],['Dari UTC',window.from],['Sampai UTC (eksklusif)',window.to],
    ['Zona waktu pada kolom Excel','WIB (Asia/Pontianak / UTC+7)'],['Jumlah sensor diterima',sensors.length],
    ['Jumlah perintah dicatat',commands.length],['RTT backend minimum (ms)',ms(rtt.min)],
    ['RTT backend rata-rata (ms)',ms(rtt.avg)],['RTT backend maksimum (ms)',ms(rtt.max)],
    ['RTU→MTU PDR (%)',metrics.uplink?.valid?ms(metrics.uplink.pdr):'Tidak tersedia'],
    ['RTU→MTU PLR (%)',metrics.uplink?.valid?ms(metrics.uplink.plr):'Tidak tersedia'],
    ['MTU→RTU PDR konfirmasi (%)',metrics.downlink?.valid?ms(metrics.downlink.pdr):'Tidak tersedia'],
    ['MTU→RTU PLR belum terkonfirmasi (%)',metrics.downlink?.valid?ms(metrics.downlink.plr):'Tidak tersedia'],
    ['Rumus PDR','PDR = paket diterima / paket terkirim × 100%'],
    ['Rumus PLR','PLR = (paket terkirim − paket diterima) / paket terkirim × 100%'],
    ['Kualitas waktu','Timestamp antar ESP32–backend–browser memerlukan sinkronisasi jam NTP untuk delay satu arah.'],
    ['Catatan pengukuran','PDR RTU→MTU membutuhkan laporan paket terkirim utuh per 10 detik dari RTU; kekurangan laporan -> N/A.'],
    ['Keterbatasan downlink','Tidak ada ACK atau laporan RTU belum membuktikan command hilang, sebab ACK/laporan bisa hilang.'],
    ['Keterbatasan browser','PDR RTU→MTU diukur hingga backend MQTT; browser hanya menyimpan waktu ketika terbuka.'],
    ['Batas data','Paket yang tidak berhasil disimpan di Supabase tidak termasuk perhitungan; pantau log error DB.']];
  return [
    {name:'Data Sensor',columns:sensorColumns,rows:sensorRows},
    {name:'Delay RTU-MTU',columns:delayColumns,rows:delayRows},
    {name:'Kontrol MTU-RTU',columns:commandColumns,rows:commandRows},
    {name:'Statistik',columns:['Parameter','Nilai'],rows:summary},
    {name:'PDR PLR',columns:['Arah','Paket dikirim','Diterima / terkonfirmasi','Hilang / belum terkonfirmasi','PDR (%)','PLR (%)','Status','Metode','Catatan'],
      rows:[deliveryRow(metrics.uplink,0,'RTU → MTU'),deliveryRow(metrics.downlink,1,'MTU → RTU')]}
  ];
}
router.get('/:id/export.xlsx',async(req,res)=>{
  try{
    const {window,direction}=parseFilters(req);
    const data=await getRows(req.params.id,window,direction);
    const metrics=await getMetrics(req.params.id,window,direction,data);
    const buf=makeWorkbook(buildTabs(data,req.params.id,window,metrics));
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="SCADA_${req.params.id}_${req.query.from.replace(/[^0-9T-]/g,'-')}_${req.query.to.replace(/[^0-9T-]/g,'-')}.xlsx"`);
    res.setHeader('Cache-Control','no-store');return res.send(buf);
  }catch(err){return responseError(res,err,'Excel export:');}
});
module.exports=router;
// Exported strictly for isolated regression tests (not a public API endpoint).
module.exports._buildTabs=buildTabs;
