-- 添加系统配置表（用于 SMTP 等配置）
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 插入默认 SMTP 配置（为空，需要管理员配置）
INSERT OR IGNORE INTO system_config (key, value, description) VALUES
  ('smtp_host', '', 'SMTP 服务器地址'),
  ('smtp_port', '', 'SMTP 端口号'),
  ('smtp_secure', '', '是否启用 SSL（true/false）'),
  ('smtp_user', '', 'SMTP 用户名'),
  ('smtp_pass', '', 'SMTP 密码/授权码'),
  ('smtp_from', '', '发件人邮箱'),
  ('smtp_from_name', '', '发件人名称'),
  ('smtp_tls_reject_unauthorized', '', 'TLS 证书校验（true/false）');
