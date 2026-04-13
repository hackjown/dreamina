WITH normalized AS (
  SELECT
    id,
    CASE
      WHEN username IS NULL OR trim(username) = '' THEN printf('user_%s', id)
      ELSE trim(username)
    END AS normalized_username
  FROM users
),
ranked AS (
  SELECT
    id,
    normalized_username,
    ROW_NUMBER() OVER (PARTITION BY normalized_username ORDER BY id) AS rn
  FROM normalized
)
UPDATE users
SET username = (
  SELECT CASE
    WHEN rn = 1 THEN normalized_username
    ELSE normalized_username || '_' || id
  END
  FROM ranked
  WHERE ranked.id = users.id
)
WHERE id IN (SELECT id FROM ranked);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username);
