const assert = require('node:assert/strict');
const {
  computeAutomatic, applyPhysics, TRANSFER_MS,
  VALVE_SWITCH_DELAY_MS, PHASE
} = require('../services/process-control');

const targets = {volume_setpoint:80, temperature_setpoint:30};
const base = {
  tankVolume:80,suhu:31,destinationVolume:10,
  valve1Status:'OFF',valve2Status:'OFF',heaterStatus:'OFF',
  mode:'Otomatis',processPhase:PHASE.HEAT,
  transferStartedAt:null,transferRemainingSeconds:0,transferFlowRate:0
};

// A full real minute of outlet operation. Main-tank volume is below target
// almost immediately, yet inlet must stay OFF until the outlet is CLOSED.
for (const speedFactor of [1,3,10]) {
  let s = computeAutomatic(base, targets, 0);
  assert.equal(s.processPhase,PHASE.TRANSFER);
  assert.equal(s.valve2Status,'ON');
  assert.equal(s.valve1Status,'OFF');
  for (let second=1;second<60;second++) {
    s=applyPhysics(s,1,speedFactor);
    s=computeAutomatic(s,targets,second*1000);
    assert.equal(s.valve2Status,'ON',`Valve 2 must remain ON at t=${second}s, speed=${speedFactor}`);
    assert.equal(s.valve1Status,'OFF',`Valve 1 must remain OFF at t=${second}s, speed=${speedFactor}`);
    assert.ok(s.tankVolume<targets.volume_setpoint,'Tank drains during transfer');
  }
  s=computeAutomatic(s,targets,TRANSFER_MS);
  assert.equal(s.processPhase,PHASE.SETTLING);
  assert.equal(s.valve2Status,'OFF','Valve 2 closed at t=60s');
  assert.equal(s.valve1Status,'OFF','Do not energize Valve 1 on same tick as closing Valve 2');
  s=computeAutomatic(s,targets,TRANSFER_MS+VALVE_SWITCH_DELAY_MS-1);
  assert.equal(s.valve1Status,'OFF','Valve 1 stays OFF during closing delay');
  s=computeAutomatic(s,targets,TRANSFER_MS+VALVE_SWITCH_DELAY_MS);
  assert.equal(s.processPhase,PHASE.FILL);
  assert.equal(s.valve1Status,'ON','Valve 1 may refill only after close-delay');
  assert.equal(s.valve2Status,'OFF');
}

// Changing targets during transfer must not interrupt or reset it.
let state=computeAutomatic(base,targets,1000);
state=applyPhysics(state,5);
state=computeAutomatic(state,{temperature_setpoint:20,volume_setpoint:95},8000);
assert.equal(state.processPhase,PHASE.TRANSFER);
assert.equal(state.transferStartedAt,1000);
assert.equal(state.valve1Status,'OFF');
assert.equal(state.valve2Status,'ON');

// Unsafe destination: close valve immediately, but never start filling
// before the locked minute has expired.
let early=computeAutomatic(base,targets,0);
early.destinationVolume=98;
early=computeAutomatic(early,targets,1000);
assert.equal(early.processPhase,PHASE.TRANSFER_HOLD);
assert.equal(early.valve2Status,'OFF');
assert.equal(early.valve1Status,'OFF');
early.destinationVolume=2; // Other downstream process frees up the tank.
early.tankVolume=40;
early=computeAutomatic(early,targets,10_000);
assert.equal(early.processPhase,PHASE.TRANSFER_HOLD,'Safety closure stays latched');
assert.equal(early.valve1Status,'OFF');
assert.equal(early.valve2Status,'OFF');
early=computeAutomatic(early,targets,TRANSFER_MS);
assert.equal(early.processPhase,PHASE.SETTLING);
assert.equal(early.valve1Status,'OFF');
early=computeAutomatic(early,targets,TRANSFER_MS+VALVE_SWITCH_DELAY_MS);
assert.equal(early.valve1Status,'ON');

// Inlet and outlet must never overlap over complete recurring cycles.
let continuous = {...base,tankVolume:45,suhu:25,destinationVolume:5,processPhase:PHASE.FILL};
for (let i=0;i<400;i++) {
  continuous=computeAutomatic(continuous,targets,i*1000);
  assert.ok(!(continuous.valve1Status==='ON'&&continuous.valve2Status==='ON'),`Both valves ON at tick ${i}`);
  continuous=applyPhysics(continuous,1);
  assert.ok(!(continuous.valve1Status==='ON'&&continuous.valve2Status==='ON'),`Both valves ON after physics at tick ${i}`);
}
console.log('PASS: valve2 60s, no dual-valve overlap, 1s closing delay, speed factors, setpoint changes, safety hold');
