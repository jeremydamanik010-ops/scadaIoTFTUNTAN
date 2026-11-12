// Regression tests for flexible setpoint input, simulated temperature & tank guards.
const assert = require('node:assert/strict');
const policy = require('../services/setpoint-policy');
const {computeAutomatic,applyPhysics,PHASE,TRANSFER_MS} = require('../services/process-control');

assert.deepEqual(policy.validateSetpoints({temperature_setpoint:65.5, volume_setpoint:97.5}), {
  temperature_setpoint:65.5, volume_setpoint:97.5
});
for (const good of [0,30,38.1,55,75,90]) {
  assert.equal(policy.validateSetpoints({temperature_setpoint:good,volume_setpoint:80}).temperature_setpoint,good);
}
for (const volume of [15,20,95,97.5,98]) {
  assert.equal(policy.validateSetpoints({temperature_setpoint:40,volume_setpoint:volume}).volume_setpoint,volume);
}
for (const input of [
  {temperature_setpoint:-1,volume_setpoint:80},
  {temperature_setpoint:91,volume_setpoint:80},
  {temperature_setpoint:40,volume_setpoint:14},
  {temperature_setpoint:40,volume_setpoint:99},
  {temperature_setpoint:Infinity,volume_setpoint:80},
  {temperature_setpoint:'60',volume_setpoint:80}
]) assert.throws(() => policy.validateSetpoints(input),/Batas suhu/);

// A newly-entered high target must actually be achievable in the simulator,
// not silently blocked by the old 40°C safety ceiling.
const targets = policy.validateSetpoints({temperature_setpoint:70,volume_setpoint:80});
let s = {
  mode:'Otomatis',processPhase:PHASE.HEAT,tankVolume:80,suhu:35,destinationVolume:10,
  valve1Status:'OFF',valve2Status:'OFF',heaterStatus:'OFF',
  transferStartedAt:null,transferRemainingSeconds:0,transferFlowRate:0
};
let time=0;
let started=false;
for (let i=0;i<120;i++) {
  s=computeAutomatic(s,targets,time);
  assert.ok(!(s.valve1Status==='ON'&&s.valve2Status==='ON'),'Valves never open simultaneously');
  if (s.processPhase===PHASE.TRANSFER) { started=true; break; }
  s=applyPhysics(s,1,1);
  time+=1000;
}
assert.ok(started,'70°C setpoint must lead to TRANSFER phase');
assert.ok(s.suhu>=70,'Temperature has reached operator target');
assert.ok(s.suhu<policy.HARD_TEMPERATURE_LIMIT,'Safety cut-off remains independent');
const startedAt=s.transferStartedAt;
s=computeAutomatic({...s,tankVolume:70},targets,startedAt+30_000);
assert.equal(s.processPhase,PHASE.TRANSFER);
assert.equal(s.valve1Status,'OFF','Filling must not interrupt 60s transfer');
assert.equal(s.valve2Status,'ON');
s=computeAutomatic(s,targets,startedAt+TRANSFER_MS);
assert.equal(s.valve2Status,'OFF','Transfer closes at 60s');

// Inlet must never exceed the physically guarded tank capacity.
let filling={...s,processPhase:PHASE.FILL, tankVolume:97.5, suhu:40,
  valve1Status:'ON',valve2Status:'OFF',heaterStatus:'OFF'};
filling=applyPhysics(filling,2,1);
assert.ok(filling.tankVolume<=policy.MAX_SAFE_VOLUME);
assert.ok(filling.valve1Status==='OFF','Inlet cuts out at tank upper guard');
// Browser inputs and chart scales must match the new API contract.
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname,'../public/dashboard.html'),'utf8');
const js = fs.readFileSync(path.join(__dirname,'../public/script.js'),'utf8');
assert.match(html,/id="temperatureSetpoint"[^>]*min="0" max="90"/);
assert.match(html,/id="volumeSetpoint"[^>]*min="15" max="98"/);
assert.ok(js.includes('t < 0 || t > 90') && js.includes('v < 15 || v > 98'));
assert.ok(js.includes('suggestedMax: 40') && !js.includes('max: 40,\n\n          ticks'),
  'Temperature axis should grow above 40 °C');
console.log('PASS: flexible setpoints, high-temperature heat control, 60s transfer, safety limits');
