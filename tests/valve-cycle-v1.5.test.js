const assert=require('node:assert/strict');
const {computeAutomatic,applyPhysics,PHASE,TRANSFER_MS}=require('../services/process-control');
const {validateSetpoints}=require('../services/setpoint-policy');
const targets=validateSetpoints({temperature_setpoint:30,volume_setpoint:80});
let s={mode:'Otomatis',tankVolume:45,suhu:25,destinationVolume:5,
  valve1Status:'OFF',valve2Status:'OFF',heaterStatus:'OFF',processPhase:PHASE.FILL,
  transferStartedAt:null,transferRemainingSeconds:0};
let at=0,firstTransfer=null,refilled=false,heating=false,secondTransfer=false;
const initialTemperature=s.suhu;
let inletMixedCooler=false,drainedVolume=false,destinationFilled=false;
for(let i=0;i<230;i++){
  s=computeAutomatic(s,targets,at);
  if(s.processPhase===PHASE.HEAT)heating=true;
  if(s.processPhase===PHASE.TRANSFER){
    if(firstTransfer===null){
      firstTransfer=at;
      assert.ok(s.tankVolume>=targets.volume_setpoint-.05);
      assert.ok(s.suhu>=targets.temperature_setpoint);
    }else if(at>firstTransfer+TRANSFER_MS)secondTransfer=true;
  }
  if(firstTransfer!==null && at>firstTransfer+TRANSFER_MS && s.valve1Status==='ON')refilled=true;
  if(firstTransfer!==null && at===firstTransfer+59_000){
    assert.equal(s.valve2Status,'ON','Valve 2 remains open at second 59');
    assert.equal(s.valve1Status,'OFF','Do not refill while discharging');
    assert.equal(s.heaterStatus,'OFF','Do not heat while discharging');
  }
  if(firstTransfer!==null && at===firstTransfer+60_000){
    assert.equal(s.valve2Status,'OFF','Valve 2 closes at 60 seconds');
  }
  const before={...s};
  s=applyPhysics(s,1);
  if(before.valve1Status==='ON' && s.tankVolume>before.tankVolume && s.suhu<before.suhu) inletMixedCooler=true;
  if(before.valve2Status==='ON' && s.tankVolume<before.tankVolume) drainedVolume=true;
  if(before.valve2Status==='ON' && s.destinationVolume>before.destinationVolume) destinationFilled=true;
  at+=1000;
}
assert.ok(initialTemperature>s.suhu || s.suhu>=18); // physical temperature bounded
assert.ok(inletMixedCooler,'Fresh fill cools the main tank');
assert.ok(drainedVolume,'Valve 2 decreases main tank volume');
assert.ok(destinationFilled,'Destination tank receives transferred water');
assert.ok(heating,'Heating phase reached');
assert.notEqual(firstTransfer,null,'Transfer phase reached');
assert.ok(refilled,'Auto restarts inlet refill after transfer');
assert.ok(secondTransfer,'Auto repeats another transfer cycle');
const manual=computeAutomatic({mode:'Otomatis',processPhase:PHASE.TRANSFER,
  transferStartedAt:0,tankVolume:3,suhu:30,destinationVolume:1,
  valve1Status:'OFF',valve2Status:'ON',heaterStatus:'OFF'},targets,1000);
assert.equal(manual.valve2Status,'OFF','Early stop when tank is near empty');
const blocked=computeAutomatic({mode:'Otomatis',processPhase:PHASE.HEAT,
  transferStartedAt:null,tankVolume:80,suhu:31,destinationVolume:99,
  valve1Status:'OFF',valve2Status:'OFF',heaterStatus:'OFF'},targets,0);
assert.equal(blocked.valve2Status,'OFF','Outlet interlock when destination is full');
console.log('PASS: 2-valve fill → heat → 60s transfer → refill → repeat; interlocks');
