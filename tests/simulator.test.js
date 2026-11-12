const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const Module = require('node:module');

const originalLoad = Module._load;
const originalInterval = global.setInterval;
const messages = [];
const client = new EventEmitter();
client.connected = true;
client.subscribe = (topics, opts, cb) => cb();
client.publish = (topic, raw, opts, cb) => {
  messages.push({topic, data: JSON.parse(raw), qos: opts.qos});
  if (cb) cb(null);
};
process.env.MQTT_HOST = 'test.invalid';
process.env.MQTT_PORT = '8883';
process.env.MQTT_USERNAME = 'dummy-user';
process.env.MQTT_PASSWORD = 'dummy-password';
Module._load = function(name) {
  if (name === 'dotenv') return {config() {}};
  if (name === 'mqtt') return {connect() {return client;}};
  return originalLoad.apply(this, arguments);
};
global.setInterval = () => 123;
try { require('../simulasi.js'); }
finally {
  Module._load = originalLoad;
}
client.emit('connect');
global.setInterval = originalInterval;
function send(device, extra) {
  const id = `test-${messages.length}`;
  client.emit('message','scada/RTU-01/command',Buffer.from(JSON.stringify({device,command_id:id,...extra})));
  return messages.filter(m=>m.topic==='scada/RTU-01/ack').at(-1)?.data;
}
let ack = send('valve1',{status:'ON'});
assert.equal(ack.applied,false,'Valve 1 ignored in automatic mode');
ack = send('mode',{mode:'Manual'});
assert.equal(ack.applied,true);
assert.equal(ack.mode,'Manual');
ack = send('valve1',{status:'ON'});
assert.equal(ack.applied,true);
assert.equal(ack.status,'ON');
ack = send('valve1',{status:'OFF'});
assert.equal(ack.applied,true);
assert.equal(ack.status,'OFF');
const sensor = messages.filter(m=>m.topic==='scada/RTU-01/sensor').at(-1)?.data;
assert.equal(sensor.valve1_status,'OFF','Telemetry reflects actual Valve 1 manual OFF');
ack = send('valve2',{status:'ON'});
assert.equal(ack.applied,true,'Manual outlet may open if safe');
assert.equal(ack.status,'ON');
ack = send('valve1',{status:'ON'});
assert.equal(ack.applied,false,'Inlet must not open while outlet is open');
ack = send('valve2',{status:'OFF'});
assert.equal(ack.applied,true);
ack = send('mode',{mode:'Otomatis'});
assert.equal(ack.applied,true);
ack = send('heater',{status:'ON'});
assert.equal(ack.applied,false,'Heater ignored while Auto');
console.log('PASS: simulator Manual/Auto, 2 valves telemetry and ACK rejection');
