// RTU-01: source -> Valve 1 -> main tank (heater) -> Valve 2 -> destination.
// This is a state machine for the SIMULATOR, not a certified hardware safety controller.
const { MIN_SAFE_VOLUME, HARD_TEMPERATURE_LIMIT, MAX_SAFE_VOLUME } = require('./setpoint-policy');

const TRANSFER_MS = 60_000;
// Keep both valves OFF for one control cycle after closing Valve 2.
// Real ESP32 firmware must use physical valve-closed feedback where available.
const VALVE_SWITCH_DELAY_MS = 1_000;
const MIN_DRAIN_RESERVE = 5;
const DESTINATION_MAX = 98;
const PHASE = Object.freeze({
  FILL: 'MENGISI', HEAT: 'MEMANASKAN', TRANSFER: 'MEMINDAHKAN',
  TRANSFER_HOLD: 'TRANSFER_TERHENTI', SETTLING: 'JEDA_VALVE',
  WAIT: 'PENAMPUNGAN_PENUH', MANUAL: 'MANUAL'
});

function outputsOff(s, overrides = {}) {
  return { ...s, valve1Status: 'OFF', valve2Status: 'OFF', heaterStatus: 'OFF', ...overrides };
}

function computeAutomatic(state, targets, now = Date.now()) {
  let s = { ...state };
  const v = s.tankVolume;
  const t = s.suhu;
  const dest = s.destinationVolume;
  if (![v,t,dest].every(Number.isFinite)) {
    return outputsOff(s, { processPhase: 'SENSOR_ERROR', transferRemainingSeconds: 0 });
  }

  // Lock the entire transfer window, even though main-tank volume falls below
  // setpoint as soon as water starts flowing out. Never refill concurrently.
  // If a safety interlock trips, close Valve 2 immediately but continue waiting
  // until the original 60-second window ends; do not refill while draining.
  if (s.processPhase === PHASE.TRANSFER || s.processPhase === PHASE.TRANSFER_HOLD) {
    const started = Number.isFinite(s.transferStartedAt) ? s.transferStartedAt : now;
    const remainingMs = started + TRANSFER_MS - now;
    if (remainingMs > 0) {
      const remaining = Math.ceil(remainingMs / 1000);
      const safetyTrip = v <= MIN_DRAIN_RESERVE || dest >= DESTINATION_MAX;
      if (s.processPhase === PHASE.TRANSFER_HOLD || safetyTrip) {
        return outputsOff(s, {
          processPhase: PHASE.TRANSFER_HOLD,
          transferStartedAt: started,
          transferRemainingSeconds: remaining,
          transferSafetyTripped: true
        });
      }
      return {
        ...s, processPhase: PHASE.TRANSFER, transferStartedAt: started,
        valve1Status: 'OFF', valve2Status: 'ON', heaterStatus: 'OFF',
        transferRemainingSeconds: remaining
      };
    }

    // Exactly at/after 60s, close Valve 2 FIRST. No valve overlap.
    return outputsOff(s, {
      processPhase: PHASE.SETTLING,
      transferStartedAt: null,
      transferRemainingSeconds: 0,
      transferFlowRate: 0,
      transferSafetyTripped: false,
      switchReadyAt: now + VALVE_SWITCH_DELAY_MS
    });
  }

  if (s.processPhase === PHASE.SETTLING) {
    if (!Number.isFinite(s.switchReadyAt) || now < s.switchReadyAt) {
      return outputsOff(s, {processPhase: PHASE.SETTLING, transferRemainingSeconds: 0});
    }
    // The outlet is now closed. Only on a later control cycle may refill begin.
    s = outputsOff(s, {processPhase: PHASE.FILL, switchReadyAt: null});
  }

  if (v < targets.volume_setpoint - 0.05) {
    return {
      ...s, processPhase: PHASE.FILL,
      valve1Status: v < MAX_SAFE_VOLUME ? 'ON' : 'OFF',
      valve2Status: 'OFF', heaterStatus: 'OFF', transferRemainingSeconds: 0
    };
  }
  if (t < targets.temperature_setpoint) {
    const safe = v >= MIN_SAFE_VOLUME && t < HARD_TEMPERATURE_LIMIT;
    return {
      ...s, processPhase: PHASE.HEAT,
      valve1Status: 'OFF', valve2Status: 'OFF',
      heaterStatus: safe ? 'ON' : 'OFF', transferRemainingSeconds: 0
    };
  }
  if (dest >= DESTINATION_MAX) {
    return outputsOff(s, { processPhase: PHASE.WAIT, transferRemainingSeconds: 0 });
  }

  // Transfer will run for 60 real seconds under normal conditions.
  // The rate uses available source water/destination space and has a 20%
  // safety margin so normal simulation won't dry the source or fill the
  // destination before the one-minute timer expires.
  const safeCapacity = Math.min(v - MIN_DRAIN_RESERVE, DESTINATION_MAX - dest);
  if (safeCapacity < 1) {
    return outputsOff(s, {processPhase: PHASE.WAIT, transferRemainingSeconds: 0});
  }
  return {
    ...s, processPhase: PHASE.TRANSFER, transferStartedAt: now,
    transferFlowRate: safeCapacity * 0.8 / (TRANSFER_MS / 1000),
    transferSafetyTripped: false, switchReadyAt: null,
    valve1Status: 'OFF', valve2Status: 'ON', heaterStatus: 'OFF',
    transferRemainingSeconds: 60
  };
}

function applyPhysics(state, seconds, speedFactor = 1) {
  const s = { ...state };
  const realDt = Math.max(0, Math.min(seconds,5));
  const dt = realDt * Math.max(.1, Math.min(speedFactor,10));
  // Simulated downstream consumption empties the destination BETWEEN transfers.
  if (s.valve2Status !== 'ON') s.destinationVolume = Math.max(0,s.destinationVolume-1.5*dt);
  if (s.valve1Status === 'ON') {
    const incoming = Math.max(0, Math.min(MAX_SAFE_VOLUME-s.tankVolume,1.65*dt));
    const newVolume = s.tankVolume+incoming;
    s.suhu = newVolume > 0 ? (s.suhu*s.tankVolume+22*incoming)/newVolume : s.suhu;
    s.tankVolume = newVolume;
  }
  if (s.valve2Status === 'ON') {
    // Transfer timer AND flow are based on real elapsed seconds. Faster test
    // simulation must not drain the main tank before the 60s window ends.
    const nominal = s.mode === 'Otomatis' ? s.transferFlowRate || .5 : .65;
    const outgoing = Math.min(
      Math.max(0,s.tankVolume-MIN_DRAIN_RESERVE),
      Math.max(0,DESTINATION_MAX-s.destinationVolume),
      Math.max(0,nominal)*realDt
    );
    s.tankVolume -= outgoing;
    s.destinationVolume += outgoing;
    s.suhu -= 0.055*realDt;
  }
  if (s.heaterStatus === 'ON' && s.tankVolume >= MIN_SAFE_VOLUME && s.suhu < HARD_TEMPERATURE_LIMIT) {
    s.suhu += 0.65*dt;
  } else {
    s.suhu += (22-s.suhu)*0.0015*dt;
  }
  s.tankVolume=Math.max(0,Math.min(100,s.tankVolume));
  s.destinationVolume=Math.max(0,Math.min(100,s.destinationVolume));
  s.suhu=Math.max(0,Math.min(HARD_TEMPERATURE_LIMIT,s.suhu));
  // Independent safety interlocks: never open inlet and outlet together.
  if (s.tankVolume >= MAX_SAFE_VOLUME || s.valve2Status === 'ON') s.valve1Status='OFF';
  if (s.tankVolume <= MIN_DRAIN_RESERVE || s.destinationVolume >= DESTINATION_MAX || s.valve1Status === 'ON') s.valve2Status='OFF';
  if (s.tankVolume < MIN_SAFE_VOLUME || s.suhu >= HARD_TEMPERATURE_LIMIT || s.valve2Status === 'ON') s.heaterStatus='OFF';
  return s;
}

module.exports = {
  computeAutomatic, applyPhysics, TRANSFER_MS, VALVE_SWITCH_DELAY_MS,
  PHASE, MIN_DRAIN_RESERVE, DESTINATION_MAX
};
