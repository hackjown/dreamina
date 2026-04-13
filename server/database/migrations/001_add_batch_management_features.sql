-- 迁移 001: 批量管理功能增强
-- 日期：2026-03-24
-- 说明：添加项目管理、任务编辑、视频自动保存等字段

-- 1. 项目表新增视频保存路径字段
ALTER TABLE projects ADD COLUMN video_save_path TEXT;

-- 2. 任务表新增音频相关字段
ALTER TABLE tasks ADD COLUMN audio_path TEXT;
ALTER TABLE tasks ADD COLUMN audio_uri TEXT;

-- 3. 任务表新增批次关联字段
ALTER TABLE tasks ADD COLUMN batch_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_tasks_batch_id ON tasks(batch_id);

-- 4. 任务表新增发送次数（支持多次生成）
ALTER TABLE tasks ADD COLUMN send_count INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN last_sent_at DATETIME;

-- 5. 批量任务表新增定时相关字段
ALTER TABLE batches ADD COLUMN scheduled_at DATETIME;
ALTER TABLE batches ADD COLUMN is_scheduled INTEGER DEFAULT 0;

-- 6. 批量任务表新增当前并发和队列长度（运行时状态）
ALTER TABLE batches ADD COLUMN current_running INTEGER DEFAULT 0;
ALTER TABLE batches ADD COLUMN queue_length INTEGER DEFAULT 0;

-- 7. 项目表新增默认并发设置
ALTER TABLE projects ADD COLUMN default_concurrent INTEGER DEFAULT 5;
ALTER TABLE projects ADD COLUMN default_min_interval INTEGER DEFAULT 30000;
ALTER TABLE projects ADD COLUMN default_max_interval INTEGER DEFAULT 50000;

-- 8. 创建项目 - 视频保存目录关联表（可选，用于多目录管理）
CREATE TABLE IF NOT EXISTS project_video_paths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  save_path TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_video_paths_project_id ON project_video_paths(project_id);
