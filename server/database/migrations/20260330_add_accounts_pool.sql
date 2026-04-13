-- 账号池表
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT,
    session_id TEXT,
    credits INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active', -- active, inactive, out_of_credits, banned
    provider TEXT DEFAULT 'dreamina',
    last_used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引以加快查找可用账号的速度
CREATE INDEX IF NOT EXISTS idx_accounts_status_credits ON accounts(status, credits);
