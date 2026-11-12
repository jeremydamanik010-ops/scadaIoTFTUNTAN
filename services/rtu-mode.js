// One RTU, two distinct states: operator preference versus reported hardware mode.
// Database calls are made by the backend with service-role access only.
const db = require('../config/database');
const {readLiveStatus} = require('./rtu-live-state');
const MODES = new Set(['Manual', 'Otomatis']);
const FRESH_MS = 45000;

async function readActualState(rtuId) {
  const live = readLiveStatus(rtuId);
  if (live) return live; // MQTT state is fresher than a database snapshot.
  const { data, error } = await db.from('rtu_status_log')
    .select('status,mode,changed_at').eq('rtu_id', rtuId)
    .order('changed_at', {ascending:false}).limit(1).maybeSingle();
  if (error) throw error;
  const seen = Date.parse(data?.changed_at || '');
  const age = Date.now() - seen;
  const fresh = Number.isFinite(seen) && age >= -5000 && age <= FRESH_MS;
  const isOnline = fresh && String(data?.status || 'online').toLowerCase() === 'online';
  return {
    status: isOnline ? 'online' : 'offline',
    mode: isOnline && MODES.has(data?.mode) ? data.mode : null,
    last_seen: data?.changed_at ?? null,
    is_online: isOnline
  };
}

async function readDesiredMode(rtuId) {
  const { data, error } = await db.from('rtu_mode_preferences')
    .select('desired_mode,updated_at').eq('rtu_id', rtuId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function saveDesiredMode(rtuId, desiredMode) {
  if (!MODES.has(desiredMode)) throw new Error('Mode tidak valid');
  const row = { rtu_id: rtuId, desired_mode: desiredMode, updated_at: new Date().toISOString() };
  const { error } = await db.from('rtu_mode_preferences').upsert(row, {onConflict:'rtu_id'});
  if (error) throw error;
  return row;
}

function combineState(actual, saved) {
  const desired = saved?.desired_mode ?? null;
  return { ...actual, desired_mode: desired, desired_updated_at: saved?.updated_at ?? null,
    mode_pending: !!desired && (!actual.is_online || actual.mode !== desired) };
}
module.exports = {readActualState, readDesiredMode, saveDesiredMode, combineState};
