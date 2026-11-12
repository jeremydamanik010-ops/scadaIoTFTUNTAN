const assert=require('node:assert/strict');
const {validateSetpoints,DEFAULTS}=require('../services/setpoint-policy');
const {computeAutomatic,PHASE}=require('../services/process-control');
assert.deepEqual(validateSetpoints({temperature_setpoint:31.5,volume_setpoint:75}),
  {temperature_setpoint:31.5,volume_setpoint:75});
assert.throws(()=>validateSetpoints({temperature_setpoint:99,volume_setpoint:70}));
let s={mode:'Otomatis',tankVolume:35,suhu:24,destinationVolume:0,
  processPhase:PHASE.FILL,valve1Status:'OFF',valve2Status:'OFF',heaterStatus:'OFF'};
s=computeAutomatic(s,DEFAULTS,0);
assert.equal(s.valve1Status,'ON');
assert.equal(s.valve2Status,'OFF');
s=computeAutomatic({...s,tankVolume:80},DEFAULTS,0);
assert.equal(s.heaterStatus,'ON');
s=computeAutomatic({...s,suhu:30},DEFAULTS,0);
assert.equal(s.valve2Status,'ON');
assert.equal(s.heaterStatus,'OFF');
console.log('PASS: V1.4 setpoint validation retained; V1.5 valve control replaces pump');
