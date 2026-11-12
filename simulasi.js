// ============================================================
// simulasi.js
// Simulator RTU-01 — EMQX Cloud
// Mendukung Mode Otomatis + Manual
// ============================================================

require('dotenv').config();

const mqtt = require('mqtt');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULTS, validateSetpoints, decideAutomaticControl,
  MIN_SAFE_VOLUME,HARD_TEMPERATURE_LIMIT,MAX_SAFE_VOLUME } = require('./services/setpoint-policy');
// Mimics ESP32 NVS persistence for local simulator testing only.
const SETPOINT_FILE = path.join(__dirname, 'simulasi-setpoints.json');
function loadSavedSetpoints() {
  if (process.env.SIMULATOR_PERSIST_SETPOINTS === 'false') return {...DEFAULTS};
  try { return validateSetpoints(JSON.parse(fs.readFileSync(SETPOINT_FILE,'utf8'))); }
  catch(err) {
    if (err.code !== 'ENOENT') console.warn('⚠️ Setpoint simulator tidak valid; gunakan default.');
    return {...DEFAULTS};
  }
}
function persistSetpoints(values) {
  if (process.env.SIMULATOR_PERSIST_SETPOINTS === 'false') return;
  const tmpFile = SETPOINT_FILE + '.tmp';
  fs.writeFileSync(tmpFile,JSON.stringify(values,null,2)+'\n',{mode:0o600});
  fs.renameSync(tmpFile,SETPOINT_FILE);
}
let activeSetpoints = loadSavedSetpoints();


// ============================================================
// KONFIGURASI EMQX
// ============================================================

const RAW_MQTT_HOST =
  String(
    process.env.MQTT_HOST || ''
  ).trim();

const MQTT_HOST =
  RAW_MQTT_HOST
    .replace(/^mqtts?:\/\//i, '')
    .replace(/:\d+$/, '')
    .replace(/\/+$/, '');

const MQTT_PORT =
  parseInt(
    process.env.MQTT_PORT || '8883',
    10
  );

const MQTT_USERNAME =
  process.env.MQTT_USERNAME;

const MQTT_PASSWORD =
  process.env.MQTT_PASSWORD;


if (
  !MQTT_HOST ||
  !MQTT_USERNAME ||
  !MQTT_PASSWORD
) {

  console.error(
    '❌ Konfigurasi MQTT belum lengkap di .env'
  );

  console.error(
    'Pastikan MQTT_HOST, MQTT_PORT, MQTT_USERNAME, MQTT_PASSWORD tersedia.'
  );

  process.exit(1);
}


const MQTT_URL =
  `mqtts://${MQTT_HOST}:${MQTT_PORT}`;


// ============================================================
// STATE RTU-01 — 2 valve + 1 heater
// ============================================================
let state={
  suhu:25,humidity:70,tankVolume:45,destinationVolume:10,
  mode:'Otomatis',valve1Status:'OFF',valve2Status:'OFF',heaterStatus:'OFF',
  processPhase:'MENGISI',transferStartedAt:null,transferRemainingSeconds:0,transferFlowRate:0,transferSafetyTripped:false,switchReadyAt:null
};
const {computeAutomatic,applyPhysics,PHASE,MIN_DRAIN_RESERVE,DESTINATION_MAX,VALVE_SWITCH_DELAY_MS}=require('./services/process-control');
const TOPICS={sensor:'scada/RTU-01/sensor',status:'scada/RTU-01/status',command:'scada/RTU-01/command',ack:'scada/RTU-01/ack',stats:'scada/RTU-01/stats'};
const COMMAND_TOPICS=[TOPICS.command]; // no legacy pump command topics
const SEEN=new Map();
const SENSOR_MS=Math.max(500,Math.min(5000,Number(process.env.SIMULATOR_INTERVAL_MS)||1000));
const SPEED=Math.max(.1,Math.min(10,Number(process.env.SIMULATOR_SPEED_FACTOR)||1));
const mqttClient=mqtt.connect(MQTT_URL,{
  username:MQTT_USERNAME,password:MQTT_PASSWORD,clientId:`simulator_RTU01_${Date.now()}`,
  clean:true,reconnectPeriod:5000,connectTimeout:30000,rejectUnauthorized:true,keepalive:15,
  will:{topic:TOPICS.status,payload:JSON.stringify({status:'offline',mode:state.mode}),qos:1,retain:false}
});
// Each complete UTC 10-second bucket reports the RTU's own transmitted total.
// Without these reports, a missing sensor packet is invisible at the backend.
const SESSION_ID=randomUUID();
const STATS_BUCKET_MS=10000;
let nextSequence=0;
let activeSince=Date.now();
let currentBucketStart=Math.floor(activeSince/STATS_BUCKET_MS)*STATS_BUCKET_MS;
let bucketSensorSent=0;
let bucketCommands=new Map();
let bucketInterrupted=false;
function closeElapsedBuckets(now=Date.now()) {
  while(now>=currentBucketStart+STATS_BUCKET_MS) {
    publish(TOPICS.stats,{
      event:'delivery_report',session_id:SESSION_ID,
      window_start:new Date(currentBucketStart).toISOString(),
      window_end:new Date(currentBucketStart+STATS_BUCKET_MS).toISOString(),
      sensor_sent_count:bucketSensorSent,
      command_received_ids:[...bucketCommands.keys()],
      command_received_times:Object.fromEntries(bucketCommands),
      bucket_complete:!bucketInterrupted && activeSince<=currentBucketStart,
      time_sync_status:'local_os'
    },1);
    currentBucketStart+=STATS_BUCKET_MS;
    bucketSensorSent=0;bucketCommands=new Map();bucketInterrupted=false;
  }
}
let simulationTimer=null;
let lastHeartbeat=0;
let lastTick=Date.now();
let lastPhase=null;
function publish(topic,payload,qos=0){
  if(!mqttClient.connected)return false;
  mqttClient.publish(topic,JSON.stringify(payload),{qos,retain:false},err=>{if(err)console.error('MQTT publish gagal:',err.message)});
  return true;
}
function sensorPayload(){
  return {
    packet_id:randomUUID(),session_id:SESSION_ID,packet_seq:nextSequence++,rtu_sent_at:new Date().toISOString(),time_sync_status:'local_os',
    suhu:Number(state.suhu.toFixed(2)),humidity:Number(state.humidity.toFixed(2)),
    water_level:state.tankVolume>=60?'HIGH':state.tankVolume>=40?'MEDIUM':'LOW',
    tank_volume:Number(state.tankVolume.toFixed(2)),
    destination_volume:Number(state.destinationVolume.toFixed(2)),
    valve1_status:state.valve1Status,valve2_status:state.valve2Status,
    heater_status:state.heaterStatus,process_phase:state.processPhase,
    transfer_remaining_seconds:state.transferRemainingSeconds
  };
}
let lastSensorPayload=null;
function publishSensor(){
  const now=Date.now();closeElapsedBuckets(now);
  if(!mqttClient.connected)return;
  const packet=sensorPayload();
  if(publish(TOPICS.sensor,packet)){bucketSensorSent++;lastSensorPayload=packet;}
}
function publishStatus(){
  publish(TOPICS.status,{status:'online',mode:state.mode,...activeSetpoints,
    process_phase:state.processPhase,transfer_remaining_seconds:state.transferRemainingSeconds},1);
}
function runTick(){
  const now=Date.now();closeElapsedBuckets(now);const dt=Math.min(5,(now-lastTick)/1000);lastTick=now;
  if(state.mode==='Otomatis')state=computeAutomatic(state,activeSetpoints,now);
  state=applyPhysics(state,dt,SPEED);
  if(state.mode==='Otomatis')state=computeAutomatic(state,activeSetpoints,now);
  state.humidity=Math.max(50,Math.min(90,state.humidity+(Math.random()-.5)*.15));
  publishSensor();
  if(lastPhase!==state.processPhase){
    console.log(`🔄 FASE PROSES: ${state.processPhase} | V1=${state.valve1Status} V2=${state.valve2Status} Heater=${state.heaterStatus}`);
    lastPhase=state.processPhase;publishStatus();
  }
  if(now-lastHeartbeat>=10000){publishStatus();lastHeartbeat=now;}
  if(process.env.SCADA_VERBOSE_SIMULATOR==='true')console.log('📤 SENSOR',lastSensorPayload);
}
function applyMode(raw){
  const mode=String(raw||'').toLowerCase();
  if(!['manual','otomatis','auto','automatic'].includes(mode))return false;
  if(mode==='manual'){
    state.mode='Manual';state.processPhase=PHASE.MANUAL;
    // Switching modes cannot leave outlet or heater unexpectedly energized.
    state.valve1Status='OFF';state.valve2Status='OFF';state.heaterStatus='OFF';
    state.transferStartedAt=null;state.transferRemainingSeconds=0;
    state.transferSafetyTripped=false;state.switchReadyAt=null;
  }else{
    const outletWasOpen=state.valve2Status==='ON';
    state.mode='Otomatis';state.processPhase=outletWasOpen?PHASE.SETTLING:PHASE.FILL;
    state.valve1Status='OFF';state.valve2Status='OFF';state.heaterStatus='OFF';
    state.transferStartedAt=null;state.transferRemainingSeconds=0;
    state.transferSafetyTripped=false;
    state.switchReadyAt=outletWasOpen?Date.now()+VALVE_SWITCH_DELAY_MS:null;
    state=computeAutomatic(state,activeSetpoints,Date.now());
  }
  publishStatus();publishSensor();return true;
}
function applyActuator(device,requested){
  if(state.mode!=='Manual'||!['ON','OFF'].includes(requested))return false;
  if(device==='valve1'){
    if(requested==='ON'&&(state.valve2Status==='ON'||state.tankVolume>=MAX_SAFE_VOLUME))return false;
    state.valve1Status=requested;
  }else if(device==='valve2'){
    if(requested==='ON'&&(state.valve1Status==='ON'||state.heaterStatus==='ON'||state.tankVolume<=MIN_DRAIN_RESERVE||state.destinationVolume>=DESTINATION_MAX))return false;
    state.valve2Status=requested;
  }else if(device==='heater'){
    if(requested==='ON'&&(state.tankVolume<MIN_SAFE_VOLUME||state.suhu>=HARD_TEMPERATURE_LIMIT||state.valve2Status==='ON'))return false;
    state.heaterStatus=requested;
  }else return false;
  publishSensor();return true;
}
function applySetpoints(payload){
  try{
    const validated=validateSetpoints(payload);
    persistSetpoints(validated);activeSetpoints=validated;
    if(state.mode==='Otomatis'){
      // Do NOT interrupt an ongoing 60s transfer or the valve-closing delay.
      // New targets are acknowledged now, but applied to control after this
      // batch finishes and Valve 2 has been confirmed closed in the simulator.
      state=computeAutomatic(state,activeSetpoints,Date.now());
    }
    publishStatus();publishSensor();return true;
  }catch(err){console.warn('Setpoint ditolak:',err.message);return false;}
}
function handleCommand(payload){
  const rtuReceivedAt=new Date().toISOString();
  const id=payload?.command_id;
  if(typeof id!=='string'||!id||id.length>100)return;
  if(SEEN.has(id)){publish(TOPICS.ack,SEEN.get(id),1);return;}
  closeElapsedBuckets(Date.now());bucketCommands.set(id,rtuReceivedAt);
  const device=String(payload.device||'').toLowerCase();
  const requested=String(payload.status||payload.command||'').toUpperCase();
  let applied=false;
  if(device==='mode')applied=applyMode(payload.mode||payload.status);
  else if(device==='setpoints')applied=applySetpoints(payload);
  else applied=applyActuator(device,requested);
  const ack={command_id:id,device,applied,mode:state.mode,
    rtu_received_at:rtuReceivedAt,rtu_ack_sent_at:new Date().toISOString(),
    time_sync_status:'local_os',
    status:device==='valve1'?state.valve1Status:device==='valve2'?state.valve2Status:device==='heater'?state.heaterStatus:undefined,
    ...(device==='setpoints'&&applied?activeSetpoints:{}),
    reason:applied?null:'Perintah ditolak: mode, nilai, atau interlock keselamatan'};
  SEEN.set(id,ack);if(SEEN.size>200)SEEN.delete(SEEN.keys().next().value);
  publish(TOPICS.ack,ack,1);
}
mqttClient.on('connect',()=>{
  activeSince=Date.now();closeElapsedBuckets(activeSince);
  console.log('✅ SIMULATOR RTU-01 (2 valve + heater) MQTT terhubung:',MQTT_URL);
  mqttClient.subscribe(COMMAND_TOPICS,{qos:1},err=>{if(err)console.error('Subscribe gagal:',err.message)});
  if(state.mode==='Otomatis')state=computeAutomatic(state,activeSetpoints,Date.now());
  publishStatus();publishSensor();lastHeartbeat=Date.now();lastTick=Date.now();
  if(!simulationTimer)simulationTimer=setInterval(runTick,SENSOR_MS);
});
mqttClient.on('message',(topic,raw)=>{
  if(topic!==TOPICS.command)return;
  try{handleCommand(JSON.parse(raw.toString()));}catch(err){console.error('Command tidak valid:',err.message);}
});
mqttClient.on('error',err=>console.error('MQTT error:',err.message));
mqttClient.on('offline',()=>{bucketInterrupted=true;console.warn('⚠️ MQTT offline');});
mqttClient.on('reconnect',()=>console.log('🔄 MQTT reconnect...'));
process.on('SIGINT',()=>{if(simulationTimer)clearInterval(simulationTimer);mqttClient.end(true,()=>process.exit(0));});
