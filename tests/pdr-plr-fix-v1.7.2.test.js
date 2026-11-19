'use strict';
// Regression tests for V1.7.2 PDR/PLR calculation fixes (Windows-safe, no cloud needed).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { parseTimeWindow, calculateUplink, calculateDownlink } = require('../services/communication-metrics');
const { makeWorkbook } = require('../services/xlsx-export');

const w = parseTimeWindow('2026-11-19T14:21', '2026-11-19T14:26');
const base = Date.parse(w.from);
const now = Date.parse(w.to) + 20000;
const session = '62a7cdaf-029e-4ad8-a422-c6fe62bf8a19';

// 1. Strict full-window uplink still passes & calculates accurately
const fullReports = Array.from({ length: 30 }, (_, i) => ({
  session_id: session,
  window_start: new Date(base + i * 10000).toISOString(),
  sensor_sent_count: 10,
  bucket_complete: true,
  command_received_ids: []
}));
const fullSensors = Array.from({ length: 297 }, (_, i) => ({
  packet_id: `full-${i}`,
  session_id: session,
  rtu_sent_at: new Date(base + Math.floor(i / 10) * 10000 + 100).toISOString()
}));
const fullUp = calculateUplink(fullSensors, fullReports, w, now);
assert.equal(fullUp.valid, true);
assert.equal(fullUp.sent, 300);
assert.equal(fullUp.received, 297);
assert.equal(fullUp.lost, 3);
assert.equal(fullUp.pdr, 99);
assert.equal(fullUp.plr, 1);

// 2. Partial active-window uplink: RTU started mid-minute (bucket 0 incomplete) and stopped early (only 13 complete buckets)
const partialReports = [
  { session_id: session, window_start: new Date(base).toISOString(), sensor_sent_count: 6, bucket_complete: false, command_received_ids: [] },
  ...Array.from({ length: 13 }, (_, i) => ({
    session_id: session,
    window_start: new Date(base + (i + 1) * 10000).toISOString(),
    sensor_sent_count: 10,
    bucket_complete: true,
    command_received_ids: []
  }))
];
// Include 6 packets inside incomplete bucket 0 (MUST NOT be counted in partial numerator)
// plus 128 packets inside the 13 complete buckets (2 lost out of 130).
const partialSensors = [
  ...Array.from({ length: 6 }, (_, i) => ({
    packet_id: `inc-${i}`,
    session_id: session,
    rtu_sent_at: new Date(base + 3000 + i * 1000).toISOString()
  })),
  ...Array.from({ length: 128 }, (_, i) => ({
    packet_id: `cmp-${i}`,
    session_id: session,
    rtu_sent_at: new Date(base + (Math.floor(i / 10) + 1) * 10000 + 200).toISOString()
  }))
];
const partUp = calculateUplink(partialSensors, partialReports, w, now);
assert.equal(partUp.valid, false, 'Full-window valid must remain false when buckets are incomplete');
assert.ok(partUp.partial && partUp.partial.valid === true, 'Partial metric must calculate over complete 10s buckets');
assert.equal(partUp.partial.complete_buckets, 13);
assert.equal(partUp.partial.expected_buckets, 30);
assert.equal(partUp.partial.sent, 130);
assert.equal(partUp.partial.received, 128);
assert.equal(partUp.partial.lost, 2);
assert.equal(Number(partUp.partial.pdr.toFixed(2)), Number((128 / 130 * 100).toFixed(2)));

// 3. Zero complete reports -> BOTH full and partial remain invalid (never fabricate 100% or 0%)
const emptyUp = calculateUplink(partialSensors, [], w, now);
assert.equal(emptyUp.valid, false);
assert.equal(emptyUp.partial, null);

// 4. Downlink recognizes ACK_OK / ACK_REJECTED even if rtu_command_received_at is null, while TIMEOUT stays unconfirmed
const cmds = [
  { packet_id: 'c1', backend_command_sent_at: new Date(base + 1000).toISOString(), rtu_command_received_at: new Date(base + 1100).toISOString(), outcome: 'ACK_OK' },
  { packet_id: 'c2', backend_command_sent_at: new Date(base + 2000).toISOString(), rtu_command_received_at: null, outcome: 'ACK_OK' },
  { packet_id: 'c3', backend_command_sent_at: new Date(base + 3000).toISOString(), rtu_command_received_at: null, outcome: 'ACK_REJECTED' },
  { packet_id: 'c4', backend_command_sent_at: new Date(base + 4000).toISOString(), rtu_command_received_at: null, outcome: 'TIMEOUT_OR_ERROR' }
];
const down = calculateDownlink(cmds, [], w, now);
assert.equal(down.valid, true);
assert.equal(down.sent, 4);
assert.equal(down.received, 3);
assert.equal(down.lost, 1);
assert.equal(down.pdr, 75);
assert.equal(down.plr, 25);

// 5. Route /metrics always calculates BOTH uplink and downlink even when direction=RTU_TO_MTU
const routeHandlers = new Map();
const fakeRouter = {
  use() {},
  get(p, ...cbs) { routeHandlers.set('GET ' + p, cbs.at(-1)); },
  post(p, ...cbs) { routeHandlers.set('POST ' + p, cbs.at(-1)); }
};
const fakeDb = {
  from(table) {
    let eventFilter = null;
    const builder = {
      select() { return this; },
      eq(col, val) { if (col === 'event_type') eventFilter = val; return this; },
      gte() { return this; },
      lt() { return this; },
      order() { return this; },
      async range() {
        if (table === 'communication_sender_windows') return { data: partialReports, error: null };
        if (eventFilter === 'sensor') return { data: partialSensors.map(s => ({ ...s, event_type: 'sensor' })), error: null };
        if (eventFilter === 'command') return { data: cmds.map(c => ({ ...c, event_type: 'command' })), error: null };
        return { data: [], error: null };
      }
    };
    return builder;
  }
};
const origLoad = Module._load;
let commRoute;
Module._load = function(name, ...args) {
  if (name === 'express') return { Router: () => fakeRouter };
  if (name === '../config/database') return fakeDb;
  if (name === '../middleware/auth') return (_req, _res, next) => next();
  if (name === '../middleware/rtu-access') return { authorizedOperator: (_req, _res, next) => next() };
  return origLoad.call(this, name, ...args);
};
try {
  delete require.cache[require.resolve('../routes/communication')];
  commRoute = require('../routes/communication');
} finally {
  Module._load = origLoad;
}

(async () => {
  const metricsHandler = routeHandlers.get('GET /:id/metrics');
  assert.ok(metricsHandler, '/:id/metrics route exists');
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(payload) { this.body = payload; return this; }
  };
  await metricsHandler({
    params: { id: 'RTU-01' },
    query: { from: '2026-11-19T14:21', to: '2026-11-19T14:26', direction: 'RTU_TO_MTU' }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.metrics.uplink && res.body.metrics.uplink.partial.valid === true, 'Uplink partial metrics calculated');
  assert.ok(res.body.metrics.downlink && res.body.metrics.downlink.valid === true, 'Downlink still calculated when direction=RTU_TO_MTU');
  assert.equal(res.body.metrics.downlink.pdr, 75);

  // 6. Excel workbook generation with partial uplink + full downlink succeeds & satisfies formula whitelist
  const tabs = commRoute._buildTabs(
    [...partialSensors.map(s => ({ ...s, event_type: 'sensor' })), ...cmds.map(c => ({ ...c, event_type: 'command' }))],
    'RTU-01', w, { uplink: partUp, downlink: down }
  );
  const xlsxBuf = makeWorkbook(tabs);
  assert.equal(xlsxBuf.readUInt32LE(0), 0x04034b50);
  assert.ok(xlsxBuf.includes(Buffer.from('xl/workbook.xml')));

  // 7. Static checks on frontend default window margin and simulator timestamp alignment
  const scriptSrc = fs.readFileSync(path.join(__dirname, '../public/script.js'), 'utf8');
  assert.ok(scriptSrc.includes('Date.now()-60000'), 'Frontend default commTo uses 60s safety margin');
  assert.ok(scriptSrc.includes('m?.partial?.valid===true'), 'Frontend renders partial complete-bucket metrics');
  const simSrc = fs.readFileSync(path.join(__dirname, '../simulasi.js'), 'utf8');
  assert.ok(simSrc.includes('const packet=sensorPayload(now);'), 'Simulator aligns rtu_sent_at with bucket timestamp');

  console.log('✅ PASS V1.7.2: strict & partial complete-bucket PDR/PLR, downlink ACK, dual-card /metrics, XLSX export, 60s default window, simulator bucket sync');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
