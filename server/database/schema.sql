-- Seedance 2.0 批量管理功能数据库 Schema

-- ============================================
-- 用户认证模块表结构（参考 genai-craft）
-- ============================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  credits INTEGER DEFAULT 10, -- 初始赠送 10 积分
  daily_check_in INTEGER DEFAULT 0, -- 是否已签到
  last_check_in_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 会话表
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 签到记录表
CREATE TABLE IF NOT EXISTS check_ins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  credits_earned INTEGER DEFAULT 2,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 邮箱验证码表（增强版，支持防刷和多种用途）
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  purpose TEXT DEFAULT 'register' CHECK (purpose IN ('register', 'login', 'reset_password', 'bind_email')),
  code_hash TEXT NOT NULL, -- 加密存储验证码
  salt TEXT NOT NULL,
  attempts INTEGER DEFAULT 0, -- 验证尝试次数
  request_ip TEXT, -- 请求 IP（用于防刷）
  consumed_at DATETIME, -- 已使用/已消费时间
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 系统配置表（用于存储 SMTP 等配置）
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email ON email_verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires_at ON email_verification_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_purpose ON email_verification_codes(purpose, email);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email ON email_verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires_at ON email_verification_codes(expires_at);


-- 插入默认管理员账户 (密码：admin123456)
INSERT OR IGNORE INTO users (username, email, password_hash, role, status, credits)
VALUES ('admin', 'admin@seedance.com', '9e5f160f7992eda2696de915f2f8f90bb3c372555bf686a1f0363ea5df9511ff', 'admin', 'active', 1000);

-- ============================================
-- 原有业务表结构
-- ============================================

-- 项目表
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, -- 所属用户 ID
  name TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  settings_json TEXT -- 项目级设置（模型、比例、时长等）
);

-- 任务表
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, -- 所属用户 ID
  project_id INTEGER NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  task_kind TEXT NOT NULL DEFAULT 'output' CHECK (task_kind IN ('draft', 'output')),
  source_task_id INTEGER,
  row_group_id TEXT,
  row_index INTEGER,
  video_count INTEGER NOT NULL DEFAULT 1,
  output_index INTEGER,
  status TEXT DEFAULT 'pending', -- pending, generating, done, error, cancelled
  submit_id TEXT,
  history_id TEXT, -- 即梦 history_record_id
  item_id TEXT,
  media_type TEXT DEFAULT 'video', -- video, image
  model_id TEXT,
  provider_id TEXT,
  video_url TEXT,
  video_path TEXT, -- 本地保存路径
  download_status TEXT DEFAULT 'pending', -- pending, downloading, done, failed
  download_path TEXT, -- 下载完成路径
  downloaded_at DATETIME, -- 下载完成时间
  submitted_at DATETIME,
  account_info TEXT, -- 账号信息
  progress TEXT, -- 生成进度
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (source_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- 任务素材表
CREATE TABLE IF NOT EXISTS task_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  asset_type TEXT NOT NULL, -- image, audio
  file_path TEXT NOT NULL,
  image_uri TEXT, -- 上传到 ImageX 后的 URI
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- 生成历史表
CREATE TABLE IF NOT EXISTS generation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  batch_id TEXT, -- 批次 ID
  request_data TEXT, -- 请求参数
  response_data TEXT, -- 响应结果
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- 用户的即梦 SessionID 账号表
CREATE TABLE IF NOT EXISTS jimeng_session_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT DEFAULT '',
  session_id TEXT NOT NULL,
  email TEXT DEFAULT '',
  password TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, session_id)
);

-- 全局设置表
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


-- 定时任务表
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  project_id INTEGER,
  task_ids TEXT, -- JSON 数组，存储任务 ID 列表
  cron_expression TEXT NOT NULL, -- cron 表达式
  enabled INTEGER DEFAULT 1, -- 1=启用，0=禁用
  last_run_at DATETIME,
  next_run_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- 批量任务表
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  project_id INTEGER NOT NULL,
  task_ids TEXT NOT NULL, -- JSON 数组，存储任务 ID 列表
  status TEXT DEFAULT 'pending', -- pending, running, done, error, cancelled
  total_count INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  cancelled_count INTEGER DEFAULT 0,
  concurrent_count INTEGER DEFAULT 5, -- 并发数
  min_interval INTEGER DEFAULT 30000, -- 最小间隔 (ms)
  max_interval INTEGER DEFAULT 50000, -- 最大间隔 (ms)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_download_status ON tasks(download_status);
CREATE INDEX IF NOT EXISTS idx_tasks_status_download ON tasks(status, download_status);
CREATE INDEX IF NOT EXISTS idx_tasks_task_kind ON tasks(task_kind);
CREATE INDEX IF NOT EXISTS idx_tasks_source_task_id ON tasks(source_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_row_group_id ON tasks(row_group_id);
CREATE INDEX IF NOT EXISTS idx_tasks_row_index ON tasks(row_index);
CREATE INDEX IF NOT EXISTS idx_tasks_history_id ON tasks(history_id);
CREATE INDEX IF NOT EXISTS idx_tasks_item_id ON tasks(item_id);
CREATE INDEX IF NOT EXISTS idx_tasks_submit_id ON tasks(submit_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_kind_row ON tasks(project_id, task_kind, row_index);
CREATE INDEX IF NOT EXISTS idx_tasks_source_output_index ON tasks(source_task_id, output_index);
CREATE INDEX IF NOT EXISTS idx_task_assets_task_id ON task_assets(task_id);
CREATE INDEX IF NOT EXISTS idx_generation_history_task_id ON generation_history(task_id);
CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);
CREATE INDEX IF NOT EXISTS idx_batches_project_id ON batches(project_id);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
CREATE INDEX IF NOT EXISTS idx_jimeng_session_accounts_user_id ON jimeng_session_accounts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jimeng_session_accounts_default_per_user
  ON jimeng_session_accounts(user_id)
  WHERE is_default = 1;

  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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

-- 创建索引以加快查找可用账号的速度
CREATE INDEX IF NOT EXISTS idx_accounts_status_credits ON accounts(status, credits);

-- 初始化默认设置
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('provider', 'dreamina'),
  ('model', 'seedance-2.0-fast'),
  ('ratio', '16:9'),
  ('duration', '5'),
  ('reference_mode', '全能参考'),
  ('download_path', ''),
  ('max_concurrent', '5'),
  ('min_interval', '30000'),
  ('max_interval', '50000'),
  ('manual_video_url', ''),
  ('session_id', ''),
  ('gpt_browserbase_api_key', ''),
  ('gpt_browserbase_project_id', ''),
  ('gpt_ddg_token', ''),
  ('gpt_cli_proxy_url', ''),
  ('gpt_cli_proxy_token', ''),
  ('gpt_mail_inbox_url', '');
