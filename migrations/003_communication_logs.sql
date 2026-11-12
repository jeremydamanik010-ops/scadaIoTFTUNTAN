-- SCADA IoT V1.6 — komunikasi sensor + perintah, tanpa mengubah tabel lama.
-- Jalankan sekali di Supabase SQL Editor menggunakan akun admin.
CREATE TABLE IF NOT EXISTS public.communication_logs (
  packet_id text PRIMARY KEY,
  rtu_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('RTU_TO_MTU','MTU_TO_RTU')),
  event_type text NOT NULL CHECK (event_type IN ('sensor','command')),
  created_at timestamptz NOT NULL DEFAULT now(),
  clock_quality text NOT NULL DEFAULT 'unverified',
  rtu_sent_at timestamptz,
  backend_received_at timestamptz,
  browser_received_at timestamptz,
  browser_reported_at timestamptz,
  browser_user_id uuid,
  delay_rtu_backend_est_ms double precision,
  delay_rtu_browser_est_ms double precision,
  sensor_payload jsonb,
  command_device text,
  command_payload jsonb,
  user_id uuid,
  mtu_sent_at timestamptz,
  backend_request_received_at timestamptz,
  backend_command_sent_at timestamptz,
  rtu_command_received_at timestamptz,
  rtu_ack_sent_at timestamptz,
  backend_ack_received_at timestamptz,
  backend_rtt_ms double precision,
  delay_mtu_rtu_est_ms double precision,
  delay_backend_rtu_est_ms double precision,
  outcome text,
  error_message text
);
CREATE INDEX IF NOT EXISTS communication_logs_rtu_created_idx
  ON public.communication_logs (rtu_id, created_at, packet_id);
CREATE INDEX IF NOT EXISTS communication_logs_direction_created_idx
  ON public.communication_logs (direction, created_at);
ALTER TABLE public.communication_logs ENABLE ROW LEVEL SECURITY;
-- Tidak buat policy akses langsung. Hanya backend service-role (server) yang boleh membaca/menulis.
-- Pastikan SUPABASE_SERVICE_ROLE_KEY hanya di .env backend, tidak di browser.
NOTIFY pgrst, 'reload schema';
