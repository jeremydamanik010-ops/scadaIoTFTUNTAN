// Offline-mode integration tests (Supabase, Express and MQTT mocked, no network).
const assert = require('node:assert/strict');
const Module = require('node:module');

const rows = {status: null, preference: null};
const published = [];
let migrationMissing = false;
const db = { from(table) {
  return {
    select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
    maybeSingle: async () => {
      if (table === 'rtu_status_log') return {data:rows.status,error:null};
      if (table === 'rtu_mode_preferences') return migrationMissing ?
        {data:null,error:{message:'relation does not exist',code:'42P01'}} : {data:rows.preference,error:null};
      return {data:null,error:null};
    },
    upsert: async(row) => {
      if (migrationMissing) return {error:{message:'relation does not exist'}};
      rows.preference = {desired_mode:row.desired_mode,updated_at:row.updated_at};
      return {error:null};
    }
  };
}};
const appRoutes = new Map();
const router = {use(){}, get(path,...handlers){appRoutes.set('GET '+path,handlers.at(-1));}, post(path,...handlers){appRoutes.set('POST '+path,handlers.at(-1));}};
const express = {Router(){return router;}};
const mqtt = {publishCommand: async(topic,payload) => {
  published.push({topic,payload});
  return {command_id:'mock-ack',applied:true,...payload};
}};
const originalLoad = Module._load;
Module._load = function(name,parent,isMain) {
  if (name === 'express') return express;
  if (name === '../config/database') return db;
  if (name === '../middleware/auth') return (_req,_res,next)=>next();
  if (name === '../middleware/rtu-access') return {authorizedOperator:(_req,_res,next)=>next()};
  if (name === '../config/mqtt') return mqtt;
  return originalLoad.call(this,name,parent,isMain);
};
try {
  require('../routes/rtu');
} finally {
  Module._load = originalLoad;
}
async function api(method,path,body) {
  const handler = appRoutes.get(method+' '+path);
  assert.ok(handler,'Route '+method+' '+path+' exists');
  const req = {params:{id:'RTU-01'},body:body||{}};
  const res = {statusCode:200,status(n){this.statusCode=n;return this;},json(data){this.payload=data;return this;}};
  await handler(req,res);
  return {status:res.statusCode,...res.payload};
}
(async()=>{
  let result = await api('GET','/:id/state');
  assert.equal(result.data.is_online,false);
  assert.equal(result.data.mode,null);
  assert.equal(result.data.desired_mode,null);

  result = await api('POST','/:id/mode',{mode:'Manual'});
  assert.equal(result.status,202);
  assert.equal(result.success,true);
  assert.equal(result.acknowledged,false);
  assert.equal(rows.preference.desired_mode,'Manual');
  assert.equal(published.length,0,'Never publish offline mode commands');

  result = await api('GET','/:id/state');
  assert.equal(result.data.desired_mode,'Manual');
  assert.equal(result.data.mode_pending,true);
  assert.equal(result.data.mode,null);
  result = await api('POST','/:id/valve1',{status:'ON'});
  assert.equal(result.status,409);
  assert.equal(published.length,0,'Actuators cannot be controlled offline');

  rows.status = {status:'online',mode:'Otomatis',changed_at:new Date().toISOString()};
  result = await api('GET','/:id/state');
  assert.equal(result.data.is_online,true);
  assert.equal(result.data.mode,'Otomatis');
  assert.equal(result.data.desired_mode,'Manual');
  assert.equal(result.data.mode_pending,true);
  assert.equal(published.length,0,'Saved offline mode must not automatically replay on RTU reconnect');

  result = await api('POST','/:id/valve1',{status:'ON'});
  assert.equal(result.status,409,'Actuator forbidden until actual RTU mode is Manual');

  result = await api('POST','/:id/mode/apply');
  assert.equal(result.acknowledged,true);
  assert.equal(published.at(-1).payload.mode,'Manual');

  rows.status.mode = 'Manual';
  result = await api('GET','/:id/state');
  assert.equal(result.data.mode_pending,false);
  result = await api('POST','/:id/heater',{status:'ON'});
  assert.equal(result.acknowledged,true);
  assert.equal(published.at(-1).payload.device,'heater');

  result = await api('POST','/:id/mode',{mode:'Mode Palsu'});
  assert.equal(result.status,400);
  migrationMissing = true;
  result = await api('POST','/:id/mode',{mode:'Otomatis'});
  assert.equal(result.status,500,'Do not fake persisted preference if migration is missing');
  console.log('PASS: offline preference saved; no command replay; actual/demand separated; explicit apply; actuator guard; missing migration failure');
})().catch(err=>{console.error(err);process.exitCode=1;});
