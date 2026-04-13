ALTER TABLE users ADD COLUMN username TEXT;

UPDATE users
SET username = CASE
  WHEN instr(email, '@') > 1 THEN substr(email, 1, instr(email, '@') - 1)
  ELSE printf('user_%s', id)
END
WHERE username IS NULL OR trim(username) = '';

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
