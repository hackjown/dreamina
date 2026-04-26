import { getDatabase } from '../database/index.js';
import { getDefaultGenerationSettings } from './generationProviders.js';
import { jimengRequest, COMMERCE_API_URL_US, COMMERCE_API_URL_CN } from './videoGenerator.js';
import { normalizeSessionIdInput, parseRegionalSessionInput } from './sessionIdUtils.js';
import browserService from '../browser-service.js';

/**
 * 全局设置服务层
 */

const EDITABLE_SETTING_KEYS = new Set([
  'provider',
  'model',
  'ratio',
  'duration',
  'reference_mode',
  'download_path',
  'max_concurrent',
  'min_interval',
  'max_interval',
  'manual_video_url',
  'gpt_email_provider',
  'gpt_browserbase_api_key',
  'gpt_browserbase_project_id',
  'gpt_ddg_token',
  'gpt_cli_proxy_url',
  'gpt_cli_proxy_token',
  'gpt_mail_inbox_url',
  'gpt_2925_master_email',
  'gpt_2925_password',
  'gpt_ddg_inbox_url',
  'gpt_2925_inbox_url',
  'ecommerce_api_name',
  'ecommerce_api_url',
  'ecommerce_api_key',
  'ecommerce_model',
  'ecommerce_analysis_api_name',
  'ecommerce_analysis_api_url',
  'ecommerce_analysis_api_key',
  'ecommerce_analysis_model',
  'ecommerce_generation_api_name',
  'ecommerce_generation_provider',
  'ecommerce_generation_api_url',
  'ecommerce_generation_api_key',
  'ecommerce_generation_model',
  'ecommerce_video_api_name',
  'ecommerce_video_provider',
  'ecommerce_video_api_url',
  'ecommerce_video_api_key',
  'ecommerce_video_model',
]);

const LEGACY_MODEL_SETTING_MAP = {
  'dreamina-seedance-1.0-mini': 'seedance-2.0-fast',
  'dreamina-seedance-1.5-pro': 'seedance-2.0',
};

function sanitizeSettingsRowMap(rows) {
  const settings = {};
  for (const row of rows) {
    if (row.key === 'session_id') {
      continue;
    }
    settings[row.key] = row.value;
  }
  return settings;
}

function ensureDefaultSettings() {
  const defaults = getDefaultGenerationSettings();
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO NOTHING
  `);

  const insertDefaults = db.transaction(() => {
    for (const [key, value] of Object.entries(defaults)) {
      stmt.run(key, value);
    }
    
    // 初始化 GPT 注册机相关的默认设置
    const gptDefaults = {
      'gpt_browserbase_api_key': '',
      'gpt_browserbase_project_id': '',
      'gpt_ddg_token': '',
      'gpt_cli_proxy_url': '',
      'gpt_cli_proxy_token': '',
      'gpt_mail_inbox_url': '',
      'gpt_ddg_inbox_url': '',
      'gpt_2925_inbox_url': 'https://2925.com/#/mailList',
    };
    
    for (const [key, value] of Object.entries(gptDefaults)) {
      stmt.run(key, value);
    }
  });

  insertDefaults();

  const currentModel = db.prepare(`SELECT value FROM settings WHERE key = 'model'`).get()?.value;
  const normalizedModel = LEGACY_MODEL_SETTING_MAP[currentModel];
  if (normalizedModel) {
    db.prepare(`
      UPDATE settings
      SET value = ?, updated_at = CURRENT_TIMESTAMP
      WHERE key = 'model'
    `).run(normalizedModel);
  }
}

/**
 * 获取所有可编辑全局设置
 */
export function getAllSettings() {
  ensureDefaultSettings();
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM settings`);
  const rows = stmt.all();
  return sanitizeSettingsRowMap(rows);
}

/**
 * 获取单个设置
 */
export function getSetting(key) {
  if (!EDITABLE_SETTING_KEYS.has(key)) {
    return null;
  }

  ensureDefaultSettings();
  const db = getDatabase();
  const stmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
  const row = stmt.get(key);
  return row ? row.value : null;
}

/**
 * 获取遗留全局 SessionID（仅用于兼容兜底）
 */
export function getLegacyGlobalSessionId() {
  const db = getDatabase();
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'session_id'`).get();
  return normalizeSessionIdInput(row?.value || '');
}

/**
 * 更新设置
 */
export function updateSetting(key, value) {
  if (!EDITABLE_SETTING_KEYS.has(key)) {
    throw new Error('不支持更新该设置项');
  }

  ensureDefaultSettings();
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(key, value);
  return { key, value };
}

/**
 * 批量更新设置
 */
export function updateSettings(settings) {
  ensureDefaultSettings();
  const db = getDatabase();
  const entries = Object.entries(settings).filter(([key]) => EDITABLE_SETTING_KEYS.has(key));

  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `);

  const transaction = db.transaction((items) => {
    for (const [key, value] of items) {
      stmt.run(key, value);
    }
  });

  transaction(entries);
  return getAllSettings();
}

function summarizeBenefitRecord(record) {
  if (!record) return '';
  const parts = [];
  if (record.title) parts.push(record.title);
  if (record.trade_source) parts.push(record.trade_source);
  if (record.amount !== undefined) parts.push(`amount=${record.amount}`);
  return parts.join(' | ');
}

export function analyzeJimengCreditHistory(raw) {
  const records = Array.isArray(raw?.records) ? raw.records : [];
  const totalCredit = Number(raw?.total_credit || 0);

  const benefitRecord = records.find((record) => {
    const title = String(record?.title || '').toLowerCase();
    const tradeSource = String(record?.trade_source || '').toUpperCase();
    return (
      tradeSource === 'FREEMIUM_RECEIVE' ||
      title.includes('daily_free') ||
      title.includes('expired_daily')
    );
  });

  if (benefitRecord) {
    return {
      benefitEligibility: 'eligible',
      benefitLabel: '有权益发放资格',
      benefitReason: '检测到 Dreamina daily free / FREEMIUM_RECEIVE 发放记录',
      benefitEvidence: summarizeBenefitRecord(benefitRecord),
      benefitTradeSource: benefitRecord.trade_source || '',
      hasBenefitGrant: true,
      totalCredit,
    };
  }

  if (records.length === 0) {
    return {
      benefitEligibility: 'ineligible',
      benefitLabel: '未检测到权益发放',
      benefitReason: '服务端未返回任何 credits 发放记录，通常表示未进入 daily free 发放范围',
      benefitEvidence: '',
      benefitTradeSource: '',
      hasBenefitGrant: false,
      totalCredit,
    };
  }

  return {
    benefitEligibility: 'unknown',
    benefitLabel: totalCredit > 0 ? '有积分但来源待确认' : '资格待确认',
    benefitReason: totalCredit > 0
      ? '检测到积分或历史记录，但未在最近账本中发现明确的 daily free 发放记录'
      : '存在账本记录，但未发现明确的 daily free 发放记录',
    benefitEvidence: summarizeBenefitRecord(records[0]),
    benefitTradeSource: records[0]?.trade_source || '',
    hasBenefitGrant: false,
    totalCredit,
  };
}

function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function collectZeroAmountBenefitEntries(value, currentPath = 'root', hits = []) {
  if (!value || typeof value !== 'object') {
    return hits;
  }

  if (
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'benefit_type') &&
    Number(value.amount) === 0
  ) {
    hits.push({
      path: currentPath,
      benefitType: String(value.benefit_type || ''),
      amount: 0,
    });
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectZeroAmountBenefitEntries(item, `${currentPath}[${index}]`, hits));
    return hits;
  }

  for (const [key, child] of Object.entries(value)) {
    collectZeroAmountBenefitEntries(child, `${currentPath}.${key}`, hits);
  }

  return hits;
}

function summarizeZeroCreditUsage(usage) {
  if (!usage) return '';

  const parts = [
    usage.historyRecordId ? `historyId=${usage.historyRecordId}` : '',
    usage.modelReqKey ? `model=${usage.modelReqKey}` : '',
    usage.resolution ? `resolution=${usage.resolution}` : '',
    usage.durationMs ? `durationMs=${usage.durationMs}` : '',
    usage.ratio ? `ratio=${usage.ratio}` : '',
    Array.isArray(usage.benefitTypes) && usage.benefitTypes.length
      ? `benefitType=${usage.benefitTypes.join('|')}`
      : '',
  ].filter(Boolean);

  return parts.join(', ');
}

function extractZeroCreditUsageFromAsset(asset) {
  const videoAsset = asset?.video;
  if (!videoAsset || typeof videoAsset !== 'object') {
    return null;
  }

  const zeroAmountEntries = collectZeroAmountBenefitEntries(videoAsset)
    .filter((entry) => entry.benefitType)
    .filter((entry) => /video|seedance|dreamina/i.test(entry.benefitType));

  if (zeroAmountEntries.length === 0) {
    return null;
  }

  const item = Array.isArray(videoAsset.item_list) ? videoAsset.item_list[0] : null;
  const commonAttr = item?.common_attr || {};
  const text2VideoParams = item?.aigc_image_params?.text2video_params || {};
  const input = Array.isArray(text2VideoParams.video_gen_inputs)
    ? text2VideoParams.video_gen_inputs[0]
    : null;
  const metricsExtra = safeJsonParse(videoAsset.metrics_extra, {});
  const sceneOptions = safeJsonParse(metricsExtra?.sceneOptions, []);
  const scene = Array.isArray(sceneOptions) ? sceneOptions[0] : null;
  const draftContent = safeJsonParse(videoAsset.draft_content, {});
  const draftInput =
    draftContent?.component_list?.[0]?.abilities?.gen_video?.text_to_video_params?.video_gen_inputs?.[0] ||
    null;
  const resolvedInput = input || draftInput || {};

  const durationMs = Number(
    resolvedInput?.duration_ms ||
    item?.video?.duration_ms ||
    0
  ) || null;
  const fps = Number(resolvedInput?.fps || 0) || null;
  const seed = Number(text2VideoParams?.seed || 0);

  return {
    historyRecordId: String(videoAsset.history_record_id || asset?.id || '').trim() || null,
    itemId: commonAttr?.id ? String(commonAttr.id) : null,
    finishTime: Number(videoAsset.finish_time || commonAttr?.create_time || 0) || null,
    generateId: videoAsset.generate_id || null,
    submitId: videoAsset.submit_id || null,
    modelReqKey:
      text2VideoParams?.model_req_key ||
      videoAsset?.model_info?.model_req_key ||
      scene?.modelReqKey ||
      null,
    modelName: videoAsset?.model_info?.model_name || null,
    benefitTypes: Array.from(new Set(zeroAmountEntries.map((entry) => entry.benefitType))),
    zeroAmountEntries,
    resolution: scene?.resolution || null,
    durationMs,
    ratio: text2VideoParams?.video_aspect_ratio || null,
    fps,
    seed: Number.isFinite(seed) && seed > 0 ? seed : null,
    functionMode: metricsExtra?.functionMode || null,
    prompt: String(resolvedInput?.prompt || '').trim(),
    firstFrameImageUri: resolvedInput?.first_frame_image?.image_uri || null,
    endFrameImageUri: resolvedInput?.end_frame_image?.image_uri || null,
    videoUrl:
      item?.video?.transcoded_video?.origin?.video_url ||
      item?.video?.download_url ||
      item?.video?.play_url ||
      null,
  };
}

async function fetchRecentDreaminaZeroCreditVideoUsage(sessionId) {
  const normalizedSessionId = normalizeSessionIdInput(sessionId);
  const region = parseRegionalSessionInput(normalizedSessionId).region || 'us';
  if (!normalizedSessionId || region === 'cn') {
    return null;
  }

  const offset = Date.now();
  const requestBodies = [
    {
      offset,
      count: 30,
      direction: 1,
      mode: 'workbench',
      option: {
        origin_image_info: { width: 96 },
        only_favorited: true,
        with_task_status: [50, 45],
        end_time_stamp: 0,
        aigc_generate_type_filters: [],
      },
      asset_type_list: [6],
    },
    {
      offset,
      count: 30,
      direction: 1,
      mode: 'workbench',
      option: {
        origin_image_info: { width: 96 },
        only_favorited: false,
        with_task_status: [50, 45],
        end_time_stamp: 0,
        aigc_generate_type_filters: [],
      },
      asset_type_list: [6],
    },
    {
      asset_type: 4,
      option: { only_favorited: true },
      count: 110,
    },
    {
      asset_type: 4,
      option: { only_favorited: false },
      count: 110,
    },
  ];

  const assetsById = new Map();

  for (const body of requestBodies) {
    try {
      const result = await jimengRequest('POST', '/mweb/v1/get_asset_list', normalizedSessionId, null, {
        data: body,
        providerId: 'dreamina',
      });
      const assetList = Array.isArray(result?.asset_list)
        ? result.asset_list
        : Array.isArray(result?.item_list)
          ? result.item_list
          : Array.isArray(result?.data?.asset_list)
            ? result.data.asset_list
            : [];

      for (const asset of assetList) {
        const key = String(
          asset?.id ||
          asset?.video?.history_record_id ||
          asset?.video?.generate_id ||
          ''
        ).trim();
        if (!key || assetsById.has(key)) {
          continue;
        }
        assetsById.set(key, asset);
      }
    } catch (error) {
      console.warn(`[settings] get_asset_list zero-credit history probe failed: ${error.message}`);
    }
  }

  const usages = Array.from(assetsById.values())
    .map((asset) => extractZeroCreditUsageFromAsset(asset))
    .filter(Boolean)
    .sort((a, b) => Number(b.finishTime || 0) - Number(a.finishTime || 0));

  if (usages[0]) {
    return usages[0];
  }

  const browserProbe = await browserService.probeRecentZeroCreditVideoUsage(normalizedSessionId, {
    siteType: 'dreamina',
  });
  return browserProbe?.usage || null;
}

/**
 * 获取即梦 Session 信息 (积分等)
 */
export async function getJimengSessionInfo(sessionId, isCn = false) {
  const normalizedSessionId = normalizeSessionIdInput(sessionId);
  let baseUrl;
  
  if (isCn) {
    baseUrl = 'https://commerce.jianying.com';
  } else {
    const regionInfo = parseRegionalSessionInput(sessionId || normalizedSessionId);
    const isGlobalRegion = regionInfo.region !== 'us';
    baseUrl = isGlobalRegion ? 'https://commerce-api.capcut.com' : 'https://commerce.us.capcut.com';
  }

  const creditUrl = `${baseUrl}/commerce/v1/benefits/user_credit_history`;
  const result = await jimengRequest('POST', creditUrl, normalizedSessionId, null, {
    data: { count: 100, cursor: "0" },
    providerId: isCn ? 'legacy-jimeng' : 'dreamina'
  });
  const benefitAnalysis = analyzeJimengCreditHistory(result);
  let historyUsage = null;

  if (
    !isCn &&
    benefitAnalysis.benefitEligibility === 'ineligible' &&
    Number(result?.total_credit || 0) <= 0
  ) {
    historyUsage = await fetchRecentDreaminaZeroCreditVideoUsage(normalizedSessionId);
  }

  if (historyUsage) {
    return {
      normalizedSessionId,
      points: result?.total_credit !== undefined ? result.total_credit : 0,
      raw: result,
      benefitEligibility: 'eligible',
      benefitLabel: '已检测到 0积分视频生成',
      benefitReason: '最近作品历史中检测到 0金额视频生成，说明该账号至少已真实走通过一次免积分视频路径',
      benefitEvidence: summarizeZeroCreditUsage(historyUsage),
      benefitTradeSource: 'history_zero_cost_generate',
      hasBenefitGrant: true,
      recentZeroCreditUsage: historyUsage,
    };
  }
  
  return {
    normalizedSessionId,
    points: result?.total_credit !== undefined ? result.total_credit : 0,
    raw: result,
    ...benefitAnalysis,
  };
}

/**
 * 测试 SessionID 是否有效
 */
export async function testSessionId(sessionId, isCn = false) {
  try {
    const info = await getJimengSessionInfo(sessionId, isCn);
    return { 
      success: true, 
      message: `SessionID 有效！当前 Dreamina 剩余积分: ${info.points}`,
      points: info.points,
      normalizedSessionId: info.normalizedSessionId,
    };
  } catch (error) {
    console.error(`[testSessionId] 验证失败: ${error.message}`);
    
    // 检查是否是由于账号区域问题导致的 (ret=1015 或 1002)
    if (error.message.includes('1015') || error.message.includes('1002')) {
      return {
        success: false,
        error: '账号鉴权失败。请确保您使用的是 Dreamina 国际版 SessionID，而非国内即梦账号。'
      };
    }
    
    return {
      success: false,
      error: `验证失败：${error.message || '网络连接超时'}`
    };
  }
}

export default {
  getAllSettings,
  getSetting,
  getLegacyGlobalSessionId,
  updateSetting,
  updateSettings,
  getJimengSessionInfo,
  testSessionId,
};
