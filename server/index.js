import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import browserService from './browser-service.js';
import { initDatabase, getDatabase, closeDatabase } from './database/index.js';
import * as projectService from './services/projectService.js';
import * as taskService from './services/taskService.js';
import * as settingsService from './services/settingsService.js';
import * as batchService from './services/batchScheduler.js';
import * as videoDownloader from './services/videoDownloader.js';
import { getGenerationProvider, getModelCategory, isImageModel, DREAMINA_PROVIDER_ID, LEGACY_JIMENG_PROVIDER_ID } from './services/generationProviders.js';
import { jimengRequest as providerJimengRequest } from './services/videoGenerator.js';
import * as authService from './services/authService.js';
import * as jimengSessionService from './services/jimengSessionService.js';
import accountService from './services/account-service.js';
import registrationService from './services/registration-service.js';
import gptService from './services/gptService.js';
import apiKeyService from './services/apiKeyService.js';
import { readFileSync } from 'fs';

// 初始化数据库
initDatabase();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const DEFAULT_SESSION_ID = process.env.VITE_DEFAULT_SESSION_ID || '';

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  if (
    req.path.startsWith('/api/settings/session-accounts') ||
    req.path === '/api/auth/me' ||
    req.path === '/api/settings' ||
    req.path === '/api/projects'
  ) {
    const start = Date.now();
    res.on('finish', () => {
      console.log(
        `[http] ${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms) origin=${req.headers.origin || '-'} x-session=${req.headers['x-session-id'] ? 'present' : 'missing'}`
      );
    });
  }
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ============================================================
// 常量定义
// ============================================================
const JIMENG_BASE_URL = 'https://jimeng.jianying.com';
const DEFAULT_ASSISTANT_ID = 513641;
const VERSION_CODE = '8.4.0';
const PLATFORM_CODE = '7';
const WEB_ID = Math.random() * 999999999999999999 + 7000000000000000000;
const USER_ID = crypto.randomUUID().replace(/-/g, '');
const downloadTokens = new Map();
const DOWNLOAD_TOKEN_TTL_MS = 60 * 1000;
const PRE_SUBMIT_GENERATING_RECOVERY_WINDOW_MS = Number(
  process.env.PRE_SUBMIT_GENERATING_RECOVERY_WINDOW_MS || 15 * 60 * 1000
);
const PRE_SUBMIT_GENERATING_RECOVERY_REASON =
  '任务在提交前中断，未拿到 history_id。通常是服务重启或进程退出导致，请重新生成。';
const IMAGE_HISTORY_BACKGROUND_POLL_INTERVAL_MS = Number(
  process.env.IMAGE_HISTORY_BACKGROUND_POLL_INTERVAL_MS || 8000
);
const IMAGE_HISTORY_BACKGROUND_MAX_ATTEMPTS = Number(
  process.env.IMAGE_HISTORY_BACKGROUND_MAX_ATTEMPTS || 240
);
const imageTaskMonitors = new Map();

function cleanupExpiredDownloadTokens() {
  const now = Date.now();
  for (const [token, record] of downloadTokens.entries()) {
    if (record.expiresAt <= now) {
      downloadTokens.delete(token);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDownloadToken(taskId, userId) {
  cleanupExpiredDownloadTokens();
  const token = crypto.randomBytes(24).toString('hex');
  downloadTokens.set(token, {
    taskId: String(taskId),
    userId: Number(userId),
    expiresAt: Date.now() + DOWNLOAD_TOKEN_TTL_MS,
  });
  return token;
}

function consumeDownloadToken(token, userId = null) {
  cleanupExpiredDownloadTokens();
  const record = downloadTokens.get(token);
  if (!record) {
    return null;
  }
  if (record.expiresAt <= Date.now()) {
    downloadTokens.delete(token);
    return null;
  }
  if (userId !== null && record.userId !== Number(userId)) {
    downloadTokens.delete(token);
    return null;
  }
  downloadTokens.delete(token);
  return record;
}

setInterval(cleanupExpiredDownloadTokens, DOWNLOAD_TOKEN_TTL_MS).unref();

// 认证中间件
const authenticate = async (req, res, next) => {
  const sessionId = req.headers['x-session-id'];

  if (!sessionId) {
    return res.status(401).json({ error: '未登录' });
  }

  try {
    const user = await authService.getCurrentUser(sessionId);
    if (!user) {
      return res.status(401).json({ error: 'Session 已过期或无效' });
    }
    req.user = user;
    req.sessionId = sessionId; // 保存原始 sessionId 供后续使用
    next();
  } catch (error) {
    res.status(401).json({ error: '认证失败' });
  }
};

// 管理员认证中间件
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
};

function extractApiKeyFromRequest(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return String(req.headers['x-api-key'] || '').trim();
}

const authenticateOpenApi = (req, res, next) => {
  const rawKey = extractApiKeyFromRequest(req);
  if (!rawKey) {
    return res.status(401).json({ error: '缺少 API Key，请使用 Authorization: Bearer <API_KEY>' });
  }

  const auth = apiKeyService.authenticateApiKey(rawKey);
  if (!auth?.user) {
    return res.status(401).json({ error: 'API Key 无效或已失效' });
  }

  req.apiKey = auth.apiKey;
  req.apiUser = auth.user;
  req.user = auth.user;
  next();
};

const FAKE_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-language': 'zh-CN,zh;q=0.9',
  'App-Sdk-Version': '48.0.0',
  'Cache-control': 'no-cache',
  Appid: String(DEFAULT_ASSISTANT_ID),
  Appvr: VERSION_CODE,
  Lan: 'zh-Hans',
  Loc: 'cn',
  Origin: 'https://jimeng.jianying.com',
  Pragma: 'no-cache',
  Priority: 'u=1, i',
  Referer: 'https://jimeng.jianying.com',
  Pf: PLATFORM_CODE,
  'Sec-Ch-Ua':
    '"Google Chrome";v="132", "Chromium";v="132", "Not_A Brand";v="8"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
};

// 模型映射
const MODEL_MAP = {
  'dreamina-video-2.0': 'dreamina_ic_generate_video_model_vgfm_lite',
  'dreamina-video-2.0-pro': 'dreamina_ic_generate_video_model_vgfm1.0',
  'dreamina-video-3.0': 'dreamina_ic_generate_video_model_vgfm_3.0',
  'dreamina-video-3.0-pro': 'dreamina_ic_generate_video_model_vgfm_3.0_pro',
};

const BENEFIT_TYPE_MAP = {
  'dreamina-video-2.0': 'basic_video_operation_vgfm_v_three',
  'dreamina-video-2.0-pro': 'basic_video_operation_vgfm_v_three',
  'dreamina-video-3.0': 'basic_video_operation_vgfm_v_three',
  'dreamina-video-3.0-pro': 'basic_video_operation_vgfm_v_three',
};

const SEEDANCE_DRAFT_VERSION = '3.3.9';

// 分辨率配置
const VIDEO_RESOLUTION = {
  '1:1': { width: 720, height: 720 },
  '4:3': { width: 960, height: 720 },
  '3:4': { width: 720, height: 960 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '21:9': { width: 1680, height: 720 },
};

// ============================================================
// 异步任务管理
// ============================================================
const tasks = new Map();
let taskCounter = 0;

function getMissingSessionErrorMessage() {
  return '未配置可用的 Legacy Jimeng SessionID，请在设置页添加并设为默认账号';
}

function resolveGenerationRuntime(userId) {
  const settings = settingsService.getAllSettings();
  const provider = getGenerationProvider(settings.provider);
  const resolvedSession = provider.requiresSession
    ? jimengSessionService.resolveEffectiveSession(userId)
    : null;

  return { settings, provider, resolvedSession };
}

function getGenerationHandler(provider, model) {
  if (isImageModel(model)) {
    if (typeof provider.generateImage !== 'function') {
      throw new Error(`当前 Provider (${provider.label}) 暂不支持图片生成`);
    }
    return provider.generateImage.bind(provider);
  }

  if (typeof provider.generateVideo !== 'function') {
    throw new Error(`当前 Provider (${provider.label}) 暂不支持视频生成`);
  }

  return provider.generateVideo.bind(provider);
}

function getGenerationResultUrl(result, model) {
  return isImageModel(model) ? result?.imageUrl : result?.videoUrl;
}

function buildTaskResultPayload(result, model, fallbackPrompt = '') {
  const type = getModelCategory(model);
  const url = getGenerationResultUrl(result, model);

  return {
    created: Math.floor(Date.now() / 1000),
    data: [{
      url,
      revised_prompt: result?.revisedPrompt || fallbackPrompt || '',
      type,
    }],
  };
}

function extractImageUrlsFromHistoryRecord(record, requestedCount = 1) {
  const normalizedCount = Math.max(1, Number.parseInt(String(requestedCount || '1'), 10) || 1);
  const rawImageUrls = pickFirstArray(record?.item_list, record?.items, record?.data?.item_list)
    .map(
      (item) =>
        item?.image?.origin?.url ||
        item?.image?.large_images?.[0]?.image_url ||
        item?.image?.url ||
        item?.image?.play_url
    )
    .filter(Boolean);

  return {
    rawImageUrls,
    imageUrls: rawImageUrls.slice(0, normalizedCount),
  };
}

async function fetchImageHistoryRecord(sessionId, historyId, options = {}) {
  const { webId = null, providerId = DREAMINA_PROVIDER_ID } = options;
  const normalizedHistoryId = String(historyId || '').trim();
  if (!normalizedHistoryId) {
    return null;
  }

  const result = await providerJimengRequest('post', '/mweb/v1/get_history_by_ids', sessionId, webId, {
    data: {
      history_ids: [normalizedHistoryId],
    },
    providerId,
  });

  return (
    pickFirstArray(result?.history_list, result?.list, result?.data?.history_list, result?.data?.list)[0] ||
    result?.[normalizedHistoryId] ||
    result?.data?.[normalizedHistoryId] ||
    null
  );
}

function buildPendingImageProgress(historyId, status = null) {
  const statusText = Number.isFinite(Number(status)) ? `，status=${status}` : '';
  return `已提交到即梦，仍在处理中（historyId=${historyId}${statusText}）...`;
}

function updateRuntimeImageTaskState(taskId, updates = {}) {
  const runtimeTask = tasks.get(taskId);
  if (!runtimeTask) return null;
  Object.assign(runtimeTask, updates);
  return runtimeTask;
}

function startBackgroundImageTaskMonitor({
  runtimeTaskId = null,
  dbTaskId = null,
  userId = null,
  sessionId = '',
  webId = null,
  historyId,
  providerId = DREAMINA_PROVIDER_ID,
  model = 'dreamina-image-4.1',
  prompt = '',
  requestedCount = 1,
}) {
  const normalizedHistoryId = String(historyId || '').trim();
  if (!normalizedHistoryId) {
    return null;
  }

  const monitorKey = `${dbTaskId || runtimeTaskId || 'standalone'}:${normalizedHistoryId}`;
  if (imageTaskMonitors.has(monitorKey)) {
    return imageTaskMonitors.get(monitorKey);
  }

  const monitorPromise = (async () => {
    try {
      let pendingMessage = buildPendingImageProgress(normalizedHistoryId);

      if (runtimeTaskId) {
        updateRuntimeImageTaskState(runtimeTaskId, {
          status: 'processing',
          progress: pendingMessage,
          error: null,
        });
      }

      if (dbTaskId) {
        taskService.updateTask(dbTaskId, {
          status: 'generating',
          history_id: normalizedHistoryId,
          progress: pendingMessage,
          error_message: null,
          completed_at: null,
        });
      }

      for (let attempt = 0; attempt < IMAGE_HISTORY_BACKGROUND_MAX_ATTEMPTS; attempt += 1) {
        if (attempt > 0) {
          await sleep(IMAGE_HISTORY_BACKGROUND_POLL_INTERVAL_MS);
        }

        const dbTask = dbTaskId ? taskService.getTaskById(dbTaskId) : null;
        if ((dbTask && dbTask.status === 'cancelled') || (runtimeTaskId && tasks.get(runtimeTaskId)?.status === 'cancelled')) {
          return;
        }

        const resolvedSession =
          sessionId ||
          (userId ? jimengSessionService.resolveEffectiveSession(userId)?.sessionId : '') ||
          '';

        if (!resolvedSession) {
          throw new Error('缺少可用 SessionID，无法继续追踪生图结果');
        }

        const historyRecord = await fetchImageHistoryRecord(resolvedSession, normalizedHistoryId, {
          webId,
          providerId,
        });

        if (!historyRecord) {
          pendingMessage = `已提交到即梦，但暂未查询到历史记录（historyId=${normalizedHistoryId}）...`;
        } else {
          const status = Number(historyRecord?.status);
          const failCode = String(historyRecord?.fail_code || '').trim();
          const failMessage =
            String(historyRecord?.fail_starling_message || '').trim() ||
            String(historyRecord?.fail_msg || '').trim() ||
            '';
          const { rawImageUrls, imageUrls } = extractImageUrlsFromHistoryRecord(historyRecord, requestedCount);
          const imageUrl = imageUrls[0] || null;

          if (imageUrl) {
            const result = {
              imageUrl,
              imageUrls,
              historyId: normalizedHistoryId,
              status,
            };

            if (runtimeTaskId) {
              updateRuntimeImageTaskState(runtimeTaskId, {
                status: 'done',
                progress: '',
                error: null,
                result: buildTaskResultPayload(result, model, prompt),
              });
              scheduleTaskCleanup(tasks.get(runtimeTaskId));
            }

            if (dbTaskId) {
              taskService.updateTaskStatus(dbTaskId, 'done', {
                history_id: normalizedHistoryId,
                video_url: imageUrl,
                progress: '',
                error_message: null,
              });
            }

            if (rawImageUrls.length > requestedCount) {
              console.warn(
                `[image-monitor] historyId=${normalizedHistoryId} 上游返回 ${rawImageUrls.length} 张图，已按请求 count=${requestedCount} 截断`
              );
            }
            return result;
          }

          if (status === 30) {
            const terminalMessage = failMessage || `生图失败 (代码: ${failCode || 'unknown'})`;

            if (runtimeTaskId) {
              updateRuntimeImageTaskState(runtimeTaskId, {
                status: 'error',
                progress: '',
                error: terminalMessage,
              });
              scheduleTaskCleanup(tasks.get(runtimeTaskId));
            }

            if (dbTaskId) {
              taskService.updateTaskStatus(dbTaskId, 'error', {
                progress: '',
                error_message: terminalMessage,
              });
            }
            return;
          }

          pendingMessage = buildPendingImageProgress(normalizedHistoryId, status);
        }

        if (runtimeTaskId) {
          updateRuntimeImageTaskState(runtimeTaskId, {
            status: 'processing',
            progress: pendingMessage,
            error: null,
          });
        }

        if (dbTaskId) {
          taskService.updateTask(dbTaskId, {
            status: 'generating',
            progress: pendingMessage,
            error_message: null,
            completed_at: null,
          });
        }
      }

      console.warn(
        `[image-monitor] historyId=${normalizedHistoryId} 超过后台追踪窗口，保留 generating 状态，等待后续继续采集`
      );
    } catch (error) {
      console.error(`[image-monitor] historyId=${normalizedHistoryId} 追踪失败: ${error.message}`);

      if (runtimeTaskId) {
        updateRuntimeImageTaskState(runtimeTaskId, {
          status: 'error',
          progress: '',
          error: error.message,
        });
        scheduleTaskCleanup(tasks.get(runtimeTaskId));
      }

      if (dbTaskId) {
        taskService.updateTaskStatus(dbTaskId, 'error', {
          progress: '',
          error_message: error.message,
        });
      }
    } finally {
      imageTaskMonitors.delete(monitorKey);
    }
  })();

  imageTaskMonitors.set(monitorKey, monitorPromise);
  return monitorPromise;
}

function handlePendingImageTask({
  error,
  generationType,
  runtimeTask = null,
  dbTaskId = null,
  userId = null,
  sessionId = '',
  webId = null,
  providerId = DREAMINA_PROVIDER_ID,
  model = 'dreamina-image-4.1',
  prompt = '',
  requestedCount = 1,
}) {
  if (generationType !== 'image' || !error?.isHistoryPending || !error?.historyId) {
    return false;
  }

  const pendingMessage = error.progressMessage || buildPendingImageProgress(error.historyId, error.taskStatus);

  if (runtimeTask) {
    runtimeTask.status = 'processing';
    runtimeTask.progress = pendingMessage;
    runtimeTask.error = null;
  }

  if (dbTaskId) {
    taskService.updateTask(dbTaskId, {
      status: 'generating',
      history_id: error.historyId,
      progress: pendingMessage,
      error_message: null,
      completed_at: null,
    });
  }

  console.warn(`[image] historyId=${error.historyId} 本地轮询超时，已转入后台继续追踪`);

  startBackgroundImageTaskMonitor({
    runtimeTaskId: runtimeTask?.id || null,
    dbTaskId,
    userId,
    sessionId,
    webId,
    historyId: error.historyId,
    providerId,
    model,
    prompt,
    requestedCount,
  });
  return true;
}

function parseJsonField(value, fallback = null) {
  if (value == null || value === '') {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function buildSavedSessionFallbackCandidates(userId, resolvedSession = null) {
  const currentSessionId = String(resolvedSession?.sessionId || '').trim();
  const accounts = jimengSessionService
    .listUserAccounts(userId)
    .filter((account) => !account?.isVirtual && String(account?.sessionId || '').trim());

  const unique = [];
  const seen = new Set();
  for (const account of accounts) {
    const sessionId = String(account.sessionId || '').trim();
    if (!sessionId || sessionId === currentSessionId || seen.has(sessionId)) {
      continue;
    }
    seen.add(sessionId);
    unique.push(sessionId);
  }

  return unique;
}

function startGenerationTaskForUser({
  user,
  input = {},
  files = [],
  taskRetentionMs = 5 * 60 * 1000,
  source = 'session',
}) {
  const startTime = Date.now();
  let dbTaskId = null;
  let latestAccountInfo = null;
  const { settings, provider, resolvedSession } = resolveGenerationRuntime(user.id);
  const sessionId = resolvedSession?.sessionId || '';
  const fallbackSessionCandidates = buildSavedSessionFallbackCandidates(user.id, resolvedSession);
  const normalizedModel = provider.normalizeModel(input.model || settings.model);
  const generationType = getModelCategory(normalizedModel);
  const generate = getGenerationHandler(provider, normalizedModel);
  const supportsAutoPool = [DREAMINA_PROVIDER_ID, LEGACY_JIMENG_PROVIDER_ID].includes(provider.id);

  if (provider.requiresSession && !sessionId && !supportsAutoPool) {
    throw new Error(provider.getMissingCredentialMessage());
  }

  const taskId = createTaskId();
  const task = {
    id: taskId,
    status: 'processing',
    progress: '正在准备...',
    startTime,
    result: null,
    error: null,
    ownerUserId: Number(user.id),
    dbTaskId: null,
    source,
    cleanupAfterMs: taskRetentionMs,
  };
  tasks.set(taskId, task);

  const requestedCount = Math.max(1, Number.parseInt(String(input.count || '1'), 10) || 1);

  try {
    const defaultProject = ensureDefaultProjectForUser(user.id);
    const createdTask = taskService.createTask({
      projectId: defaultProject.id,
      userId: user.id,
      prompt: input.prompt || '',
      taskKind: 'output',
      mediaType: generationType,
      modelId: normalizedModel,
      providerId: provider.id,
      videoCount: generationType === 'image' ? requestedCount : 1,
      status: 'generating',
      downloadStatus: 'pending',
      progress: '正在准备...',
      startedAt: new Date().toISOString(),
    });
    dbTaskId = createdTask.id;
    task.dbTaskId = dbTaskId;
    console.log(`[生成任务] 数据库记录已创建，db_task_id = ${dbTaskId}, project_id = ${defaultProject.id}`);
  } catch (dbError) {
    console.error('[生成任务] 创建数据库记录失败:', dbError.message);
  }

  console.log(`\n========== [${taskId}] 收到${generationType === 'image' ? '图片' : '视频'}生成请求 ==========`);
  console.log(`  prompt: ${(input.prompt || '').substring(0, 80)}${(input.prompt || '').length > 80 ? '...' : ''}`);
  console.log(`  provider: ${provider.id}`);
  console.log(`  model: ${normalizedModel}, ratio: ${input.ratio || '4:3'}, duration: ${input.duration || 4}秒, count: ${Math.max(1, Number.parseInt(String(input.count || '1'), 10) || 1)}`);
  console.log(`  files: ${files.length}张`);
  if (resolvedSession) {
    console.log(`  credential source: ${resolvedSession.source}`);
  }
  files.forEach((f, i) => {
    console.log(
      `  file[${i}]: ${f.originalname} (${f.mimetype || 'application/octet-stream'}, ${((f.size || 0) / 1024).toFixed(1)}KB)`
    );
  });

  generate({
    prompt: input.prompt,
    ratio: input.ratio || '4:3',
    duration: parseInt(input.duration, 10) || 4,
    count: Math.max(1, Number.parseInt(String(input.count || '1'), 10) || 1),
    referenceMode: input.referenceMode || settings.reference_mode || '全能参考',
    referenceMap: input.referenceMap || null,
    files,
    sessionId,
    fallbackSessionCandidates,
    model: normalizedModel,
    providerId: provider.id,
    settings,
    onProgress: async (progress) => {
      task.progress = progress;
      console.log(`[${taskId}] 进度：${progress}`);
      if (dbTaskId) {
        try {
          taskService.updateTask(dbTaskId, { progress });
        } catch (dbError) {
          console.error('[生成任务] 保存进度失败:', dbError.message);
        }
      }
    },
    onSubmitId: async (submitId) => {
      if (dbTaskId) {
        try {
          taskService.updateTask(dbTaskId, {
            submit_id: submitId,
            submitted_at: new Date().toISOString(),
          });
        } catch (dbError) {
          console.error('[生成任务] 保存 submitId 失败:', dbError.message);
        }
      }
    },
    onHistoryId: async (historyId) => {
      if (dbTaskId) {
        try {
          taskService.updateTask(dbTaskId, {
            history_id: historyId,
            status: 'generating',
          });
        } catch (dbError) {
          console.error('[生成任务] 保存 historyId 失败:', dbError.message);
        }
      }
    },
    onItemId: async (itemId) => {
      if (dbTaskId) {
        try {
          taskService.updateTask(dbTaskId, { item_id: itemId });
        } catch (dbError) {
          console.error('[生成任务] 保存 itemId 失败:', dbError.message);
        }
      }
    },
    onVideoReady: async (videoUrl) => {
      if (dbTaskId) {
        try {
          taskService.updateTask(dbTaskId, { video_url: videoUrl, media_type: 'video' });
        } catch (dbError) {
          console.error('[生成任务] 保存 videoUrl 失败:', dbError.message);
        }
      }
    },
    onImageReady: async (imageUrl) => {
      if (dbTaskId) {
        try {
          taskService.updateTask(dbTaskId, { video_url: imageUrl, media_type: 'image' });
        } catch (dbError) {
          console.error('[生成任务] 保存 imageUrl 失败:', dbError.message);
        }
      }
    },
    onAccountResolved: async (accountInfo) => {
      if (!dbTaskId || !accountInfo || typeof accountInfo !== 'object') {
        return;
      }

      latestAccountInfo = {
        ...(latestAccountInfo || {}),
        ...accountInfo,
        updatedAt: accountInfo.updatedAt || new Date().toISOString(),
      };

      try {
        taskService.updateTask(dbTaskId, {
          account_info: JSON.stringify(latestAccountInfo),
        });
      } catch (dbError) {
        console.error('[生成任务] 保存 account_info 失败:', dbError.message);
      }
    },
  })
    .then((result) => {
      const mediaUrl = getGenerationResultUrl(result, normalizedModel);
      task.status = 'done';
      task.result = buildTaskResultPayload(result, normalizedModel, input.prompt);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `========== [${taskId}] ✅ ${generationType === 'image' ? '图片' : '视频'}生成成功 (${elapsed}秒) ==========` + '\n'
      );

      if (dbTaskId) {
        try {
          taskService.updateTaskStatus(dbTaskId, 'done', {
            submit_id: result.submitId || null,
            history_id: result.historyId || null,
            item_id: result.itemId || null,
            video_url: mediaUrl,
            progress: '',
            error_message: null,
          });
        } catch (dbError) {
          console.error('[生成任务] 更新数据库记录失败:', dbError.message);
        }
      }
    })
    .catch((err) => {
      if (
        handlePendingImageTask({
          error: err,
          generationType,
          runtimeTask: task,
          dbTaskId,
          userId: user.id,
          sessionId,
          providerId: provider.id,
          model: normalizedModel,
          prompt: input.prompt,
          requestedCount,
        })
      ) {
        return;
      }

      task.status = 'error';
      task.error = err.message || `${generationType === 'image' ? '图片' : '视频'}生成失败`;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(
        `========== [${taskId}] ❌ ${generationType === 'image' ? '图片' : '视频'}生成失败 (${elapsed}秒): ${err.message} ==========` + '\n'
      );

      if (dbTaskId) {
        try {
          taskService.updateTaskStatus(dbTaskId, 'error', {
            progress: '',
            error_message: err.message,
          });
        } catch (dbError) {
          console.error('[生成任务] 更新数据库记录失败:', dbError.message);
        }
      }
    });

  return {
    taskId,
    dbTaskId,
    model: normalizedModel,
    mediaType: generationType,
    providerId: provider.id,
  };
}

function buildOpenApiTaskPayload(task) {
  const base = {
    taskId: task.id,
    status: task.status === 'done' ? 'succeeded' : task.status === 'error' ? 'failed' : 'processing',
    progress: task.progress || '',
    dbTaskId: task.dbTaskId || null,
  };

  if (task.status === 'done') {
    return {
      ...base,
      output: task.result?.data || [],
      result: task.result || null,
    };
  }

  if (task.status === 'error') {
    return {
      ...base,
      error: task.error || '生成失败',
    };
  }

  return base;
}

function ensureDefaultProjectForUser(userId) {
  const db = getDatabase();
  const existingProject = db.prepare(`
    SELECT * FROM projects
    WHERE user_id = ? AND name = ?
    ORDER BY id ASC
    LIMIT 1
  `).get(userId, '默认项目');

  if (existingProject) {
    return existingProject;
  }

  return projectService.createProject({
    name: '默认项目',
    description: '单任务生成默认项目',
    user_id: userId,
  });
}

function validateBatchTasks(projectId, taskIds, userId = null, isAdmin = false) {
  const project = projectService.getProjectById(projectId, userId, isAdmin);
  if (!project) {
    return { error: '项目不存在', statusCode: 404 };
  }

  const normalizedTaskIds = [...new Set(taskIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (normalizedTaskIds.length === 0) {
    return { error: '请选择有效任务', statusCode: 400 };
  }

  const invalidTasks = [];
  for (const taskId of normalizedTaskIds) {
    const task = taskService.getTaskById(taskId, userId, isAdmin);
    if (!task) {
      invalidTasks.push({ taskId, prompt: '', reason: '任务不存在' });
      continue;
    }
    if (Number(task.project_id) !== Number(projectId)) {
      invalidTasks.push({ taskId, prompt: task.prompt || '', reason: '任务不属于当前项目' });
      continue;
    }
    if (task.task_kind !== 'draft') {
      invalidTasks.push({ taskId, prompt: task.prompt || '', reason: '只能启动草稿任务' });
      continue;
    }
    if (!String(task.prompt || '').trim()) {
      invalidTasks.push({ taskId, prompt: task.prompt || '', reason: '任务缺少提示词' });
      continue;
    }

    const imageAssets = taskService.getTaskAssets(taskId).filter((asset) => asset.asset_type === 'image');
    if (imageAssets.length === 0) {
      invalidTasks.push({ taskId, prompt: task.prompt || '', reason: '任务缺少图片素材' });
    }
  }

  return {
    project,
    taskIds: normalizedTaskIds,
    invalidTasks,
  };
}

function pickFirstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length >= 0) || [];
}

function extractItemId(item) {
  return item?.item_id || item?.local_item_id || item?.common_attr?.id || item?.id || null;
}

function extractHistoryId(item) {
  return item?.history_id || item?.history_record_id || item?.common_attr?.history_id || item?.item_base?.history_id || null;
}

function extractVideoUrl(item) {
  return item?.video?.transcoded_video?.origin?.video_url || item?.video?.download_url || item?.video?.play_url || item?.video?.url || item?.video?.play_addr?.url_list?.[0] || item?.item_video?.url || null;
}

async function resolveItemIdsByHistoryIds(sessionId, historyIds) {
  const normalizedHistoryIds = [...new Set(historyIds.map((historyId) => String(historyId || '')).filter(Boolean))];
  const itemIdByHistoryId = new Map();

  if (normalizedHistoryIds.length === 0) {
    return itemIdByHistoryId;
  }

  const historyResult = await jimengRequest('post', '/mweb/v1/get_history_by_ids', sessionId, null, {
    data: {
      history_ids: normalizedHistoryIds,
    },
  });

  const historyRecords = [
    ...pickFirstArray(
      historyResult?.history_list,
      historyResult?.list,
      historyResult?.data?.history_list,
      historyResult?.data?.list
    ),
    ...normalizedHistoryIds
      .map((historyId) => historyResult?.[historyId] || historyResult?.data?.[historyId] || null)
      .filter(Boolean),
  ];

  for (const record of historyRecords) {
    const historyId = extractHistoryId(record);
    if (!historyId) {
      continue;
    }

    const item = pickFirstArray(record?.item_list, record?.items, record?.data?.item_list)[0];
    const itemId = extractItemId(item);
    if (!itemId) {
      continue;
    }

    itemIdByHistoryId.set(String(historyId), String(itemId));
  }

  return itemIdByHistoryId;
}

async function fetchLocalItemsByItemIds(sessionId, itemIds) {
  const normalizedItemIds = [...new Set(itemIds.map((itemId) => String(itemId || '')).filter(Boolean))];
  if (normalizedItemIds.length === 0) {
    return [];
  }

  const result = await jimengRequest('post', '/mweb/v1/get_local_item_list', sessionId, null, {
    data: {
      item_id_list: normalizedItemIds,
      pack_item_opt: {
        scene: 1,
        need_data_integrity: true,
      },
      is_for_video_download: true,
    },
  });

  return pickFirstArray(
    result?.item_list,
    result?.local_item_list,
    result?.list,
    result?.data?.item_list,
    result?.data?.local_item_list,
    result?.data?.list
  );
}

async function resolveTaskVideoByHistory(sessionId, task) {
  const historyId = task?.history_id ? String(task.history_id) : '';
  if (!historyId) {
    return { itemId: null, videoUrl: null };
  }

  const itemId = task?.item_id ? String(task.item_id) : (await resolveItemIdsByHistoryIds(sessionId, [historyId])).get(historyId) || null;
  if (!itemId) {
    return { itemId: null, videoUrl: null };
  }

  const items = await fetchLocalItemsByItemIds(sessionId, [itemId]);
  const matchedItem = items.find((item) => {
    const resolvedItemId = extractItemId(item);
    const resolvedHistoryId = extractHistoryId(item);
    return String(resolvedItemId || '') === itemId || String(resolvedHistoryId || '') === historyId;
  }) || items[0];

  return {
    itemId,
    videoUrl: matchedItem ? extractVideoUrl(matchedItem) : null,
  };
}

function persistResolvedVideoTask(db, taskId, { itemId = null, videoUrl = null }) {
  if (videoUrl) {
    db.prepare(`
      UPDATE tasks
      SET item_id = COALESCE(?, item_id), video_url = ?, status = 'done', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(itemId, videoUrl, taskId);
    return;
  }

  if (itemId) {
    db.prepare(`
      UPDATE tasks
      SET item_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(itemId, taskId);
  }
}

function isOutputTask(task) {
  return task && task.task_kind === 'output';
}

function createTaskId() {
  return `task_${++taskCounter}_${Date.now()}`;
}

function scheduleTaskCleanup(task) {
  if (!task?.id) {
    return;
  }
  const delay = Number(task?.cleanupAfterMs || 5 * 60 * 1000);
  setTimeout(() => tasks.delete(task.id), delay);
}

function parseTaskTimestampForRecovery(task) {
  const candidates = [task?.updated_at, task?.started_at, task?.created_at];
  for (const value of candidates) {
    if (!value) continue;
    const normalizedValue =
      typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
        ? `${value.replace(' ', 'T')}Z`
        : value;
    const parsed = new Date(normalizedValue).getTime();
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

function hasLiveRuntimeTaskForDbTaskId(dbTaskId) {
  const normalizedDbTaskId = Number(dbTaskId);
  if (!Number.isFinite(normalizedDbTaskId) || normalizedDbTaskId <= 0) {
    return false;
  }

  for (const runtimeTask of tasks.values()) {
    if (Number(runtimeTask?.dbTaskId) !== normalizedDbTaskId) {
      continue;
    }

    if (!['done', 'error', 'cancelled'].includes(String(runtimeTask?.status || ''))) {
      return true;
    }
  }

  return false;
}

function recoverInterruptedGeneratingTasks({ userId = null, isAdmin = false } = {}) {
  const db = getDatabase();
  const whereClauses = [
    `t.task_kind = 'output'`,
    `t.status = 'generating'`,
    `t.history_id IS NULL`,
    `t.video_url IS NULL`,
  ];
  const params = [];

  if (!isAdmin && userId !== null) {
    whereClauses.push('t.user_id = ?');
    params.push(Number(userId));
  }

  const candidates = db.prepare(`
    SELECT t.id, t.user_id, t.prompt, t.progress, t.created_at, t.started_at, t.updated_at
    FROM tasks t
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY t.id ASC
  `).all(...params);

  const now = Date.now();
  const recoveredTaskIds = [];

  for (const task of candidates) {
    if (hasLiveRuntimeTaskForDbTaskId(task.id)) {
      continue;
    }

    const taskTimestamp = parseTaskTimestampForRecovery(task);
    if (!taskTimestamp || now - taskTimestamp < PRE_SUBMIT_GENERATING_RECOVERY_WINDOW_MS) {
      continue;
    }

    taskService.updateTaskStatus(task.id, 'error', {
      progress: '',
      downloadStatus: 'failed',
      errorMessage: PRE_SUBMIT_GENERATING_RECOVERY_REASON,
    });
    recoveredTaskIds.push(task.id);
  }

  return recoveredTaskIds;
}

function bootstrapPendingImageTaskRecovery() {
  const db = getDatabase();
  const pendingTasks = db.prepare(`
    SELECT t.id, t.user_id, t.prompt, t.history_id, t.provider_id, t.model_id, t.video_count, t.status
    FROM tasks t
    WHERE t.media_type = 'image'
      AND t.history_id IS NOT NULL
      AND t.video_url IS NULL
      AND t.status != 'cancelled'
    ORDER BY t.id ASC
  `).all();

  let queued = 0;

  for (const task of pendingTasks) {
    const sessionId = task.user_id
      ? jimengSessionService.resolveEffectiveSession(task.user_id)?.sessionId || ''
      : '';

    if (!sessionId) {
      continue;
    }

    const started = startBackgroundImageTaskMonitor({
      dbTaskId: task.id,
      userId: task.user_id,
      sessionId,
      historyId: task.history_id,
      providerId: task.provider_id || DREAMINA_PROVIDER_ID,
      model: task.model_id || 'dreamina-image-4.1',
      prompt: task.prompt || '',
      requestedCount: Math.max(1, Number.parseInt(String(task.video_count || '1'), 10) || 1),
    });

    if (started) {
      queued += 1;
    }
  }

  return queued;
}

// 定期清理过期任务
setInterval(() => {
  const now = Date.now();
  for (const [id, task] of tasks) {
    if (now - task.startTime > 30 * 60 * 1000) {
      tasks.delete(id);
    }
  }
}, 60000);

// ============================================================
// 工具函数
// ============================================================
function generateUUID() {
  return crypto.randomUUID();
}

function unixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function generateCookie(sessionId) {
  return [
    `_tea_web_id=${WEB_ID}`,
    `is_staff_user=false`,
    `store-region=cn-gd`,
    `store-region-src=uid`,
    `uid_tt=${USER_ID}`,
    `uid_tt_ss=${USER_ID}`,
    `sid_tt=${sessionId}`,
    `sessionid=${sessionId}`,
    `sessionid_ss=${sessionId}`,
  ].join('; ');
}

function generateSign(uri) {
  const deviceTime = unixTimestamp();
  const sign = md5(
    `9e2c|${uri.slice(-7)}|${PLATFORM_CODE}|${VERSION_CODE}|${deviceTime}||11ac`
  );
  return { deviceTime, sign };
}

// ============================================================
// 即梦 API 请求函数
// ============================================================
async function jimengRequest(method, uri, sessionId, webId, options = {}) {
  const { deviceTime, sign } = generateSign(uri);
  const fullUrl = new URL(`${JIMENG_BASE_URL}${uri}`);

  const defaultParams = {
    aid: DEFAULT_ASSISTANT_ID,
    device_platform: 'web',
    region: 'cn',
    webId: webId || WEB_ID,
    da_version: '3.3.2',
    web_component_open_flag: 1,
    web_version: '7.5.0',
    aigc_features: 'app_lip_sync',
    ...(options.params || {}),
  };

  for (const [key, value] of Object.entries(defaultParams)) {
    fullUrl.searchParams.set(key, String(value));
  }

  const headers = {
    ...FAKE_HEADERS,
    Cookie: generateCookie(sessionId),
    'Device-Time': String(deviceTime),
    Sign: sign,
    'Sign-Ver': '1',
    ...(options.headers || {}),
  };

  const fetchOptions = { method: method.toUpperCase(), headers };

  if (options.data) {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.data);
  }

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        console.log(`  [jimeng] 重试 ${uri} (第${attempt}次)`);
      }

      const response = await fetch(fullUrl.toString(), {
        ...fetchOptions,
        signal: AbortSignal.timeout(45000),
      });
      const data = await response.json();

      if (isFinite(Number(data.ret))) {
        if (String(data.ret) === '0') return data.data;
        // API 业务错误不重试，直接抛出
        const errMsg = data.errmsg || String(data.ret);
        const retCode = String(data.ret);
        if (retCode === '5000')
          throw new Error('即梦积分不足，请前往即梦官网领取积分');
        throw Object.assign(
          new Error(`即梦API错误 (ret=${retCode}): ${errMsg}`),
          { isApiError: true }
        );
      }

      return data;
    } catch (err) {
      // API 业务错误（非网络问题）不重试
      if (err.isApiError) throw err;
      if (attempt === 3) throw err;
      console.log(
        `  [jimeng] 请求 ${uri} 失败 (第${attempt + 1}次): ${err.message}`
      );
    }
  }
}

// ============================================================
// AWS4-HMAC-SHA256 签名
// ============================================================
function createAWSSignature(
  method,
  url,
  headers,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  payload = ''
) {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname || '/';

  const timestamp = headers['x-amz-date'];
  const date = timestamp.substr(0, 8);
  const region = 'cn-north-1';
  const service = 'imagex';

  // 规范化查询参数
  const queryParams = [];
  urlObj.searchParams.forEach((value, key) => {
    queryParams.push([key, value]);
  });
  queryParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQueryString = queryParams
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  // 签名头部
  const headersToSign = { 'x-amz-date': timestamp };
  if (sessionToken)
    headersToSign['x-amz-security-token'] = sessionToken;

  let payloadHash = crypto.createHash('sha256').update('').digest('hex');
  if (method.toUpperCase() === 'POST' && payload) {
    payloadHash = crypto
      .createHash('sha256')
      .update(payload, 'utf8')
      .digest('hex');
    headersToSign['x-amz-content-sha256'] = payloadHash;
  }

  const signedHeaders = Object.keys(headersToSign)
    .map((k) => k.toLowerCase())
    .sort()
    .join(';');
  const canonicalHeaders = Object.keys(headersToSign)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k.toLowerCase()}:${headersToSign[k].trim()}\n`)
    .join('');

  const canonicalRequest = [
    method.toUpperCase(),
    pathname,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    credentialScope,
    crypto
      .createHash('sha256')
      .update(canonicalRequest, 'utf8')
      .digest('hex'),
  ].join('\n');

  const kDate = crypto
    .createHmac('sha256', `AWS4${secretAccessKey}`)
    .update(date)
    .digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto
    .createHmac('sha256', kRegion)
    .update(service)
    .digest();
  const kSigning = crypto
    .createHmac('sha256', kService)
    .update('aws4_request')
    .digest();
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

// ============================================================
// CRC32 计算
// ============================================================
function calculateCRC32(buffer) {
  const crcTable = [];
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    crcTable[i] = crc;
  }

  let crc = 0 ^ -1;
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
  }
  return ((crc ^ -1) >>> 0).toString(16).padStart(8, '0');
}

// ============================================================
// 图片上传 (4步 ImageX 流程)
// ============================================================
async function uploadImageBuffer(buffer, sessionId) {
  console.log(`  [upload] 开始上传图片, 大小: ${buffer.length} 字节`);

  // 第1步: 获取上传令牌
  const tokenResult = await jimengRequest(
    'post',
    '/mweb/v1/get_upload_token',
    sessionId,
    null,
    { data: { scene: 2 } }
  );

  const { access_key_id, secret_access_key, session_token, service_id } =
    tokenResult;
  if (!access_key_id || !secret_access_key || !session_token) {
    throw new Error('获取上传令牌失败');
  }
  const actualServiceId = service_id || 'tb4s082cfz';
  console.log(`  [upload] 上传令牌获取成功: serviceId=${actualServiceId}`);

  const fileSize = buffer.length;
  const crc32 = calculateCRC32(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  );

  // 第2步: 申请上传权限
  const timestamp = new Date()
    .toISOString()
    .replace(/[:\-]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const randomStr = Math.random().toString(36).substring(2, 12);
  const applyUrl = `https://imagex.bytedanceapi.com/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=${actualServiceId}&FileSize=${fileSize}&s=${randomStr}`;

  const reqHeaders = {
    'x-amz-date': timestamp,
    'x-amz-security-token': session_token,
  };
  const authorization = createAWSSignature(
    'GET',
    applyUrl,
    reqHeaders,
    access_key_id,
    secret_access_key,
    session_token
  );

  const applyResponse = await fetch(applyUrl, {
    method: 'GET',
    headers: {
      accept: '*/*',
      authorization: authorization,
      origin: 'https://jimeng.jianying.com',
      referer: 'https://jimeng.jianying.com/ai-tool/video/generate',
      'user-agent': FAKE_HEADERS['User-Agent'],
      'x-amz-date': timestamp,
      'x-amz-security-token': session_token,
    },
  });

  if (!applyResponse.ok)
    throw new Error(`申请上传权限失败: ${applyResponse.status}`);
  const applyResult = await applyResponse.json();
  if (applyResult?.ResponseMetadata?.Error)
    throw new Error(
      `申请上传权限失败: ${JSON.stringify(applyResult.ResponseMetadata.Error)}`
    );

  const uploadAddress = applyResult?.Result?.UploadAddress;
  if (!uploadAddress?.StoreInfos?.length || !uploadAddress?.UploadHosts?.length) {
    throw new Error('获取上传地址失败');
  }

  const storeInfo = uploadAddress.StoreInfos[0];
  const uploadHost = uploadAddress.UploadHosts[0];
  const uploadUrl = `https://${uploadHost}/upload/v1/${storeInfo.StoreUri}`;

  console.log(`  [upload] 上传图片到: ${uploadHost}`);

  // 第3步: 上传图片文件
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      Authorization: storeInfo.Auth,
      'Content-CRC32': crc32,
      'Content-Disposition': 'attachment; filename="undefined"',
      'Content-Type': 'application/octet-stream',
      Origin: 'https://jimeng.jianying.com',
      Referer: 'https://jimeng.jianying.com/ai-tool/video/generate',
      'User-Agent': FAKE_HEADERS['User-Agent'],
    },
    body: buffer,
  });

  if (!uploadResponse.ok)
    throw new Error(`图片上传失败: ${uploadResponse.status}`);
  console.log(`  [upload] 图片文件上传成功`);

  // 第4步: 提交上传
  const commitUrl = `https://imagex.bytedanceapi.com/?Action=CommitImageUpload&Version=2018-08-01&ServiceId=${actualServiceId}`;
  const commitTimestamp = new Date()
    .toISOString()
    .replace(/[:\-]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const commitPayload = JSON.stringify({
    SessionKey: uploadAddress.SessionKey,
    SuccessActionStatus: '200',
  });
  const payloadHash = crypto
    .createHash('sha256')
    .update(commitPayload, 'utf8')
    .digest('hex');

  const commitReqHeaders = {
    'x-amz-date': commitTimestamp,
    'x-amz-security-token': session_token,
    'x-amz-content-sha256': payloadHash,
  };
  const commitAuth = createAWSSignature(
    'POST',
    commitUrl,
    commitReqHeaders,
    access_key_id,
    secret_access_key,
    session_token,
    commitPayload
  );

  const commitResponse = await fetch(commitUrl, {
    method: 'POST',
    headers: {
      accept: '*/*',
      authorization: commitAuth,
      'content-type': 'application/json',
      origin: 'https://jimeng.jianying.com',
      referer: 'https://jimeng.jianying.com/ai-tool/video/generate',
      'user-agent': FAKE_HEADERS['User-Agent'],
      'x-amz-date': commitTimestamp,
      'x-amz-security-token': session_token,
      'x-amz-content-sha256': payloadHash,
    },
    body: commitPayload,
  });

  if (!commitResponse.ok)
    throw new Error(`提交上传失败: ${commitResponse.status}`);
  const commitResult = await commitResponse.json();
  if (commitResult?.ResponseMetadata?.Error)
    throw new Error(
      `提交上传失败: ${JSON.stringify(commitResult.ResponseMetadata.Error)}`
    );

  if (!commitResult?.Result?.Results?.length)
    throw new Error('提交上传响应缺少结果');
  const result = commitResult.Result.Results[0];
  if (result.UriStatus !== 2000)
    throw new Error(`图片上传状态异常: UriStatus=${result.UriStatus}`);

  const imageUri =
    commitResult.Result?.PluginResult?.[0]?.ImageUri || result.Uri;
  console.log(`  [upload] 图片上传完成: ${imageUri}`);
  return imageUri;
}

// ============================================================
// 解析 prompt 中的图片占位符, 构建 meta_list
// ============================================================
function buildMetaListFromPrompt(prompt, imageCount) {
  const metaList = [];
  const placeholderRegex = /@(?:图|image)?(\d+)/gi;
  let lastIndex = 0;
  let match;

  while ((match = placeholderRegex.exec(prompt)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = prompt.substring(lastIndex, match.index);
      if (textBefore.trim()) {
        metaList.push({ meta_type: 'text', text: textBefore });
      }
    }

    const imageIndex = parseInt(match[1]) - 1;
    if (imageIndex >= 0 && imageIndex < imageCount) {
      metaList.push({
        meta_type: 'image',
        text: '',
        material_ref: { material_idx: imageIndex },
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < prompt.length) {
    const remainingText = prompt.substring(lastIndex);
    if (remainingText.trim()) {
      metaList.push({ meta_type: 'text', text: remainingText });
    }
  }

  // 如果没有占位符, 构建默认 meta_list
  if (metaList.length === 0) {
    for (let i = 0; i < imageCount; i++) {
      if (i === 0) metaList.push({ meta_type: 'text', text: '使用' });
      metaList.push({
        meta_type: 'image',
        text: '',
        material_ref: { material_idx: i },
      });
      if (i < imageCount - 1)
        metaList.push({ meta_type: 'text', text: '和' });
    }
    if (prompt && prompt.trim()) {
      metaList.push({ meta_type: 'text', text: `图片，${prompt}` });
    } else {
      metaList.push({ meta_type: 'text', text: '图片生成视频' });
    }
  }

  return metaList;
}


// ============================================================
// Express 路由
// ============================================================

// POST /api/generate-video - 提交任务, 立即返回 taskId
app.post('/api/generate-video', authenticate, upload.array('files', 5), async (req, res) => {
  try {
    const {
      prompt,
      ratio,
      duration,
      model,
      reference_mode: referenceMode,
      reference_map: referenceMapRaw,
      referenceMap: referenceMapObject,
    } = req.body;
    const files = Array.isArray(req.files) ? req.files : [];
    const created = startGenerationTaskForUser({
      user: req.user,
      input: {
        prompt,
        ratio,
        duration,
        model,
        referenceMode,
        referenceMap: parseJsonField(referenceMapRaw, parseJsonField(referenceMapObject, null)),
      },
      files,
      taskRetentionMs: 5 * 60 * 1000,
      source: 'session',
    });

    res.json({ taskId: created.taskId, dbTaskId: created.dbTaskId });
  } catch (error) {
    console.error(`请求处理错误: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || '服务器内部错误' });
    }
  }
});

// GET /api/task/:taskId - 轮询任务状态
app.get('/api/task/:taskId', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }

  const elapsed = Math.floor((Date.now() - task.startTime) / 1000);

  if (task.status === 'done') {
    res.json({ status: 'done', elapsed, result: task.result });
    scheduleTaskCleanup(task);
    return;
  }

  if (task.status === 'error') {
    res.json({ status: 'error', elapsed, error: task.error });
    scheduleTaskCleanup(task);
    return;
  }

  res.json({ status: 'processing', elapsed, progress: task.progress });
});

// GET /api/open/spec - OpenAPI 简要说明
app.get('/api/open/spec', (_req, res) => {
  res.json({
    success: true,
    data: {
      auth: {
        type: 'bearer',
        header: 'Authorization: Bearer <API_KEY>',
      },
      notes: [
        '生图支持 0~5 张参考图混合输入；可在 prompt 中用 @1 / @2 或 Image1 / Image2 精确引用。',
        '生视频支持 0~5 张参考图，并可通过 reference_map 显式声明首帧 / 中间参考 / 尾帧映射。',
      ],
      endpoints: [
        {
          method: 'POST',
          path: '/api/open/generate/image',
          description: '文生图 / 图生图',
          contentType: ['application/json', 'multipart/form-data'],
          fields: {
            prompt: '可选；多图时可用 @1、@2 或 Image1、Image2 引用参考图',
            model: '可选；默认 dreamina-image-4.1',
            ratio: '可选；默认 1:1',
            files: '可选；0~5 张参考图，字段名统一为 files',
          },
        },
        {
          method: 'POST',
          path: '/api/open/generate/video',
          description: '文生视频 / 图生视频',
          contentType: ['application/json', 'multipart/form-data'],
          fields: {
            prompt: '可选；可用 @1 / @2 标记图片引用',
            model: '可选；默认 seedance-2.0-fast',
            ratio: '可选；默认 16:9',
            duration: '可选；默认 5',
            reference_mode: '可选；全能参考 / 首帧参考 / 尾帧参考',
            reference_map: {
              first: 1,
              middle: [2, 3],
              last: 4,
            },
            files: '可选；0~5 张参考图，字段名统一为 files',
          },
        },
        {
          method: 'GET',
          path: '/api/open/tasks/:taskId',
          description: '查询任务状态',
        },
      ],
    },
  });
});

// POST /api/open/generate/image - 对外生图接口
app.post('/api/open/generate/image', authenticateOpenApi, upload.array('files', 5), async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const created = startGenerationTaskForUser({
      user: req.apiUser,
      input: {
        prompt: req.body?.prompt || '',
        ratio: req.body?.ratio || '1:1',
        duration: 4,
        count: Math.max(1, Number.parseInt(String(req.body?.count || '1'), 10) || 1),
        model: req.body?.model || 'dreamina-image-4.1',
        referenceMode: req.body?.reference_mode || req.body?.referenceMode || '全能参考',
      },
      files,
      taskRetentionMs: 60 * 60 * 1000,
      source: 'openapi',
    });

    res.json({
      success: true,
      data: {
        taskId: created.taskId,
        dbTaskId: created.dbTaskId,
        model: created.model,
        type: 'image',
        status: 'processing',
        statusUrl: `/api/open/tasks/${created.taskId}`,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/open/generate/video - 对外生视频接口
app.post('/api/open/generate/video', authenticateOpenApi, upload.array('files', 5), async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const created = startGenerationTaskForUser({
      user: req.apiUser,
      input: {
        prompt: req.body?.prompt || '',
        ratio: req.body?.ratio || '16:9',
        duration: req.body?.duration || 5,
        model: req.body?.model || 'seedance-2.0-fast',
        referenceMode: req.body?.reference_mode || req.body?.referenceMode || '全能参考',
        referenceMap: parseJsonField(req.body?.reference_map, parseJsonField(req.body?.referenceMap, null)),
      },
      files,
      taskRetentionMs: 60 * 60 * 1000,
      source: 'openapi',
    });

    res.json({
      success: true,
      data: {
        taskId: created.taskId,
        dbTaskId: created.dbTaskId,
        model: created.model,
        type: 'video',
        status: 'processing',
        statusUrl: `/api/open/tasks/${created.taskId}`,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/open/tasks/:taskId - OpenAPI 查询任务状态
app.get('/api/open/tasks/:taskId', authenticateOpenApi, (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task || Number(task.ownerUserId) !== Number(req.apiUser.id)) {
    return res.status(404).json({ error: '任务不存在' });
  }

  res.json({ success: true, data: buildOpenApiTaskPayload(task) });
});

// GET /api/video-proxy - 代理视频流，绕过 CDN 跨域限制
app.get('/api/video-proxy', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ error: '缺少 url 参数' });
  }

  try {
    console.log(`[video-proxy] 代理视频: ${videoUrl.substring(0, 100)}...`);

    const response = await fetch(videoUrl, {
      headers: {
        'User-Agent': FAKE_HEADERS['User-Agent'],
        Referer: 'https://jimeng.jianying.com/',
      },
    });

    if (!response.ok) {
      console.error(`[video-proxy] 上游错误: ${response.status}`);
      return res.status(response.status).json({ error: `视频获取失败: ${response.status}` });
    }

    // 转发响应头
    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    const contentLength = response.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // 流式转发视频数据
    const reader = response.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        if (!res.write(value)) {
          await new Promise((r) => res.once('drain', r));
        }
      }
    };
    pump().catch((err) => {
      console.error(`[video-proxy] 流传输错误: ${err.message}`);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
  } catch (error) {
    console.error(`[video-proxy] 错误: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: '视频代理失败' });
    }
  }
});

// multer 错误处理
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE')
      return res.status(413).json({ error: '文件大小超过限制 (最大20MB)' });
    if (err.code === 'LIMIT_FILE_COUNT')
      return res.status(400).json({ error: '文件数量超过限制 (最多5个)' });
    return res.status(400).json({ error: `上传错误: ${err.message}` });
  }
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// ============================================================
// 批量管理功能 API 路由
// ============================================================

// -------------------- 项目管理 --------------------
// GET /api/projects - 获取项目列表
app.get('/api/projects', authenticate, (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const projects = projectService.getAllProjects(req.user.id, isAdmin);
    res.json({ success: true, data: projects });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/projects - 创建项目
app.post('/api/projects', authenticate, (req, res) => {
  try {
    const { name, description, settings } = req.body;
    if (!name) {
      return res.status(400).json({ error: '项目名称不能为空' });
    }
    const project = projectService.createProject({ name, description, settings, user_id: req.user.id });
    res.json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/projects/:id - 获取项目详情
app.get('/api/projects/:id', authenticate, (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const project = projectService.getProjectById(req.params.id, req.user.id, isAdmin);
    if (!project) {
      return res.status(404).json({ error: '项目不存在或无权访问' });
    }
    res.json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/projects/:id - 更新项目
app.put('/api/projects/:id', authenticate, (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const project = projectService.getProjectById(req.params.id, req.user.id, isAdmin);
    if (!project) {
      return res.status(404).json({ error: '项目不存在或无权访问' });
    }
    // 非管理员只能更新自己的项目
    if (!isAdmin && project.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权修改此项目' });
    }
    const { name, description, settings, video_save_path, default_concurrent, default_min_interval, default_max_interval } = req.body;
    const updated = projectService.updateProject(req.params.id, {
      name,
      description,
      settings_json: settings ? JSON.stringify(settings) : undefined,
      video_save_path,
      default_concurrent,
      default_min_interval,
      default_max_interval,
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/projects/:id - 删除项目
app.delete('/api/projects/:id', authenticate, (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const project = projectService.getProjectById(req.params.id, req.user.id, isAdmin);
    if (!project) {
      return res.status(404).json({ error: '项目不存在或无权访问' });
    }
    // 非管理员只能删除自己的项目
    if (!isAdmin && project.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权删除此项目' });
    }
    projectService.deleteProject(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/projects/:id/tasks - 获取项目下的任务列表
app.get('/api/projects/:id/tasks', authenticate, (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const project = projectService.getProjectById(req.params.id, req.user.id, isAdmin);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在或无权访问' });
    }

    const { status, taskKind, sourceTaskId, rowGroupId } = req.query;
    const tasks = taskService.getTasksByProjectId(req.params.id, {
      status: typeof status === 'string' ? status : undefined,
      taskKind: typeof taskKind === 'string' ? taskKind : undefined,
      sourceTaskId: sourceTaskId !== undefined ? Number(sourceTaskId) : undefined,
      rowGroupId: typeof rowGroupId === 'string' ? rowGroupId : undefined,
    }, req.user.id, isAdmin);
    res.json({ success: true, data: tasks });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------- 任务管理 --------------------
// GET /api/tasks/:id - 获取任务详情
app.get('/api/tasks/:id', authenticate, (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const task = taskService.getTaskById(req.params.id, req.user.id, isAdmin);
    if (!task) {
      return res.status(404).json({ error: '任务不存在或无权访问' });
    }
    res.json({ success: true, data: task });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/projects/:projectId/tasks - 创建任务
app.post('/api/projects/:projectId/tasks', authenticate, (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const project = projectService.getProjectById(req.params.projectId, req.user.id, isAdmin);
    if (!project) {
      return res.status(404).json({ success: false, error: '项目不存在或无权访问' });
    }
    // 非管理员只能在自己的项目中创建任务
    if (!isAdmin && project.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: '无权在此项目中创建任务' });
    }

    const {
      prompt = '',
      taskKind = 'output',
      rowIndex,
      videoCount,
      sourceTaskId,
      rowGroupId,
      outputIndex,
    } = req.body || {};

    if (taskKind !== 'draft' && !String(prompt).trim()) {
      return res.status(400).json({ success: false, error: '任务提示词不能为空' });
    }

    const task = taskService.createTask({
      projectId: req.params.projectId,
      prompt,
      taskKind,
      rowIndex,
      videoCount,
      sourceTaskId,
      rowGroupId,
      outputIndex,
      userId: req.user.id,
    });
    res.json({ success: true, data: task });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/tasks/:id - 更新任务
app.put('/api/tasks/:id', authenticate, (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const task = taskService.getTaskById(req.params.id, req.user.id, isAdmin);
    if (!task) {
      return res.status(404).json({ error: '任务不存在或无权访问' });
    }
    // 非管理员只能更新自己的任务
    if (!isAdmin && task.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权修改此任务' });
    }
    const updates = req.body;
    const updated = taskService.updateTask(req.params.id, updates);
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/tasks/:id - 删除任务
app.delete('/api/tasks/:id', authenticate, (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const task = taskService.getTaskById(req.params.id, req.user.id, isAdmin);
    if (!task) {
      return res.status(404).json({ error: '任务不存在或无权访问' });
    }
    // 非管理员只能删除自己的任务
    if (!isAdmin && task.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权删除此任务' });
    }
    taskService.deleteTask(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tasks/:id/assets - 添加任务素材
app.post('/api/tasks/:id/assets', authenticate, upload.fields([
  { name: 'images', maxCount: 5 },
  { name: 'audios', maxCount: 2 },
]), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const task = taskService.getTaskById(req.params.id, req.user.id, isAdmin);
    if (!task) {
      return res.status(404).json({ error: '任务不存在或无权访问' });
    }
    // 非管理员只能为自己的任务添加素材
    if (!isAdmin && task.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权为此任务添加素材' });
    }

    const files = req.files;
    const results = [];

    // 处理图片
    if (files.images) {
      for (const file of files.images) {
        const saveDir = path.join(__dirname, '../data/assets/tasks', req.params.id);
        const filename = `${Date.now()}_${file.originalname}`;

        // 确保目录存在
        const fs = await import('fs');
        if (!fs.existsSync(saveDir)) {
          fs.mkdirSync(saveDir, { recursive: true });
        }

        const filePath = path.join(saveDir, filename);
        fs.writeFileSync(filePath, file.buffer);

        const asset = taskService.addTaskAsset(req.params.id, {
          assetType: 'image',
          filePath,
          sortOrder: results.filter(r => r.asset_type === 'image').length,
        });
        results.push(asset);
      }
    }

    // 处理音频
    if (files.audios) {
      for (const file of files.audios) {
        const saveDir = path.join(__dirname, '../data/assets/tasks', req.params.id);
        const filename = `${Date.now()}_${file.originalname}`;

        const fs = await import('fs');
        if (!fs.existsSync(saveDir)) {
          fs.mkdirSync(saveDir, { recursive: true });
        }

        const filePath = path.join(saveDir, filename);
        fs.writeFileSync(filePath, file.buffer);

        const asset = taskService.addTaskAsset(req.params.id, {
          assetType: 'audio',
          filePath,
          sortOrder: results.filter(r => r.asset_type === 'audio').length,
        });
        results.push(asset);
      }
    }

    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/tasks/:id/assets - 获取任务素材列表
app.get('/api/tasks/:id/assets', (req, res) => {
  try {
    const assets = taskService.getTaskAssets(req.params.id);
    res.json({ success: true, data: assets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/tasks/assets/:assetId - 删除任务素材
app.delete('/api/tasks/assets/:assetId', (req, res) => {
  try {
    taskService.deleteTaskAsset(req.params.assetId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tasks/:id/generate - 单个任务生成
app.post('/api/tasks/:id/generate', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const task = taskService.getTaskById(req.params.id, req.user.id, isAdmin);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }

    const { settings, provider, resolvedSession } = resolveGenerationRuntime(req.user.id);
    const sessionId = resolvedSession?.sessionId || '';
    const fallbackSessionCandidates = buildSavedSessionFallbackCandidates(req.user.id, resolvedSession);
    const normalizedModel = provider.normalizeModel(settings.model);
    const generationType = getModelCategory(normalizedModel);
    const generate = getGenerationHandler(provider, normalizedModel);

    const supportsAutoPool = [DREAMINA_PROVIDER_ID, LEGACY_JIMENG_PROVIDER_ID].includes(provider.id);
    if (provider.requiresSession && !sessionId && !supportsAutoPool) {
      return res.status(400).json({ error: provider.getMissingCredentialMessage() });
    }

    if (task.task_kind === 'draft') {
      const validation = validateBatchTasks(task.project_id, [task.id], req.user.id, isAdmin);
      if (validation.error) {
        return res.status(validation.statusCode || 400).json({ success: false, error: validation.error });
      }
      if (validation.invalidTasks.length > 0) {
        return res.status(400).json({
          success: false,
          error: validation.invalidTasks[0]?.reason || '当前任务无法启动生成',
          invalidTasks: validation.invalidTasks,
        });
      }

      const activeOutputTasks = taskService
        .getOutputTasksBySourceTaskId(task.id)
        .filter((outputTask) => !['done', 'error', 'cancelled'].includes(outputTask.status));
      if (activeOutputTasks.length > 0) {
        return res.status(400).json({ success: false, error: '该任务行已有生成中的记录，请等待当前任务结束后再试' });
      }

      const outputTasks = taskService.expandDraftTaskToOutputTasks(task.id);
      if (outputTasks.length === 0) {
        return res.status(400).json({ success: false, error: '没有可启动的输出任务' });
      }

      const batchId = batchService.createBatch({
        projectId: Number(task.project_id),
        taskIds: outputTasks.map((outputTask) => outputTask.id),
        name: `row-${task.id}`,
        concurrent: Math.max(1, Number(task.video_count) || 1),
      });

      await batchService.startBatch(batchId, {
        providerId: provider.id,
        sessionId,
        onProgress: (data) => {
          console.log('[row-batch] 进度更新:', data);
        },
        onTaskComplete: (data) => {
          console.log('[row-batch] 任务完成:', data);
        },
        onBatchComplete: (data) => {
          console.log('[row-batch] 批量任务完成:', data);
        },
      });

      return res.json({
        success: true,
        data: {
          taskId: Number(task.id),
          batchId,
          totalTasks: outputTasks.length,
          outputTaskIds: outputTasks.map((outputTask) => outputTask.id),
          message: '任务生成已启动',
        },
      });
    }

    const assets = taskService.getTaskAssets(req.params.id);
    const imageAssets = assets.filter(a => a.asset_type === 'image');
    const files = [];
    if (imageAssets.length > 0) {
      for (const asset of imageAssets) {
        try {
          const buffer = readFileSync(asset.file_path);
          files.push({
            buffer,
            originalname: asset.file_path.split('/').pop(),
            size: buffer.length,
          });
        } catch (err) {
          console.error(`读取图片文件失败：${asset.file_path}`, err.message);
        }
      }
    }

    if (generationType === 'video' && files.length === 0) {
      return res.status(400).json({ error: '任务没有图片素材，请至少上传一张参考图片' });
    }

    if (imageAssets.length > 0 && files.length === 0) {
      return res.status(400).json({ error: '没有可用的图片文件' });
    }

    taskService.updateTaskStatus(task.id, 'generating', {
      task_kind: 'output',
      progress: '正在准备...',
      error_message: null,
      submit_id: null,
      history_id: null,
      item_id: null,
      video_url: null,
      completed_at: null,
      submitted_at: null,
    });

    res.json({
      success: true,
      data: {
        taskId: Number(task.id),
        message: '任务生成已启动',
      },
    });

    generate({
      prompt: task.prompt,
      ratio: settings.ratio || '16:9',
      duration: parseInt(settings.duration) || 5,
      files,
      sessionId,
      fallbackSessionCandidates,
      model: normalizedModel,
      settings,
      onProgress: async (progress) => {
        console.log(`[task ${task.id}] 进度：${progress}`);
        try {
          taskService.updateTask(task.id, { progress });
        } catch (err) {
          console.error('[任务生成] 保存进度失败:', err.message);
        }
      },
      onSubmitId: async (submitId) => {
        try {
          taskService.updateTask(task.id, {
            submit_id: submitId,
            submitted_at: new Date().toISOString(),
          });
        } catch (err) {
          console.error('[任务生成] 保存 submitId 失败:', err.message);
        }
      },
      onHistoryId: async (historyId) => {
        try {
          taskService.updateTask(task.id, {
            history_id: historyId,
            status: 'generating',
          });
        } catch (err) {
          console.error('[任务生成] 保存 historyId 失败:', err.message);
        }
      },
      onItemId: async (itemId) => {
        try {
          taskService.updateTask(task.id, { item_id: itemId });
        } catch (err) {
          console.error('[任务生成] 保存 itemId 失败:', err.message);
        }
      },
      onVideoReady: async (videoUrl) => {
        try {
          taskService.updateTask(task.id, { video_url: videoUrl });
        } catch (err) {
          console.error('[任务生成] 保存 videoUrl 失败:', err.message);
        }
      },
      onImageReady: async (imageUrl) => {
        try {
          taskService.updateTask(task.id, { video_url: imageUrl });
        } catch (err) {
          console.error('[任务生成] 保存 imageUrl 失败:', err.message);
        }
      },
    })
      .then((result) => {
        const mediaUrl = getGenerationResultUrl(result, normalizedModel);
        taskService.updateTaskStatus(task.id, 'done', {
          submit_id: result.submitId || null,
          history_id: result.historyId || null,
          item_id: result.itemId || null,
          video_url: mediaUrl,
          progress: '',
          error_message: null,
        });
        console.log(`[task ${task.id}] ${generationType === 'image' ? '图片' : '视频'}生成成功：${mediaUrl}`);
      })
      .catch((err) => {
        if (
          handlePendingImageTask({
            error: err,
            generationType,
            dbTaskId: task.id,
            userId: req.user.id,
            sessionId,
            providerId: provider.id,
            model: normalizedModel,
            prompt: task.prompt,
            requestedCount: Math.max(1, Number.parseInt(String(task.video_count || '1'), 10) || 1),
          })
        ) {
          return;
        }

        taskService.updateTaskStatus(task.id, 'error', {
          progress: '',
          error_message: err.message,
        });
        console.error(`[task ${task.id}] ${generationType === 'image' ? '图片' : '视频'}生成失败：${err.message}`);
      });
  } catch (error) {
    console.error(`请求处理错误：${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || '服务器内部错误' });
    }
  }
});


// POST /api/tasks/:id/cancel - 取消任务（包括正在生成的任务）
app.post('/api/tasks/:id/cancel', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const task = taskService.getTaskById(req.params.id, req.user.id, isAdmin);
    if (!task) {
      return res.status(404).json({ error: '任务不存在或无权访问' });
    }
    // 非管理员只能取消自己的任务
    if (!isAdmin && task.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权取消此任务' });
    }

    const db = getDatabase();
    const activeBatches = db.prepare(`
      SELECT id, task_ids
      FROM batches
      WHERE status IN ('pending', 'running', 'paused')
      ORDER BY id DESC
    `).all();

    const parentBatch = activeBatches.find((batch) => {
      try {
        const taskIds = JSON.parse(batch.task_ids || '[]').map(Number);
        return taskIds.includes(Number(task.id));
      } catch {
        return false;
      }
    });

    if (parentBatch && await batchService.cancelBatchTask(parentBatch.id, task.id)) {
      res.json({ success: true, message: '任务取消成功' });
      return;
    }

    // 普通任务直接取消
    taskService.updateTaskStatus(req.params.id, 'cancelled', {
      progress: '',
      error_message: '用户取消任务',
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tasks/:id/collect - 二次采集视频（根据 history_id）
app.post('/api/tasks/:id/collect', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const task = taskService.getTaskById(req.params.id, req.user.id, isAdmin);
    if (!task) {
      return res.status(404).json({ error: '任务不存在或无权访问' });
    }
    // 非管理员只能采集自己的任务
    if (!isAdmin && task.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权采集此任务' });
    }
    if (!isOutputTask(task)) {
      return res.status(400).json({ error: '只有输出任务可以采集视频' });
    }
    if (!task.history_id) {
      return res.status(400).json({ error: '任务没有 history_id，无法采集' });
    }

    const resolvedSession = jimengSessionService.resolveEffectiveSession(req.user.id);
    const sessionId = req.body.sessionId || resolvedSession.sessionId;
    if (!sessionId) {
      return res.status(400).json({ error: getMissingSessionErrorMessage() });
    }

    const resolved = await resolveTaskVideoByHistory(sessionId, task);
    if (!resolved.itemId) {
      return res.status(404).json({ error: '即梦 API 未找到该历史记录对应的视频条目' });
    }
    if (!resolved.videoUrl) {
      return res.status(400).json({ error: '历史记录中没有视频 URL，可能还在生成中' });
    }

    const db = getDatabase();
    persistResolvedVideoTask(db, task.id, resolved);

    res.json({
      success: true,
      data: {
        videoUrl: resolved.videoUrl,
        historyId: task.history_id,
        itemId: resolved.itemId,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/batch/:batchId/collect - 批量二次采集视频
app.post('/api/batch/:batchId/collect', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const batch = batchService.getBatchById(req.params.batchId, req.user.id, isAdmin);
    if (!batch) {
      return res.status(404).json({ error: '批量任务不存在或无权访问' });
    }

    const taskIds = JSON.parse(batch.task_ids || '[]');
    const resolvedSession = jimengSessionService.resolveEffectiveSession(req.user.id);
    const sessionId = req.body.sessionId || resolvedSession.sessionId;

    if (!sessionId) {
      return res.status(400).json({ error: getMissingSessionErrorMessage() });
    }

    const db = getDatabase();
    const candidateTasks = taskIds
      .map((taskId) => taskService.getTaskById(taskId, req.user.id, isAdmin))
      .filter((task) => task && isOutputTask(task) && task.history_id && !task.video_url);

    if (candidateTasks.length === 0) {
      return res.json({
        success: true,
        data: { results: [], total: 0, message: '没有需要采集的任务' },
      });
    }

    const historyIds = candidateTasks.map((task) => String(task.history_id));
    const itemIdByHistoryId = await resolveItemIdsByHistoryIds(sessionId, historyIds);
    const itemIds = [...new Set(candidateTasks.map((task) => task.item_id || itemIdByHistoryId.get(String(task.history_id)) || null).filter(Boolean).map(String))];
    const items = await fetchLocalItemsByItemIds(sessionId, itemIds);

    const itemByItemId = new Map();
    const itemByHistoryId = new Map();
    for (const item of items) {
      const itemId = extractItemId(item);
      const historyId = extractHistoryId(item);
      if (itemId) {
        itemByItemId.set(String(itemId), item);
      }
      if (historyId) {
        itemByHistoryId.set(String(historyId), item);
      }
    }

    const results = candidateTasks.map((task) => {
      const historyId = String(task.history_id);
      const itemId = String(task.item_id || itemIdByHistoryId.get(historyId) || '');
      const item = (itemId && itemByItemId.get(itemId)) || itemByHistoryId.get(historyId) || null;
      const videoUrl = item ? extractVideoUrl(item) : null;

      persistResolvedVideoTask(db, task.id, {
        itemId: itemId || null,
        videoUrl,
      });

      if (videoUrl) {
        return {
          taskId: task.id,
          success: true,
          itemId: itemId || null,
          videoUrl,
        };
      }

      return {
        taskId: task.id,
        success: false,
        itemId: itemId || null,
        error: itemId ? '历史记录中没有视频 URL，可能还在生成中' : '即梦 API 未返回该历史记录，可能仍在生成中',
      };
    });

    res.json({
      success: true,
      data: { results, total: results.length },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tasks/:id/download - 下载任务视频
app.post('/api/tasks/:id/download', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const task = taskService.getTaskById(req.params.id, req.user.id, isAdmin);
    if (!task) {
      return res.status(404).json({ error: '任务不存在或无权访问' });
    }
    // 非管理员只能下载自己的任务
    if (!isAdmin && task.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权下载此任务' });
    }

    const downloadPath = videoDownloader.getDefaultDownloadPath();
    const result = await videoDownloader.downloadVideoByTaskId(task.id, downloadPath);

    if (result.success) {
      res.json({ success: true, data: result });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tasks/:id/open-folder - 打开视频所在文件夹
app.post('/api/tasks/:id/open-folder', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const task = taskService.getTaskById(req.params.id, req.user.id, isAdmin);
    if (!task) {
      return res.status(404).json({ error: '任务不存在或无权访问' });
    }
    // 非管理员只能打开自己的任务文件夹
    if (!isAdmin && task.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权访问此任务' });
    }
    if (!task.video_path) {
      return res.status(400).json({ error: '视频尚未下载' });
    }

    const result = await videoDownloader.openVideoFolder(task.video_path);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- 批量生成 --------------------
// POST /api/batch/generate - 创建并启动批量任务
app.post('/api/batch/generate', authenticate, async (req, res) => {
  try {
    const { projectId, taskIds, name = '', concurrent = 5 } = req.body;
    const isAdmin = req.user.role === 'admin';

    if (!projectId || !Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ success: false, error: '参数不完整' });
    }

    const validation = validateBatchTasks(projectId, taskIds, req.user.id, isAdmin);
    if (validation.error) {
      return res.status(validation.statusCode || 400).json({ success: false, error: validation.error });
    }
    if (validation.invalidTasks.length > 0) {
      return res.status(400).json({
        success: false,
        error: '部分任务无法启动批量生成',
        invalidTasks: validation.invalidTasks,
      });
    }

    const { provider, resolvedSession } = resolveGenerationRuntime(req.user.id);
    const sessionId = resolvedSession?.sessionId || '';
    const supportsAutoPool = [DREAMINA_PROVIDER_ID, LEGACY_JIMENG_PROVIDER_ID].includes(provider.id);
    if (provider.requiresSession && !sessionId && !supportsAutoPool) {
      return res.status(400).json({ success: false, error: provider.getMissingCredentialMessage() });
    }

    const outputTasks = taskService.expandDraftTasksToOutputTasks(validation.taskIds);
    if (outputTasks.length === 0) {
      return res.status(400).json({ success: false, error: '没有可启动的输出任务' });
    }

    const batchId = batchService.createBatch({
      projectId: Number(projectId),
      taskIds: outputTasks.map((task) => task.id),
      name,
      concurrent: Number(concurrent) || 5,
    });

    await batchService.startBatch(batchId, {
      providerId: provider.id,
      sessionId,
      onProgress: (data) => {
        console.log('[batch] 进度更新:', data);
      },
      onTaskComplete: (data) => {
        console.log('[batch] 任务完成:', data);
      },
      onBatchComplete: (data) => {
        console.log('[batch] 批量任务完成:', data);
      },
    });

    res.json({
      success: true,
      data: {
        batchId,
        totalTasks: outputTasks.length,
        draftTaskIds: validation.taskIds,
        outputTaskIds: outputTasks.map((task) => task.id),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/batch/:batchId/status - 获取批量任务状态
app.get('/api/batch/:batchId/status', authenticate, (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const status = batchService.getBatchStatus(req.params.batchId, req.user.id, isAdmin);
    if (!status) {
      return res.status(404).json({ success: false, error: '批量任务不存在或无权访问' });
    }
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/batch/:batchId/pause - 暂停批量任务
app.post('/api/batch/:batchId/pause', authenticate, (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const batch = batchService.getBatchById(req.params.batchId, req.user.id, isAdmin);
    if (!batch) {
      return res.status(404).json({ success: false, error: '批量任务不存在或无权访问' });
    }

    const result = batchService.pauseBatch(req.params.batchId);
    if (!result) {
      return res.status(404).json({ success: false, error: '批量任务不存在或无权访问' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/batch/:batchId/resume - 恢复批量任务
app.post('/api/batch/:batchId/resume', authenticate, (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const batch = batchService.getBatchById(req.params.batchId, req.user.id, isAdmin);
    if (!batch) {
      return res.status(404).json({ success: false, error: '批量任务不存在或无权访问' });
    }

    const result = batchService.resumeBatch(req.params.batchId);
    if (!result) {
      return res.status(404).json({ success: false, error: '批量任务不存在或无权访问' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/batch/:batchId/cancel - 取消批量任务
app.post('/api/batch/:batchId/cancel', authenticate, (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const batch = batchService.getBatchById(req.params.batchId, req.user.id, isAdmin);
    if (!batch) {
      return res.status(404).json({ success: false, error: '批量任务不存在或无权访问' });
    }

    const result = batchService.cancelBatch(req.params.batchId);
    if (!result) {
      return res.status(404).json({ success: false, error: '批量任务不存在或无权访问' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// -------------------- 全局设置 --------------------
// GET /api/settings - 获取全局设置
app.get('/api/settings', (req, res) => {
  try {
    const settings = settingsService.getAllSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/settings - 更新全局设置
app.put('/api/settings', (req, res) => {
  try {
    const settings = req.body;
    const updated = settingsService.updateSettings(settings);
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/settings/session-accounts - 获取当前用户的 SessionID 账号列表
app.get('/api/settings/session-accounts', authenticate, (req, res) => {
  try {
    const accounts = jimengSessionService.listUserAccounts(req.user.id);
    const effective = jimengSessionService.resolveEffectiveSession(req.user.id);
    res.json({ success: true, data: { accounts, effective } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/settings/session-accounts - 新增 SessionID 账号
app.post('/api/settings/session-accounts', authenticate, (req, res) => {
  try {
    const account = jimengSessionService.createUserAccount(req.user.id, req.body || {});
    res.json({ success: true, data: account });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/settings/session-accounts/:id - 更新 SessionID 账号
app.put('/api/settings/session-accounts/:id', authenticate, (req, res) => {
  try {
    const account = jimengSessionService.updateUserAccount(
      req.user.id,
      Number(req.params.id),
      req.body || {}
    );
    res.json({ success: true, data: account });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/settings/session-accounts/:id - 删除 SessionID 账号
app.delete('/api/settings/session-accounts/:id', authenticate, (req, res) => {
  try {
    const result = jimengSessionService.deleteUserAccount(req.user.id, Number(req.params.id));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/settings/session-accounts/:id/default - 设为默认账号
app.post('/api/settings/session-accounts/:id/default', authenticate, (req, res) => {
  try {
    const account = jimengSessionService.setDefaultAccount(req.user.id, Number(req.params.id));
    res.json({ success: true, data: account });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/settings/session-accounts/:id/refresh-session - 使用已保存凭证刷新 SessionID
app.post('/api/settings/session-accounts/:id/refresh-session', authenticate, async (req, res) => {
  try {
    const account = await jimengSessionService.refreshUserAccountSession(req.user.id, Number(req.params.id));
    res.json({ success: true, data: account });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/settings/session-accounts/test - 测试 SessionID
app.post('/api/settings/session-accounts/test', authenticate, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'SessionID 不能为空' });
    }

    const result = await jimengSessionService.testSessionId(sessionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 账号池管理模块 (由 Antigravity 自动化实现)
// ============================================================

// [已移除冗余的账号池管理路由，使用文件末尾的管理员专用路由]

// -------------------- 下载 API --------------------
// GET /api/download/file?path=xxx - 下载文件
app.get('/api/download/file', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: '文件路径不能为空' });
    }

    const fs = await import('fs');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '文件不存在' });
    }

    res.download(filePath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function getDownloadMimeType(filename = '') {
  const lowerName = String(filename).toLowerCase();

  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  if (lowerName.endsWith('.bmp')) return 'image/bmp';
  if (lowerName.endsWith('.mov')) return 'video/quicktime';
  if (lowerName.endsWith('.webm')) return 'video/webm';
  if (lowerName.endsWith('.mkv')) return 'video/x-matroska';

  return 'video/mp4';
}

function isDownloadFileMissingError(errorMessage = '') {
  return errorMessage === '任务尚未下载到服务器' || errorMessage === '文件不存在，可能已被删除' || errorMessage === '视频文件不存在，可能已被删除';
}

function sendDownloadedVideoFile(res, result) {
  res.setHeader('Content-Type', getDownloadMimeType(result.filename));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.download(result.filePath, result.filename);
}

// POST /api/download/tasks/:id/file-token - 创建一次性下载 token
app.post('/api/download/tasks/:id/file-token', authenticate, async (req, res) => {
  try {
    const taskId = req.params.id;
    const result = videoDownloader.getDownloadedVideoFileByTaskId(taskId);

    if (!result.success) {
      const statusCode = result.error === '任务不存在'
        ? 404
        : isDownloadFileMissingError(result.error)
          ? 400
          : 500;
      return res.status(statusCode).json({ error: result.error });
    }

    const token = createDownloadToken(taskId, req.user.id);
    res.json({ success: true, data: { token } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/download/file-by-token - 使用一次性 token 下载服务器本地已保存的视频文件
app.get('/api/download/file-by-token', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    const userIdParam = req.query.userId;
    const userId = userIdParam === undefined || userIdParam === null || userIdParam === ''
      ? null
      : Number(userIdParam);
    if (!token) {
      return res.status(400).json({ error: '下载参数无效' });
    }

    const record = consumeDownloadToken(token, Number.isFinite(userId) ? userId : null);
    if (!record) {
      return res.status(401).json({ error: '下载链接已失效，请重试' });
    }

    const result = videoDownloader.getDownloadedVideoFileByTaskId(record.taskId);
    if (!result.success) {
      const statusCode = result.error === '任务不存在'
        ? 404
        : isDownloadFileMissingError(result.error)
          ? 400
          : 500;
      return res.status(statusCode).json({ error: result.error });
    }

    sendDownloadedVideoFile(res, result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/download/tasks/:id/file - 下载服务器本地已保存的视频文件
app.get('/api/download/tasks/:id/file', authenticate, async (req, res) => {
  try {
    const taskId = req.params.id;
    const result = videoDownloader.getDownloadedVideoFileByTaskId(taskId);

    if (!result.success) {
      const statusCode = result.error === '任务不存在'
        ? 404
        : isDownloadFileMissingError(result.error)
          ? 400
          : 500;
      return res.status(statusCode).json({ error: result.error });
    }

    sendDownloadedVideoFile(res, result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 下载管理 API 路由
// ============================================================

// GET /api/download/tasks - 获取下载任务列表
app.get('/api/download/tasks', authenticate, (req, res) => {
  try {
    const { status = 'all', type = 'all', page = 1, pageSize = 20 } = req.query;
    const isAdmin = req.user.role === 'admin';
    const result = videoDownloader.getDownloadTasks({
      status,
      type,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      userId: req.user.id,
      isAdmin,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/download/refresh - 刷新下载任务列表（使用 get_local_item_list 获取已生成的视频）
app.post('/api/download/refresh', authenticate, async (req, res) => {
  try {
    const db = getDatabase();
    const resolvedSession = jimengSessionService.resolveEffectiveSession(req.user.id);
    const sessionId = resolvedSession.sessionId;
    const isAdmin = req.user.role === 'admin';
    const recoveredTaskIds = recoverInterruptedGeneratingTasks({
      userId: req.user.id,
      isAdmin,
    });

    if (!sessionId) {
      return res.status(400).json({ error: getMissingSessionErrorMessage() });
    }

    // 非管理员用户只能刷新自己的任务
    const userWhereClause = isAdmin ? '' : 'AND t.user_id = ?';
    const userParams = isAdmin ? [] : [req.user.id];

    const tasks = db.prepare(`
      SELECT t.id, t.history_id, t.item_id, t.status, t.video_url, t.created_at
      FROM tasks t
      WHERE t.task_kind = 'output'
        AND t.history_id IS NOT NULL
        AND t.video_url IS NULL
        AND t.status != 'cancelled'
        ${userWhereClause}
    `).all(...userParams);

    if (tasks.length === 0) {
      return res.json({
        success: true,
        data: {
          refreshed: 0,
          total: 0,
          generating: 0,
          generatingTasks: [],
          recovered: recoveredTaskIds.length,
          recoveredTaskIds,
          message: recoveredTaskIds.length > 0 ? `已修复 ${recoveredTaskIds.length} 个中断任务` : '没有需要刷新的任务',
        },
      });
    }

    const historyIds = tasks.map((task) => String(task.history_id));
    const itemIdByHistoryId = await resolveItemIdsByHistoryIds(sessionId, historyIds);
    const itemIds = [...new Set(tasks.map((task) => task.item_id || itemIdByHistoryId.get(String(task.history_id)) || null).filter(Boolean).map(String))];
    const items = await fetchLocalItemsByItemIds(sessionId, itemIds);

    const itemByItemId = new Map();
    const itemByHistoryId = new Map();
    for (const item of items) {
      const itemId = extractItemId(item);
      const historyId = extractHistoryId(item);
      if (itemId) {
        itemByItemId.set(String(itemId), item);
      }
      if (historyId) {
        itemByHistoryId.set(String(historyId), item);
      }
    }

    let refreshedCount = 0;
    const generatingTasks = [];

    for (const task of tasks) {
      const historyId = String(task.history_id);
      const itemId = String(task.item_id || itemIdByHistoryId.get(historyId) || '');
      const item = (itemId && itemByItemId.get(itemId)) || itemByHistoryId.get(historyId) || null;
      const videoUrl = item ? extractVideoUrl(item) : null;

      persistResolvedVideoTask(db, task.id, {
        itemId: itemId || null,
        videoUrl,
      });

      if (videoUrl) {
        refreshedCount++;
      } else {
        generatingTasks.push({
          taskId: task.id,
          historyId: task.history_id,
          itemId: itemId || null,
          createdAt: task.created_at,
        });
      }
    }

    res.json({
      success: true,
      data: {
        refreshed: refreshedCount,
        total: tasks.length,
        generating: generatingTasks.length,
        generatingTasks,
        recovered: recoveredTaskIds.length,
        recoveredTaskIds,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/download/sync-from-jimeng - 从即梦平台同步所有已生成的视频记录
app.post('/api/download/sync-from-jimeng', authenticate, async (req, res) => {
  try {
    const db = getDatabase();
    // 使用用户的即梦 SessionID（而非登录 session）
    const resolvedSession = jimengSessionService.resolveEffectiveSession(req.user.id);
    const sessionId = resolvedSession.sessionId;

    if (!sessionId) {
      return res.status(400).json({ error: getMissingSessionErrorMessage() });
    }

    const localTasks = db.prepare(`
      SELECT id, history_id, video_url FROM tasks WHERE history_id IS NOT NULL
    `).all();
    const localTaskMap = new Map(localTasks.map((task) => [task.history_id, task]));
    const defaultProject = ensureDefaultProjectForUser(req.user.id);

    const pickFirstArray = (...values) =>
      values.find((value) => Array.isArray(value) && value.length >= 0) || [];

    const extractItemId = (item) =>
      item?.item_id ||
      item?.local_item_id ||
      item?.common_attr?.id ||
      item?.id ||
      null;

    const extractHistoryId = (item) =>
      item?.history_id ||
      item?.history_record_id ||
      item?.common_attr?.history_id ||
      item?.item_base?.history_id ||
      null;

    const extractPrompt = (item, fallbackId) =>
      item?.prompt ||
      item?.desc ||
      item?.description ||
      item?.common_attr?.prompt ||
      item?.common_attr?.desc ||
      `即梦作品 ${fallbackId}`;

    const extractVideoUrl = (item) =>
      item?.video?.transcoded_video?.origin?.video_url ||
      item?.video?.download_url ||
      item?.video?.play_url ||
      item?.video?.url ||
      item?.video?.play_addr?.url_list?.[0] ||
      item?.item_video?.url ||
      null;

    const chunkArray = (items, size) => {
      const chunks = [];
      for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
      }
      return chunks;
    };

    const assetResult = await jimengRequest(
      'post',
      '/mweb/v1/get_asset_list',
      sessionId,
      null,
      { data: {} }
    );

    const assetItems = pickFirstArray(
      assetResult?.asset_list,
      assetResult?.item_list,
      assetResult?.list,
      assetResult?.data?.asset_list,
      assetResult?.data?.item_list,
      assetResult?.data?.list
    );

    if (assetItems.length === 0) {
      return res.json({
        success: true,
        data: { synced: 0, total: 0, message: '即梦平台暂无可同步作品' },
      });
    }

    const normalizedAssets = [];
    const seenKeys = new Set();

    for (const item of assetItems) {
      const itemId = extractItemId(item);
      const historyId = extractHistoryId(item);
      const uniqueKey = historyId || itemId;

      if (!uniqueKey || seenKeys.has(uniqueKey)) {
        continue;
      }

      seenKeys.add(uniqueKey);
      normalizedAssets.push({
        itemId: itemId ? String(itemId) : null,
        historyId: historyId ? String(historyId) : null,
        prompt: extractPrompt(item, uniqueKey),
        videoUrl: extractVideoUrl(item),
      });
    }

    const detailByItemId = new Map();
    const detailByHistoryId = new Map();
    const itemIds = normalizedAssets
      .map((item) => item.itemId)
      .filter(Boolean);

    for (const chunk of chunkArray(itemIds, 20)) {
      const detailResult = await jimengRequest(
        'post',
        '/mweb/v1/get_local_item_list',
        sessionId,
        null,
        {
          data: {
            item_id_list: chunk,
            pack_item_opt: {
              scene: 1,
              need_data_integrity: true,
            },
            is_for_video_download: true,
          },
        }
      );

      const detailItems = pickFirstArray(
        detailResult?.item_list,
        detailResult?.local_item_list,
        detailResult?.list,
        detailResult?.data?.item_list,
        detailResult?.data?.local_item_list,
        detailResult?.data?.list
      );

      for (const item of detailItems) {
        const itemId = extractItemId(item);
        const historyId = extractHistoryId(item);
        const videoUrl = extractVideoUrl(item);

        if (itemId) {
          detailByItemId.set(String(itemId), {
            historyId: historyId ? String(historyId) : null,
            videoUrl,
          });
        }

        if (historyId) {
          detailByHistoryId.set(String(historyId), {
            itemId: itemId ? String(itemId) : null,
            videoUrl,
          });
        }
      }
    }

    let syncedCount = 0;
    const syncedItems = [];

    for (const item of normalizedAssets) {
      const detail =
        (item.itemId && detailByItemId.get(item.itemId)) ||
        (item.historyId && detailByHistoryId.get(item.historyId)) ||
        null;

      const historyId = detail?.historyId || item.historyId;
      const videoUrl = detail?.videoUrl || item.videoUrl;

      if (!historyId || !videoUrl) {
        continue;
      }

      const existingTask = localTaskMap.get(historyId);

      if (existingTask) {
        if (!existingTask.video_url) {
          db.prepare(`
            UPDATE tasks
            SET video_url = ?, status = 'done', completed_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(videoUrl, existingTask.id);
          syncedCount++;
          syncedItems.push({
            taskId: existingTask.id,
            historyId,
            action: 'updated',
          });
        }
        continue;
      }

      const createdTask = taskService.createTask({
        projectId: defaultProject.id,
        userId: req.user.id,
        prompt: item.prompt,
        taskKind: 'output',
        status: 'done',
        historyId: historyId,
        itemId: item.itemId,
        videoUrl,
        downloadStatus: 'pending',
        completedAt: new Date().toISOString(),
      });

      localTaskMap.set(historyId, {
        id: createdTask.id,
        history_id: historyId,
        video_url: videoUrl,
      });

      syncedCount++;
      syncedItems.push({
        taskId: createdTask.id,
        historyId,
        action: 'created',
        prompt: item.prompt,
      });
    }

    res.json({
      success: true,
      data: {
        synced: syncedCount,
        total: normalizedAssets.length,
        items: syncedItems.slice(0, 20),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/download/tasks/:id - 下载单个任务视频
app.post('/api/download/tasks/:id', async (req, res) => {
  try {
    const taskId = req.params.id;
    const db = getDatabase();

    // 获取任务信息
    const task = db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.id = ?
    `).get(taskId);

    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }

    if (!task.video_url) {
      return res.status(400).json({ error: '视频仍在生成中，暂时无法下载' });
    }

    // 更新状态为 downloading
    videoDownloader.updateDownloadStatus(taskId, 'downloading');

    // 获取下载路径
    const baseDownloadPath = videoDownloader.getDefaultDownloadPath();

    // 下载视频
    const result = await videoDownloader.downloadVideoByTaskId(taskId, baseDownloadPath);

    if (result.success) {
      videoDownloader.updateDownloadStatus(taskId, 'done', { downloadPath: result.path });
      res.json({ success: true, data: { path: result.path, size: result.size } });
    } else {
      videoDownloader.updateDownloadStatus(taskId, 'failed', { error: result.error });
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/download/batch - 批量下载视频
app.post('/api/download/batch', async (req, res) => {
  try {
    const { taskIds } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: 'taskIds 必须是非空数组' });
    }

    const baseDownloadPath = videoDownloader.getDefaultDownloadPath();
    const results = await videoDownloader.batchDownloadVideos(taskIds, baseDownloadPath);

    // 更新下载状态
    const db = getDatabase();
    for (const result of results) {
      if (result.success) {
        videoDownloader.updateDownloadStatus(result.taskId, 'done', { downloadPath: result.path });
      } else {
        videoDownloader.updateDownloadStatus(result.taskId, 'failed', { error: result.error });
      }
    }

    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/download/tasks/:id/open - 打开视频所在文件夹
app.post('/api/download/tasks/:id/open', async (req, res) => {
  try {
    const taskId = req.params.id;
    const db = getDatabase();

    const task = db.prepare('SELECT video_path FROM tasks WHERE id = ?').get(taskId);
    if (!task || !task.video_path) {
      return res.status(404).json({ error: '任务不存在或未下载' });
    }

    const result = await videoDownloader.openVideoFolder(task.video_path);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/download/tasks/:id - 删除任务
app.delete('/api/download/tasks/:id', (req, res) => {
  try {
    const taskId = req.params.id;
    const db = getDatabase();

    // 删除任务（外键会自动删除 task_assets 和 generation_history）
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 认证相关 API
// ============================================================

// POST /api/auth/register - 用户注册
app.post('/api/auth/register', async (req, res) => {
  try {
    const { account, username, email, password } = req.body;
    const loginAccount = account || username || email;

    if (!loginAccount || !password) {
      return res.status(400).json({ error: '账号和密码不能为空' });
    }

    const result = await authService.registerUser(loginAccount, password);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/auth/login - 用户登录
app.post('/api/auth/login', async (req, res) => {
  try {
    const { account, username, email, password } = req.body;
    const loginAccount = account || username || email;

    if (!loginAccount || !password) {
      return res.status(400).json({ error: '账号和密码不能为空' });
    }

    const result = await authService.loginUser(loginAccount, password);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// POST /api/auth/logout - 用户登出
app.post('/api/auth/logout', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) {
      await authService.logoutUser(sessionId);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/auth/api-keys - 获取当前用户的 OpenAPI Keys
app.get('/api/auth/api-keys', authenticate, async (req, res) => {
  try {
    const keys = apiKeyService.listUserApiKeys(req.user.id);
    res.json({ success: true, data: keys });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/api-keys - 创建当前用户的 OpenAPI Key
app.post('/api/auth/api-keys', authenticate, async (req, res) => {
  try {
    const created = apiKeyService.createApiKey(req.user.id, req.body?.name || '默认 OpenAPI Key');
    res.json({ success: true, data: created });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/auth/api-keys/:id - 删除当前用户的 OpenAPI Key
app.delete('/api/auth/api-keys/:id', authenticate, async (req, res) => {
  try {
    const result = apiKeyService.deleteApiKey(req.params.id, req.user.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/auth/me - 获取当前用户信息
app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    res.json({ success: true, data: { user: req.user } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/auth/me - 更新当前用户信息
app.put('/api/auth/me', authenticate, async (req, res) => {
  try {
    const { username, email } = req.body || {};
    const user = await authService.updateCurrentUserProfile(req.user.id, {
      username,
      email,
    });
    res.json({ success: true, data: { user } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/auth/password - 修改密码
app.put('/api/auth/password', authenticate, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '原密码和新密码不能为空' });
    }

    await authService.changePassword(req.user.id, oldPassword, newPassword);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/auth/email-code - 发送邮箱验证码
app.post('/api/auth/email-code', async (req, res) => {
  try {
    const { email, purpose = 'register' } = req.body;

    if (!email) {
      return res.status(400).json({ error: '邮箱不能为空' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }

    // 获取请求 IP
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

    // 开发环境下返回验证码，生产环境应该发送邮件
    const result = await authService.generateAndSaveVerificationCode(email, purpose, ip);
    res.json(result); // 生产环境不返回 debugCode
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/auth/email-status - 检查邮箱状态
app.post('/api/auth/email-status', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: '邮箱不能为空' });
    }

    const result = await authService.checkEmailStatus(email);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/auth/verify-email-code - 验证邮箱验证码
app.post('/api/auth/verify-email-code', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: '邮箱和验证码不能为空' });
    }

    const result = await authService.verifyEmailCode(email, code);
    if (result.valid) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/credits/deduct - 扣减积分
app.post('/api/credits/deduct', authenticate, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: '积分数量无效' });
    }

    const result = await authService.deductCredits(req.user.id, amount);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/credits/add - 充值积分（管理员可用）
app.post('/api/credits/add', authenticate, async (req, res) => {
  try {
    const { userId, amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: '积分数量无效' });
    }

    const targetUserId = userId || req.user.id;
    const result = await authService.rechargeCredits(targetUserId, amount);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/credits/checkin - 每日签到
app.post('/api/credits/checkin', authenticate, async (req, res) => {
  try {
    const result = await authService.checkIn(req.user.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/credits/checkin/status - 获取签到状态
app.get('/api/credits/checkin/status', authenticate, async (req, res) => {
  try {
    const result = await authService.getCheckInStatus(req.user.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 管理员 API
// ============================================================

// GET /api/admin/stats - 获取系统统计
app.get('/api/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const stats = await authService.getSystemStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/users - 获取用户列表
app.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, pageSize = 20, role, status, email } = req.query;
    const result = await authService.getUserList(
      parseInt(page),
      parseInt(pageSize),
      { role, status, email }
    );
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/users/:id - 获取用户详情
app.get('/api/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await authService.getUserDetail(userId);

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/users/:id/status - 更新用户状态
app.put('/api/admin/users/:id/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { status } = req.body;

    await authService.updateUserStatus(userId, status);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/admin/users/:id/credits - 修改用户积分
app.put('/api/admin/users/:id/credits', authenticate, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { credits, operation = 'set' } = req.body;

    await authService.updateUserCredits(userId, credits, operation);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/admin/users/:id/password - 重置用户密码
app.put('/api/admin/users/:id/password', authenticate, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { newPassword } = req.body;

    await authService.resetUserPassword(userId, newPassword);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/admin/users/:id - 删除用户
app.delete('/api/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await authService.deleteUser(req.params.id, req.user.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/admin/works - 获取作品列表（预留）
app.get('/api/admin/works', authenticate, requireAdmin, async (req, res) => {
  try {
    // 预留作品管理功能
    res.json({ success: true, data: { works: [], pagination: { total: 0 } } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/admin/works/:id/featured - 切换作品推荐状态（预留）
app.put('/api/admin/works/:id/featured', authenticate, requireAdmin, async (req, res) => {
  try {
    // 预留作品推荐功能
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 系统配置接口（SMTP 等）
// ============================================================

// GET /api/admin/config - 获取系统配置
app.get('/api/admin/config', authenticate, requireAdmin, async (req, res) => {
  try {
    const db = getDatabase();
    const configs = db.prepare('SELECT key, value, description FROM system_config').all();
    const configObj = {};
    for (const c of configs) {
      configObj[c.key] = { value: c.value, description: c.description };
    }
    res.json({ success: true, data: configObj });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/config - 保存系统配置
app.post('/api/admin/config', authenticate, requireAdmin, async (req, res) => {
  try {
    const db = getDatabase();
    const { configs } = req.body; // { smtp_host: 'value', smtp_port: 'value', ... }

    if (!configs || typeof configs !== 'object') {
      return res.status(400).json({ error: '配置数据格式错误' });
    }

    const smtpConfigKeys = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_from_name', 'smtp_tls_reject_unauthorized'];
    const descriptions = {
      smtp_host: 'SMTP 服务器地址',
      smtp_port: 'SMTP 端口号',
      smtp_secure: '是否启用 SSL（true/false）',
      smtp_user: 'SMTP 用户名',
      smtp_pass: 'SMTP 密码/授权码',
      smtp_from: '发件人邮箱',
      smtp_from_name: '发件人名称',
      smtp_tls_reject_unauthorized: 'TLS 证书校验（true/false）'
    };

    for (const [key, value] of Object.entries(configs)) {
      if (smtpConfigKeys.includes(key)) {
        const description = descriptions[key] || '';
        db.prepare(`
          INSERT INTO system_config (key, value, description)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = ?, description = ?, updated_at = datetime('now')
        `).run(key, String(value), description, String(value), description);
      }
    }

    // 清除邮件传输器缓存，以便重新加载配置
    const { resetMailTransporterCache } = await import('./services/authService.js');
    if (resetMailTransporterCache) resetMailTransporterCache();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 账号池管理 API (管理员)
// ============================================================

// GET /api/admin/accounts - 获取所有生成的账号池列表 (支持分页)
app.get('/api/admin/accounts', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const result = await accountService.listAccounts({ page, pageSize });
    res.json({ success: true, data: result.accounts, pagination: result.pagination, summary: result.summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/accounts - 手动添加账号
app.post('/api/admin/accounts', authenticate, requireAdmin, async (req, res) => {
  try {
    const account = await accountService.createManualAccount(req.body || {});
    res.json({ success: true, data: account });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/admin/accounts/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const account = await accountService.updateManualAccount(req.params.id, req.body || {});
    res.json({ success: true, data: account });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/admin/accounts/delete-batch - 批量删除账号
app.post('/api/admin/accounts/delete-batch', authenticate, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请选择要删除的账号' });
    }
    await accountService.deleteAccountsBatch(ids);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/accounts/:id - 删除账号
app.delete('/api/admin/accounts/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/accounts/:id/inspect - 即时检测单个账号状态与积分
app.post('/api/admin/accounts/:id/inspect', authenticate, requireAdmin, async (req, res) => {
  try {
    const account = await accountService.inspectAccountById(req.params.id, { persist: true });
    res.json({ success: true, data: account });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/admin/accounts/:id/refresh-session - 立即刷新单个账号 SessionID
app.post('/api/admin/accounts/:id/refresh-session', authenticate, requireAdmin, async (req, res) => {
  try {
    const account = await accountService.refreshAccountSessionById(req.params.id, {
      syncAfterRefresh: true,
      reason: '管理员手动刷新',
    });
    res.json({ success: true, data: account });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/admin/accounts/register-batch - 启动批量注册任务
app.post('/api/admin/accounts/register-batch', authenticate, requireAdmin, async (req, res) => {
  try {
    const { count = 1, provider = 'tempmail.lol' } = req.body;
    const jobId = registrationService.startBatchRegistration(count, provider);
    res.json({ success: true, data: { jobId } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/accounts/registration-jobs/:id - 获取任务日志与状态
app.get('/api/admin/accounts/registration-jobs/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const job = registrationService.getJobStatus(req.params.id);
    if (!job) {
      return res.status(404).json({ error: '任务不存在' });
    }
    res.json({ success: true, data: job });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/accounts/registration-jobs - 获取所有批量任务
app.get('/api/admin/accounts/registration-jobs', authenticate, requireAdmin, async (req, res) => {
  try {
    const jobs = registrationService.getAllJobs();
    res.json({ success: true, data: jobs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/accounts/sync-all - 启动后台全量同步
app.post('/api/admin/accounts/sync-all', authenticate, requireAdmin, async (req, res) => {
  try {
    const { jobId } = await accountService.syncAllAccounts();
    res.json({ success: true, message: '全量同步任务已启动', data: { jobId } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/accounts/sync-batch - 启动后台批量同步
app.post('/api/admin/accounts/sync-batch', authenticate, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请选择要同步的账号' });
    }
    const jobId = await accountService.startSyncBatch(ids);
    if (!jobId) {
      return res.status(400).json({ error: '无可同步的活跃账号' });
    }
    res.json({ success: true, message: '选择账号的同步任务已启动', data: { jobId } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/accounts/refresh-batch - 启动批量刷新 SessionID
app.post('/api/admin/accounts/refresh-batch', authenticate, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请选择要刷新的账号' });
    }
    const jobId = accountService.startRefreshBatch(ids);
    if (!jobId) {
      return res.status(400).json({ error: '无可刷新的账号' });
    }
    res.json({ success: true, data: { jobId } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/accounts/refresh-jobs/:id - 获取 Session 刷新任务状态
app.get('/api/admin/accounts/refresh-jobs/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const job = accountService.getRefreshJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: '任务不存在' });
    }
    res.json({ success: true, data: job });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/accounts/refresh-jobs - 获取所有 Session 刷新任务
app.get('/api/admin/accounts/refresh-jobs', authenticate, requireAdmin, async (req, res) => {
  try {
    const jobs = accountService.getAllRefreshJobs();
    res.json({ success: true, data: jobs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/accounts/sync-jobs/:id - 获取同步任务状态
app.get('/api/admin/accounts/sync-jobs/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const job = accountService.getSyncJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: '任务不存在' });
    }
    res.json({ success: true, data: job });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/accounts/sync-jobs - 获取所有同步任务
app.get('/api/admin/accounts/sync-jobs', authenticate, requireAdmin, async (req, res) => {
  try {
    const jobs = accountService.getAllSyncJobs();
    res.json({ success: true, data: jobs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'pluggable-generation-providers' });
});

// ============================================================
// GPT 注册机 API (提升优先级)
// ============================================================

/**
 * 获取账号列表
 */
app.get('/api/gpt/accounts', authenticate, async (req, res) => {
  try {
    const accounts = gptService.getAccounts();
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取 GPT 注册任务列表
 */
app.get('/api/gpt/jobs', authenticate, async (req, res) => {
  try {
    const jobs = gptService.getJobs();
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取特定任务详情
 */
app.get('/api/gpt/jobs/:id', authenticate, async (req, res) => {
  try {
    const job = gptService.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: '任务不存在' });
    }
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 启动批量注册任务
 */
app.post('/api/gpt/register-batch', authenticate, async (req, res) => {
  try {
    console.log(`[GPT] 收到注册请求: ${JSON.stringify(req.body)}`);
    const { count } = req.body;
    if (!count || count < 1) {
      return res.status(400).json({ error: '无效的任务数量' });
    }

    const jobId = await gptService.startBatch(Number(count));
    res.json({ jobId, message: '任务已启动' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 停止任务
 */
app.post('/api/gpt/jobs/:id/stop', authenticate, async (req, res) => {
  try {
    console.log(`[GPT] 停止任务: ${req.params.id}`);
    await gptService.stopJob(req.params.id);
    res.json({ message: '任务停止指令已下发' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 删除任务记录
 */
app.delete('/api/gpt/jobs/:id', authenticate, async (req, res) => {
  try {
    console.log(`[GPT] 正在删除任务: ${req.params.id}`);
    gptService.deleteJob(req.params.id);
    res.json({ message: '任务记录已删除' });
  } catch (error) {
    console.error(`[GPT] 删除失败: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 生产模式: 提供前端静态文件
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// 优雅关闭: 清理浏览器进程
process.on('SIGTERM', () => {
  console.log('[server] 收到 SIGTERM，正在关闭...');
  browserService.close().finally(() => {
    closeDatabase();
    process.exit(0);
  });
});
process.on('SIGINT', () => {
  console.log('[server] 收到 SIGINT，正在关闭...');
  browserService.close().finally(() => {
    closeDatabase();
    process.exit(0);
  });
});

// ============================================================
// GPT 注册机 API
// ============================================================

/**
 * 获取 GPT 账号列表
 */
app.get('/api/gpt/accounts', authenticate, async (req, res) => {
  try {
    const accounts = gptService.getAccounts();
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GPT 注册机接口已移动到上方以获得更高优先级

const recoveredInterruptedTaskIds = recoverInterruptedGeneratingTasks({ isAdmin: true });

app.listen(PORT, '0.0.0.0', () => {
  const recoveredPendingImageTasks = bootstrapPendingImageTaskRecovery();
  const currentProvider = getGenerationProvider(settingsService.getSetting('provider'));
  console.log(`\n🚀 服务器已启动: http://localhost:${PORT}`);
  console.log(`🧩 当前生成 Provider: ${currentProvider.label} (${currentProvider.id})`);
  console.log(
    `🔑 Legacy Jimeng 默认 Session ID: ${DEFAULT_SESSION_ID ? `已配置 (长度${DEFAULT_SESSION_ID.length})` : '未配置'}`
  );
  console.log(
    `📁 运行模式: ${process.env.NODE_ENV === 'production' ? '生产' : '开发'}\n`
  );
  if (recoveredInterruptedTaskIds.length > 0) {
    console.log(
      `[task-recovery] 已修复 ${recoveredInterruptedTaskIds.length} 个提交前中断的任务: ${recoveredInterruptedTaskIds.join(', ')}`
    );
  }
  if (recoveredPendingImageTasks > 0) {
    console.log(`[image-monitor] 已接管 ${recoveredPendingImageTasks} 个待补轮询的图片任务`);
  }
});
