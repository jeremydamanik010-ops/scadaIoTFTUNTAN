-- Run once in Supabase SQL Editor for IMTS-V1.
-- Stores operator-selected mode separately from RTU telemetry/actual mode.
create table if not exists public.rtu_mode_preferences (
  rtu_id text primary key,
  desired_mode text not null check (desired_mode in ('Manual', 'Otomatis')),
  updated_at timestamptz not null default now()
);
-- Browser/anon clients have no policies; only backend service-role has access.
alter table public.rtu_mode_preferences enable row level security;
