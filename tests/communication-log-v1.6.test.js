// Stub the DB client, ensure audit logging is additive and RTT null for timeouts.
const assert=require('node:assert/strict');
const dbPath=require.resolve('../config/database');
const inserted=[];
const fakeDb={from(table){assert.equal(table,'communication_logs');return {
 insert(record){inserted.push(record);return Promise.resolve({error:null});}
};}};
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fakeDb};
const {recordSensor,recordCommand}=require('../services/communication-log');
const now='2026-11-05T12:00:00.200Z';
const packet='26f72ee6-bf7b-4b33-baa7-f9940cfb640e';
const sensor=recordSensor('RTU-01',{
  packet_id:packet,rtu_sent_at:'2026-11-05T12:00:00.100Z',time_sync_status:'local_os'
},{water_temp:30,tank_volume:60,destination_volume:8,valve1_status:'OFF',valve2_status:'OFF',heater_status:'ON',process_phase:'MEMANASKAN'},now);
assert.equal(sensor.packet_id,packet);
recordCommand({commandId:'f91643d6-57de-45a7-a9d7-2d32d78ab6e4',rtuId:'RTU-01',device:'heater',
  commandPayload:{device:'heater',status:'ON'},backendSentAt:now,backendAckAt:null,
  rttMs:null,outcome:'TIMEOUT_OR_ERROR',errorMessage:'Timeout'});
assert.equal(inserted.length,2);
assert.equal(inserted[0].delay_rtu_backend_est_ms,100);
assert.equal(inserted[0].clock_quality,'unverified');
assert.equal(inserted[1].backend_rtt_ms,null);
assert.equal(inserted[1].outcome,'TIMEOUT_OR_ERROR');
console.log('✅ V1.6 background audit log: sensor metadata, clock flags, timeout RTT/null OK');
