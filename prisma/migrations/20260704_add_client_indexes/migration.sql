-- Add indexes on Client phone and email for duplicate-detection queries
-- Used by public-lead and meta-leads webhooks (findFirst with OR on phone/email)

CREATE INDEX IF NOT EXISTS "clients_phone_idx" ON "clients" ("phone");
CREATE INDEX IF NOT EXISTS "clients_email_idx" ON "clients" ("email");