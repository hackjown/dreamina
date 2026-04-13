-- 为 accounts 表增加权益和状态持久化字段
ALTER TABLE accounts ADD COLUMN benefit_eligibility TEXT DEFAULT 'unknown';
ALTER TABLE accounts ADD COLUMN benefit_label TEXT DEFAULT '待检测';
ALTER TABLE accounts ADD COLUMN benefit_reason TEXT;
ALTER TABLE accounts ADD COLUMN benefit_evidence TEXT;
ALTER TABLE accounts ADD COLUMN usage_status TEXT DEFAULT 'unknown';
ALTER TABLE accounts ADD COLUMN usage_status_label TEXT DEFAULT '待确认';
ALTER TABLE accounts ADD COLUMN credit_synced_at DATETIME;
ALTER TABLE accounts ADD COLUMN credit_source TEXT DEFAULT 'cached';
ALTER TABLE accounts ADD COLUMN sync_error TEXT;
