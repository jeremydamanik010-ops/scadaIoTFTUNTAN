// Local unit tests with dependency stubs, no cloud credentials or network needed.
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function withMocks(mocks, callback) {
  const original = Module._load;
  Module._load = function(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return original.apply(this, arguments);
  };
  try { return callback(); } finally { Module._load = original; }
}
function mockMqtt(whenPublish) {
  const client = new EventEmitter();
  client.connected = false;
  client.published = [];
  client.subscribe = (_topics, _opts, cb) => cb(null);
  client.publish = (topic, body, opts, cb) => {
    client.published.push({topic, body: JSON.parse(body), opts});
    cb?.(null);
    if (whenPublish) setImmediate(() => whenPublish(client, topic, JSON.parse(body)));
  };
  return client;
}
function loadMqtt(client) {
  delete require.cache[require.resolve('../config/mqtt')];
  return withMocks({
    'dotenv': {config() {}},
    'mqtt': { connect: () => client },
    './database': { from() { throw new Error('Unexpected DB request'); } }
  }, () => require('../config/mqtt'));
}

async function testOffline() {
  process.env.MQTT_HOST = 'localhost';
  const client = mockMqtt();
  const api = loadMqtt(client);
  await assert.rejects(api.publishCommand('scada/RTU-01/command', {device: 'pump',status:'ON'}), {statusCode:503});
}

async function testAck() {
  process.env.MQTT_HOST = 'localhost';
  const client = mockMqtt((c,topic,body) => {
    c.emit('message', Buffer.from(topic).toString().replace('/command','/ack'), Buffer.from(JSON.stringify({command_id:body.command_id,applied:true,device:body.device,status:body.status})));
  });
  const api = loadMqtt(client);
  client.connected = true;
  api.connectMQTT();
  client.emit('connect');
  const result = await api.publishCommand('scada/RTU-01/command', {device:'valve1',status:'ON'});
  assert.equal(result.applied,true);
  assert.equal(result.status,'ON');
  assert.equal(client.published[0].opts.qos,1);
  assert.equal(client.published[0].opts.retain,false);
  assert.ok(client.published[0].body.command_id);
}

async function testNack() {
  process.env.MQTT_HOST = 'localhost';
  const client = mockMqtt((c,topic,body) => {
    c.emit('message','scada/RTU-01/ack', Buffer.from(JSON.stringify({command_id:body.command_id,applied:false,reason:'Masih Otomatis'})));
  });
  const api = loadMqtt(client);
  client.connected = true;
  api.connectMQTT();
  client.emit('connect');
  await assert.rejects(api.publishCommand('scada/RTU-01/command',{device:'valve1',status:'OFF'}),/Masih Otomatis/);
}

function testAccess() {
  const { authorizedOperator } = require('../middleware/rtu-access');
  function run(role, id) {
    const req = { user: { role }, params: { id } };
    const res = { status(n) {this.code = n; return this;}, json(data) {this.data=data; return this;} };
    let nextCalled=false;
    authorizedOperator(req,res,()=> {nextCalled=true});
    return {res, nextCalled};
  }
  assert.equal(run('Viewer','RTU-01').res.code,403);
  assert.equal(run('Operator','RTU-999').res.code,403);
  assert.equal(run('Operator','RTU-01').nextCalled,true);
}

(async function run() {
  await testOffline();
  console.log('PASS: offline MQTT');
  await testAck();
  console.log('PASS: QoS1 command and positive ACK');
  await testNack();
  console.log('PASS: RTU rejection');
  testAccess();
  console.log('PASS: role and RTU access');
})().catch(err => { console.error(err); process.exitCode = 1; });
