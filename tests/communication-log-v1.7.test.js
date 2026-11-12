const assert=require('node:assert/strict');
const dbPath=require.resolve('../config/database');
const saved=[];
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{from(table){return {
  insert(row){saved.push({table,row});return Promise.resolve({error:null});},
  upsert(row,options){saved.push({table,row,options});return Promise.resolve({error:null});}
};}}};
const {recordSensor,recordDeliveryReport}=require('../services/communication-log');
const session='62a7cdaf-029e-4ad8-a422-c6fe62bf8a19';
const packet='b4e61ac5-360a-4e06-8d3e-d4bcb8a4c912';
recordSensor('RTU-01',{packet_id:packet,session_id:session,packet_seq:55,
  rtu_sent_at:'2026-11-09T03:00:01.100Z',time_sync_status:'local_os'},
  null,'2026-11-09T03:00:01.250Z','INVALID');
assert.equal(saved[0].row.validation_status,'INVALID');
assert.equal(saved[0].row.session_id,session);
assert.equal(saved[0].row.packet_seq,55);
const cmd='79a1a3fe-13cb-4d1b-b13b-f4094ea30d1a';
recordDeliveryReport('RTU-01',{event:'delivery_report',session_id:session,
  window_start:'2026-11-09T03:00:00Z',window_end:'2026-11-09T03:00:10Z',
  sensor_sent_count:10,bucket_complete:true,command_received_ids:[cmd],
  command_received_times:{[cmd]:'2026-11-09T03:00:02.125Z'},time_sync_status:'local_os'});
assert.equal(saved[1].table,'communication_sender_windows');
assert.deepEqual(saved[1].row.command_received_ids,[cmd]);
assert.equal(saved[1].row.command_received_times[cmd],'2026-11-09T03:00:02.125Z');
assert.throws(()=>recordDeliveryReport('RTU-01',{event:'delivery_report',sensor_sent_count:-1}));
console.log('✅ V1.7 log: invalid sensor tetap dihitung diterima, sequence/session, counter report & waktu penerimaan RTU: OK');
