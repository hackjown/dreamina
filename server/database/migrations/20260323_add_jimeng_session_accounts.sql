CREATE TABLE IF NOT EXISTS jimeng_session_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT DEFAULT '',
  session_id TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_jimeng_session_accounts_user_id
  ON jimeng_session_accounts(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jimeng_session_accounts_default_per_user
  ON jimeng_session_accounts(user_id)
  WHERE is_default = 1;
