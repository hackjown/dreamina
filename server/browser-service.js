import { chromium } from 'playwright-core';
import path from 'path';
import fs from 'fs';
import { parseRegionalSessionInput } from './services/sessionIdUtils.js';
import { resolveVideoModelDefinition } from './services/modelRegistry.js';

const SESSION_IDLE_TIMEOUT = 10 * 60 * 1000;
const SYSTEM_BROWSER_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

function maskValue(value) {
  if (!value) return '';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function collectZeroAmountBenefitEntries(value, hits = []) {
  if (!value || typeof value !== 'object') {
    return hits;
  }

  if (
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'benefit_type') &&
    Number(value.amount) === 0
  ) {
    hits.push({
      benefitType: String(value.benefit_type || ''),
      amount: 0,
    });
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectZeroAmountBenefitEntries(item, hits));
    return hits;
  }

  for (const child of Object.values(value)) {
    collectZeroAmountBenefitEntries(child, hits);
  }

  return hits;
}

function extractZeroCreditUsageFromAssetPayload(asset) {
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
  const text2VideoParams = item?.aigc_image_params?.text2video_params || {};
  const input = Array.isArray(text2VideoParams.video_gen_inputs)
    ? text2VideoParams.video_gen_inputs[0]
    : null;
  const metricsExtra = safeJsonParse(videoAsset.metrics_extra, {});
  const sceneOptions = safeJsonParse(metricsExtra?.sceneOptions, []);
  const scene = Array.isArray(sceneOptions) ? sceneOptions[0] : null;

  return {
    historyRecordId: String(videoAsset.history_record_id || asset?.id || '').trim() || null,
    modelReqKey:
      text2VideoParams?.model_req_key ||
      videoAsset?.model_info?.model_req_key ||
      scene?.modelReqKey ||
      null,
    benefitTypes: Array.from(new Set(zeroAmountEntries.map((entry) => entry.benefitType))),
    resolution: scene?.resolution || null,
    durationMs: Number(input?.duration_ms || item?.video?.duration_ms || 0) || null,
    ratio: text2VideoParams?.video_aspect_ratio || null,
    finishTime: Number(videoAsset.finish_time || item?.common_attr?.create_time || 0) || null,
    prompt: String(input?.prompt || '').trim(),
    firstFrameImageUri: input?.first_frame_image?.image_uri || null,
    endFrameImageUri: input?.end_frame_image?.image_uri || null,
    videoUrl:
      item?.video?.transcoded_video?.origin?.video_url ||
      item?.video?.download_url ||
      item?.video?.play_url ||
      null,
  };
}

class BrowserService {
  constructor() {
    this.browser = null;
    this.sessions = new Map();
  }

  getSystemBrowserExecutablePath() {
    return SYSTEM_BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
  }

  async ensureBrowser() {
    if (this.browser) return this.browser;
    const launchOptions = {
      headless: true, // 生产环境保持静默
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security'
      ]
    };

    try {
      this.browser = await chromium.launch(launchOptions);
    } catch (error) {
      const fallbackExecutablePath = this.getSystemBrowserExecutablePath();
      const message = String(error?.message || '');
      const shouldFallbackToSystemBrowser =
        Boolean(fallbackExecutablePath) &&
        /Executable doesn't exist|browserType\.launch/i.test(message);

      if (!shouldFallbackToSystemBrowser) {
        throw error;
      }

      console.warn(
        `[browser] Playwright 内置 Chromium 不可用，回退系统浏览器: ${fallbackExecutablePath}`
      );
      this.browser = await chromium.launch({
        ...launchOptions,
        executablePath: fallbackExecutablePath,
      });
    }

    console.log('[browser] Chromium 调度引擎启动 (v4.0 视觉诊断版)');
    return this.browser;
  }

  async applyStealth(context) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });
  }

  async createContext(sessionId, webId, userId, siteType = 'jimeng') {
    const browser = await this.ensureBrowser();
    
    const sessionInfo = parseRegionalSessionInput(sessionId);
    const pureSessionId = sessionInfo.pureSessionId;
    const region = sessionInfo.region || 'us';
    const isGlobalRegion = region !== 'us';
    const idc = isGlobalRegion ? 'alisg' : 'useast5';
    
    // 会话唯一标识与隔离
    const sidClean = String(pureSessionId || sessionId || '').substring(0, 32).replace(/[^a-zA-Z0-9]/g, '');
    const sessionKey = `${siteType}_${region}_${sidClean}`;
    const userDataDir = path.join(process.cwd(), '.jimeng-sessions', sessionKey);

    // 每次同步前清理旧缓存，确保环境纯净
    if (fs.existsSync(userDataDir)) {
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      userDataDir
    });

    await this.applyStealth(context);

    // 注入核心 Cookie
    const cookieDomain = siteType === 'dreamina' ? '.capcut.com' : '.jianying.com';
    const cookies = [
      { name: 'sessionid_ss', value: pureSessionId, domain: cookieDomain, path: '/' },
      { name: 'sessionid', value: pureSessionId, domain: cookieDomain, path: '/' },
      { name: 'sid_tt', value: pureSessionId, domain: cookieDomain, path: '/' },
      { name: 'store-idc', value: idc, domain: cookieDomain, path: '/' },
      { name: 'store-country-code', value: region, domain: cookieDomain, path: '/' },
      { name: 'store-region', value: region, domain: cookieDomain, path: '/' }
    ];

    // 伪造随机 ttwid 增强真实性
    const rand = () => Math.random().toString(36).substring(2, 10);
    cookies.push({ name: 'ttwid', value: `1|${rand()}|${rand()}|${Math.floor(Date.now()/1000)}`, domain: cookieDomain, path: '/' });

    await context.addCookies(cookies);
    const page = await context.newPage();
    
    return { context, page, userDataDir, sessionKey, region };
  }

  async warmupPage(page, domainUrl) {
    try {
      await page.goto(domainUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(800);
    } catch (e) {
      console.warn(`[browser-fetch] 页面预热较慢，继续请求: ${e.message}`);
    }
  }

  isRetriableBrowserFetchError(error) {
    const message = String(error?.message || error || '');
    return [
      'Execution context was destroyed',
      'Failed to fetch',
      'Target page, context or browser has been closed',
      'Target closed',
      'net::ERR',
      'Navigation failed because page was closed',
      'Request context disposed',
      'Page closed',
    ].some((pattern) => message.includes(pattern));
  }

  parseApiResponsePayload(status, contentType, text, apiUrl) {
    if (contentType.includes('application/json')) {
      return JSON.parse(text);
    }

    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return JSON.parse(trimmed);
    }

    if (status < 200 || status >= 300) {
      return {
        error: `HTTP ${status}: ${trimmed.slice(0, 200) || 'empty response'}`,
        status,
        url: apiUrl,
      };
    }

    return {
      ok: true,
      status,
      contentType,
      text,
    };
  }

  async requestViaContextApi(context, url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    const requestOptions = {
      method,
      headers,
      failOnStatusCode: false,
      timeout: options.timeout || 45000,
    };

    if (method !== 'GET' && method !== 'HEAD') {
      if (options.body !== undefined && options.body !== null) {
        requestOptions.data = options.body;
      } else if (options.data !== undefined && options.data !== null) {
        requestOptions.data = options.data;
      }
    }

    const response = await context.request.fetch(url, requestOptions);
    const contentType = response.headers()['content-type'] || '';
    const text = await response.text();
    return this.parseApiResponsePayload(response.status(), contentType, text, url);
  }

  async requestViaPageFetch(context, domainUrl, url, options = {}) {
    const apiPage = await context.newPage();
    try {
      await this.warmupPage(apiPage, domainUrl);
      const apiMethod = String(options.method || 'GET').toUpperCase();
      const apiResponse = await apiPage.evaluate(async ({ apiUrl, apiMethod, apiData, apiBody, apiHeaders }) => {
        try {
          const method = (apiMethod || 'GET').toUpperCase();
          const headers = { ...(apiHeaders || {}) };
          let body = undefined;

          if (apiBody !== undefined && apiBody !== null && method !== 'GET' && method !== 'HEAD') {
            body = apiBody;
          } else if (apiData !== undefined && apiData !== null && method !== 'GET' && method !== 'HEAD') {
            body = JSON.stringify(apiData);
            if (!headers['Content-Type'] && !headers['content-type']) {
              headers['Content-Type'] = 'application/json';
            }
          }

          const resp = await window.fetch(apiUrl, {
            method,
            credentials: 'include',
            headers,
            body,
          });

          const contentType = resp.headers.get('content-type') || '';
          const text = await resp.text();
          return { status: resp.status, contentType, text };
        } catch (e) {
          return { error: e.message, url: apiUrl };
        }
      }, {
        apiUrl: url,
        apiMethod,
        apiData: options.data,
        apiBody: options.body,
        apiHeaders: options.headers || {}
      });

      if (apiResponse?.error) {
        return apiResponse;
      }

      return this.parseApiResponsePayload(
        Number(apiResponse?.status || 0),
        apiResponse?.contentType || '',
        apiResponse?.text || '',
        url
      );
    } finally {
      await apiPage.close().catch(() => {});
    }
  }

  async fetchWithBrowser(sessionId, url, options = {}) {
    const { siteType = 'dreamina', webId = 7352342534578964000 } = options;
    const region = parseRegionalSessionInput(sessionId).region || 'us';
    console.log(`[browser-fetch] DEBUG: keys=${Object.keys(options).join(',')}, dataExits=${!!options.data}`);
    console.log(`[browser-fetch] DEBUG: optionsStr=${JSON.stringify(options).substring(0, 200)}`);
    
    const domainUrl = siteType === 'dreamina' ? 'https://dreamina.capcut.com/ai-tool/home' : 'https://jimeng.jianying.com/ai-tool/home';

    if (url) {
      const maxAttempts = 3;
      let lastError = null;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let requestInfo = null;
        try {
          requestInfo = await this.createContext(sessionId, webId, 0, siteType);
          const { context, page } = requestInfo;

          console.log(
            `[browser-fetch] 正在通过浏览器(Region:${region})代发 AIGC 请求 [尝试 ${attempt + 1}/${maxAttempts}]: ${url.substring(0, 80)}...`
          );
          await this.warmupPage(page, domainUrl);

          let apiResponse = await this.requestViaContextApi(context, url, options);
          if (apiResponse?.error) {
            console.warn(`[browser-fetch] context.request 失败，回退 page.fetch: ${apiResponse.error}`);
            apiResponse = await this.requestViaPageFetch(context, domainUrl, url, options);
          }

          if (apiResponse && !apiResponse.error) {
            console.log(`[browser-fetch] 原生代发成功(增强版)。`);
            return apiResponse;
          }

          throw new Error(apiResponse?.error || '浏览器代发失败');
        } catch (error) {
          lastError = error;
          const retriable = this.isRetriableBrowserFetchError(error);
          console.warn(
            `[browser-fetch] 第 ${attempt + 1} 次代发失败: ${error.message}${retriable && attempt < maxAttempts - 1 ? '，准备自动重试' : ''}`
          );
          if (!retriable || attempt >= maxAttempts - 1) {
            throw error;
          }
          await sleep(800 * (attempt + 1));
        } finally {
          if (requestInfo?.context) await requestInfo.context.close().catch(() => {});
        }
      }

      throw lastError || new Error('浏览器代发失败');
    }

    let info = null;
    try {
      info = await this.createContext(sessionId, webId, 0, siteType);
      const { page } = info;

      console.log(`[browser-fetch] 正在访问控制台并监听积分包...`);
      try {
        await page.goto(domainUrl, { waitUntil: 'networkidle', timeout: 50000 });
      } catch (e) {
        console.warn(`[browser-fetch] 页面加载较慢，继续尝试拦截...`);
      }

      // 增强拦截器：涵盖所有可能的积分返回路径
      const responsePromise = page.waitForResponse(response => {
        const u = response.url();
        return (u.includes('/user_credit_history') || u.includes('/credit/balance') || u.includes('/v1/user/info')) &&
               response.status() === 200;
      }, { timeout: 35000 }).catch(() => null);

      // 正常的同步逻辑（如果没捕获到主动请求，则回退到被动拦截/状态提取）
      const intercepted = await responsePromise;
      if (intercepted) {
        const json = await intercepted.json();
        const total = json.total_credit ?? json.data?.total_credit;
        if (total !== undefined) {
          console.log(`[browser-fetch] 成功通过被动拦截同步到积分: ${total}`);
          return { ret: '0', total_credit: total };
        }
      }

      // 诊断：如果在 35s 内没拦截到，保存截图看是怎么回事
      const debugFile = `debug_${region}_${Date.now()}.png`;
      const debugPath = path.join(process.cwd(), debugFile);
      await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
      console.error(`[browser-fetch] 拦截超时！现场 URL: ${page.url()}, 截图已保存: ${debugPath}`);

      // 兜底状态提取
      const stateTotal = await page.evaluate(() => {
        const s = window.__INITIAL_STATE__ || {};
        return s.user?.credits || s.wallet?.total_credit || s.user?.info?.total_credit;
      }).catch(() => null);

      if (stateTotal !== undefined && stateTotal !== null) {
        console.log(`[browser-fetch] 成功通过状态提取同步到积分: ${stateTotal}`);
        return { ret: '0', total_credit: stateTotal };
      }

      throw new Error(`同步超时或被重定向。请检查截图: ${debugFile}`);
    } finally {
      if (info?.context) await info.context.close().catch(() => {});
    }
  }

  async fetch(sessionId, webId, userId, url, options = {}, siteType = 'jimeng') {
    // 显式确保 data, method 等关键参数能够抵达下层
    const fetchOptions = {
      ...options,
      siteType: options.siteType || siteType,
      webId: webId,
      data: options.data || null,
      method: options.method || 'GET'
    };
    return this.fetchWithBrowser(sessionId, url, fetchOptions);
  }

  async probeFastVideoNeedCredits(sessionId, options = {}) {
    const {
      webId = 7352342534578964000,
      siteType = 'dreamina',
      waitMs = 5000,
    } = options;

    const domainUrl =
      siteType === 'dreamina'
        ? 'https://dreamina.capcut.com/ai-tool/home?type=video&workspace=0'
        : 'https://jimeng.jianying.com/ai-tool/home?type=video&workspace=0';

    let info = null;
    try {
      info = await this.createContext(sessionId, webId, 0, siteType);
      const { page } = info;

      await page.goto(domainUrl, { waitUntil: 'networkidle', timeout: 90000 });
      await page.waitForTimeout(waitMs);

      const result = await page.evaluate(async () => {
        const entries = window.__debugger?._containerService?._services?._entries;
        const resolveSvc = (name) => {
          let found = null;
          entries?.forEach?.((value, key) => {
            if (!found && String(key) === name) found = value;
          });
          return found;
        };

        const commercialWrap = resolveSvc('dreamina-commercial-feature-container-service');
        const commercial =
          commercialWrap?._instance ||
          (typeof commercialWrap?._getModule === 'function' ? await commercialWrap._getModule() : null);

        if (!commercial) {
          throw new Error('页面商业化服务未就绪');
        }

        const buildSceneOptions = (modelReqKey) => ({
          type: 'video',
          scene: 'BasicVideoGenerateButton',
          resolution: '720p',
          modelReqKey,
          videoDuration: 5,
          reportParams: {
            enterSource: 'generate',
            vipSource: 'generate',
            extraVipFunctionKey: `${modelReqKey}-720p`,
            useVipFunctionDetailsReporterHoc: true,
          },
          materialTypes: [],
        });

        const fastModelReqKey =
          resolveVideoModelDefinition('seedance-2.0-fast')?.nativeModelId || 'dreamina_seedance_40';
        const proModelReqKey =
          resolveVideoModelDefinition('seedance-2.0')?.nativeModelId || 'dreamina_ic_generate_video_model_vgfm_3.5_pro';

        const fastSceneOptions = buildSceneOptions(fastModelReqKey);
        const proSceneOptions = buildSceneOptions(proModelReqKey);

        return {
          fastNeedCredits: commercial.getNeedCredits?.(fastSceneOptions) || null,
          fastTrialInfo: commercial.getTrialInfo?.(fastSceneOptions) || null,
          fastCanUse: commercial.getCommerceRightCanUse?.(fastSceneOptions) ?? null,
          proNeedCredits: commercial.getNeedCredits?.(proSceneOptions) || null,
        };
      });

      const fastCredits = Number(result?.fastNeedCredits?.credits);
      const normalizedFastCredits = Number.isFinite(fastCredits) ? fastCredits : null;
      const status =
        normalizedFastCredits === 0
          ? 'free'
          : normalizedFastCredits && normalizedFastCredits > 0
            ? 'paid'
            : 'unknown';

      return {
        ok: true,
        status,
        checkedAt: new Date().toISOString(),
        fastCredits: normalizedFastCredits,
        fastNeedCredits: result?.fastNeedCredits || null,
        fastTrialInfo: result?.fastTrialInfo || null,
        fastCanUse: result?.fastCanUse ?? null,
        proNeedCredits: result?.proNeedCredits || null,
        reason:
          status === 'free'
            ? '网页端 Fast 显示 0积分'
            : status === 'paid'
              ? `网页端 Fast 显示 ${normalizedFastCredits}积分`
              : '网页端 Fast 积分显示未知',
      };
    } catch (error) {
      return {
        ok: false,
        status: 'error',
        checkedAt: new Date().toISOString(),
        fastCredits: null,
        reason: error?.message || '网页端 Fast 积分探测失败',
      };
    } finally {
      if (info?.context) await info.context.close().catch(() => {});
    }
  }

  async probeRecentZeroCreditVideoUsage(sessionId, options = {}) {
    const {
      webId = 7352342534578964000,
      siteType = 'dreamina',
      waitMs = 12000,
    } = options;

    const domainUrl =
      siteType === 'dreamina'
        ? 'https://dreamina.capcut.com/ai-tool/home'
        : 'https://jimeng.jianying.com/ai-tool/home';

    let info = null;
    const detectedAssets = [];

    try {
      info = await this.createContext(sessionId, webId, 0, siteType);
      const { page } = info;

      page.on('response', async (response) => {
        if (!response.url().includes('/mweb/v1/get_asset_list')) {
          return;
        }

        try {
          const payload = await response.json();
          const assets = payload?.data?.asset_list || payload?.asset_list || payload?.data?.item_list || [];
          for (const asset of assets) {
            detectedAssets.push(asset);
          }
        } catch (error) {
          console.warn(`[browser-fetch] 读取资产历史响应失败: ${error.message}`);
        }
      });

      await page.goto(domainUrl, { waitUntil: 'networkidle', timeout: 90000 });
      await page.waitForTimeout(3000);
      const assetsTab = page.getByText('Assets', { exact: true }).first();
      await assetsTab.waitFor({ state: 'visible', timeout: 10000 });
      await assetsTab.click();
      await page.waitForTimeout(waitMs);

      const usage = detectedAssets
        .map((asset) => extractZeroCreditUsageFromAssetPayload(asset))
        .filter(Boolean)
        .sort((a, b) => Number(b.finishTime || 0) - Number(a.finishTime || 0))[0] || null;

      return {
        ok: Boolean(usage),
        checkedAt: new Date().toISOString(),
        usage,
      };
    } catch (error) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        usage: null,
        reason: error?.message || '网页端作品历史探测失败',
      };
    } finally {
      if (info?.context) await info.context.close().catch(() => {});
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

export default new BrowserService();
