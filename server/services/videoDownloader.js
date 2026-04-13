import fs from 'fs';
import path from 'path';
import { getDatabase } from '../database/index.js';

/**
 * 媒体下载服务
 * 负责将生成的图片/视频保存到本地
 */

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'];

function isImageExtension(extension) {
  return IMAGE_EXTENSIONS.includes(String(extension || '').toLowerCase());
}

function isVideoExtension(extension) {
  return VIDEO_EXTENSIONS.includes(String(extension || '').toLowerCase());
}

function matchesAnySuffix(value, suffixes) {
  const normalized = String(value || '').toLowerCase();
  return suffixes.some((suffix) => normalized.includes(suffix));
}

/**
 * 规范化文件名
 */
function sanitizeFilename(filename) {
  const sanitized = String(filename || '')
    .replace(/[<>:"/\\|？*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 100);

  return sanitized || 'task';
}

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function getContentTypeExtension(contentType) {
  const normalized = String(contentType || '').toLowerCase();

  if (!normalized) return null;
  if (normalized.includes('image/png')) return '.png';
  if (normalized.includes('image/jpeg') || normalized.includes('image/jpg')) return '.jpg';
  if (normalized.includes('image/webp')) return '.webp';
  if (normalized.includes('image/gif')) return '.gif';
  if (normalized.includes('image/bmp')) return '.bmp';
  if (normalized.includes('video/mp4')) return '.mp4';
  if (normalized.includes('video/webm')) return '.webm';
  if (normalized.includes('video/quicktime')) return '.mov';
  if (normalized.includes('video/x-matroska')) return '.mkv';

  return null;
}

function getUrlExtension(mediaUrl) {
  const rawUrl = String(mediaUrl || '');
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);
    const pathnameExt = path.extname(parsed.pathname || '').toLowerCase();
    if ([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].includes(pathnameExt)) {
      return pathnameExt;
    }

    const format = (parsed.searchParams.get('format') || '').toLowerCase();
    if (format && [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].includes(format)) {
      return format;
    }

    const mimeType = (parsed.searchParams.get('mime_type') || '').toLowerCase();
    if (mimeType.includes('video_mp4')) return '.mp4';
    if (mimeType.includes('video_webm')) return '.webm';
    if (mimeType.includes('image_png')) return '.png';
    if (mimeType.includes('image_jpeg') || mimeType.includes('image_jpg')) return '.jpg';
    if (mimeType.includes('image_webp')) return '.webp';
  } catch {
    const lowerUrl = rawUrl.toLowerCase();
    const matchedExtension = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].find((ext) => lowerUrl.includes(ext));
    if (matchedExtension) {
      return matchedExtension;
    }
  }

  return null;
}

function inferMediaTypeFromUrlOrPath(value) {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return null;

  if (
    matchesAnySuffix(normalized, IMAGE_EXTENSIONS) ||
    normalized.includes('/aigc_draft/generate') ||
    normalized.includes('format=.png') ||
    normalized.includes('format=.jpg') ||
    normalized.includes('format=.jpeg') ||
    normalized.includes('format=.webp')
  ) {
    return 'image';
  }

  if (
    matchesAnySuffix(normalized, VIDEO_EXTENSIONS) ||
    normalized.includes('mime_type=video_') ||
    normalized.includes('/video/')
  ) {
    return 'video';
  }

  return null;
}

function getTaskMediaType(task) {
  return (
    (task?.media_type ? String(task.media_type).toLowerCase() : null) ||
    inferMediaTypeFromUrlOrPath(task?.video_url) ||
    inferMediaTypeFromUrlOrPath(task?.video_path) ||
    'video'
  );
}

function resolveMediaExtension({ contentType, mediaUrl, mediaType }) {
  return (
    getContentTypeExtension(contentType) ||
    getUrlExtension(mediaUrl) ||
    (mediaType === 'image' ? '.png' : '.mp4')
  );
}

function buildTaskBaseFilename(task, taskId) {
  const promptPreview = task.prompt ? sanitizeFilename(task.prompt.substring(0, 30)) : '';
  return `${sanitizeFilename(task.project_name || 'project')}_task${taskId}${promptPreview ? `_${promptPreview}` : ''}`;
}

/**
 * 下载媒体到本地
 * @param {string} videoUrl - 媒体 URL
 * @param {string} savePath - 保存路径（目录）
 * @param {string} filename - 文件名（不含扩展名）
 * @param {{ mediaType?: 'image' | 'video' }} options
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
export async function downloadVideo(videoUrl, savePath, filename, options = {}) {
  try {
    // 确保保存目录存在
    const targetDir = ensureDir(savePath);

    // 下载媒体
    const response = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`下载失败：HTTP ${response.status}`);
    }

    // 根据真实内容类型/URL 推断扩展名，避免图片被保存成 mp4
    const contentType = response.headers.get('content-type');
    const mediaType = options.mediaType || 'video';
    const extension = resolveMediaExtension({ contentType, mediaUrl: videoUrl, mediaType });
    const safeFilename = sanitizeFilename(filename);
    const filepath = path.join(targetDir, `${safeFilename}${extension}`);

    // 创建写入流
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filepath, buffer);

    // 验证文件
    const stats = fs.statSync(filepath);
    if (stats.size === 0) {
      fs.unlinkSync(filepath);
      throw new Error('下载的文件为空');
    }

    console.log(
      `[download] ${mediaType === 'image' ? '图片' : '视频'}已保存：${filepath} (${(stats.size / 1024 / 1024).toFixed(2)}MB, content-type=${contentType || 'unknown'})`
    );

    return {
      success: true,
      path: filepath,
      size: stats.size,
    };
  } catch (error) {
    console.error('[download] 下载失败:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

function getTaskWithProject(taskId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT t.*, p.name as project_name
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.id = ?
  `).get(taskId);
}

function buildTaskMediaFilename(task, taskId, extension = null) {
  const baseName = buildTaskBaseFilename(task, taskId);
  const mediaType = getTaskMediaType(task);
  const pathExtension = getUrlExtension(task?.video_path);
  const urlExtension = getUrlExtension(task?.video_url);
  const inferredExtension =
    mediaType === 'image'
      ? (isImageExtension(pathExtension) ? pathExtension : (isImageExtension(urlExtension) ? urlExtension : '.png'))
      : (isVideoExtension(pathExtension) ? pathExtension : (isVideoExtension(urlExtension) ? urlExtension : '.mp4'));
  const finalExtension = extension || inferredExtension;
  return `${baseName}${finalExtension}`;
}

function repairDownloadedFilePathIfNeeded(task, taskId) {
  const storedPath = task?.video_path;
  if (!storedPath || !fs.existsSync(storedPath)) {
    return task;
  }

  const storedFilename = path.basename(storedPath);
  const taskMediaType = getTaskMediaType(task);
  const storedExtension = path.extname(storedFilename || '').toLowerCase();
  const storedType = isImageExtension(storedExtension) ? 'image' : (isVideoExtension(storedExtension) ? 'video' : null);

  if (storedType === taskMediaType) {
    return task;
  }

  const correctedFilename = buildTaskMediaFilename(task, taskId);
  const correctedPath = path.join(path.dirname(storedPath), correctedFilename);

  if (correctedPath === storedPath) {
    return {
      ...task,
      video_path: correctedPath,
      download_path: task.download_path === storedPath ? correctedPath : task.download_path,
    };
  }

  try {
    if (!fs.existsSync(correctedPath)) {
      fs.renameSync(storedPath, correctedPath);
    }

    const db = getDatabase();
    db.prepare(`
      UPDATE tasks
      SET video_path = ?, download_path = CASE WHEN download_path = ? THEN ? ELSE download_path END
      WHERE id = ?
    `).run(correctedPath, storedPath, correctedPath, taskId);

    return {
      ...task,
      video_path: correctedPath,
      download_path: task.download_path === storedPath ? correctedPath : task.download_path,
    };
  } catch (error) {
    console.warn(`[download] 修正文件扩展名失败(task=${taskId}): ${error.message}`);
    return task;
  }
}

/**
 * 根据任务 ID 下载媒体
 * @param {number} taskId - 任务 ID
 * @param {string} baseDownloadPath - 基础下载路径
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
export async function downloadVideoByTaskId(taskId, baseDownloadPath) {
  try {
    const db = getDatabase();
    const task = getTaskWithProject(taskId);

    if (!task) {
      return { success: false, error: '任务不存在' };
    }

    if (!task.video_url) {
      return { success: false, error: '任务尚未生成完成，暂时无法下载' };
    }

    const mediaType = getTaskMediaType(task);

    // 构建保存路径：baseDownloadPath/project_name/
    const projectDir = path.join(baseDownloadPath, sanitizeFilename(task.project_name || `project_${task.project_id}`));
    const filename = buildTaskBaseFilename(task, taskId);

    // 下载媒体
    const result = await downloadVideo(task.video_url, projectDir, filename, { mediaType });

    if (result.success) {
      // 更新任务的 video_path
      db.prepare(`UPDATE tasks SET video_path = ? WHERE id = ?`).run(result.path, taskId);
    }

    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 获取已下载媒体文件信息
 * @param {number} taskId - 任务 ID
 * @returns {{success: boolean, filePath?: string, filename?: string, task?: any, error?: string}}
 */
export function getDownloadedVideoFileByTaskId(taskId) {
  try {
    let task = getTaskWithProject(taskId);

    if (!task) {
      return { success: false, error: '任务不存在' };
    }

    if (!task.video_path) {
      return { success: false, error: '任务尚未下载到服务器' };
    }

    if (!fs.existsSync(task.video_path)) {
      return { success: false, error: '文件不存在，可能已被删除' };
    }

    task = repairDownloadedFilePathIfNeeded(task, taskId);

    return {
      success: true,
      task,
      filePath: task.video_path,
      filename: (() => {
        const storedFilename = path.basename(task.video_path);
        const taskMediaType = getTaskMediaType(task);
        const storedExtension = path.extname(storedFilename || '').toLowerCase();
        const storedType = isImageExtension(storedExtension) ? 'image' : (isVideoExtension(storedExtension) ? 'video' : null);

        if (storedFilename && storedType === taskMediaType) {
          return storedFilename;
        }

        return buildTaskMediaFilename(task, taskId);
      })(),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 打开视频所在文件夹
 * @param {string} videoPath - 视频文件路径
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function openVideoFolder(videoPath) {
  try {
    const { exec } = await import('child_process');
    const dirPath = path.dirname(videoPath);

    // 检查目录是否存在
    if (!fs.existsSync(dirPath)) {
      throw new Error('目录不存在');
    }

    // 根据平台打开文件夹
    const platform = process.platform;

    return new Promise((resolve, reject) => {
      let command;

      if (platform === 'win32') {
        command = `explorer "${dirPath}"`;
      } else if (platform === 'darwin') {
        command = `open "${dirPath}"`;
      } else {
        // Linux (包括 WSL)
        command = `xdg-open "${dirPath}"`;
      }

      exec(command, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve({ success: true });
        }
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 获取下载路径设置
 */
export function getDefaultDownloadPath() {
  const db = getDatabase();
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'download_path'`).get();

  if (row && row.value) {
    return row.value;
  }

  // 默认下载到用户目录下的 Videos/Seedance 文件夹
  const homedir = process.platform === 'win32'
    ? process.env.USERPROFILE
    : process.env.HOME;

  return path.join(homedir, 'Videos', 'Seedance');
}

/**
 * 批量下载视频
 */
export async function batchDownloadVideos(taskIds, baseDownloadPath) {
  const results = [];

  for (const taskId of taskIds) {
    const result = await downloadVideoByTaskId(taskId, baseDownloadPath);
    results.push({ taskId, ...result });
  }

  return results;
}

/**
 * 获取下载任务列表
 * @param {Object} options - 查询选项
 * @param {string} options.status - 下载状态筛选
 * @param {string} options.type - 类型筛选
 * @param {number} options.page - 页码（从 1 开始）
 * @param {number} options.pageSize - 每页数量
 * @param {number|null} options.userId - 用户 ID，用于过滤（非管理员只能查看自己的任务）
 * @param {boolean} options.isAdmin - 是否管理员，true 时忽略 userId 过滤
 * @returns {Object} { tasks, total, page, pageSize }
 */
export function getDownloadTasks(options = {}) {
  const db = getDatabase();
  const {
    status = 'all',
    type = 'all',
    page = 1,
    pageSize = 20,
    userId = null,
    isAdmin = false,
  } = options;

  const inferredModelTypeCase = `
    CASE
      WHEN LOWER(COALESCE(t.video_path, '')) LIKE '%.png'
        OR LOWER(COALESCE(t.video_path, '')) LIKE '%.jpg'
        OR LOWER(COALESCE(t.video_path, '')) LIKE '%.jpeg'
        OR LOWER(COALESCE(t.video_path, '')) LIKE '%.webp'
        OR LOWER(COALESCE(t.video_path, '')) LIKE '%.gif'
        OR LOWER(COALESCE(t.video_path, '')) LIKE '%.bmp'
        OR LOWER(COALESCE(t.video_url, '')) LIKE '%.png%'
        OR LOWER(COALESCE(t.video_url, '')) LIKE '%.jpg%'
        OR LOWER(COALESCE(t.video_url, '')) LIKE '%.jpeg%'
        OR LOWER(COALESCE(t.video_url, '')) LIKE '%.webp%'
        OR LOWER(COALESCE(t.video_url, '')) LIKE '%.gif%'
        OR LOWER(COALESCE(t.video_url, '')) LIKE '%.bmp%'
        OR LOWER(COALESCE(t.video_url, '')) LIKE '%format=.png%'
        OR LOWER(COALESCE(t.video_url, '')) LIKE '%format=.jpg%'
        OR LOWER(COALESCE(t.video_url, '')) LIKE '%format=.jpeg%'
        OR LOWER(COALESCE(t.video_url, '')) LIKE '%format=.webp%'
        OR LOWER(COALESCE(t.video_url, '')) LIKE '%/aigc_draft/generate%'
      THEN 'image'
      ELSE 'video'
    END
  `;
  const modelTypeCase = `COALESCE(NULLIF(LOWER(COALESCE(t.media_type, '')), ''), ${inferredModelTypeCase})`;

  const whereClauses = ["t.task_kind = 'output'"];
  const params = [];

  // 非管理员用户只能查看自己的任务
  if (!isAdmin && userId !== null) {
    whereClauses.push('t.user_id = ?');
    params.push(userId);
  }

  if (status !== 'all') {
    if (status === 'generating') {
      whereClauses.push("(t.status = 'generating' OR (t.history_id IS NOT NULL AND t.video_url IS NULL AND t.status != 'cancelled'))");
    } else if (status === 'pending') {
      whereClauses.push("(t.video_url IS NOT NULL AND (t.download_status IS NULL OR t.download_status = 'pending'))");
    } else {
      whereClauses.push('t.download_status = ?');
      params.push(status);
    }
  }

  if (type !== 'all') {
    if (type !== 'video' && type !== 'image') {
      return { tasks: [], total: 0, page, pageSize };
    }
    whereClauses.push(`${modelTypeCase} = ?`);
    params.push(type);
  }

  const whereClause = `WHERE ${whereClauses.join(' AND ')}`;
  const countStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM tasks t
    ${whereClause}
  `);
  const { count: total } = countStmt.get(...params);

  const offset = (page - 1) * pageSize;
  const query = `
    SELECT
      t.id,
      t.prompt,
      t.status,
      t.download_status,
      t.video_url,
      t.video_path,
      t.download_path,
      t.downloaded_at,
      t.account_info,
      t.history_id,
      t.item_id,
      t.submit_id,
      t.source_task_id,
      t.output_index,
      t.created_at,
      t.completed_at,
      p.name as project_name,
      ${modelTypeCase} as model_type,
      CASE
        WHEN t.status = 'generating' OR (t.history_id IS NOT NULL AND t.video_url IS NULL AND t.status != 'cancelled') THEN 'generating'
        WHEN t.status = 'done' AND t.video_url IS NOT NULL AND (t.download_status IS NULL OR t.download_status = 'pending') THEN 'pending'
        WHEN t.download_status = 'downloading' THEN 'downloading'
        WHEN t.download_status = 'done' THEN 'done'
        WHEN t.download_status = 'failed' THEN 'failed'
        ELSE 'failed'
      END as effective_download_status
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const stmt = db.prepare(query);
  const tasks = stmt.all(...params, pageSize, offset);

  return {
    tasks: tasks.map((task) => ({
      ...task,
      hasHistory: !!task.history_id,
    })),
    total,
    page,
    pageSize,
  };
}

/**
 * 更新下载状态
 */
export function updateDownloadStatus(taskId, status, extraData = {}) {
  try {
    const db = getDatabase();
    const updates = ['download_status = ?'];
    const values = [status];

    if (status === 'done' && extraData.downloadPath) {
      updates.push('download_path = ?');
      values.push(extraData.downloadPath);
    }
    if (status === 'done') {
      updates.push('downloaded_at = CURRENT_TIMESTAMP');
    }
    if (extraData.error) {
      updates.push('error_message = ?');
      values.push(extraData.error);
    }

    values.push(taskId);

    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export default {
  downloadVideo,
  downloadVideoByTaskId,
  getDownloadedVideoFileByTaskId,
  openVideoFolder,
  getDefaultDownloadPath,
  batchDownloadVideos,
  getDownloadTasks,
  updateDownloadStatus,
};
