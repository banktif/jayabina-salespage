-- Remove the DB http-extension Bayarcash proxy.
-- Reason: superseded by the Supabase Edge Function (functions/bayarcash),
-- which keeps the Bayarcash PAT as an encrypted secret instead of hardcoded
-- inside this migration (the previous approach leaked the token into git).
DROP FUNCTION IF EXISTS create_bayarcash_payment(UUID, INTEGER, TEXT, TEXT, TEXT);

-- Ensure columns used by the payment callback exist (idempotent).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS bayarcash_ref TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS bayarcash_transaction_id TEXT;

NOTIFY pgrst, 'reload schema';
