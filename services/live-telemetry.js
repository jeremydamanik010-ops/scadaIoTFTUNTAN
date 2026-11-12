// Event fanout from validated MQTT frames to connected dashboard clients.
// Stream is only opened through the authenticated /api/sensor/stream route.
const listeners = new Set();
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function publish(event) {
  for (const listener of listeners) {
    try { listener(event); } catch (err) {
      console.warn('SCADA live stream listener error:', err.message);
    }
  }
}
module.exports = { subscribe, publish };
