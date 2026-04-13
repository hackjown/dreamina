ALTER TABLE tasks ADD COLUMN task_kind TEXT NOT NULL DEFAULT 'output' CHECK (task_kind IN ('draft', 'output'));
ALTER TABLE tasks ADD COLUMN source_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN row_group_id TEXT;
ALTER TABLE tasks ADD COLUMN row_index INTEGER;
ALTER TABLE tasks ADD COLUMN video_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN output_index INTEGER;
ALTER TABLE tasks ADD COLUMN submit_id TEXT;
ALTER TABLE tasks ADD COLUMN item_id TEXT;
ALTER TABLE tasks ADD COLUMN submitted_at DATETIME;

UPDATE tasks SET task_kind = 'output' WHERE task_kind IS NULL;
UPDATE tasks SET video_count = 1 WHERE video_count IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_task_kind ON tasks(task_kind);
CREATE INDEX IF NOT EXISTS idx_tasks_source_task_id ON tasks(source_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_row_group_id ON tasks(row_group_id);
CREATE INDEX IF NOT EXISTS idx_tasks_row_index ON tasks(row_index);
CREATE INDEX IF NOT EXISTS idx_tasks_history_id ON tasks(history_id);
CREATE INDEX IF NOT EXISTS idx_tasks_item_id ON tasks(item_id);
CREATE INDEX IF NOT EXISTS idx_tasks_submit_id ON tasks(submit_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_kind_row ON tasks(project_id, task_kind, row_index);
CREATE INDEX IF NOT EXISTS idx_tasks_source_output_index ON tasks(source_task_id, output_index);
