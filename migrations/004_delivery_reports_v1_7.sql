-- SCADA IoT V1.7 — telemetry sequence + independent RTU send reports.
-- Run AFTER migrations/003_communication_logs.sql. Non-destructive.
ALTER TABLE public.communication_logs
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS packet_seq bigint,
  ADD COLUMN IF NOT EXISTS validation_status text DEFAULT 'VALID';
CREATE INDEX IF NOT EXISTS communication_logs_sent_time_idx
  ON public.communication_logs (rtu_id,event_type,rtu_sent_at);
CREATE INDEX IF NOT EXISTS communication_logs_command_time_idx
  ON public.communication_logs (rtu_id,event_type,backend_command_sent_at);

CREATE TABLE IF NOT EXISTS public.communication_sender_windows (
  rtu_id text NOT NULL,
  session_id text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  sensor_sent_count integer NOT NULL CHECK(sensor_sent_count BETWEEN 0 AND 100000),
  bucket_complete boolean NOT NULL DEFAULT false,
  command_received_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  command_received_times jsonb NOT NULL DEFAULT '{}'::jsonb,
  clock_quality text NOT NULL DEFAULT 'unverified',
  reported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rtu_id, session_id, window_start),
  CHECK(window_end > window_start),
  CHECK(jsonb_typeof(command_received_ids) = 'array')
);
ALTER TABLE public.communication_sender_windows
  ADD COLUMN IF NOT EXISTS command_received_times jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS communication_sender_windows_lookup_idx
  ON public.communication_sender_windows (rtu_id, window_start);
ALTER TABLE public.communication_sender_windows ENABLE ROW LEVEL SECURITY;
-- Same V1.6 policy: service-role backend only; no direct browser writes.
NOTIFY pgrst, 'reload schema';
