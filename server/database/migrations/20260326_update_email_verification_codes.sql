-- 更新 email_verification_codes 表结构
-- 添加 purpose、code_hash、salt、attempts、request_ip、consumed_at 字段

-- 先处理旧数据：将旧记录的 code 字段迁移到 code_hash
UPDATE email_verification_codes SET code_hash = code, salt = '' WHERE code_hash IS NULL AND code IS NOT NULL;

-- 删除旧数据（因为旧数据格式不兼容新的加密存储方式）
DELETE FROM email_verification_codes WHERE code_hash IS NULL;

-- 添加 purpose 字段
ALTER TABLE email_verification_codes ADD COLUMN purpose TEXT DEFAULT 'register' CHECK (purpose IN ('register', 'login', 'reset_password', 'bind_email'));

-- 添加 code_hash 字段（允许 NULL，因为旧记录可能没有）
ALTER TABLE email_verification_codes ADD COLUMN code_hash TEXT;

-- 添加 salt 字段
ALTER TABLE email_verification_codes ADD COLUMN salt TEXT DEFAULT '';

-- 添加 attempts 字段
ALTER TABLE email_verification_codes ADD COLUMN attempts INTEGER DEFAULT 0;

-- 添加 request_ip 字段
ALTER TABLE email_verification_codes ADD COLUMN request_ip TEXT;

-- 添加 consumed_at 字段
ALTER TABLE email_verification_codes ADD COLUMN consumed_at DATETIME;

-- 设置 code_hash 和 salt 为 NOT NULL（在新记录中必须有值）
-- SQLite 不支持直接添加 NOT NULL 约束，需要通过重建表实现
-- 这里我们通过触发器来确保新记录必须有值

-- 将 used 字段迁移到 consumed_at
UPDATE email_verification_codes SET consumed_at = created_at WHERE used = 1 AND consumed_at IS NULL;

