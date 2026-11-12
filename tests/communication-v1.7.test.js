const assert=require('node:assert/strict');
const fs=require('node:fs');
const {parseTimeWindow,calculateUplink,calculateDownlink}=require('../services/communication-metrics');
const {makeWorkbook}=require('../services/xlsx-export');
const w=parseTimeWindow('2026-11-09T10:00','2026-11-09T10:05');
assert.equal(w.from,'2026-11-09T03:00:00.000Z');
assert.equal(w.to,'2026-11-09T03:05:00.000Z');
assert.throws(()=>parseTimeWindow('2026-11-09T10:05','2026-11-09T10:00'));
assert.throws(()=>parseTimeWindow('2026-02-30T10:00','2026-03-01T11:00'));
assert.throws(()=>parseTimeWindow('2026-11-09T10:00','2026-11-09T10:00'));
const session='62a7cdaf-029e-4ad8-a422-c6fe62bf8a19';
const base=Date.parse(w.from);
const reports=Array.from({length:30},(_,i)=>({session_id:session,window_start:new Date(base+i*10000).toISOString(),
  sensor_sent_count:10,bucket_complete:true,command_received_ids:[]}));
const sensors=Array.from({length:297},(_,i)=>({packet_id:'pkt'+i,session_id:session,
  rtu_sent_at:new Date(base+Math.floor(i/10)*10000).toISOString()}));
const now=Date.parse(w.to)+20000;
const uplink=calculateUplink(sensors,reports,w,now);
assert.equal(uplink.sent,300);assert.equal(uplink.received,297);assert.equal(uplink.lost,3);
assert.equal(uplink.pdr,99);assert.equal(uplink.plr,1);
assert.equal(calculateUplink([...sensors,sensors[0]],reports,w,now).received,297);
assert.equal(calculateUplink(sensors,reports.slice(1),w,now).valid,false);
assert.equal(calculateUplink(sensors,[{...reports[0],bucket_complete:false},...reports.slice(1)],w,now).valid,false);
assert.equal(calculateUplink(sensors,reports,w,Date.parse(w.to)+1000).valid,false);
const commands=Array.from({length:5},(_,i)=>({packet_id:'command'+i,backend_command_sent_at:new Date(base+i*10000).toISOString(),
  rtu_command_received_at:i<3?new Date(base+i*10000+123).toISOString():null}));
reports[12].command_received_ids=['command3'];
let down=calculateDownlink(commands,reports,w,now);
assert.equal(down.sent,5);assert.equal(down.received,4);assert.equal(down.pdr,80);assert.equal(down.plr,20);
assert.equal(down.isEstimate,true);
assert.equal(calculateDownlink([],reports,w,now).valid,false);
const tabs=[{name:'PDR PLR',columns:['Arah','Sent','Received','Lost','PDR (%)','PLR (%)'],rows:[
  ['RTU → MTU',300,297,3,{formula:'IF(B2>0,C2/B2*100,"")',cached:99},{formula:'IF(B2>0,D2/B2*100,"")',cached:1}]
]}];
const buf=makeWorkbook(tabs);
assert(buf.includes(Buffer.from('xl/workbook.xml')));
assert.throws(()=>makeWorkbook([{name:'X',columns:['A'],rows:[[{formula:'1+1',cached:2}]]}]));
fs.writeFileSync('/mnt/data/scada_v17_formula_test.xlsx',buf);
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/dashboard.html'),'utf8');
assert(source.includes('type="datetime-local"')&&source.includes('id="commRates"'));
console.log('✅ V1.7: 5-minute window WIB, sender denominator, duplicate protection, PDR/PLR, N/A when incomplete, downlink confirmation, XLSX formulas: OK');
