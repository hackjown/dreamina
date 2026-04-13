ALTER TABLE accounts ADD COLUMN fast_zero_credit_probe_status TEXT DEFAULT 'unknown';
ALTER TABLE accounts ADD COLUMN fast_zero_credit_probe_model TEXT;
ALTER TABLE accounts ADD COLUMN fast_zero_credit_probe_reason TEXT;
ALTER TABLE accounts ADD COLUMN fast_zero_credit_probe_checked_at DATETIME;
