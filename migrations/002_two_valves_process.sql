-- V1.5: additive migration, safe for existing sensor history and the old pump_status.
-- Run once in Supabase SQL Editor BEFORE installing V1.5 server code.
ALTER TABLE public.sensor_data
  ADD COLUMN IF NOT EXISTS valve1_status text,
  ADD COLUMN IF NOT EXISTS valve2_status text,
  ADD COLUMN IF NOT EXISTS destination_volume double precision,
  ADD COLUMN IF NOT EXISTS process_phase text,
  ADD COLUMN IF NOT EXISTS transfer_remaining_seconds integer;
-- Backfill Valve 1 from old pump status only for legacy history.
UPDATE public.sensor_data SET valve1_status=pump_status
 WHERE valve1_status IS NULL AND pump_status IN ('ON','OFF');
-- Old rows have unknown valve 2; do not pretend it was OFF.
-- Keep pump_status for backward compatibility with any existing NOT NULL schema.
