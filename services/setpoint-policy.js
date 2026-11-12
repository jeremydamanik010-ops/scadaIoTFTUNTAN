// Setpoint API contract shared by Node.js backend and simulator.
// Independent upper targets; hysteresis prevents chattering.
// Hardware must enforce independent safe limits irrespective of setpoint.
const DEFAULTS = Object.freeze({ temperature_setpoint: 30, volume_setpoint: 80 });
// Operator may choose targets across the operating range, not just 20–38 °C.
// Keep process targets BELOW independent simulator safety interlocks.
// Hardware ESP32 must use its own independently verified safety limits.
const MIN_SAFE_VOLUME = 15; // no heating below this level
const MAX_SAFE_VOLUME = 98; // prevent overflow above this level
const HARD_TEMPERATURE_LIMIT = 95; // SIMULATOR-only emergency cut-off
const TEMP_MIN = 0, TEMP_MAX = 90;
const VOLUME_MIN = MIN_SAFE_VOLUME, VOLUME_MAX = MAX_SAFE_VOLUME;
const TEMP_HYSTERESIS = 1;   // Celsius
const VOLUME_HYSTERESIS = 5; // percentage points

function validateSetpoints(input) {
  const t = input?.temperature_setpoint;
  const v = input?.volume_setpoint;
  if (typeof t !== 'number' || !Number.isFinite(t) ||
      typeof v !== 'number' || !Number.isFinite(v) ||
      t < TEMP_MIN || t > TEMP_MAX || v < VOLUME_MIN || v > VOLUME_MAX) {
    const err = new Error(`Batas suhu harus ${TEMP_MIN}–${TEMP_MAX} °C dan batas volume ${VOLUME_MIN}–${VOLUME_MAX}% (angka).`);
    err.statusCode = 400;
    throw err;
  }
  return { temperature_setpoint: Number(t.toFixed(1)), volume_setpoint: Number(v.toFixed(1)) };
}

// Auto valve + heater sequencing is implemented in process-control.js.
module.exports = {DEFAULTS,validateSetpoints,
  TEMP_MIN,TEMP_MAX,VOLUME_MIN,VOLUME_MAX,TEMP_HYSTERESIS,VOLUME_HYSTERESIS,
  HARD_TEMPERATURE_LIMIT,MIN_SAFE_VOLUME,MAX_SAFE_VOLUME};
