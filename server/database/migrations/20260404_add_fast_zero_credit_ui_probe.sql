ALTER TABLE accounts ADD COLUMN fast_zero_credit_ui_status TEXT DEFAULT 'unknown';
ALTER TABLE accounts ADD COLUMN fast_zero_credit_ui_credits INTEGER;
ALTER TABLE accounts ADD COLUMN fast_zero_credit_ui_reason TEXT;
ALTER TABLE accounts ADD COLUMN fast_zero_credit_ui_checked_at DATETIME;
