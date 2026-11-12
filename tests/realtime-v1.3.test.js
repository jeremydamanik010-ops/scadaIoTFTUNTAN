// V1.3 regression checks. MQTT and Supabase mocked: no secrets/cloud connections.
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const Module = require('node:module');
const liveState = require('../services/rtu-live-state');
const bus = require('../services/live-telemetry');

(async () => {
  liveState.brokerDisconnected();
  assert.equal(liveState.readLiveStatus('RTU-01').is_online, false);
  liveState.brokerConnected();
  assert.equal(liveState.readLiveStatus('RTU-01').is_online, false,
    'Reconnect requires a fresh RTU status');
  assert.throws(() => liveState.acceptStatus('RTU-01',{status:'online',mode:'Fake'}), /tidak valid/);
  liveState.acceptStatus('RTU-01', {status:'online',mode:'Manual'});
  assert.equal(liveState.readLiveStatus('RTU-01').mode, 'Manual');
  liveState.brokerDisconnected();
  assert.equal(liveState.readLiveStatus('RTU-01').mode, null);
  console.log('PASS: broker reconnect / offline safety / status validation');

  const client = new EventEmitter();
  client.connected = true;
  client.subscribe = (_topics,_opts,cb)=>cb(null);
  client.publish = (_topic,_payload,_opts,cb)=>cb?.(null);
  let resolveCloudStatus;
  let sensorInsertCount = 0;
  const db = {from(table) {
    if (table === 'rtu_status_log') return {insert() {return {select() {return {single() {return new Promise(resolve => {resolveCloudStatus=resolve;});}};}};}};
    if (table === 'sensor_data') return {insert() {sensorInsertCount++;return Promise.resolve({error:null});}};
    throw new Error('Unexpected DB table '+table);
  }};
  const originalLoad = Module._load;
  try {
    Module._load = function(name, parent, isMain) {
      if (name === 'dotenv') return {config() {}};
      if (name === 'mqtt') return {connect:() => client};
      if (name === './database' && /[/\\]config[/\\]mqtt\.js$/.test(parent?.filename || '')) return db;
      return originalLoad.call(this,name,parent,isMain);
    };
    process.env.MQTT_HOST = 'localhost';
    delete require.cache[require.resolve('../config/mqtt')];
    const backend = require('../config/mqtt');
    const events = [];
    const off = bus.subscribe(event=>events.push(event));
    backend.connectMQTT();
    client.emit('connect');
    client.emit('message','scada/RTU-01/status',Buffer.from(JSON.stringify({status:'online',mode:'Otomatis'})));
    assert.equal(liveState.readLiveStatus('RTU-01').mode,'Otomatis',
      'State must update before the cloud insert completes');
    assert.equal(events.at(-1).type,'status',
      'Status SSE must be published without waiting for Supabase');
    assert.ok(resolveCloudStatus,'Status cloud write has started');
    resolveCloudStatus({data:{id:1},error:null});
    await new Promise(resolve=>setImmediate(resolve));

    const msg = {suhu:26.5,humidity:70,water_level:'MEDIUM',tank_volume:34,valve1_status:'ON',valve2_status:'OFF',heater_status:'OFF',destination_volume:10,process_phase:'MENGISI',transfer_remaining_seconds:0};
    client.emit('message','scada/RTU-01/sensor',Buffer.from(JSON.stringify(msg)));
    assert.equal(events.at(-1).type,'telemetry');
    assert.equal(events.at(-1).data.water_temp,26.5);
    assert.equal(sensorInsertCount,1);
    client.emit('message','scada/RTU-01/sensor',Buffer.from(JSON.stringify(msg)));
    assert.equal(sensorInsertCount,1,'History writes are throttled; stream is not');
    assert.equal(events.filter(e=>e.type==='telemetry').length,2);
    client.emit('offline');
    assert.equal(liveState.readLiveStatus('RTU-01').is_online,false);
    off();
    console.log('PASS: MQTT status/sensor streamed immediately; DB writes throttled; offline guards');
  } finally {
    Module._load = originalLoad;
  }
})();
