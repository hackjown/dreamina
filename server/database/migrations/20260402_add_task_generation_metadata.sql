ALTER TABLE tasks ADD COLUMN media_type TEXT DEFAULT 'video';
ALTER TABLE tasks ADD COLUMN model_id TEXT;
ALTER TABLE tasks ADD COLUMN provider_id TEXT;

UPDATE tasks
SET media_type = CASE
  WHEN LOWER(COALESCE(video_path, '')) LIKE '%.png'
    OR LOWER(COALESCE(video_path, '')) LIKE '%.jpg'
    OR LOWER(COALESCE(video_path, '')) LIKE '%.jpeg'
    OR LOWER(COALESCE(video_path, '')) LIKE '%.webp'
    OR LOWER(COALESCE(video_path, '')) LIKE '%.gif'
    OR LOWER(COALESCE(video_path, '')) LIKE '%.bmp'
    OR LOWER(COALESCE(video_url, '')) LIKE '%.png%'
    OR LOWER(COALESCE(video_url, '')) LIKE '%.jpg%'
    OR LOWER(COALESCE(video_url, '')) LIKE '%.jpeg%'
    OR LOWER(COALESCE(video_url, '')) LIKE '%.webp%'
    OR LOWER(COALESCE(video_url, '')) LIKE '%.gif%'
    OR LOWER(COALESCE(video_url, '')) LIKE '%.bmp%'
    OR LOWER(COALESCE(video_url, '')) LIKE '%format=.png%'
    OR LOWER(COALESCE(video_url, '')) LIKE '%format=.jpg%'
    OR LOWER(COALESCE(video_url, '')) LIKE '%format=.jpeg%'
    OR LOWER(COALESCE(video_url, '')) LIKE '%format=.webp%'
    OR LOWER(COALESCE(video_url, '')) LIKE '%/aigc_draft/generate%'
  THEN 'image'
  ELSE 'video'
END
WHERE media_type IS NULL OR media_type = '';

UPDATE tasks
SET provider_id = COALESCE(NULLIF(provider_id, ''), 'dreamina')
WHERE provider_id IS NULL OR provider_id = '';

UPDATE settings
SET value = 'seedance-2.0-fast'
WHERE key = 'model' AND value = 'dreamina-seedance-1.0-mini';

UPDATE settings
SET value = 'seedance-2.0'
WHERE key = 'model' AND value = 'dreamina-seedance-1.5-pro';
