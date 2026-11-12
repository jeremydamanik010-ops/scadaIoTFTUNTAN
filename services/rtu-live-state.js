// Local, short-lived cache of RTU state verified through the MQTT status topic.
// Offline operator mode preference remains stored in Supabase (rtu_mode_preferences).
const FRESH_MS = 45000;
const {validateSetpoints} = require('./setpoint-policy');
const states = new Map();
let brokerConnection = 'unknown';

function brokerConnected() {
  brokerConnection = 'connected';
  states.clear(); // Require a new device status after reconnect; never trust an old one.
}
function brokerDisconnected() {
  brokerConnection = 'disconnected';
  states.clear();
}
function acceptStatus(rtuId, payload) {
  const status = String(payload?.status || '').toLowerCase();
  const mode = payload?.mode;
  if (!['online', 'offline'].includes(status) || !['Manual', 'Otomatis'].includes(mode)) {
    throw new Error('Status/mode RTU tidak valid');
  }
  const last_seen = new Date().toISOString();
  const state = { status, mode: status === 'online' ? mode : null,
    last_seen, is_online: status === 'online',
    temperature_setpoint: null, volume_setpoint: null,
    process_phase: payload.process_phase ?? null,
    transfer_remaining_seconds: Number.isFinite(payload.transfer_remaining_seconds) ? payload.transfer_remaining_seconds : null };
  // Older firmware may not report setpoints. Treat those as unknown, not defaults.
  if (status === 'online' && payload.temperature_setpoint !== undefined && payload.volume_setpoint !== undefined) {
    const targets = validateSetpoints({
      temperature_setpoint: payload.temperature_setpoint,
      volume_setpoint: payload.volume_setpoint
    });
    Object.assign(state, targets);
  }
  states.set(rtuId, { state, at: Date.now() });
  return state;
}
function readLiveStatus(rtuId) {
  if (brokerConnection === 'unknown') return null; // Unit-test/backward compatible DB fallback.
  const row = states.get(rtuId);
  if (!row || Date.now() - row.at > FRESH_MS || brokerConnection === 'disconnected') {
    return { status: 'offline', mode: null, last_seen: row?.state.last_seen || null, is_online: false };
  }
  return { ...row.state };
}
module.exports = { brokerConnected, brokerDisconnected, acceptStatus, readLiveStatus };
