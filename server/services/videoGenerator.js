import crypto from 'crypto';
import browserService from '../browser-service.js';
import { getDatabase } from '../database/index.js';
import accountService from './account-service.js';
import { normalizeSessionIdInput, parseRegionalSessionInput } from './sessionIdUtils.js';
import { signXBogus } from './x-bogus.js';
import { getXGnarly } from './x-gnarly.js';
import { getRegionProfile } from './regionProfiles.js';
import {
  VIDEO_MODEL_REGISTRY,
  IMAGE_MODEL_REGISTRY,
  resolveVideoModelDefinition,
  resolveImageModelDefinition,
} from './modelRegistry.js';

// 常量定义
const DREAMINA_BASE_URL_US = 'https://dreamina-api.us.capcut.com';
const DREAMINA_BASE_URL_GLOBAL = 'https://mweb-api-sg.capcut.com';
const DREAMINA_BASE_URL = DREAMINA_BASE_URL_US; // 保持向后兼容
const JIMENG_BASE_URL = 'https://jimeng.jianying.com';
const COMMERCE_API_URL_US = 'https://commerce.us.capcut.com';
const COMMERCE_API_URL_GLOBAL = 'https://commerce.capcut.com';
const COMMERCE_API_URL_CN = 'https://commerce.jianying.com';

const APP_ID_US = 513641; 
const APP_ID_CN = 513641; 

const VERSION_US = '8.4.0'; // 已对齐官方 webmssdk 2.0.0.4 
const VERSION_CN = '8.4.0';

const DA_VERSION_US = '3.3.12';
const DA_VERSION_CN = '3.3.12';

const PLATFORM_CODE = '7';
const WEB_ID = Math.floor(Math.random() * 999999999999999999) + 7000000000000000000;
const USER_ID = crypto.randomUUID().replace(/-/g, '');

const FAKE_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  'Appid': String(APP_ID_US),
  'Appvr': VERSION_US,
  'Pf': PLATFORM_CODE,
  'App-Sdk-Version': '48.0.0', // 根据抓包结果更新
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
};

const MODEL_MAP = Object.values(VIDEO_MODEL_REGISTRY).reduce((acc, definition) => {
  acc[definition.id] = definition.nativeModelId;
  for (const alias of definition.aliases || []) {
    acc[alias] = definition.nativeModelId;
  }
  return acc;
}, {
  ...Object.values(IMAGE_MODEL_REGISTRY).reduce((acc, definition) => {
    acc[definition.id] = definition.staticMeta?.modelId || definition.id;
    return acc;
  }, {}),
});

const BENEFIT_TYPE_MAP = Object.values(VIDEO_MODEL_REGISTRY).reduce((acc, definition) => {
  acc[definition.id] = definition.benefitType;
  for (const alias of definition.aliases || []) {
    acc[alias] = definition.benefitType;
  }
  return acc;
}, {});

const DRAFT_VERSION_US = '3.3.12'; // 根据抓包结果更新
const DRAFT_VERSION_CN = '3.3.9';

// 分辨率配置
const VIDEO_RESOLUTION = {
  '1:1': { width: 720, height: 720 },
  '4:3': { width: 960, height: 720 },
  '3:4': { width: 720, height: 960 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '21:9': { width: 1680, height: 720 },
};

const IMAGE_MODEL_META = {
  'dreamina-image-4.1': {
    modelId: 'high_aes_general_v41',
    benefitType: 'image_basic_v41_2k',
    resolution: '2k',
    fallbackModel: 'dreamina-image-4.0',
  },
  'dreamina-image-4.0': {
    modelId: 'high_aes_general_v40',
    benefitType: 'image_basic_generate_piece',
    resolution: '2k',
    fallbackModel: null,
  },
};
const IMAGE_MODEL_ALIASES = {
  'dreamina-image-4.1': {
    labels: ['Image 4.1', '4.1'],
    reqKeys: ['high_aes_general_v41'],
  },
  'dreamina-image-4.0': {
    labels: ['Image 4.0', '4.0'],
    reqKeys: ['high_aes_general_v40'],
  },
};
const IMAGE_MODEL_CONFIG_CACHE = new Map();
const IMAGE_RATIO_TYPE_MAP = {
  '1:1': 1,
  '3:4': 2,
  '16:9': 3,
  '4:3': 4,
  '9:16': 5,
  '2:3': 6,
  '3:2': 7,
  '21:9': 8,
};
const IMAGE_RATIO_SIZE_FALLBACK = {
  '2k': {
    '1:1': { width: 2048, height: 2048 },
    '3:4': { width: 1728, height: 2304 },
    '16:9': { width: 2560, height: 1440 },
    '4:3': { width: 2304, height: 1728 },
    '9:16': { width: 1440, height: 2560 },
    '2:3': { width: 1664, height: 2496 },
    '3:2': { width: 2496, height: 1664 },
    '21:9': { width: 3024, height: 1296 },
  },
  '4k': {
    '1:1': { width: 4096, height: 4096 },
    '3:4': { width: 3520, height: 4693 },
    '16:9': { width: 5404, height: 3040 },
    '4:3': { width: 4693, height: 3520 },
    '9:16': { width: 3040, height: 5404 },
    '2:3': { width: 3328, height: 4992 },
    '3:2': { width: 4992, height: 3328 },
    '21:9': { width: 6197, height: 2656 },
  },
};
const MAX_REFERENCE_FILES = 5;
const DEFAULT_IMAGE_GENERATE_COUNT = 1;
const DEFAULT_IMAGE_BENEFIT_COUNT = 1;

/**
 * 生成 UUID
 */
function generateUUID() {
  return crypto.randomUUID();
}

function clampReferenceIndex(index, maxCount) {
  const numeric = Number(index);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > maxCount) {
    return null;
  }
  return numeric;
}

function dedupeReferenceIndexes(indexes = []) {
  return Array.from(new Set(indexes.filter(Boolean)));
}

function collectPromptReferenceIndexes(prompt = '', maxCount = MAX_REFERENCE_FILES) {
  const matches = [];
  const text = String(prompt || '');
  const regex = /(?:@|Image)(\d+)/gi;
  let match;

  while ((match = regex.exec(text))) {
    const normalized = clampReferenceIndex(match[1], maxCount);
    if (normalized) {
      matches.push(normalized);
    }
  }

  return dedupeReferenceIndexes(matches);
}

function normalizeImagePromptReferences(prompt = '') {
  return String(prompt || '').replace(/@(\d+)/g, 'Image$1').trim();
}

function buildImagePromptWithPlaceholders(prompt = '', fileCount = 0) {
  const normalizedPrompt = normalizeImagePromptReferences(prompt);
  const referencedIndexes = collectPromptReferenceIndexes(normalizedPrompt, fileCount);

  if (referencedIndexes.length > 0) {
    return {
      promptText: normalizedPrompt,
      promptWithPlaceholder: normalizedPrompt,
      referencedIndexes,
    };
  }

  const placeholders = Array.from({ length: fileCount }, (_, index) => `Image${index + 1}`).join(' ');
  const promptWithPlaceholder = normalizedPrompt
    ? `${normalizedPrompt}\n参考图：${placeholders}`
    : placeholders;

  return {
    promptText: normalizedPrompt,
    promptWithPlaceholder,
    referencedIndexes,
  };
}

function buildImageMetaListFromPrompt(promptWithPlaceholder = '', materialCount = 0) {
  const metaList = [];
  const text = String(promptWithPlaceholder || '').trim();
  const placeholderRegex = /Image(\d+)/gi;
  let lastIndex = 0;
  let match;

  while ((match = placeholderRegex.exec(text)) !== null) {
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore.trim()) {
      metaList.push({
        type: '',
        id: generateUUID(),
        meta_type: 'text',
        text: textBefore,
      });
    }

    const materialIndex = clampReferenceIndex(match[1], materialCount);
    if (materialIndex) {
      metaList.push({
        type: '',
        id: generateUUID(),
        meta_type: 'image',
        text: '',
        material_ref: {
          type: '',
          id: generateUUID(),
          material_idx: materialIndex - 1,
        },
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const trailingText = text.slice(lastIndex);
    if (trailingText.trim()) {
      metaList.push({
        type: '',
        id: generateUUID(),
        meta_type: 'text',
        text: trailingText,
      });
    }
  }

  if (metaList.length === 0 && materialCount > 0) {
    for (let index = 0; index < materialCount; index++) {
      if (index > 0) {
        metaList.push({
          type: '',
          id: generateUUID(),
          meta_type: 'text',
          text: ' ',
        });
      }
      metaList.push({
        type: '',
        id: generateUUID(),
        meta_type: 'image',
        text: '',
        material_ref: {
          type: '',
          id: generateUUID(),
          material_idx: index,
        },
      });
    }
  }

  return metaList;
}

function normalizeVideoPromptReferences(prompt = '') {
  return String(prompt || '').replace(/@(\d+)/g, 'reference image $1').trim();
}

function normalizeReferenceIndexList(value, maxCount) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : value == null
        ? []
        : [value];

  return dedupeReferenceIndexes(source.map((item) => clampReferenceIndex(item, maxCount)));
}

function normalizeReferenceMap(referenceMap, maxCount) {
  if (!referenceMap || typeof referenceMap !== 'object') {
    return {
      firstIndex: null,
      lastIndex: null,
      middleIndexes: [],
    };
  }

  const firstIndex = clampReferenceIndex(
    referenceMap.first ?? referenceMap.firstFrame ?? referenceMap.start,
    maxCount
  );
  const lastIndex = clampReferenceIndex(
    referenceMap.last ?? referenceMap.lastFrame ?? referenceMap.end,
    maxCount
  );

  const middleIndexes = normalizeReferenceIndexList(
    referenceMap.middle ??
      referenceMap.middleFrames ??
      referenceMap.extra ??
      referenceMap.extraFrames ??
      referenceMap.references,
    maxCount
  ).filter((index) => index !== firstIndex && index !== lastIndex);

  return {
    firstIndex,
    lastIndex,
    middleIndexes,
  };
}

function extractFrameReferenceIndex(prompt = '', keywords = [], maxCount = MAX_REFERENCE_FILES) {
  const text = String(prompt || '');

  for (const keyword of keywords) {
    const patterns = [
      new RegExp(`(?:@|Image)(\\d+)\\s*(?:作为|当作|用作|做|是)?\\s*${keyword}`, 'i'),
      new RegExp(`${keyword}\\s*(?:使用|用|参考|选择|设为|设置为|是|为|放|采用)?\\s*(?:第\\s*)?(\\d+)\\s*张`, 'i'),
      new RegExp(`${keyword}[：:，,\\s]*(?:@|Image)(\\d+)`, 'i'),
      new RegExp(`${keyword}[：:，,\\s]*(\\d+)`, 'i'),
      new RegExp(`${keyword}[\\s\\S]{0,24}?(?:@|Image)(\\d+)`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      const normalized = clampReferenceIndex(match?.[1], maxCount);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function resolveVideoReferenceSelection(files = [], referenceMode = '全能参考', prompt = '', referenceMap = null) {
  const fileCount = Array.isArray(files) ? files.length : 0;
  const referencedIndexes = collectPromptReferenceIndexes(prompt, fileCount);
  const firstHint = extractFrameReferenceIndex(prompt, ['首帧', '第一帧', '开头', '起始'], fileCount);
  const lastHint = extractFrameReferenceIndex(prompt, ['尾帧', '最后一帧', '末帧', '结尾', '结束'], fileCount);
  const explicitReferenceMap = normalizeReferenceMap(referenceMap, fileCount);

  const selectByIndex = (index) => {
    if (!index) return null;
    return files[index - 1] || null;
  };

  let firstIndex = null;
  let lastIndex = null;
  let middleIndexes = [];

  if (referenceMode === '首帧参考') {
    firstIndex = explicitReferenceMap.firstIndex || firstHint || referencedIndexes[0] || 1;
  } else if (referenceMode === '尾帧参考') {
    lastIndex = explicitReferenceMap.lastIndex || lastHint || referencedIndexes[0] || 1;
  } else {
    firstIndex = explicitReferenceMap.firstIndex || firstHint || referencedIndexes[0] || 1;
    lastIndex =
      explicitReferenceMap.lastIndex ||
      lastHint ||
      (referencedIndexes.length > 1 ? referencedIndexes[referencedIndexes.length - 1] : null) ||
      (fileCount > 1 ? fileCount : null);

    if (lastIndex === firstIndex && fileCount > 1) {
      lastIndex = fileCount;
    }

    middleIndexes = explicitReferenceMap.middleIndexes.length > 0
      ? explicitReferenceMap.middleIndexes
      : dedupeReferenceIndexes(
          referencedIndexes.filter((index) => index !== firstIndex && index !== lastIndex)
        );

    if (middleIndexes.length === 0 && fileCount > 2) {
      middleIndexes = Array.from({ length: fileCount }, (_, index) => index + 1).filter(
        (index) => index !== firstIndex && index !== lastIndex
      );
    }
  }

  return {
    firstFrameFile: selectByIndex(firstIndex),
    endFrameFile: selectByIndex(lastIndex),
    middleFrameFiles: middleIndexes.map((index) => selectByIndex(index)).filter(Boolean),
    firstIndex,
    lastIndex,
    middleIndexes,
    referencedIndexes,
    explicitReferenceMap,
  };
}

function isSessionAuthError(message = '') {
  return /1002|1015|34010105|expired|invalid|unauthorized|login error|鉴权失败|会话已失效|缺少 SessionID/i.test(
    String(message || '')
  );
}

function extractProviderErrorCode(source) {
  if (source == null) return '';
  if (typeof source === 'string' || typeof source === 'number') {
    return String(source);
  }

  return String(
    source?.retCode ??
      source?.ret ??
      source?.failCode ??
      source?.fail_code ??
      source?.apiResponse?.ret ??
      source?.apiResponse?.data?.fail_code ??
      source?.data?.fail_code ??
      ''
  );
}

function isDailyGenerationLimitError(source) {
  const code = extractProviderErrorCode(source);
  if (code === '121101') return true;

  const text =
    typeof source === 'string'
      ? source
      : [
          source?.message,
          source?.errmsg,
          source?.fail_starling_key,
          source?.fail_starling_message,
          source?.apiResponse?.errmsg,
          source?.apiResponse?.data?.fail_starling_key,
          source?.apiResponse?.data?.fail_starling_message,
          source?.apiResponse?.data?.fail_code,
        ]
          .filter(Boolean)
          .join(' ');

  return /121101|daily generation limit|reach.*daily.*limit|web_notice_reach_daily_usage_limit/i.test(
    String(text || '')
  );
}

function isSharkRiskControlError(source) {
  const code = extractProviderErrorCode(source);
  if (code === '-6') return true;

  const text =
    typeof source === 'string'
      ? source
      : [
          source?.message,
          source?.errmsg,
          source?.apiResponse?.errmsg,
          source?.apiResponse?.data?.fail_starling_key,
          source?.apiResponse?.data?.fail_starling_message,
        ]
          .filter(Boolean)
          .join(' ');

  return /shark not pass|risk control|风控|reject/i.test(String(text || ''));
}

function buildExcludedSessionCandidates(sessionId) {
  const normalized = normalizeSessionIdInput(sessionId);
  const parsed = parseRegionalSessionInput(normalized);
  return Array.from(
    new Set(
      [
        normalized,
        parsed.pureSessionId,
        parsed.pureSessionId ? `hk-${parsed.pureSessionId}` : '',
      ].filter(Boolean)
    )
  );
}

function resolveVideoBenefitTypeForRequest(videoDefinition, sessionId, providerId = 'dreamina') {
  if (!videoDefinition) return null;
  const region = parseRegionalSessionInput(sessionId).region || 'us';
  const isCn = providerId === 'legacy-jimeng' || region === 'cn';
  if (!isCn && videoDefinition.internationalBenefitType) {
    return videoDefinition.internationalBenefitType;
  }
  return videoDefinition.benefitType || null;
}

function supportsVideoInputMode(videoDefinition, mode) {
  const supported = Array.isArray(videoDefinition?.supportedInputMediaTypes)
    ? videoDefinition.supportedInputMediaTypes
    : [];
  return supported.includes(mode);
}

function resolveVideoDefinitionForReferences(videoDefinition, {
  hasFirstFrame = false,
  hasEndFrame = false,
  hasMiddleFrames = false,
} = {}) {
  void hasFirstFrame;
  void hasEndFrame;
  void hasMiddleFrames;
  return videoDefinition;
}

function markAccountStatus(accountId, sessionId, status, syncError) {
  const db = getDatabase();
  const reason = String(syncError || '').slice(0, 500);

  try {
    if (accountId) {
      db.prepare(`
        UPDATE accounts
        SET status = ?,
            sync_error = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(status, reason, accountId);
      return;
    }

    const normalizedSessionId = normalizeSessionIdInput(sessionId);
    if (normalizedSessionId) {
      db.prepare(`
        UPDATE accounts
        SET status = ?,
            sync_error = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
      `).run(status, reason, normalizedSessionId);
    }
  } catch (error) {
    console.warn(`[account] 更新账号状态失败: ${error.message}`);
  }
}

async function switchToNextPoolAccount({
  currentAccountId = null,
  currentSessionId = '',
  excludeAccountIds = [],
  excludeSessionIds = [],
  onProgress,
  reason = '',
  progressMessage = '正在切换账号重试...',
  minCredits = 10,
  markStatus = null,
  modelId = null,
  allowFastZeroCreditProbe = false,
  requireFastZeroCreditProbe = false,
}) {
  if (markStatus) {
    markAccountStatus(currentAccountId, currentSessionId, markStatus, reason);
  }

  if (onProgress) onProgress(progressMessage);

  const combinedExcludeAccountIds = Array.from(
    new Set(
      [
        ...(Array.isArray(excludeAccountIds) ? excludeAccountIds : []),
        currentAccountId,
      ]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );
  const combinedExcludeSessionIds = Array.from(
    new Set(
      [
        ...(Array.isArray(excludeSessionIds) ? excludeSessionIds : []),
        ...buildExcludedSessionCandidates(currentSessionId),
      ]
        .map((value) => normalizeSessionIdInput(value))
        .filter(Boolean)
    )
  );

  const account = await accountService.getAvailableAccount(minCredits, {
    excludeAccountIds: combinedExcludeAccountIds,
    excludeSessionIds: combinedExcludeSessionIds,
    modelId,
    allowFastZeroCreditProbe,
    requireFastZeroCreditProbe,
  });

  console.log(
    `[account] 切换到新账号: ${account.email} (id=${account.id}, webId=${String(account.web_id || WEB_ID).substring(0, 8)}...)`
  );

  return {
    sessionId: normalizeSessionIdInput(account.session_id),
    webId: account.web_id || WEB_ID,
    accountId: account.id || null,
    email: account.email,
    credits: toNullableNumber(account.credits),
  };
}

async function tryRefreshPoolAccountSession(activeAccountId, reason, onProgress) {
  if (!activeAccountId) {
    return null;
  }

  const progressMessage = `检测到当前账号鉴权异常，正在自动刷新 SessionID 后重试...`;
  console.warn(`[session-refresh] accountId=${activeAccountId}, reason=${reason}`);
  if (onProgress) onProgress(progressMessage);

  try {
    const refreshedAccount = await accountService.refreshAccountSessionById(activeAccountId, {
      syncAfterRefresh: true,
      reason,
    });

    return {
      accountId: refreshedAccount.id,
      sessionId: normalizeSessionIdInput(refreshedAccount.session_id),
      webId: refreshedAccount.web_id || WEB_ID,
      email: refreshedAccount.email,
      credits: toNullableNumber(refreshedAccount.credits),
    };
  } catch (error) {
    console.warn(`[session-refresh] 自动刷新 SessionID 失败(accountId=${activeAccountId}): ${error.message}`);
    return null;
  }
}

async function tryRefreshSessionForRetry({
  activeAccountId = null,
  sessionId = '',
  reason = '',
  onProgress,
  sourceHint = 'pool',
} = {}) {
  const shouldTreatAsManualSession = sourceHint === 'manual_session';

  if (activeAccountId && sourceHint !== 'manual_session') {
    const refreshed = await tryRefreshPoolAccountSession(activeAccountId, reason, onProgress);
    if (refreshed?.sessionId) {
      return {
        ...refreshed,
        source: 'pool',
      };
    }
  }

  let targetAccount = shouldTreatAsManualSession && activeAccountId
    ? accountService.getAccountById(activeAccountId)
    : null;

  if (!targetAccount && shouldTreatAsManualSession && sessionId) {
    targetAccount = accountService.findAccountBySessionId(sessionId, { requirePassword: true });
  }

  if (!targetAccount?.id) {
    return null;
  }

  const refreshSource = shouldTreatAsManualSession ? 'manual_session' : 'pool';
  const progressMessage = refreshSource === 'manual_session'
    ? '检测到当前手动 Session 鉴权异常，正在自动刷新 SessionID 后重试...'
    : '检测到当前账号鉴权异常，正在自动刷新 SessionID 后重试...';

  console.warn(
    `[session-refresh] accountId=${targetAccount.id}, source=${refreshSource}, reason=${reason || 'unknown'}`
  );
  if (onProgress) onProgress(progressMessage);

  try {
    const refreshedAccount = await accountService.refreshAccountSessionById(targetAccount.id, {
      syncAfterRefresh: true,
      reason,
    });

    return {
      accountId: refreshedAccount.id,
      sessionId: normalizeSessionIdInput(refreshedAccount.session_id),
      webId: refreshedAccount.web_id || WEB_ID,
      email: refreshedAccount.email,
      credits: toNullableNumber(refreshedAccount.credits),
      source: refreshSource,
    };
  } catch (error) {
    console.warn(
      `[session-refresh] 自动刷新 SessionID 失败(accountId=${targetAccount.id}, source=${refreshSource}): ${error.message}`
    );
    return null;
  }
}

function createFallbackSessionQueue(candidates = [], currentSessionId = '') {
  const current = normalizeSessionIdInput(currentSessionId);
  const queue = [];
  const seen = new Set(current ? [current] : []);

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const normalized = normalizeSessionIdInput(candidate);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    queue.push(normalized);
  }

  return queue;
}

function takeNextFallbackSession(queue = [], excludedSessionIds = []) {
  const excluded = new Set(
    (Array.isArray(excludedSessionIds) ? excludedSessionIds : [])
      .map((item) => normalizeSessionIdInput(item))
      .filter(Boolean)
  );

  while (queue.length > 0) {
    const next = normalizeSessionIdInput(queue.shift());
    if (next && !excluded.has(next)) {
      return next;
    }
  }

  return '';
}

function normalizeLookupValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function inferImageResolution(benefitType, fallback = '2k') {
  const value = normalizeLookupValue(benefitType);
  if (value.includes('4k')) return '4k';
  if (value.includes('2k')) return '2k';
  return fallback;
}

function createImageModelCacheKey(sessionId, providerId, model) {
  const sessionHash = crypto
    .createHash('sha1')
    .update(String(sessionId || ''))
    .digest('hex')
    .slice(0, 12);
  return `${providerId || 'dreamina'}:${model}:${sessionHash}`;
}

function matchImageModelConfig(model, modelList = []) {
  const alias = IMAGE_MODEL_ALIASES[model] || {
    labels: [model],
    reqKeys: [model],
  };
  const normalizedLabels = alias.labels.map(normalizeLookupValue);
  const normalizedReqKeys = alias.reqKeys.map(normalizeLookupValue);

  return modelList.find((item) => {
    const itemReqKey = normalizeLookupValue(item?.model_req_key);
    const itemName = normalizeLookupValue(item?.model_name);
    const itemCategoryName = normalizeLookupValue(item?.generation_category_name);

    if (normalizedReqKeys.includes(itemReqKey)) return true;
    if (normalizedLabels.includes(itemName)) return true;
    if (normalizedLabels.includes(itemCategoryName)) return true;
    return false;
  });
}

async function resolveImageModelMeta({ sessionId, webId, providerId = 'dreamina', model }) {
  const cacheKey = createImageModelCacheKey(sessionId, providerId, model);
  if (IMAGE_MODEL_CONFIG_CACHE.has(cacheKey)) {
    return IMAGE_MODEL_CONFIG_CACHE.get(cacheKey);
  }

  try {
    const config = await jimengRequest(
      'POST',
      '/mweb/v1/get_common_config',
      sessionId,
      webId,
      {
        data: {
          needCache: true,
          needRefresh: false,
        },
        providerId,
      }
    );

    const modelList = Array.isArray(config?.model_list) ? config.model_list : [];
    const matched = matchImageModelConfig(model, modelList);
    if (!matched) {
      throw new Error(`官方 common_config 中未找到图片模型 ${model}`);
    }

    const benefitType =
      matched?.commercial_config?.image_model_commerce_config?.base?.default?.benefit_type ||
      IMAGE_MODEL_META[model]?.benefitType ||
      null;
    const resolved = {
      modelId: matched.model_req_key,
      benefitType,
      resolution: inferImageResolution(benefitType, IMAGE_MODEL_META[model]?.resolution || '2k'),
      fallbackModel: IMAGE_MODEL_META[model]?.fallbackModel || null,
      modelName: matched.model_name || matched.generation_category_name || model,
      resolutionMap: matched.resolution_map || matched.resolutionMap || null,
    };

    IMAGE_MODEL_CONFIG_CACHE.set(cacheKey, resolved);
    console.log(
      `[image-model] 已从官方配置解析 ${model} => ${resolved.modelName} / ${resolved.modelId} / ${resolved.benefitType || 'no-benefit'}`
    );
    return resolved;
  } catch (error) {
    const fallback = IMAGE_MODEL_META[model];
    if (!fallback) throw error;

    const resolved = {
      ...fallback,
      modelName: model,
      usedFallbackConfig: true,
      resolutionMap: null,
    };
    IMAGE_MODEL_CONFIG_CACHE.set(cacheKey, resolved);
    console.warn(
      `[image-model] 官方配置解析失败，暂用本地已验证映射 ${model} => ${resolved.modelId}: ${error.message}`
    );
    return resolved;
  }
}

function resolveImageLargeImageInfo(meta, ratio = '1:1') {
  const normalizedRatio = IMAGE_RATIO_TYPE_MAP[ratio] ? ratio : '1:1';
  const resolutionType = meta?.resolution || '2k';
  const ratioType = IMAGE_RATIO_TYPE_MAP[normalizedRatio] || IMAGE_RATIO_TYPE_MAP['1:1'];

  const configuredSize = meta?.resolutionMap?.[resolutionType]?.image_ratio_sizes?.find(
    (item) => Number(item?.ratio_type) === Number(ratioType)
  );

  if (configuredSize?.width && configuredSize?.height) {
    return {
      ratio: normalizedRatio,
      ratioType,
      width: configuredSize.width,
      height: configuredSize.height,
      resolutionType,
    };
  }

  const fallbackSize =
    IMAGE_RATIO_SIZE_FALLBACK[resolutionType]?.[normalizedRatio] ||
    IMAGE_RATIO_SIZE_FALLBACK['2k']?.['1:1'];

  return {
    ratio: normalizedRatio,
    ratioType,
    width: fallbackSize.width,
    height: fallbackSize.height,
    resolutionType,
  };
}

function getImageDimensionsFromBuffer(buffer) {
  if (!buffer || buffer.length < 24) return null;

  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      const marker = buffer[offset + 1];
      const blockLength = buffer.readUInt16BE(offset + 2);
      const isSOF =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker);

      if (isSOF && offset + 8 < buffer.length) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }

      offset += 2 + blockLength;
    }
  }

  // WebP
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    if (chunk === 'VP8 ' && buffer.length >= 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    if (chunk === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
  }

  // BMP
  if (buffer[0] === 0x42 && buffer[1] === 0x4d && buffer.length >= 26) {
    return {
      width: buffer.readUInt32LE(18),
      height: Math.abs(buffer.readInt32LE(22)),
    };
  }

  return null;
}

/**
 * 解析 Cookie 字符串
 */
function parseCookieString(cookieString) {
  if (!cookieString || !cookieString.includes('=') || !cookieString.includes(';')) {
    return new Map();
  }

  const cookies = new Map();
  const pairs = String(cookieString)
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (!key || !value) continue;
    cookies.set(key, value);
  }

  return cookies;
}

/**
 * 从 Session / Full Cookie 中提取请求上下文
 */
function resolveRequestContext(sessionId, webId) {
  const cookieMap = parseCookieString(sessionId);
  const cookieWebId =
    cookieMap.get('_tea_web_id') ||
    cookieMap.get('webid') ||
    cookieMap.get('web_id') ||
    '';
  const cookieMsToken =
    cookieMap.get('msToken') ||
    cookieMap.get('mstoken') ||
    '';

  return {
    cookieMap,
    resolvedWebId: String(cookieWebId || webId || WEB_ID),
    msToken: String(cookieMsToken || ''),
    region: parseRegionalSessionInput(sessionId).region || 'us',
  };
}

/**
 * 执行回调
 */
async function invokePersistenceCallback(callback, label, ...args) {
  if (typeof callback !== 'function') return;
  try {
    await callback(...args);
  } catch (error) {
    console.error(`[video] ${label} 回调失败: ${error.message}`);
  }
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function maskSessionForDisplay(sessionId = '') {
  const normalized = normalizeSessionIdInput(sessionId);
  if (!normalized) return '';

  const parsed = parseRegionalSessionInput(normalized);
  const pureSessionId = parsed.pureSessionId || normalized;
  if (!pureSessionId) return '';

  const suffix = pureSessionId.slice(-6) || pureSessionId;
  return `${parsed.region === 'hk' ? 'hk-' : ''}***${suffix}`;
}

function resolveCommerceCreditHistoryUrl(sessionId = '', providerId = 'dreamina') {
  const region = parseRegionalSessionInput(sessionId).region || 'us';
  if (providerId === 'legacy-jimeng' || region === 'cn') {
    return `${COMMERCE_API_URL_CN}/commerce/v1/benefits/user_credit_history`;
  }
  if (region === 'us') {
    return `${COMMERCE_API_URL_US}/commerce/v1/benefits/user_credit_history`;
  }
  return `https://commerce-api.capcut.com/commerce/v1/benefits/user_credit_history`;
}

async function probeSessionCredits(sessionId = '', providerId = 'dreamina') {
  const normalizedSessionId = normalizeSessionIdInput(sessionId);
  if (!normalizedSessionId) {
    throw new Error('缺少可校验的 SessionID');
  }

  const result = await jimengRequest(
    'POST',
    resolveCommerceCreditHistoryUrl(normalizedSessionId, providerId),
    normalizedSessionId,
    null,
    {
      data: { count: 1, cursor: '0' },
      providerId,
    }
  );

  return toNullableNumber(result?.total_credit);
}

async function takeNextValidatedFallbackSession({
  queue = [],
  excludedSessionIds = [],
  providerId = 'dreamina',
  onProgress = null,
  progressMessage = '正在校验候补 Session...',
} = {}) {
  const rejectedSessions = [];
  let lastError = '';

  while (true) {
    const candidate = takeNextFallbackSession(queue, [...excludedSessionIds, ...rejectedSessions]);
    if (!candidate) {
      return {
        sessionId: '',
        credits: null,
        lastError,
        rejectedSessions,
      };
    }

    const masked = maskSessionForDisplay(candidate) || 'unknown';
    if (onProgress) {
      onProgress(`${progressMessage} ${masked}`);
    }

    try {
      const credits = await probeSessionCredits(candidate, providerId);
      console.log(
        `[image] 候补 Session 校验成功: ${masked}, credits=${credits === null ? 'unknown' : credits}`
      );
      return {
        sessionId: candidate,
        credits,
        lastError: '',
        rejectedSessions,
      };
    } catch (error) {
      lastError = error?.message || '候补 Session 校验失败';
      rejectedSessions.push(candidate);
      console.warn(`[image] 候补 Session 校验失败: ${masked} -> ${lastError}`);
    }
  }
}

function isFastZeroCreditProbeEnabledForRequest(modelId = '', providerId = 'dreamina') {
  if (providerId === 'legacy-jimeng') {
    return false;
  }
  const definition = resolveVideoModelDefinition(modelId);
  return Boolean(definition?.zeroCreditProbeEligible);
}

function isFastZeroCreditProbeAttempt({
  modelId = '',
  providerId = 'dreamina',
  accountInfo = null,
  sessionId = '',
} = {}) {
  if (!isFastZeroCreditProbeEnabledForRequest(modelId, providerId)) {
    return false;
  }

  const creditsBefore = toNullableNumber(accountInfo?.creditsBefore);
  const region = parseRegionalSessionInput(sessionId || '').region;
  return creditsBefore === 0 && region === 'hk' && accountInfo?.source === 'pool';
}

async function finalizeAccountUsageInfo({
  activeAccountId = null,
  sessionId = '',
  currentAccountInfo = null,
  onAccountResolved = null,
  modelId = '',
  providerId = 'dreamina',
}) {
  let nextInfo = {
    ...(currentAccountInfo || {}),
    sessionMask: currentAccountInfo?.sessionMask || maskSessionForDisplay(sessionId),
    phase: 'completed',
    updatedAt: new Date().toISOString(),
  };

  if (activeAccountId) {
    try {
      const inspectedAccount = await accountService.inspectAccountById(activeAccountId, { persist: true });
      const creditsBefore = toNullableNumber(nextInfo.creditsBefore);
      const creditsAfter = toNullableNumber(inspectedAccount?.credits);

      nextInfo = {
        ...nextInfo,
        source: 'pool',
        accountId: inspectedAccount?.id || activeAccountId,
        email: inspectedAccount?.email || nextInfo.email || null,
        sessionMask: maskSessionForDisplay(inspectedAccount?.session_id || sessionId),
        creditsAfter,
        creditCost: creditsBefore !== null && creditsAfter !== null
          ? Math.max(0, creditsBefore - creditsAfter)
          : null,
        updatedAt: new Date().toISOString(),
      };

      if (isFastZeroCreditProbeAttempt({
        modelId,
        providerId,
        accountInfo: nextInfo,
        sessionId: inspectedAccount?.session_id || sessionId,
      })) {
        const probeCheckedAt = new Date().toISOString();
        accountService.markFastZeroCreditProbeResult(activeAccountId, {
          status: 'success',
          modelId,
          checkedAt: probeCheckedAt,
          reason: '0积分账号已成功完成 Fast 首免生成，后续不再优先复用',
        });
        nextInfo.fastZeroCreditProbeStatus = 'success';
        nextInfo.fastZeroCreditProbeReason = '0积分账号已成功完成 Fast 首免生成，后续不再优先复用';
        nextInfo.fastZeroCreditProbeCheckedAt = probeCheckedAt;
      }
    } catch (error) {
      console.warn(`[account] 刷新任务账号积分信息失败: ${error.message}`);
    }
  }

  await invokePersistenceCallback(onAccountResolved, 'onAccountResolved', nextInfo);
  return nextInfo;
}

/**
 * 生成 Cookie
 */
function generateCookie(sessionId, webId, userId, isCn = false) {
  const sessionInfo = parseRegionalSessionInput(sessionId);
  const pureSessionId = sessionInfo.pureSessionId || String(sessionId || '');
  const region = sessionInfo.region || 'us';

  if (isCn) {
    return [
      `sessionid=${pureSessionId}`,
      `sessionid_ss=${pureSessionId}`,
      `sid_tt=${pureSessionId}`,
      `uid_tt=${userId}`,
      `uid_tt_ss=${userId}`,
      `_tea_web_id=${webId}`,
      `store-region=cn-gd`,
      `store-region-src=uid`,
    ].join('; ');
  }

  // 国际版 (Dreamina) 的逻辑
  return [
    `sessionid=${pureSessionId}`,
    `sessionid_ss=${pureSessionId}`,
    `sid_tt=${pureSessionId}`,
    `uid_tt=${userId}`,
    `uid_tt_ss=${userId}`,
    `_tea_web_id=${webId}`,
    `store-country-code=${region}`,
    `store-region=${region}`,
    `store-region-src=uid`,
  ].join('; ');
}

function buildCookieHeader(sessionId, webId, userId, isCn = false) {
  const cookieMap = parseCookieString(sessionId);
  if (cookieMap.size === 0) {
    return generateCookie(sessionId, webId, userId, isCn);
  }

  const sessionInfo = parseRegionalSessionInput(sessionId);
  const pureSessionId = sessionInfo.pureSessionId || '';
  const region = sessionInfo.region || 'us';
  const regionProfile = getRegionProfile(region);

  if (pureSessionId) {
    cookieMap.set('sessionid', pureSessionId);
    cookieMap.set('sessionid_ss', pureSessionId);
    cookieMap.set('sid_tt', pureSessionId);
  }

  if (webId) {
    cookieMap.set('_tea_web_id', String(webId));
  }

  if (!isCn) {
    if (userId && !cookieMap.get('uid_tt')) cookieMap.set('uid_tt', String(userId));
    if (userId && !cookieMap.get('uid_tt_ss')) cookieMap.set('uid_tt_ss', String(userId));
    if (!cookieMap.get('store-idc') && regionProfile?.idc) cookieMap.set('store-idc', regionProfile.idc);
    if (!cookieMap.get('store-country-code')) cookieMap.set('store-country-code', regionProfile?.storeCountryCode || region);
    if (!cookieMap.get('store-region')) cookieMap.set('store-region', regionProfile?.storeCountryCode || region);
    if (!cookieMap.get('store-country-code-src')) cookieMap.set('store-country-code-src', 'uid');
    if (!cookieMap.get('store-region-src')) cookieMap.set('store-region-src', 'uid');
  }

  return Array.from(cookieMap.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function shouldApplyDreaminaAigcAntiBotSignature(uri, isCn = false) {
  if (isCn) return false;
  return String(uri || '').includes('/mweb/v1/aigc_draft/generate');
}

/**
 * 生成 签名 (支持 POST Body MD5)
 */
function generateSign(uri, version = VERSION_US, body = null) {
  const deviceTime = Math.floor(Date.now() / 1000);
  const path = uri.includes('://') ? new URL(uri).pathname : uri;
  
  // 对于 POST 请求，Body 的 MD5 会参与签名
  let bodyMd5 = '';
  if (body) {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    bodyMd5 = crypto.createHash('md5').update(bodyStr).digest('hex');
  }

  // 格式: 9e2c|path.slice(-7)|platform|version|time|bodyMd5|11ac
  const signStr = `9e2c|${path.slice(-7)}|${PLATFORM_CODE}|${version}|${deviceTime}|${bodyMd5}|11ac`;
  
  const sign = crypto
    .createHash('md5')
    .update(signStr)
    .digest('hex');
    
  return { deviceTime, sign };
}

function buildProviderApiError(data, providerLabel = 'Dreamina') {
  const retCode = String(data?.ret ?? '');
  const errMsg =
    data?.errmsg ||
    data?.message ||
    data?.data?.fail_starling_message ||
    data?.data?.fail_code ||
    retCode ||
    'unknown error';

  if (
    ['5000', '1006'].includes(retCode) ||
    /not enough credits|no relevant benefits/i.test(String(errMsg))
  ) {
    return Object.assign(
      new Error(`${providerLabel} 积分不足 (ret=${retCode || 'unknown'}): ${errMsg}`),
      {
        isApiError: true,
        isCreditError: true,
        retCode,
        apiResponse: data,
      }
    );
  }

  if (isDailyGenerationLimitError(data)) {
    return Object.assign(
      new Error(`${providerLabel} 当日生成次数已达上限 (ret=${retCode || 'unknown'}): ${errMsg}`),
      {
        isApiError: true,
        isDailyLimitError: true,
        retCode,
        apiResponse: data,
      }
    );
  }

  return Object.assign(
    new Error(
      `${providerLabel} API 错误 (ret=${retCode || 'unknown'}): ${errMsg} - Response: ${JSON.stringify(data)}`
    ),
    {
      isApiError: true,
      retCode,
      apiResponse: data,
    }
  );
}

function unwrapProviderApiResponse(data, providerLabel = 'Dreamina') {
  if (data && isFinite(Number(data.ret))) {
    const retCode = String(data.ret);
    if (retCode === '0' || retCode === '200') {
      return data.data || data;
    }
    throw buildProviderApiError(data, providerLabel);
  }

  return data;
}

function extractHistoryIdFromGenerateResponse(response) {
  return (
    response?.aigc_data?.history_record_id ||
    response?.history_record_id ||
    response?.historyId ||
    response?.data?.aigc_data?.history_record_id ||
    response?.data?.history_record_id ||
    response?.data?.historyId ||
    response?.history_id ||
    response?.data?.history_id ||
    null
  );
}

/**
 * 计算 CRC32
 */
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

/**
 * AWS4-HMAC-SHA256 签名 (用于 ImageX)
 */
function createAWSSignature(
  method,
  url,
  headers,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  payload = '',
  signingRegion = 'useast5'
) {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname || '/';

  const timestamp = headers['x-amz-date'];
  const date = timestamp.substr(0, 8);
  const region = signingRegion; 
  const service = 'imagex';

  const queryParams = [];
  urlObj.searchParams.forEach((value, key) => {
    queryParams.push([key, value]);
  });
  queryParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQueryString = queryParams
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

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

/**
 * 即梦 API 请求 (通用)
 */
export async function jimengRequest(method, uri, sessionId, webId, options = {}) {
  const isCn = options.providerId === 'legacy-jimeng';
  const initialSessionInfo = parseRegionalSessionInput(sessionId);
  const useNodeFetch = options.transport === 'node';
  
  // 动态选择 Base URL
  let baseUrl;
  if (isCn) {
    baseUrl = JIMENG_BASE_URL;
  } else {
    const isGlobalRegion = initialSessionInfo.region !== 'us';
    baseUrl = isGlobalRegion ? DREAMINA_BASE_URL_GLOBAL : DREAMINA_BASE_URL_US;
  }

  const appId = isCn ? APP_ID_CN : APP_ID_US;
  const webVersion = isCn ? VERSION_CN : VERSION_US;
  const daVersion = isCn ? DA_VERSION_CN : DA_VERSION_US;
  const region = isCn ? 'cn' : 'all';
  const requestContext = resolveRequestContext(sessionId, webId);
  const resolvedWebId = requestContext.resolvedWebId;
  const regionProfile = getRegionProfile(requestContext.region || (isCn ? 'cn' : 'us'));

  if (requestContext.cookieMap.size > 0) {
    console.log(
      `[jimeng] 已从全量 Cookie 提取上下文: webId=${resolvedWebId}${requestContext.msToken ? ', msToken=present' : ', msToken=missing'}`
    );
  }

  const { deviceTime, sign } = generateSign(uri, isCn ? VERSION_CN : VERSION_US, options.data);
  const fullUrl = uri.includes('://') ? new URL(uri) : new URL(`${baseUrl}${uri}`);

  const defaultParams = {
    aid: appId,
    device_platform: 'web',
    region: region,
    webId: resolvedWebId,
    web_id: resolvedWebId,
    webid: resolvedWebId,
    da_version: daVersion,
    web_component_open_flag: 1,
    web_version: webVersion,
    aigc_features: 'app_lip_sync',
    os: 'mac',
    ...(options.params || {}),
  };

  if (shouldApplyDreaminaAigcAntiBotSignature(uri, isCn)) {
    defaultParams.region = regionProfile?.requestRegion || String(requestContext.region || 'us').toUpperCase();
    defaultParams.web_component_open_flag = 0;
    defaultParams.commerce_with_input_video = 1;
    defaultParams.web_version = '7.5.0';
  }

  console.log(`[jimeng] 请求: ${method.toUpperCase()} ${uri}`);
  console.log(`[jimeng] 参数: ${JSON.stringify(defaultParams, null, 2)}`);
  if (options.data) console.log(`[jimeng] Body: ${JSON.stringify(options.data, null, 2).substring(0, 500)}...`);

  for (const [key, value] of Object.entries(defaultParams)) {
    fullUrl.searchParams.set(key, String(value));
  }

  if (!isCn && requestContext.msToken && !fullUrl.searchParams.has('msToken')) {
    fullUrl.searchParams.set('msToken', requestContext.msToken);
  }

  const headers = {
    ...FAKE_HEADERS,
    Cookie: buildCookieHeader(sessionId, resolvedWebId, USER_ID, isCn),
    'Device-Time': String(deviceTime),
    Sign: sign,
    'Sign-Ver': '1',
    'App-Sdk-Version': '48.0.0',
    Appid: String(appId),
    Appvr: webVersion,
    Pf: PLATFORM_CODE,
    Lan: regionProfile?.lan || (isCn ? 'zh-Hans' : 'en'),
    Loc: regionProfile?.loc || (isCn ? 'cn' : 'us'),
    Did: String(resolvedWebId),
    Tdid: '',
    'store-country-code': regionProfile?.storeCountryCode || requestContext.region || 'us',
    'store-country-code-src': 'uid',
    ...(options.headers || {}),
  };
  const requestCookie = headers.Cookie || headers.cookie || '';
  const requestBodyString = options.data ? JSON.stringify(options.data) : '';

  if (!isCn && requestContext.msToken) {
    headers['X-Ms-Token'] = requestContext.msToken;
  } else {
    delete headers['X-Ms-Token'];
  }

  if (!useNodeFetch) {
    if (headers.Cookie) delete headers.Cookie;
    if (headers.cookie) delete headers.cookie;
  }

  const fetchOptions = { 
    method: method.toUpperCase(), 
    headers,
    data: options.data, // 显式传递原始对象，以触发 Active Dispatch 2.0
    body: options.data ? JSON.stringify(options.data) : undefined
  };

  let currentSessionId = sessionId;
  let currentUri = uri;

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }

      // 动态判定当前尝试的地区
      const currentSessionInfo = parseRegionalSessionInput(currentSessionId);
      const isGlobalRegion = currentSessionInfo.region !== 'us';
      
      // 重新构造 URL (如果因为前缀变化需要切换域名)
      let finalUrl = currentUri;
      if (!currentUri.includes('://')) {
        const currentBase = isGlobalRegion ? DREAMINA_BASE_URL_GLOBAL : DREAMINA_BASE_URL_US;
        finalUrl = `${currentBase}${currentUri}`;
      } else if (attempt > 0 && isGlobalRegion) {
        // [核心修复] 如果补齐了 hk- 前缀，必须强制把所有 .us. 域名替换掉，否则会鉴权失败
        if (finalUrl.includes('commerce.us.capcut.com')) {
          finalUrl = finalUrl.replace('commerce.us.capcut.com', 'commerce-api.capcut.com');
        } else if (finalUrl.includes('dreamina-api.us.capcut.com')) {
          finalUrl = finalUrl.replace('dreamina-api.us.capcut.com', DREAMINA_BASE_URL_GLOBAL.replace('https://', ''));
        }
      }
      
      const fullUrlObj = new URL(finalUrl);
      for (const [key, value] of Object.entries(defaultParams)) {
        fullUrlObj.searchParams.set(key, String(value));
      }

      if (shouldApplyDreaminaAigcAntiBotSignature(currentUri, isCn)) {
        const unsignedQuery = fullUrlObj.searchParams.toString();
        const queryWithXBogus = signXBogus(unsignedQuery, headers['User-Agent'], requestBodyString);
        const signedParams = new URLSearchParams(queryWithXBogus);
        signedParams.set('X-Gnarly', getXGnarly(unsignedQuery, requestBodyString, headers['User-Agent']));
        fullUrlObj.search = signedParams.toString();
      }

      if (attempt > 0) {
        console.log(`  [jimeng] 重试请求 (attempt:${attempt}, region:${currentSessionInfo.region}): ${fullUrlObj.toString()}`);
      }

      let data;
      if (useNodeFetch) {
        const nodeHeaders = {
          ...headers,
          Cookie: requestCookie,
          Origin: isCn ? 'https://jimeng.jianying.com' : 'https://dreamina.capcut.com',
          Referer: isCn
            ? 'https://jimeng.jianying.com/ai-tool/video/generate'
            : 'https://dreamina.capcut.com/ai-tool/video/generate',
        };

        const response = await fetch(fullUrlObj.toString(), {
          method: method.toUpperCase(),
          headers: nodeHeaders,
          body: options.data ? JSON.stringify(options.data) : undefined,
          signal: AbortSignal.timeout(45000),
        });

        const rawText = await response.text();
        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}: ${rawText.slice(0, 300) || 'empty response'}`
          );
        }

        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(`非 JSON 响应: ${rawText.slice(0, 300) || 'empty response'}`);
        }
      } else {
        data = await browserService.fetch(
          currentSessionId,
          resolvedWebId,
          USER_ID,
          fullUrlObj.toString(),
          fetchOptions,
          isCn ? 'jimeng' : 'dreamina'
        );
      }

      return unwrapProviderApiResponse(data, isCn ? '即梦' : 'Dreamina');
    } catch (err) {
      if (err.isApiError) throw err;
      
      const msg = err.message || '';
      const isRedirectToHome = msg.includes('超时') || msg.includes('重定向') || msg.includes('login error');
      
      if (attempt < 1 && parseRegionalSessionInput(currentSessionId).region === 'us' && isRedirectToHome) {
        console.log(`  [jimeng] 检测到可能的区域失匹配导致的重定向，下一轮重试将自动开启港区探测模式...`);
        currentSessionId = `hk-${currentSessionId}`;
      }

      if (attempt === 3) throw err;
      console.log(`  [jimeng] 尝试 ${attempt + 1} 失败: ${msg}`);
    }
  }
}

/**
 * 上传图片到 ImageX CDN
 */
async function uploadImageBuffer(buffer, sessionId, webId, isCn = false) {
  console.log(`  [upload] 开始上传图片 (${isCn ? 'CN' : 'US'})，大小：${buffer.length} 字节`);
  const sessionRegion = parseRegionalSessionInput(sessionId).region || 'us';

  const tokenResult = await jimengRequest(
    'post',
    '/mweb/v1/get_upload_token',
    sessionId,
    webId,
    { 
      data: { scene: 2 },
      transport: 'node',
      providerId: isCn ? 'legacy-jimeng' : 'dreamina'
    }
  );

  const { access_key_id, secret_access_key, session_token, service_id } =
    tokenResult;
  if (!access_key_id || !secret_access_key || !session_token) {
    throw new Error('获取上传令牌失败');
  }
  const actualServiceId = service_id || 'wopfjsm1ax'; 
  console.log(`  [upload] 上传令牌获取成功：serviceId=${actualServiceId}`);

  const fileSize = buffer.length;
  const crc32 = calculateCRC32(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  );

  const timestamp = new Date()
    .toISOString()
    .replace(/[:\-]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const randomStr = Math.random().toString(36).substring(2, 12);
  const imageXDomain = isCn
    ? 'imagex.bytedanceapi.com'
    : sessionRegion === 'us'
      ? 'imagex16-normal-us-ttp.capcutapi.us'
      : 'imagex-normal-sg.capcutapi.com';
  const imageXSigningRegion = isCn
    ? 'cn-north-1'
    : sessionRegion === 'us'
      ? 'useast5'
      : 'ap-southeast-1';
  const applyUrl = `https://${imageXDomain}/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=${actualServiceId}&FileSize=${fileSize}&s=${randomStr}`;

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
    session_token,
    '',
    imageXSigningRegion
  );

  const applyData = await browserService.fetch(
    sessionId,
    WEB_ID,
    USER_ID,
    applyUrl,
    {
      method: 'GET',
      headers: {
        accept: '*/*',
        authorization: authorization,
        'x-amz-date': timestamp,
        'x-amz-security-token': session_token,
      },
      disableSigning: true,
    },
    'dreamina'
  );

  if (applyData?.ResponseMetadata?.Error)
    throw new Error(
      `申请上传权限失败：${JSON.stringify(applyData.ResponseMetadata.Error)}`
    );

  const uploadAddress = applyData?.Result?.UploadAddress;
  if (!uploadAddress?.StoreInfos?.length || !uploadAddress?.UploadHosts?.length) {
    throw new Error('获取上传地址失败');
  }

  const storeInfo = uploadAddress.StoreInfos[0];
  const uploadHost = uploadAddress.UploadHosts[0];
  const uploadUrl = `https://${uploadHost}/upload/v1/${storeInfo.StoreUri}`;

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      Authorization: storeInfo.Auth,
      'Content-CRC32': crc32,
      'Content-Disposition': 'attachment; filename="undefined"',
      'Content-Type': 'application/octet-stream',
      Origin: 'https://dreamina.capcut.com',
      Referer: 'https://dreamina.capcut.com/ai-tool/video/generate',
      'User-Agent': FAKE_HEADERS['User-Agent'],
    },
    body: buffer,
  });

  if (!uploadResponse.ok)
    throw new Error(`图片上传失败：${uploadResponse.status}`);

  const commitDataDomain = imageXDomain;
  const commitUrl = `https://${commitDataDomain}/?Action=CommitImageUpload&Version=2018-08-01&ServiceId=${actualServiceId}`;
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
    commitPayload,
    imageXSigningRegion
  );

  const commitData = await browserService.fetch(
    sessionId,
    WEB_ID,
    USER_ID,
    commitUrl,
    {
      method: 'POST',
      headers: {
        accept: '*/*',
        authorization: commitAuth,
        'content-type': 'application/json',
        'x-amz-date': commitTimestamp,
        'x-amz-security-token': session_token,
        'x-amz-content-sha256': payloadHash,
      },
      body: commitPayload,
      disableSigning: true,
    },
    'dreamina'
  );

  if (commitData?.ResponseMetadata?.Error)
    throw new Error(
      `提交上传失败：${JSON.stringify(commitData.ResponseMetadata.Error)}`
    );

  if (!commitData?.Result?.Results?.length)
    throw new Error('提交上传响应缺少结果');
  const result = commitData.Result.Results[0];
  if (result.UriStatus !== 2000)
    throw new Error(`图片上传状态异常：UriStatus=${result.UriStatus}`);

  const imageUri =
    commitData.Result?.PluginResult?.[0]?.ImageUri || result.Uri;
  console.log(`  [upload] 图片上传完成：${imageUri}`);
  return imageUri;
}

/**
 * Seedance 2.0 视频生成主函数 (已优化为 Dreamina 国际版标准结构)
 */
export async function generateSeedanceVideo(options) {
  let {
    prompt,
    ratio = '16:9',
    duration = 4,
    files = [],
    sessionId: initialSessionId,
    model = 'seedance-2.0-fast',
    referenceMode = '全能参考',
    referenceMap = null,
    onProgress,
    onSubmitId,
    onHistoryId,
    onItemId,
    onVideoReady,
    onAccountResolved,
    providerId = 'dreamina',
  } = options;

  const isCn = providerId === 'legacy-jimeng';

  let sessionId = normalizeSessionIdInput(initialSessionId);
  let webId = WEB_ID;
  let activeAccountId = null;
  let didRefreshCurrentSession = false;
  const manualSessionLocked = Boolean(initialSessionId);
  const startTime = Date.now();
  let currentVideoDefinition = resolveVideoModelDefinition(model);
  let currentModelKey = currentVideoDefinition.id;
  let currentModelId = currentVideoDefinition.nativeModelId;
  let currentRootModel = currentVideoDefinition.rootModel;
  let currentBenefitType = resolveVideoBenefitTypeForRequest(currentVideoDefinition, sessionId, providerId);
  const allowFastZeroCreditProbe = isFastZeroCreditProbeEnabledForRequest(currentModelKey, providerId);
  let strictFastZeroCreditProbeMode = false;
  const attemptedAccountIds = new Set();
  const attemptedSessionIds = new Set();
  const rememberAttemptedAccount = ({
    accountId = null,
    resolvedSessionId = '',
  } = {}) => {
    const normalizedAccountId = Number(accountId);
    if (Number.isFinite(normalizedAccountId) && normalizedAccountId > 0) {
      attemptedAccountIds.add(normalizedAccountId);
    }

    for (const candidate of buildExcludedSessionCandidates(resolvedSessionId)) {
      attemptedSessionIds.add(candidate);
    }
  };
  const updateStrictFastZeroCreditProbeMode = ({
    credits = null,
    source = 'pool',
    resolvedSessionId = '',
  } = {}) => {
    if (strictFastZeroCreditProbeMode) {
      return;
    }

    strictFastZeroCreditProbeMode = isFastZeroCreditProbeAttempt({
      modelId: currentModelKey,
      providerId,
      accountInfo: {
        source,
        creditsBefore: credits,
      },
      sessionId: resolvedSessionId || sessionId,
    });
  };
  let currentAccountInfo = {
    providerId,
    source: sessionId ? 'manual_session' : 'pool',
    accountId: null,
    email: null,
    sessionMask: maskSessionForDisplay(sessionId),
    creditsBefore: null,
    creditsAfter: null,
    creditCost: null,
    phase: 'selected',
    updatedAt: new Date().toISOString(),
  };
  const setResolvedAccountInfo = async ({
    accountId = null,
    email = null,
    resolvedSessionId = '',
    credits = null,
    source = 'pool',
  } = {}) => {
    const sameAccount = accountId && currentAccountInfo.accountId && Number(accountId) === Number(currentAccountInfo.accountId);
    currentAccountInfo = {
      ...currentAccountInfo,
      providerId,
      source,
      accountId: accountId || null,
      email: email || null,
      sessionMask: maskSessionForDisplay(resolvedSessionId || sessionId),
      creditsBefore: sameAccount && currentAccountInfo.creditsBefore !== null
        ? currentAccountInfo.creditsBefore
        : toNullableNumber(credits),
      creditsAfter: sameAccount ? currentAccountInfo.creditsAfter : null,
      creditCost: sameAccount ? currentAccountInfo.creditCost : null,
      phase: 'selected',
      updatedAt: new Date().toISOString(),
    };
    await invokePersistenceCallback(onAccountResolved, 'onAccountResolved', currentAccountInfo);
  };
  console.log(
    `[video] 收到请求模型: "${model}", 规范化后: "${currentModelKey}", 原生 ID: "${currentModelId}", draft root: "${currentRootModel}", benefitType: "${currentBenefitType}"`
  );
  const resConfig = VIDEO_RESOLUTION[ratio] || VIDEO_RESOLUTION['16:9'];
  const { width, height } = resConfig;

  if (sessionId) {
    rememberAttemptedAccount({
      accountId: activeAccountId,
      resolvedSessionId: sessionId,
    });
    await setResolvedAccountInfo({
      resolvedSessionId: sessionId,
      source: 'manual_session',
    });
  }

  // 如果没有提供 sessionId，尝试从账号池获取
  if (!sessionId) {
    if (onProgress) onProgress('正在从账号池获取可用账号...');
    try {
      const account = await accountService.getAvailableAccount(1, {
        modelId: currentModelKey,
        allowFastZeroCreditProbe,
      });
      sessionId = normalizeSessionIdInput(account.session_id);
      webId = account.web_id || WEB_ID;
      activeAccountId = account.id || null;
      rememberAttemptedAccount({
        accountId: activeAccountId,
        resolvedSessionId: sessionId,
      });
      updateStrictFastZeroCreditProbeMode({
        credits: account.credits,
        source: 'pool',
        resolvedSessionId: sessionId,
      });
      await setResolvedAccountInfo({
        accountId: activeAccountId,
        email: account.email,
        resolvedSessionId: sessionId,
        credits: account.credits,
        source: 'pool',
      });
      console.log(`[video] 初始使用账号池账号: ${account.email} (credits=${account.credits}, webId: ${String(webId).substring(0, 8)}...)`);
    } catch (err) {
      console.warn(`[video] 初始账号池获取失败: ${err.message}`);
    }
  }

  // 兜底校验：如果依然没有 sessionId，抛出明确错误以避免 1015
  if (!sessionId) {
    throw new Error('未设置 SessionID 且账号池暂无可用账号。请检查网络或稍后重试。');
  }

  let authFallbackAttempted = false;
  let dailyLimitRetryCount = 0;
  const maxDailyLimitRetries = 3;

  while (true) {
    try {
      if (onProgress) onProgress('正在上传参考图片...');
      const uploadedImages = [];
      for (let i = 0; i < files.length; i++) {
        if (onProgress) onProgress(`正在上传第 ${i + 1}/${files.length} 张图片...`);
        const imageUri = await uploadImageBuffer(files[i].buffer, sessionId, webId, isCn);
        uploadedImages.push({ uri: imageUri, width, height });
      }

      const selectedReferences = resolveVideoReferenceSelection(files, referenceMode, prompt, referenceMap);
      if (files.length > 2 && onProgress) {
        const selectedLabels = [
          selectedReferences.firstIndex ? `首帧=#${selectedReferences.firstIndex}` : '',
          selectedReferences.middleIndexes?.length
            ? `中间参考=${selectedReferences.middleIndexes.map((index) => `#${index}`).join(',')}`
            : '',
          selectedReferences.lastIndex ? `尾帧=#${selectedReferences.lastIndex}` : '',
        ]
          .filter(Boolean)
          .join('，');
        onProgress(`已解析 1~5 张参考图映射：${selectedLabels || '首尾帧'}`);
      }

      let firstFrameImage = null;
      let endFrameImage = null;
      if (selectedReferences.firstFrameFile) {
        const firstIndex = files.indexOf(selectedReferences.firstFrameFile);
        if (firstIndex >= 0 && uploadedImages[firstIndex]) {
          firstFrameImage = uploadedImages[firstIndex].uri;
        }
      }
      if (selectedReferences.endFrameFile) {
        const lastIndex = files.indexOf(selectedReferences.endFrameFile);
        if (lastIndex >= 0 && uploadedImages[lastIndex]) {
          endFrameImage = uploadedImages[lastIndex].uri;
        }
      }

      if (!firstFrameImage && !endFrameImage && uploadedImages.length > 0) {
        if (referenceMode === '首帧参考') {
          firstFrameImage = uploadedImages[0].uri;
        } else if (referenceMode === '尾帧参考') {
          endFrameImage = uploadedImages[0].uri;
        } else {
          firstFrameImage = uploadedImages[0].uri;
          if (uploadedImages.length > 1) {
            endFrameImage = uploadedImages[uploadedImages.length - 1].uri;
          }
        }
      }

      const durationMs = (parseInt(duration) || 5) * 1000;
      const durationSeconds = Math.max(1, Math.round(durationMs / 1000));
      const componentId = generateUUID();
      const submitId = generateUUID();
      const normalizedPrompt = normalizeVideoPromptReferences(prompt);
      const normalizedReferenceMap = {
        first: selectedReferences.firstIndex || null,
        middle: selectedReferences.middleIndexes || [],
        last: selectedReferences.lastIndex || null,
      };
      const hasMiddleReferences = (selectedReferences.middleIndexes?.length || 0) > 0;
      const effectiveVideoDefinition = resolveVideoDefinitionForReferences(currentVideoDefinition, {
        hasFirstFrame: Boolean(firstFrameImage),
        hasEndFrame: Boolean(endFrameImage),
        hasMiddleFrames: hasMiddleReferences,
      });
      const effectiveModelKey = effectiveVideoDefinition?.id || currentModelKey;
      const effectiveModelId = effectiveVideoDefinition?.nativeModelId || currentModelId;
      const effectiveRootModel = effectiveVideoDefinition?.rootModel || currentRootModel;
      const effectiveBenefitType =
        resolveVideoBenefitTypeForRequest(effectiveVideoDefinition, sessionId, providerId) ||
        currentBenefitType;
      const hasReferenceFrames = Boolean(firstFrameImage || endFrameImage);
      const shouldUseFirstLastFramesMode = Boolean(firstFrameImage && endFrameImage);
      const shouldIgnoreMiddleReferences = hasMiddleReferences && shouldUseFirstLastFramesMode;
      const effectiveReferenceMap = shouldIgnoreMiddleReferences
        ? {
            first: normalizedReferenceMap.first,
            middle: [],
            last: normalizedReferenceMap.last,
          }
        : normalizedReferenceMap;
      if (
        effectiveModelKey !== currentModelKey ||
        effectiveRootModel !== currentRootModel ||
        effectiveBenefitType !== currentBenefitType
      ) {
        console.log(
          `[video] 已按官方能力切换提交模型: ${currentModelKey} -> ${effectiveModelKey}, rootModel=${effectiveRootModel}, benefitType=${effectiveBenefitType}`
        );
      }
      if (shouldIgnoreMiddleReferences) {
        console.warn('[video] 当前官方首尾帧模式不接收中间参考图，本次提交将仅携带首帧和尾帧');
      }
      const sceneOptions = [
        {
          type: 'video',
          scene: 'BasicVideoGenerateButton',
          resolution: '720p',
          modelReqKey: effectiveRootModel,
          videoDuration: durationSeconds,
          reportParams: {
            enterSource: 'generate',
            vipSource: 'generate',
            extraVipFunctionKey: `${effectiveRootModel}-720p`,
            useVipFunctionDetailsReporterHoc: true,
          },
          materialTypes: [],
        },
      ];
      const metricsExtraPayload = {
        promptSource: 'custom',
        isDefaultSeed: 1,
        originSubmitId: submitId,
        isRegenerate: false,
        enterFrom: 'click',
        position: 'page_bottom_box',
        sceneOptions: JSON.stringify(sceneOptions),
      };
      if (hasReferenceFrames) {
        metricsExtraPayload.functionMode = shouldUseFirstLastFramesMode ? 'first_last_frames' : 'first_frame';
      }
      if (
        effectiveReferenceMap.first ||
        effectiveReferenceMap.last ||
        effectiveReferenceMap.middle.length > 0
      ) {
        metricsExtraPayload.referenceMap = effectiveReferenceMap;
      }
      const videoTaskExtra = JSON.stringify(metricsExtraPayload);

      await invokePersistenceCallback(onSubmitId, 'onSubmitId', submitId);

      if (onProgress) onProgress('正在提交视频生成请求...');
      let generateResult;
      let historyId = null;

      const shouldUseNativeDreaminaSubmit = !isCn && !hasReferenceFrames;

      if (shouldUseNativeDreaminaSubmit) {
        const nativeFirstFrameImage = firstFrameImage
          ? uploadedImages.find((item) => item.uri === firstFrameImage) || {
              uri: firstFrameImage,
              width,
              height,
            }
          : null;
        const nativeLastFrameImage = endFrameImage
          ? uploadedImages.find((item) => item.uri === endFrameImage) || {
              uri: endFrameImage,
              width,
              height,
            }
          : null;

        const runNativeSubmit = async (nativeModelId) => {
          const region = parseRegionalSessionInput(sessionId).region || 'us';
          const baseUrl = region === 'us' ? DREAMINA_BASE_URL_US : DREAMINA_BASE_URL_GLOBAL;
          const generateUrl = `${baseUrl}/sw/v1/video/generate`;

          return browserService.fetch(
            sessionId,
            webId,
            USER_ID,
            generateUrl,
            {
              method: 'POST',
              data: {
                prompt: normalizedPrompt,
                ratio,
                duration_ms: durationMs,
                resolution: '720p',
                model_id: nativeModelId,
                first_frame_image: nativeFirstFrameImage,
                last_frame_image: nativeLastFrameImage,
              }
            },
            'dreamina'
          );
        };

        try {
          const nativeSubmit = await runNativeSubmit(currentModelId);
          const nativeResponsePayload = nativeSubmit;

          if (nativeResponsePayload) {
            generateResult = unwrapProviderApiResponse(nativeResponsePayload, 'Dreamina');
            historyId = extractHistoryIdFromGenerateResponse(generateResult);
          } else if (!nativeSubmit?.submitEvalResult?.ok) {
            throw new Error(
              `[native submit] 页面原生提交失败: ${
                nativeSubmit?.submitEvalResult?.error || 'unknown error'
              }`
            );
          } else {
            console.warn('[video] 原生 submit 未捕获到真实 generate 响应，回退手工接口链路');
          }
        } catch (nativeError) {
          if (
            nativeError?.isDailyLimitError ||
            nativeError?.isCreditError ||
            isDailyGenerationLimitError(nativeError) ||
            isSessionAuthError(nativeError?.message || '')
          ) {
            throw nativeError;
          }
          if (isSharkRiskControlError(nativeError)) {
            if (onProgress) {
              onProgress('检测到 Dreamina 风控拦截，正在回退兼容提交流程...');
            }
            console.warn(`[video] 原生 submit 触发 shark 风控，回退手工接口链路: ${nativeError.message}`);
          } else if (nativeError?.isApiError) {
            throw nativeError;
          } else {
            console.warn(`[video] 原生提交失败，回退手工接口链路: ${nativeError.message}`);
          }
        }
      }

      if (!generateResult) {
        console.log(
          `[video] 按官方草稿接口提交: functionMode=${hasReferenceFrames ? metricsExtraPayload.functionMode : 'default'}, extraVipFunctionKey=${effectiveRootModel}-720p, model=${effectiveModelId}, benefitType=${effectiveBenefitType}`
        );
        const generateBody = {
          extend: {
            root_model: effectiveRootModel,
            workspace_id: 0,
            m_video_commerce_info: {
              benefit_type: effectiveBenefitType,
              resource_id: 'generate_video',
              resource_id_type: 'str',
              resource_sub_type: 'aigc',
            },
            m_video_commerce_info_list: [
              {
                benefit_type: effectiveBenefitType,
                resource_id: 'generate_video',
                resource_id_type: 'str',
                resource_sub_type: 'aigc',
              },
            ],
          },
          submit_id: submitId,
          metrics_extra: videoTaskExtra,
          draft_content: JSON.stringify({
            type: 'draft',
            id: generateUUID(),
            min_version: '3.0.5',
            min_features: [],
            is_from_tsn: true,
            version: isCn ? DRAFT_VERSION_CN : DRAFT_VERSION_US,
            main_component_id: componentId,
            component_list: [
              {
                type: 'video_base_component',
                id: componentId,
                min_version: '1.0.0',
                aigc_mode: 'workbench',
                metadata: {
                  type: '',
                  id: generateUUID(),
                  created_platform: 3,
                  created_platform_version: '',
                  created_time_in_ms: String(Date.now()),
                  created_did: '',
                },
                generate_type: 'gen_video',
                abilities: {
                  type: '',
                  id: generateUUID(),
                  gen_video: {
                    type: '',
                    id: generateUUID(),
                    text_to_video_params: {
                      id: generateUUID(),
                      type: '',
                      model_req_key: effectiveRootModel,
                      video_aspect_ratio: ratio || '16:9',
                      seed: Math.floor(Math.random() * 100000000) + 2500000000,
                      video_gen_inputs: [
                        {
                          duration_ms: durationMs,
                          fps: 24,
                          id: generateUUID(),
                          idip_meta_list: [],
                          min_version: '3.0.5',
                          prompt: normalizedPrompt || '',
                          resolution: '720p',
                          type: '',
                          video_mode: 2,
                          first_frame_image: firstFrameImage ? {
                            format: "",
                            height: height,
                            id: generateUUID(),
                            image_uri: firstFrameImage,
                            name: "",
                            platform_type: 1,
                            source_from: "upload",
                            type: "image",
                            uri: firstFrameImage,
                            width: width,
                          } : null,
                          end_frame_image: endFrameImage ? {
                            format: "",
                            height: height,
                            id: generateUUID(),
                            image_uri: endFrameImage,
                            name: "",
                            platform_type: 1,
                            source_from: "upload",
                            type: "image",
                            uri: endFrameImage,
                            width: width,
                          } : null,
                        },
                      ],
                      priority: 0,
                    },
                    video_task_extra: videoTaskExtra,
                  },
                },
                process_type: 1,
              },
            ],
          }),
          http_common_info: {
            aid: APP_ID_US,
          },
        };

        generateResult = await jimengRequest(
          'POST',
          '/mweb/v1/aigc_draft/generate',
          sessionId,
          webId,
          { 
            data: generateBody,
            providerId: providerId
          }
        );

        historyId = extractHistoryIdFromGenerateResponse(generateResult);
      }

      if (!historyId) throw new Error('未获取到记录 ID');

      console.log(`[video] 生成请求已提交，historyId: ${historyId}`);
      await invokePersistenceCallback(onHistoryId, 'onHistoryId', historyId);

      if (onProgress) onProgress('已提交，等待 AI 生成视频...');
      await new Promise((r) => setTimeout(r, 5000));

      let status = 20;
      let failCode;
      let itemList = [];
      const maxRetries = 60;

      for (let retryCount = 0; retryCount < maxRetries && status === 20; retryCount++) {
        try {
          const result = await jimengRequest(
            'post',
            '/mweb/v1/get_history_by_ids',
            sessionId,
            webId,
            { 
              data: { history_ids: [historyId] },
              providerId: providerId
            }
          );

          const historyData = result?.history_list?.[0] || result?.[historyId];
          if (!historyData) {
            const waitTime = Math.min(2000 * (retryCount + 1), 30000);
            await new Promise((r) => setTimeout(r, waitTime));
            continue;
          }

          status = historyData.status;
          failCode = historyData.fail_code;
          itemList = historyData.item_list || [];
          const videoUrl = itemList[0]?.video?.transcoded_video?.origin?.video_url ||
                           itemList[0]?.video?.play_url ||
                           itemList[0]?.video?.url;
          const itemId = itemList[0]?.id;

          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          console.log(
            `[video] 轮询 #${retryCount + 1}: status=${status}, items=${itemList.length}, hasVideo=${videoUrl ? 'yes' : 'no'}, ${Math.floor(elapsed / 60)}分${elapsed % 60}秒`
          );

          if (status === 30) throw buildHistoryFailureError('生成', failCode);

          if (videoUrl || status === 10 || status === 50) {
            if (!videoUrl) {
              console.warn(`[video] 历史状态已完成但尚未解析到视频 URL，historyId=${historyId}, itemId=${itemId || 'unknown'}`);
            }
            if (onVideoReady) onVideoReady(videoUrl);
            await invokePersistenceCallback(onItemId, 'onItemId', itemId);
            currentAccountInfo = await finalizeAccountUsageInfo({
              activeAccountId,
              sessionId,
              currentAccountInfo,
              onAccountResolved,
              modelId: currentModelKey,
              providerId,
            });

            return {
              videoUrl,
              historyId,
              itemId,
              submitId,
              revisedPrompt: itemList[0]?.prompt || prompt,
            };
          }
          await new Promise((r) => setTimeout(r, 5000));
        } catch (pollErr) {
          if (isSessionAuthError(pollErr.message)) {
            if (!didRefreshCurrentSession) {
              const refreshed = await tryRefreshSessionForRetry({
                activeAccountId,
                sessionId,
                reason: pollErr.message,
                onProgress,
                sourceHint: currentAccountInfo?.source || (activeAccountId ? 'pool' : 'manual_session'),
              });
              if (refreshed?.sessionId) {
                sessionId = refreshed.sessionId;
                webId = refreshed.webId || WEB_ID;
                activeAccountId = refreshed.accountId || activeAccountId;
                didRefreshCurrentSession = true;
                rememberAttemptedAccount({
                  accountId: activeAccountId,
                  resolvedSessionId: sessionId,
                });
                updateStrictFastZeroCreditProbeMode({
                  credits: refreshed.credits,
                  source: refreshed.source || currentAccountInfo?.source || 'pool',
                  resolvedSessionId: sessionId,
                });
                await setResolvedAccountInfo({
                  accountId: activeAccountId,
                  email: refreshed.email,
                  resolvedSessionId: sessionId,
                  credits: refreshed.credits,
                  source: refreshed.source || currentAccountInfo?.source || 'pool',
                });
                continue;
              }
            }
            throw pollErr;
          }
          console.error(`[video] 轮询过程出错: ${pollErr.message}`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      try {
        const finalResult = await jimengRequest(
          'post',
          '/mweb/v1/get_history_by_ids',
          sessionId,
          webId,
          {
            data: { history_ids: [historyId] },
            providerId: providerId
          }
        );
        const finalHistoryData = finalResult?.history_list?.[0] || finalResult?.[historyId];
        const finalItemList = finalHistoryData?.item_list || [];
        const finalVideoUrl = finalItemList[0]?.video?.transcoded_video?.origin?.video_url ||
                              finalItemList[0]?.video?.play_url ||
                              finalItemList[0]?.video?.url;
        const finalItemId = finalItemList[0]?.id;

        if (finalVideoUrl) {
          console.warn(`[video] 超时前最终补拉命中视频结果，historyId=${historyId}, itemId=${finalItemId || 'unknown'}`);
          if (onVideoReady) onVideoReady(finalVideoUrl);
          await invokePersistenceCallback(onItemId, 'onItemId', finalItemId);
          currentAccountInfo = await finalizeAccountUsageInfo({
            activeAccountId,
            sessionId,
            currentAccountInfo,
            onAccountResolved,
            modelId: currentModelKey,
            providerId,
          });

          return {
            videoUrl: finalVideoUrl,
            historyId,
            itemId: finalItemId,
            submitId,
            revisedPrompt: finalItemList[0]?.prompt || prompt,
          };
        }
      } catch (finalPollErr) {
        console.warn(`[video] 超时前最终补拉历史失败: ${finalPollErr.message}`);
      }
      throw new Error('生成超时');

    } catch (err) {
      const isAuthError = isSessionAuthError(err.message);
      const isDailyLimitError = err?.isDailyLimitError || isDailyGenerationLimitError(err);

      if (isDailyLimitError) {
        if (manualSessionLocked) {
          throw new Error(`${err.message}；当前任务使用手动指定 Session，不自动切换号池`);
        }
        markAccountStatus(
          activeAccountId,
          sessionId,
          'out_of_credits',
          err.message || '121101 daily generation limit'
        );

        if (dailyLimitRetryCount >= maxDailyLimitRetries) {
          throw new Error('当前所有可用账号均已达到当日生成上限，请明日再试或添加新账号');
        }

        try {
          const switched = await switchToNextPoolAccount({
            currentAccountId: activeAccountId,
            currentSessionId: sessionId,
            excludeAccountIds: Array.from(attemptedAccountIds),
            excludeSessionIds: Array.from(attemptedSessionIds),
            onProgress,
            reason: err.message || '121101 daily generation limit',
            progressMessage: '当前账号已达当日生成上限，正在切换下一个账号重试...',
            minCredits: 1,
            markStatus: 'out_of_credits',
            modelId: currentModelKey,
            allowFastZeroCreditProbe,
            requireFastZeroCreditProbe: strictFastZeroCreditProbeMode,
          });
          sessionId = switched.sessionId;
          webId = switched.webId;
          activeAccountId = switched.accountId;
          didRefreshCurrentSession = false;
          rememberAttemptedAccount({
            accountId: activeAccountId,
            resolvedSessionId: sessionId,
          });
          updateStrictFastZeroCreditProbeMode({
            credits: switched.credits,
            source: 'pool',
            resolvedSessionId: sessionId,
          });
          await setResolvedAccountInfo({
            accountId: activeAccountId,
            email: switched.email,
            resolvedSessionId: sessionId,
            credits: switched.credits,
            source: 'pool',
          });
          dailyLimitRetryCount += 1;
          continue;
        } catch (switchError) {
          throw new Error('当前所有可用账号均已达到当日生成上限，请明日再试或添加新账号');
        }
      }

      if (isAuthError && manualSessionLocked) {
        throw new Error(`${err.message}；当前任务使用手动指定 Session，不自动切换号池`);
      }

      if (isAuthError && !didRefreshCurrentSession) {
        const refreshed = await tryRefreshSessionForRetry({
          activeAccountId,
          sessionId,
          reason: err.message,
          onProgress,
          sourceHint: currentAccountInfo?.source || (activeAccountId ? 'pool' : 'manual_session'),
        });
        if (refreshed?.sessionId) {
          sessionId = refreshed.sessionId;
          webId = refreshed.webId || WEB_ID;
          activeAccountId = refreshed.accountId || activeAccountId;
          didRefreshCurrentSession = true;
          rememberAttemptedAccount({
            accountId: activeAccountId,
            resolvedSessionId: sessionId,
          });
          updateStrictFastZeroCreditProbeMode({
            credits: refreshed.credits,
            source: refreshed.source || currentAccountInfo?.source || 'pool',
            resolvedSessionId: sessionId,
          });
          await setResolvedAccountInfo({
            accountId: activeAccountId,
            email: refreshed.email,
            resolvedSessionId: sessionId,
            credits: refreshed.credits,
            source: refreshed.source || currentAccountInfo?.source || 'pool',
          });
          console.log(`[video] 已自动刷新账号 ${refreshed.email} 的 SessionID，准备重试当前请求`);
          continue;
        }
      }

      if (!authFallbackAttempted && isAuthError) {
        authFallbackAttempted = true;
        didRefreshCurrentSession = false;
        const fallbackMsg = initialSessionId && normalizeSessionIdInput(initialSessionId) !== sessionId
          ? `检测到手动账号 (..${String(initialSessionId).slice(-4)}) 鉴权异常，正在切换系统自动账号池并重试...`
          : '检测到当前账号鉴权异常，正在从账号池更换新账号并重试...';

        try {
          const switched = await switchToNextPoolAccount({
            currentAccountId: activeAccountId,
            currentSessionId: sessionId,
            excludeAccountIds: Array.from(attemptedAccountIds),
            excludeSessionIds: Array.from(attemptedSessionIds),
            onProgress,
            reason: err.message,
            progressMessage: fallbackMsg,
            minCredits: 1,
            markStatus: activeAccountId ? 'inactive' : null,
            modelId: currentModelKey,
            allowFastZeroCreditProbe,
            requireFastZeroCreditProbe: strictFastZeroCreditProbeMode,
          });
          sessionId = switched.sessionId;
          webId = switched.webId;
          activeAccountId = switched.accountId;
          rememberAttemptedAccount({
            accountId: activeAccountId,
            resolvedSessionId: sessionId,
          });
          updateStrictFastZeroCreditProbeMode({
            credits: switched.credits,
            source: 'pool',
            resolvedSessionId: sessionId,
          });
          await setResolvedAccountInfo({
            accountId: activeAccountId,
            email: switched.email,
            resolvedSessionId: sessionId,
            credits: switched.credits,
            source: 'pool',
          });
          console.log(`[video] 鉴权错误触发换号重试 -> 使用新账号: ${switched.email}`);
          continue;
        } catch (switchError) {
          throw new Error(`${err.message}；切换账号池失败：${switchError.message}`);
        }
      }
      // 处理积分不足/无权益错误：自动换号重试
      if (err.isCreditError && sessionId) {
        if (manualSessionLocked) {
          throw new Error(`${err.message}；当前任务使用手动指定 Session，不自动切换号池`);
        }
        console.warn(
          `[video] 当前账号提交返回积分/权益错误: account=${currentAccountInfo.email || 'unknown'}, ret=${err.retCode || 'unknown'}, message=${err.message}`
        );

        if (activeAccountId && isFastZeroCreditProbeAttempt({
          modelId: currentModelKey,
          providerId,
          accountInfo: currentAccountInfo,
          sessionId,
        })) {
          accountService.markFastZeroCreditProbeResult(activeAccountId, {
            status: 'failed',
            modelId: currentModelKey,
            checkedAt: new Date().toISOString(),
            reason: err.message || 'Fast 0积分首免探测失败',
          });
        }

        markAccountStatus(activeAccountId, sessionId, 'out_of_credits', err.message);

        if (dailyLimitRetryCount >= maxDailyLimitRetries) {
          throw new Error('当前账号池中没有可用的正积分账号，或现有账号均无对应权益，请补充账号后重试');
        }

        try {
          const switched = await switchToNextPoolAccount({
            currentAccountId: activeAccountId,
            currentSessionId: sessionId,
            excludeAccountIds: Array.from(attemptedAccountIds),
            excludeSessionIds: Array.from(attemptedSessionIds),
            onProgress,
            reason: err.message || '1006 not enough credits',
            progressMessage: '当前账号积分不足/无对应权益，正在切换下一个正积分账号重试...',
            minCredits: 1,
            markStatus: 'out_of_credits',
            modelId: currentModelKey,
            allowFastZeroCreditProbe,
            requireFastZeroCreditProbe: strictFastZeroCreditProbeMode,
          });
          sessionId = switched.sessionId;
          webId = switched.webId;
          activeAccountId = switched.accountId;
          didRefreshCurrentSession = false;
          rememberAttemptedAccount({
            accountId: activeAccountId,
            resolvedSessionId: sessionId,
          });
          updateStrictFastZeroCreditProbeMode({
            credits: switched.credits,
            source: 'pool',
            resolvedSessionId: sessionId,
          });
          await setResolvedAccountInfo({
            accountId: activeAccountId,
            email: switched.email,
            resolvedSessionId: sessionId,
            credits: switched.credits,
            source: 'pool',
          });
          dailyLimitRetryCount += 1;
          continue;
        } catch (switchError) {
          throw new Error(`${err.message}；切换账号池失败：${switchError.message}`);
        }
      }
      throw err;
    }
  }
}

function buildHistoryFailureError(label, failCode) {
  const error = new Error(`${label}失败 (代码: ${failCode || 'unknown'})`);
  if (failCode) error.failCode = String(failCode);
  if (isDailyGenerationLimitError({ fail_code: failCode })) {
    error.isDailyLimitError = true;
  }
  return error;
}

function buildHistoryPendingError(label, historyId, status, failCode) {
  const detail = historyId
    ? `${label}轮询超时，上游仍在处理中 (historyId=${historyId}, status=${status || 'unknown'})`
    : `${label}轮询超时`;
  const error = new Error(detail);
  error.isHistoryPending = Boolean(historyId);
  error.historyId = historyId || null;
  error.taskStatus = Number.isFinite(Number(status)) ? Number(status) : null;
  error.failCode = failCode ? String(failCode) : null;
  error.progressMessage = historyId
    ? `已提交到即梦，仍在处理中（historyId=${historyId}）...`
    : `${label}任务仍在处理中`;
  return error;
}


/**
 * Dreamina / 即梦 - 文字生图 (Image 4.1)
 */
export async function generateSeedanceImage(options) {
  const {
    prompt,
    ratio = '1:1',
    count = 1,
    files = [],
    sessionId: initialSessionId,
    fallbackSessionCandidates = [],
    webId = WEB_ID,
    model = 'dreamina-image-4.1',
    providerId = 'dreamina',
    onProgress,
    onImageReady,
    onHistoryId,
    onAccountResolved,
  } = options;

  const startTime = Date.now();
  const requestedCount = Math.max(1, Number.parseInt(String(count || '1'), 10) || DEFAULT_IMAGE_GENERATE_COUNT);
  const requestedBenefitCount = Math.max(1, Number.parseInt(String(count || '1'), 10) || DEFAULT_IMAGE_BENEFIT_COUNT);
  let currentSessionId = normalizeSessionIdInput(initialSessionId);
  let currentWebId = webId || WEB_ID;
  let activeAccountId = null;
  let didRefreshCurrentSession = false;
  const manualSessionLocked = Boolean(initialSessionId);
  const fallbackSessionQueue = createFallbackSessionQueue(fallbackSessionCandidates, currentSessionId);
  let currentAccountInfo = {
    providerId,
    source: currentSessionId ? 'manual_session' : 'pool',
    accountId: null,
    email: null,
    sessionMask: maskSessionForDisplay(currentSessionId),
    creditsBefore: null,
    creditsAfter: null,
    creditCost: null,
    phase: 'selected',
    updatedAt: new Date().toISOString(),
  };
  const setResolvedAccountInfo = async ({
    accountId = null,
    email = null,
    resolvedSessionId = '',
    credits = null,
    source = 'pool',
  } = {}) => {
    const sameAccount = accountId && currentAccountInfo.accountId && Number(accountId) === Number(currentAccountInfo.accountId);
    currentAccountInfo = {
      ...currentAccountInfo,
      providerId,
      source,
      accountId: accountId || null,
      email: email || null,
      sessionMask: maskSessionForDisplay(resolvedSessionId || currentSessionId),
      creditsBefore: sameAccount && currentAccountInfo.creditsBefore !== null
        ? currentAccountInfo.creditsBefore
        : toNullableNumber(credits),
      creditsAfter: sameAccount ? currentAccountInfo.creditsAfter : null,
      creditCost: sameAccount ? currentAccountInfo.creditCost : null,
      phase: 'selected',
      updatedAt: new Date().toISOString(),
    };
    await invokePersistenceCallback(onAccountResolved, 'onAccountResolved', currentAccountInfo);
  };

  if (currentSessionId) {
    await setResolvedAccountInfo({
      resolvedSessionId: currentSessionId,
      source: 'manual_session',
    });
  }

  if (!currentSessionId) {
    if (onProgress) onProgress('正在从账号池获取可用账号...');
    try {
      const account = await accountService.getAvailableAccount(1);
      currentSessionId = normalizeSessionIdInput(account.session_id);
      currentWebId = account.web_id || WEB_ID;
      activeAccountId = account.id || null;
      await setResolvedAccountInfo({
        accountId: activeAccountId,
        email: account.email,
        resolvedSessionId: currentSessionId,
        credits: account.credits,
        source: 'pool',
      });
      console.log(`[image] 初始使用账号池账号: ${account.email} (webId: ${String(currentWebId).substring(0, 8)}...)`);
    } catch (error) {
      console.warn(`[image] 初始账号池获取失败: ${error.message}`);
    }
  }

  if (!currentSessionId) {
    const fallbackResolved = await takeNextValidatedFallbackSession({
      queue: fallbackSessionQueue,
      providerId,
      onProgress,
      progressMessage: '账号池暂无可用正积分账号，正在校验已保存的手动 Session...',
    });
    if (fallbackResolved.sessionId) {
      currentSessionId = fallbackResolved.sessionId;
      currentWebId = WEB_ID;
      activeAccountId = null;
      await setResolvedAccountInfo({
        resolvedSessionId: currentSessionId,
        credits: fallbackResolved.credits,
        source: 'saved_session_fallback',
      });
      console.warn(`[image] 账号池不可用，回退到已保存手动 Session: ${maskSessionForDisplay(currentSessionId)}`);
    } else {
      const reasonSuffix = fallbackResolved.lastError ? `；最近一次校验失败：${fallbackResolved.lastError}` : '';
      throw new Error(`未设置 SessionID 且账号池暂无可用账号。请检查网络或稍后重试${reasonSuffix}`);
    }
  }

  if (onProgress) onProgress('正在从官方配置解析生图模型...');
  let currentModel = resolveImageModelDefinition(model)?.id || 'dreamina-image-4.1';
  let generateResult = null;
  let historyId = null;
  const hasReferenceImage = Array.isArray(files) && files.length > 0;

  let authPoolSwitchAttempted = false;
  let dailyLimitRetryCount = 0;
  const maxDailyLimitRetries = 3;

  while (true) {
    const meta = await resolveImageModelMeta({
      sessionId: currentSessionId,
      webId: currentWebId,
      providerId,
      model: currentModel,
    });
    const imageSpec = resolveImageLargeImageInfo(meta, ratio);
    if (onProgress) {
      onProgress(
        `当前生图模型：${meta.modelName || currentModel}（${meta.modelId}，${imageSpec.width}x${imageSpec.height}）`
      );
    }
    const componentId = generateUUID();
    const submitId = generateUUID();
    const draftId = generateUUID();
    const metadataId = generateUUID();
    const abilitiesId = generateUUID();
    const generateAbilityId = generateUUID();
    const coreParamId = generateUUID();
    const largeImageInfoId = generateUUID();
    const genOptionId = generateUUID();
    const seed = Math.floor(Math.random() * 2147483647);
    let sceneOptions;
    let generateBody;

    if (hasReferenceImage) {
      const referenceFiles = files.filter((file) => file?.buffer).slice(0, MAX_REFERENCE_FILES);
      if (referenceFiles.length === 0) {
        throw new Error('图生图缺少可上传的图片 buffer');
      }

      if (onProgress) {
        onProgress(
          referenceFiles.length > 1
            ? `正在上传 ${referenceFiles.length} 张图生图参考图...`
            : '正在上传图生图参考图...'
        );
      }

      const uploadedReferences = [];
      for (let index = 0; index < referenceFiles.length; index++) {
        if (onProgress) {
          onProgress(`正在上传图生图参考图 ${index + 1}/${referenceFiles.length}...`);
        }
        const file = referenceFiles[index];
        const imageUri = await uploadImageBuffer(
          file.buffer,
          currentSessionId,
          currentWebId,
          providerId === 'legacy-jimeng'
        );
        uploadedReferences.push({
          file,
          imageUri,
          size: getImageDimensionsFromBuffer(file.buffer) || { width: 0, height: 0 },
        });
      }

      const blendAbilityId = generateUUID();
      const postEditParamId = generateUUID();
      const unifiedEditInputId = generateUUID();
      const { promptWithPlaceholder } = buildImagePromptWithPlaceholders(prompt, uploadedReferences.length);
      const abilityList = uploadedReferences.map((reference) => ({
        abilityName: 'byte_edit',
        strength: 0.5,
        source: {
          imageUrl: reference.imageUri,
        },
      }));
      const blendAbilityList = uploadedReferences.map((reference, index) => ({
        type: '',
        id: generateUUID(),
        name: 'byte_edit',
        image_uri_list: [reference.imageUri],
        image_list: [
          {
            type: 'image',
            id: generateUUID(),
            source_from: 'upload',
            platform_type: 1,
            name: reference.file.originalname || '',
            image_uri: reference.imageUri,
            width: reference.size.width || 0,
            height: reference.size.height || 0,
            format: '',
            uri: reference.imageUri,
          },
        ],
        strength: 0.5,
      }));
      const materialList = uploadedReferences.map((reference) => ({
        type: '',
        id: generateUUID(),
        material_type: 'image',
        image_info: {
          type: 'image',
          id: generateUUID(),
          source_from: 'upload',
          platform_type: 1,
          name: reference.file.originalname || '',
          image_uri: reference.imageUri,
          aigc_image: {
            type: '',
            id: generateUUID(),
          },
          width: reference.size.width || 0,
          height: reference.size.height || 0,
          format: '',
          uri: reference.imageUri,
        },
      }));
      const promptPlaceholderInfoList = uploadedReferences.map((_, index) => ({
        type: '',
        id: generateUUID(),
        ability_index: index,
      }));
      const metaList = buildImageMetaListFromPrompt(promptWithPlaceholder, uploadedReferences.length);

      sceneOptions = [
        {
          type: 'image',
          scene: 'ImageBasicGenerate',
          modelReqKey: meta.modelId,
          resolutionType: imageSpec.resolutionType,
          abilityList,
          benefitCount: requestedBenefitCount,
          reportParams: {
            enterSource: 'generate',
            vipSource: 'generate',
            extraVipFunctionKey: `${meta.modelId}-${imageSpec.resolutionType}`,
            useVipFunctionDetailsReporterHoc: true,
          },
        },
      ];

      generateBody = {
        extend: {
          root_model: meta.modelId,
          workspace_id: 0,
        },
        submit_id: submitId,
        metrics_extra: JSON.stringify({
          promptSource: 'custom',
          generateCount: requestedCount,
          enterFrom: 'click',
          position: 'page_bottom_box',
          sceneOptions: JSON.stringify(sceneOptions),
          isBoxSelect: false,
          isCutout: false,
          generateId: submitId,
          isRegenerate: false,
        }),
        draft_content: JSON.stringify({
          type: 'draft',
          id: draftId,
          min_version: '3.3.11',
          min_features: ['AIGC_Image_BlendUnifiedEdit'],
          is_from_tsn: true,
          version: DRAFT_VERSION_US,
          main_component_id: componentId,
          component_list: [
            {
              type: 'image_base_component',
              id: componentId,
              min_version: '3.0.2',
              aigc_mode: 'workbench',
              metadata: {
                type: '',
                id: metadataId,
                created_platform: 3,
                created_platform_version: '',
                created_time_in_ms: String(Date.now()),
                created_did: '',
              },
              generate_type: 'blend',
              abilities: {
                type: '',
                id: abilitiesId,
                blend: {
                  type: '',
                  id: blendAbilityId,
                  min_version: '3.3.11',
                  min_features: ['AIGC_Image_BlendUnifiedEdit'],
                  core_param: {
                    type: '',
                    id: coreParamId,
                    model: meta.modelId,
                    prompt: `##${promptWithPlaceholder}`.trim(),
                    sample_strength: 0.5,
                    image_ratio: imageSpec.ratioType,
                    large_image_info: {
                      type: '',
                      id: largeImageInfoId,
                      height: imageSpec.height,
                      width: imageSpec.width,
                      resolution_type: imageSpec.resolutionType,
                    },
                    intelligent_ratio: false,
                    generate_type: 0,
                  },
                  ability_list: blendAbilityList,
                  prompt_placeholder_info_list: promptPlaceholderInfoList,
                  postedit_param: {
                    type: '',
                    id: postEditParamId,
                    generate_type: 0,
                  },
                  unified_edit_input: {
                    type: '',
                    id: unifiedEditInputId,
                    material_list: materialList,
                    meta_list: metaList,
                  },
                },
                gen_option: {
                  type: '',
                  id: genOptionId,
                  generate_all: false,
                },
              },
            },
          ],
        }),
        http_common_info: {
          aid: APP_ID_US,
        },
      };
    } else {
      sceneOptions = [
        {
          type: 'image',
          scene: 'ImageBasicGenerate',
          modelReqKey: meta.modelId,
          resolutionType: imageSpec.resolutionType,
          abilityList: [],
          benefitCount: requestedBenefitCount,
          reportParams: {
            enterSource: 'generate',
            vipSource: 'generate',
            extraVipFunctionKey: `${meta.modelId}-${imageSpec.resolutionType}`,
            useVipFunctionDetailsReporterHoc: true,
          },
        },
      ];

      generateBody = {
        extend: {
          root_model: meta.modelId,
          workspace_id: 0,
        },
        submit_id: submitId,
        metrics_extra: JSON.stringify({
          promptSource: 'custom',
          generateCount: requestedCount,
          enterFrom: 'click',
          position: 'page_bottom_box',
          sceneOptions: JSON.stringify(sceneOptions),
          isBoxSelect: false,
          isCutout: false,
          generateId: submitId,
          isRegenerate: false,
        }),
        draft_content: JSON.stringify({
          type: 'draft',
          id: draftId,
          min_version: '3.0.2',
          min_features: [],
          is_from_tsn: true,
          version: DRAFT_VERSION_US,
          main_component_id: componentId,
          component_list: [
            {
              type: 'image_base_component',
              id: componentId,
              min_version: '3.0.2',
              aigc_mode: 'workbench',
              metadata: {
                type: '',
                id: metadataId,
                created_platform: 3,
                created_platform_version: '',
                created_time_in_ms: String(Date.now()),
                created_did: '',
              },
              generate_type: 'generate',
              abilities: {
                type: '',
                id: abilitiesId,
                generate: {
                  type: '',
                  id: generateAbilityId,
                  core_param: {
                    type: '',
                    id: coreParamId,
                    model: meta.modelId,
                    prompt: prompt || '',
                    negative_prompt: '',
                    seed,
                    sample_strength: 0.5,
                    image_ratio: imageSpec.ratioType,
                    large_image_info: {
                      type: '',
                      id: largeImageInfoId,
                      height: imageSpec.height,
                      width: imageSpec.width,
                      resolution_type: imageSpec.resolutionType,
                    },
                    intelligent_ratio: false,
                    generate_type: 0,
                  },
                },
                gen_option: {
                  type: '',
                  id: genOptionId,
                  generate_all: false,
                },
              },
            },
          ],
        }),
        http_common_info: {
          aid: APP_ID_US,
        },
      };
    }

    try {
      console.log(
        `[image] 提交生图请求：generateCount=${requestedCount}, benefitCount=${requestedBenefitCount}, model=${meta.modelId}, session=${maskSessionForDisplay(currentSessionId)}`
      );
      generateResult = await jimengRequest(
        'POST',
        '/mweb/v1/aigc_draft/generate',
        currentSessionId,
        currentWebId,
        {
          data: generateBody,
          providerId: providerId
        }
      );
      historyId = extractHistoryIdFromGenerateResponse(generateResult);
      if (historyId) break;
      throw new Error('生图任务提交失败，未获取到 historyId');
    } catch (error) {
      const isAuthError = isSessionAuthError(error?.message || '');
      const isDailyLimitError = error?.isDailyLimitError || isDailyGenerationLimitError(error);

      if (isDailyLimitError) {
        if (manualSessionLocked) {
          throw new Error(`${error.message}；当前任务使用手动指定 Session，不自动切换号池`);
        }
        markAccountStatus(
          activeAccountId,
          currentSessionId,
          'out_of_credits',
          error.message || '121101 daily generation limit'
        );

        if (dailyLimitRetryCount >= maxDailyLimitRetries) {
          throw new Error('当前所有可用账号均已达到当日生成上限，请明日再试或添加新账号');
        }

        const switched = await switchToNextPoolAccount({
          currentAccountId: activeAccountId,
          currentSessionId,
          onProgress,
          reason: error.message || '121101 daily generation limit',
          progressMessage: '当前生图账号已达当日生成上限，正在切换下一个账号重试...',
          minCredits: 1,
          markStatus: 'out_of_credits',
        });
        currentSessionId = switched.sessionId;
        currentWebId = switched.webId;
        activeAccountId = switched.accountId;
        didRefreshCurrentSession = false;
        await setResolvedAccountInfo({
          accountId: activeAccountId,
          email: switched.email,
          resolvedSessionId: currentSessionId,
          credits: switched.credits,
          source: 'pool',
        });
        dailyLimitRetryCount += 1;
        continue;
      }

      if (isAuthError && manualSessionLocked) {
        throw new Error(`${error.message}；当前任务使用手动指定 Session，不自动切换号池`);
      }

      if (isAuthError && !didRefreshCurrentSession) {
        const refreshed = await tryRefreshSessionForRetry({
          activeAccountId,
          sessionId: currentSessionId,
          reason: error.message,
          onProgress,
          sourceHint: currentAccountInfo?.source || (activeAccountId ? 'pool' : 'manual_session'),
        });
        if (refreshed?.sessionId) {
          currentSessionId = refreshed.sessionId;
          currentWebId = refreshed.webId || WEB_ID;
          activeAccountId = refreshed.accountId || activeAccountId;
          didRefreshCurrentSession = true;
          await setResolvedAccountInfo({
            accountId: activeAccountId,
            email: refreshed.email,
            resolvedSessionId: currentSessionId,
            credits: refreshed.credits,
            source: refreshed.source || currentAccountInfo?.source || 'pool',
          });
          continue;
        }
      }

      if (isAuthError && currentAccountInfo?.source !== 'pool') {
        const fallbackResolved = await takeNextValidatedFallbackSession({
          queue: fallbackSessionQueue,
          excludedSessionIds: buildExcludedSessionCandidates(currentSessionId),
          providerId,
          onProgress,
          progressMessage: '当前 Session 鉴权异常，正在校验下一个已保存的手动 Session...',
        });
        if (fallbackResolved.sessionId) {
          currentSessionId = fallbackResolved.sessionId;
          currentWebId = WEB_ID;
          activeAccountId = null;
          didRefreshCurrentSession = false;
          await setResolvedAccountInfo({
            resolvedSessionId: currentSessionId,
            credits: fallbackResolved.credits,
            source: 'saved_session_fallback',
          });
          continue;
        }
      }

      if (isAuthError && !authPoolSwitchAttempted) {
        authPoolSwitchAttempted = true;
        if (onProgress) onProgress('检测到当前生图账号鉴权异常，正在切换系统自动账号池并重试...');
        const switched = await switchToNextPoolAccount({
          currentAccountId: activeAccountId,
          currentSessionId,
          onProgress: null,
          reason: error.message,
          minCredits: 1,
          markStatus: activeAccountId ? 'inactive' : null,
        });
        currentSessionId = switched.sessionId;
        currentWebId = switched.webId;
        activeAccountId = switched.accountId;
        didRefreshCurrentSession = false;
        await setResolvedAccountInfo({
          accountId: activeAccountId,
          email: switched.email,
          resolvedSessionId: currentSessionId,
          credits: switched.credits,
          source: 'pool',
        });
        continue;
      }
      if (error?.isCreditError && currentSessionId) {
        if (manualSessionLocked) {
          throw new Error(`${error.message}；当前任务使用手动指定 Session，不自动切换号池`);
        }
        markAccountStatus(activeAccountId, currentSessionId, 'out_of_credits', error.message);

        if (dailyLimitRetryCount >= maxDailyLimitRetries) {
          throw new Error('当前账号池中没有可用的正积分账号，或现有账号均无对应权益，请补充账号后重试');
        }

        const switched = await switchToNextPoolAccount({
          currentAccountId: activeAccountId,
          currentSessionId,
          onProgress,
          reason: error.message || '1006 not enough credits',
          progressMessage: '当前生图账号积分不足/无对应权益，正在切换下一个正积分账号重试...',
          minCredits: 1,
          markStatus: 'out_of_credits',
        });
        currentSessionId = switched.sessionId;
        currentWebId = switched.webId;
        activeAccountId = switched.accountId;
        didRefreshCurrentSession = false;
        await setResolvedAccountInfo({
          accountId: activeAccountId,
          email: switched.email,
          resolvedSessionId: currentSessionId,
          credits: switched.credits,
          source: 'pool',
        });
        dailyLimitRetryCount += 1;
        continue;
      }
      throw error;
    }
  }

  if (!historyId) throw new Error('生图任务提交失败，未获取到 historyId');

  console.log(`[image] 生图任务已提交，historyId: ${historyId}`);
  await invokePersistenceCallback(onHistoryId, 'onHistoryId', historyId);

  if (onProgress) onProgress('已提交，等待 AI 画图中...');
  await new Promise((r) => setTimeout(r, 3000));

  let status = 20; // 正在生成
  let failCode;
  let itemList = [];
  const maxRetries = 40;

  for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
    try {
      const result = await jimengRequest(
        'post',
        '/mweb/v1/get_history_by_ids',
        currentSessionId,
        currentWebId,
        { 
          data: { history_ids: [historyId] },
          providerId: providerId
        }
      );

      const historyData = result?.history_list?.[0] || result?.[historyId];
      if (!historyData) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      status = historyData.status;
      failCode = historyData.fail_code;
      itemList = historyData.item_list || [];

      console.log(`[image] 轮询 #${retryCount + 1}: status=${status}`);

      if (status === 30) throw buildHistoryFailureError('生图', failCode);

      if (status === 10 || status === 50) {
        const rawImageUrls = itemList
          .map(
            (item) =>
              item?.image?.origin?.url ||
              item?.image?.large_images?.[0]?.image_url ||
              item?.image?.url ||
              item?.image?.play_url
          )
          .filter(Boolean);
        const imageUrls = rawImageUrls.slice(0, requestedCount);
        const imageUrl = imageUrls[0] || null;

        if (rawImageUrls.length > requestedCount) {
          console.warn(`[image] 上游返回 ${rawImageUrls.length} 张图，已按请求 count=${requestedCount} 截断为 ${imageUrls.length} 张`);
        }

        if (imageUrl) {
          if (onImageReady) onImageReady(imageUrl);
          currentAccountInfo = await finalizeAccountUsageInfo({
            activeAccountId,
            sessionId: currentSessionId,
            currentAccountInfo,
            onAccountResolved,
          });

          return {
            imageUrl,
            imageUrls,
            historyId,
            status,
          };
        }
      }

      if (![20, 45].includes(Number(status))) {
        console.warn(`[image] 当前状态 ${status} 尚未产出可用图片，继续轮询...`);
      }
    } catch (e) {
      if (e?.isDailyLimitError || isDailyGenerationLimitError(e)) {
        throw e;
      }
      if (isSessionAuthError(e.message)) {
        if (!didRefreshCurrentSession) {
          const refreshed = await tryRefreshSessionForRetry({
            activeAccountId,
            sessionId: currentSessionId,
            reason: e.message,
            onProgress,
            sourceHint: currentAccountInfo?.source || (activeAccountId ? 'pool' : 'manual_session'),
          });
          if (refreshed?.sessionId) {
            currentSessionId = refreshed.sessionId;
            currentWebId = refreshed.webId || WEB_ID;
            activeAccountId = refreshed.accountId || activeAccountId;
            didRefreshCurrentSession = true;
            await setResolvedAccountInfo({
              accountId: activeAccountId,
              email: refreshed.email,
              resolvedSessionId: currentSessionId,
              credits: refreshed.credits,
              source: refreshed.source || currentAccountInfo?.source || 'pool',
            });
            continue;
          }
        }
        throw e;
      }
      console.warn(`[image] 轮询出错: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  throw buildHistoryPendingError('生图', historyId, status, failCode);
}

export {
  MODEL_MAP,
  BENEFIT_TYPE_MAP,
  VIDEO_RESOLUTION,
  DREAMINA_BASE_URL,
  DREAMINA_BASE_URL_US,
  DREAMINA_BASE_URL_GLOBAL,
  JIMENG_BASE_URL,
  COMMERCE_API_URL_US,
  COMMERCE_API_URL_GLOBAL,
  COMMERCE_API_URL_CN,
};
