const assert = require('node:assert/strict');
const Module = require('node:module');
const handlers = new Map();
const router = {use(){},get(path,...callbacks){handlers.set('GET '+path,callbacks.at(-1));},
  post(path,...callbacks){handlers.set('POST '+path,callbacks.at(-1));}};
let online = false, mode = 'Manual', answerOverride = null;
const published = [];
const fakeMode = {
  readActualState: async()=>({is_online:online,mode}),
  readDesiredMode: async()=>null, saveDesiredMode:async()=>{},
  combineState:()=>({})
};
const fakeMqtt = {publishCommand:async(topic,payload)=>{
  published.push({topic,payload});
  return answerOverride ?? {device:payload.device,command_id:'ack',applied:true,
    temperature_setpoint:payload.temperature_setpoint,volume_setpoint:payload.volume_setpoint};
}};
const originalLoad = Module._load;
Module._load = function(name,...args) {
  if(name==='express') return {Router:()=>router};
  if(name==='../middleware/auth') return ()=>{};
  if(name==='../middleware/rtu-access') return {authorizedOperator:()=>{}};
  if(name==='../config/database') return {from:()=>({})};
  if(name==='../config/mqtt') return fakeMqtt;
  if(name==='../services/rtu-mode') return fakeMode;
  return originalLoad.call(this,name,...args);
};
try {require('../routes/rtu');} finally {Module._load=originalLoad;}
async function request(body) {
  const handler = handlers.get('POST /:id/setpoints');
  assert.ok(handler,'Setpoint endpoint exists');
  const res = {statusCode:200,status(code){this.statusCode=code;return this;},
    json(value){this.body=value;return this;}};
  await handler({params:{id:'RTU-01'},body},res);
  return res;
}
(async()=>{
  const payload={temperature_setpoint:31.5,volume_setpoint:70};
  let response=await request(payload);
  assert.equal(response.statusCode,409);
  assert.equal(published.length,0,'Offline commands never published');
  online=true;
  response=await request({temperature_setpoint:100,volume_setpoint:70});
  assert.equal(response.statusCode,400);
  assert.equal(published.length,0);
  response=await request(payload);
  assert.equal(response.statusCode,200);
  assert.equal(response.body.acknowledged,true);
  assert.deepEqual(published.at(-1),{topic:'scada/RTU-01/command',payload:{device:'setpoints',...payload}});
  answerOverride={device:'setpoints',command_id:'ack',applied:true,temperature_setpoint:32,volume_setpoint:70};
  response=await request(payload);
  assert.equal(response.statusCode,502,'ACK value mismatch must fail');
  answerOverride=null;
  mode='Otomatis';
  response=await request(payload);
  assert.equal(response.statusCode,200,'Setpoints accepted in Automatic mode');
  console.log('PASS: authenticated setpoint route contract; offline reject; range validation; ACK verify');
})().catch(e=>{console.error(e);process.exitCode=1;});
