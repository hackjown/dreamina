-- GPT 账号表
CREATE TABLE IF NOT EXISTS gpt_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  account_id TEXT,
  status TEXT DEFAULT 'active', -- active, invalid
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- GPT 注册任务表
CREATE TABLE IF NOT EXISTS gpt_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  total_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', -- pending, running, completed, partially_completed, failed
  logs TEXT, -- 存储运行日志
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 添加 GPT 相关设置
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('gpt_browserbase_api_key', ''),
  ('gpt_browserbase_project_id', ''),
  ('gpt_ddg_token', ''),
  ('gpt_cli_proxy_url', ''),
  ('gpt_cli_proxy_token', ''),
  ('gpt_mail_inbox_url', '');
