import { getDatabase } from '../database/index.js';
import registrationService from './registration-service.js';
import settingsService, { analyzeJimengCreditHistory } from './settingsService.js';
import browserService from '../browser-service.js';
import { buildRegionalSessionId, normalizeSessionIdInput, parseRegionalSessionInput } from './sessionIdUtils.js';
import crypto from 'crypto';

/**
 * 账号池管理服务
 */
class AccountService {
  constructor() {
    this.syncJobs = new Map();
    this.refreshJobs = new Map();
  }

  isFastZeroCreditProbeStatusFresh(account, maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
    const checkedAt = account?.fast_zero_credit_probe_checked_at || null;
    if (!checkedAt) return false;

    const timestamp = new Date(checkedAt).getTime();
    return Number.isFinite(timestamp) && timestamp > 0 && (Date.now() - timestamp) <= maxAgeMs;
  }

  isFastZeroCreditUiStatusFresh(account, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    const checkedAt = account?.fast_zero_credit_ui_checked_at || null;
    if (!checkedAt) return false;

    const timestamp = new Date(checkedAt).getTime();
    return Number.isFinite(timestamp) && timestamp > 0 && (Date.now() - timestamp) <= maxAgeMs;
  }

  isTimestampWithinWindow(value, maxAgeMs) {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && timestamp > 0 && (Date.now() - timestamp) <= maxAgeMs;
  }

  shouldResetFastZeroCreditProbe(account, nextSessionId = '') {
    const current = normalizeSessionIdInput(account?.session_id || '');
    const next = normalizeSessionIdInput(nextSessionId || '');
    return Boolean(next && current && current !== next);
  }

  isFastZeroCreditProbeBaseAccount(account, modelId = 'seedance-2.0-fast') {
    if (String(modelId || '') !== 'seedance-2.0-fast') {
      return false;
    }

    const credits = Number(account?.credits || 0);
    const status = String(account?.status || '');
    const region = parseRegionalSessionInput(account?.session_id || '').region;

    if (region !== 'hk') return false;
    if (!(status === 'active' || status === 'out_of_credits')) return false;
    if (credits > 0) return false;

    return true;
  }

  isFastZeroCreditProbeCandidate(account, modelId = 'seedance-2.0-fast') {
    if (!this.isFastZeroCreditProbeBaseAccount(account, modelId)) {
      return false;
    }

    // Fast 首免一旦探测成功，说明该账号的 0 积分首免资格已经被实际消耗，
    // 后续不应再作为“首免候选”优先复用。
    return false;
  }

  shouldRecheckFastZeroCreditProbeCandidate(account, modelId = 'seedance-2.0-fast') {
    if (!this.isFastZeroCreditProbeBaseAccount(account, modelId)) {
      return false;
    }

    const status = String(account?.status || '');
    const usageStatus = String(account?.usage_status || '');
    const uiStatus = String(account?.fast_zero_credit_ui_status || 'unknown');
    const probeStatus = String(account?.fast_zero_credit_probe_status || 'unknown');
    const syncError = String(account?.sync_error || '');

    if (status !== 'active') return false;
    if (usageStatus === 'invalid') return false;
    if (probeStatus === 'success') return false;
    if (probeStatus === 'failed' && this.isFastZeroCreditProbeStatusFresh(account)) return false;
    if (this.isSessionAuthError(syncError)) return false;
    if (!this.isFastZeroCreditUiStatusFresh(account)) return false;

    return uiStatus === 'free';
  }

  shouldRetryFastZeroCreditUiPaidCandidate(account, modelId = 'seedance-2.0-fast') {
    if (!this.isFastZeroCreditProbeBaseAccount(account, modelId)) {
      return false;
    }

    const status = String(account?.status || '');
    const usageStatus = String(account?.usage_status || '');
    const uiStatus = String(account?.fast_zero_credit_ui_status || 'unknown');
    const probeStatus = String(account?.fast_zero_credit_probe_status || 'unknown');
    const syncError = String(account?.sync_error || '');

    if (status !== 'active') return false;
    if (usageStatus === 'invalid') return false;
    if (uiStatus !== 'paid') return false;
    if (probeStatus === 'success') return false;
    if (probeStatus === 'failed' && this.isFastZeroCreditProbeStatusFresh(account)) return false;
    if (this.isSessionAuthError(syncError)) return false;
    if (account?.last_used_at) return false;

    const isRecentlyCreated = this.isTimestampWithinWindow(account?.created_at, 24 * 60 * 60 * 1000);
    const wasUiCheckedLongEnoughAgo =
      !account?.fast_zero_credit_ui_checked_at ||
      !this.isFastZeroCreditUiStatusFresh(account, 10 * 60 * 1000);

    return isRecentlyCreated && wasUiCheckedLongEnoughAgo;
  }

  markFastZeroCreditProbeResult(accountId, result = {}) {
    if (!accountId) return null;

    const db = getDatabase();
    const current = this.getAccountById(accountId);
    if (!current) return null;

    const status = String(result.status || 'unknown');
    const modelId = String(result.modelId || 'seedance-2.0-fast');
    const reason = String(result.reason || '').slice(0, 500);
    const checkedAt = result.checkedAt || new Date().toISOString();

    db.prepare(`
      UPDATE accounts
      SET fast_zero_credit_probe_status = ?,
          fast_zero_credit_probe_model = ?,
          fast_zero_credit_probe_reason = ?,
          fast_zero_credit_probe_checked_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, modelId, reason, checkedAt, accountId);

    return this.getAccountById(accountId);
  }

  markFastZeroCreditUiProbeResult(accountId, result = {}) {
    if (!accountId) return null;

    const db = getDatabase();
    const status = String(result.status || 'unknown');
    const credits = Number.isFinite(Number(result.fastCredits)) ? Number(result.fastCredits) : null;
    const reason = String(result.reason || '').slice(0, 500);
    const checkedAt = result.checkedAt || new Date().toISOString();

    db.prepare(`
      UPDATE accounts
      SET fast_zero_credit_ui_status = ?,
          fast_zero_credit_ui_credits = ?,
          fast_zero_credit_ui_reason = ?,
          fast_zero_credit_ui_checked_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, credits, reason, checkedAt, accountId);

    return this.getAccountById(accountId);
  }

  isCreditSyncFresh(account, maxAgeMs = 6 * 60 * 60 * 1000) {
    const syncedAt = account?.credit_synced_at || account?.updated_at || null;
    if (!syncedAt) return false;

    const timestamp = new Date(syncedAt).getTime();
    return Number.isFinite(timestamp) && timestamp > 0 && (Date.now() - timestamp) <= maxAgeMs;
  }

  isClearlyUnavailableByCache(account, minCredits = 1) {
    const credits = Number(account?.credits || 0);
    const usageStatus = String(account?.usage_status || '');
    const status = String(account?.status || '');

    if (credits >= minCredits) {
      return false;
    }

    if (status === 'inactive' || usageStatus === 'invalid') {
      return true;
    }

    if (credits <= 0 && ['no_benefit', 'zero_credits'].includes(usageStatus)) {
      return true;
    }

    return false;
  }

  getAccountById(accountId) {
    const db = getDatabase();
    return db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(accountId);
  }

  findAccountBySessionId(sessionId, options = {}) {
    const { requirePassword = false } = options;
    const normalizedSessionId = normalizeSessionIdInput(sessionId);
    if (!normalizedSessionId) {
      return null;
    }

    const targetRegion = parseRegionalSessionInput(normalizedSessionId).region || 'us';
    const targetPureSessionId = parseRegionalSessionInput(normalizedSessionId).pureSessionId || '';
    if (!targetPureSessionId) {
      return null;
    }

    const db = getDatabase();
    const rows = db.prepare(`
      SELECT *
      FROM accounts
      WHERE session_id IS NOT NULL
        AND TRIM(session_id) != ''
    `).all();

    const candidates = rows
      .filter((row) => {
        if (requirePassword && !String(row?.password || '').trim()) {
          return false;
        }
        const parsed = parseRegionalSessionInput(row.session_id || '');
        return parsed.pureSessionId && parsed.pureSessionId === targetPureSessionId;
      })
      .sort((a, b) => {
        const parsedA = parseRegionalSessionInput(a.session_id || '');
        const parsedB = parseRegionalSessionInput(b.session_id || '');

        const score = (row, parsed) => {
          let value = 0;
          if (normalizeSessionIdInput(row.session_id || '') === normalizedSessionId) value += 100;
          if ((parsed.region || 'us') === targetRegion) value += 10;
          if (String(row.status || '') === 'active') value += 3;
          if (String(row.usage_status || '') === 'active') value += 2;
          if (String(row.usage_status || '') === 'zero_credits') value += 1;
          return value;
        };

        return score(b, parsedB) - score(a, parsedA);
      });

    return candidates[0] || null;
  }

  isSessionAuthError(message = '') {
    return /1002|1015|34010105|expired|invalid|unauthorized|login error|鉴权失败|会话已失效|缺少 SessionID/i.test(
      String(message || '')
    );
  }

  updateAccountSession(accountId, { sessionId, webId = null, status = 'active', syncError = null } = {}) {
    const db = getDatabase();
    const current = this.getAccountById(accountId);
    const shouldResetProbe = this.shouldResetFastZeroCreditProbe(current, sessionId);
    db.prepare(`
      UPDATE accounts
      SET session_id = ?,
          web_id = COALESCE(?, web_id),
          status = ?,
          sync_error = ?,
          fast_zero_credit_probe_status = CASE WHEN ? THEN 'unknown' ELSE COALESCE(fast_zero_credit_probe_status, 'unknown') END,
          fast_zero_credit_probe_model = CASE WHEN ? THEN NULL ELSE fast_zero_credit_probe_model END,
          fast_zero_credit_probe_reason = CASE WHEN ? THEN NULL ELSE fast_zero_credit_probe_reason END,
          fast_zero_credit_probe_checked_at = CASE WHEN ? THEN NULL ELSE fast_zero_credit_probe_checked_at END,
          fast_zero_credit_ui_status = CASE WHEN ? THEN 'unknown' ELSE COALESCE(fast_zero_credit_ui_status, 'unknown') END,
          fast_zero_credit_ui_credits = CASE WHEN ? THEN NULL ELSE fast_zero_credit_ui_credits END,
          fast_zero_credit_ui_reason = CASE WHEN ? THEN NULL ELSE fast_zero_credit_ui_reason END,
          fast_zero_credit_ui_checked_at = CASE WHEN ? THEN NULL ELSE fast_zero_credit_ui_checked_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      sessionId || '',
      webId || null,
      status,
      syncError,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      accountId
    );

    return this.getAccountById(accountId);
  }

  getAccountSummary() {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(COALESCE(credits, 0)), 0) AS all_credits,
        COALESCE(SUM(CASE WHEN status = 'active' AND usage_status = 'active' THEN COALESCE(credits, 0) ELSE 0 END), 0) AS total_credits,
        COALESCE(SUM(CASE WHEN benefit_eligibility = 'eligible' THEN 1 ELSE 0 END), 0) AS eligible_count,
        COALESCE(SUM(CASE WHEN usage_status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
        COALESCE(SUM(CASE WHEN usage_status = 'zero_credits' THEN 1 ELSE 0 END), 0) AS zero_credits_count,
        COALESCE(SUM(CASE WHEN status = 'active' AND COALESCE(credits, 0) = 0 AND usage_status IN ('zero_credits', 'no_benefit') THEN 1 ELSE 0 END), 0) AS zero_balance_count,
        COALESCE(SUM(CASE WHEN usage_status = 'no_benefit' THEN 1 ELSE 0 END), 0) AS no_benefit_count,
        COALESCE(SUM(CASE WHEN usage_status = 'invalid' THEN 1 ELSE 0 END), 0) AS invalid_count,
        COALESCE(SUM(CASE WHEN usage_status = 'unknown' OR usage_status IS NULL THEN 1 ELSE 0 END), 0) AS unknown_count,
        COALESCE(SUM(CASE WHEN credit_source = 'error' THEN 1 ELSE 0 END), 0) AS error_count,
        MAX(COALESCE(credit_synced_at, updated_at, created_at)) AS last_synced_at
      FROM accounts
    `).get();

    return {
      total: Number(row?.total || 0),
      totalCredits: Number(row?.total_credits || 0),
      allCredits: Number(row?.all_credits || 0),
      eligibleCount: Number(row?.eligible_count || 0),
      activeCount: Number(row?.active_count || 0),
      zeroCreditsCount: Number(row?.zero_credits_count || 0),
      zeroBalanceCount: Number(row?.zero_balance_count || 0),
      noBenefitCount: Number(row?.no_benefit_count || 0),
      invalidCount: Number(row?.invalid_count || 0),
      unknownCount: Number(row?.unknown_count || 0),
      errorCount: Number(row?.error_count || 0),
      lastSyncedAt: row?.last_synced_at || null,
    };
  }

  buildUsageStatus(account, benefitEligibility = 'unknown', syncOk = true) {
    const credits = Number(account?.credits || 0);
    const rawStatus = String(account?.status || 'active');

    if (!syncOk || rawStatus === 'inactive' || rawStatus === 'banned') {
      return { usageStatus: 'invalid', usageStatusLabel: '失效/鉴权失败' };
    }

    if (credits > 0) {
      return { usageStatus: 'active', usageStatusLabel: '可用' };
    }

    if (benefitEligibility === 'eligible') {
      return { usageStatus: 'zero_credits', usageStatusLabel: '有资格但当前 0 分' };
    }

    if (benefitEligibility === 'ineligible') {
      return { usageStatus: 'no_benefit', usageStatusLabel: '未发放权益' };
    }

    return { usageStatus: 'unknown', usageStatusLabel: '待确认' };
  }

  buildFailureState({ message, normalizedSessionId, attemptedHkFallback = false, hkFallbackError = null }) {
    const text = String(message || '同步失败');
    const hkText = hkFallbackError ? String(hkFallbackError) : '';
    const combined = hkText ? `${text} | hkFallback=${hkText}` : text;

    const isRegionalLoginError = text.includes('34010105') || /login error/i.test(text);
    const isAuthFailure = /1002|1015|34010105|expired|invalid|unauthorized|login error|鉴权失败/i.test(combined);

    if (attemptedHkFallback) {
      return {
        status: isAuthFailure ? 'inactive' : 'active',
        benefitLabel: '区域/鉴权失败',
        benefitReason: hkText
          ? '原始 Session 检测失败，且自动补 hk- 前缀后二次检测仍失败'
          : '原始 Session 检测失败，已触发 hk- 前缀重试',
        syncError: `direct=${text}${hkText ? ` | hk=${hkText}` : ''}`,
      };
    }

    if (isRegionalLoginError && parseRegionalSessionInput(normalizedSessionId).region === 'us') {
      return {
        status: 'inactive',
        benefitLabel: '区域待修复',
        benefitReason: '服务端返回 login error，疑似缺少港区/区域前缀',
        syncError: text,
      };
    }

    if (isAuthFailure) {
      return {
        status: 'inactive',
        benefitLabel: '鉴权失败',
        benefitReason: '会话已失效、被风控或当前 Session 已无法通过服务端校验',
        syncError: text,
      };
    }

    return {
      status: 'active',
      benefitLabel: '检测失败',
      benefitReason: '本次同步未拿到服务端账本',
      syncError: text,
    };
  }

  decorateAccount(account, extras = {}) {
    const normalized = {
      ...account,
      session_id: normalizeSessionIdInput(account?.session_id || ''),
      credits: Number(account?.credits || 0),
    };
    
    // 优先使用传入的 extras (当前同步结果)，否则使用数据库中的持久化字段，最后使用默认值
    const benefitEligibility = extras.benefitEligibility || account.benefit_eligibility || 'unknown';
    
    // 核心逻辑修正：如果数据库中已经存了 usage_status 且没有实时 extras，则说明上一次同步失败了
    // 只有当 extras.syncOk 明确为 true 或者（没有 extras 且数据库里没有失效记录）时，才认为 syncOk
    const isActuallyInvalid = account.usage_status === 'invalid' || account.status === 'inactive';
    const syncOk = extras.syncOk !== undefined ? extras.syncOk : !isActuallyInvalid;

    const usage = this.buildUsageStatus(
      normalized,
      benefitEligibility,
      syncOk
    );

    return {
      ...normalized,
      creditSource: extras.creditSource || account.credit_source || 'cached',
      creditSyncedAt: extras.creditSyncedAt || account.credit_synced_at || normalized.updated_at || null,
      benefitEligibility,
      benefitLabel: extras.benefitLabel || account.benefit_label || '待检测',
      benefitReason: extras.benefitReason || account.benefit_reason || '尚未同步服务端账本',
      benefitEvidence: extras.benefitEvidence || account.benefit_evidence || '',
      benefitTradeSource: extras.benefitTradeSource || '', // 不持久化这个，通常是临时的
      hasBenefitGrant: Boolean(extras.hasBenefitGrant),
      syncError: extras.syncError || account.sync_error || '',
      fastZeroCreditProbeStatus: extras.fastZeroCreditProbeStatus || account.fast_zero_credit_probe_status || 'unknown',
      fastZeroCreditProbeModel: extras.fastZeroCreditProbeModel || account.fast_zero_credit_probe_model || null,
      fastZeroCreditProbeReason: extras.fastZeroCreditProbeReason || account.fast_zero_credit_probe_reason || '',
      fastZeroCreditProbeCheckedAt:
        extras.fastZeroCreditProbeCheckedAt || account.fast_zero_credit_probe_checked_at || null,
      fastZeroCreditUiStatus: extras.fastZeroCreditUiStatus || account.fast_zero_credit_ui_status || 'unknown',
      fastZeroCreditUiCredits:
        extras.fastZeroCreditUiCredits !== undefined
          ? extras.fastZeroCreditUiCredits
          : (account.fast_zero_credit_ui_credits ?? null),
      fastZeroCreditUiReason: extras.fastZeroCreditUiReason || account.fast_zero_credit_ui_reason || '',
      fastZeroCreditUiCheckedAt:
        extras.fastZeroCreditUiCheckedAt || account.fast_zero_credit_ui_checked_at || null,
      // 如果数据库里已经存了标签，且当前没有新的同步结果，则信任数据库里的标签
      usageStatus: usage.usageStatus,
      usageStatusLabel: account.usage_status_label || usage.usageStatusLabel, 
      ...usage,
    };
  }

  async inspectAccount(account, options = {}) {
    const { persist = true } = options;
    if (!account) return null;

    const normalizedSessionId = normalizeSessionIdInput(account.session_id);
    if (!normalizedSessionId) {
      return this.decorateAccount(
        { ...account, session_id: '' },
        {
          creditSource: 'error',
          benefitEligibility: 'unknown',
          benefitLabel: '缺少 SessionID',
          benefitReason: '该账号没有可用的 sessionid_ss',
          syncError: '缺少 SessionID',
          syncOk: false,
        }
      );
    }

    try {
      // 1. 第一阶段：标准重试 (使用 settingsService)
      let info;
      let finalSessionId = normalizedSessionId;
      
      try {
        info = await settingsService.getJimengSessionInfo(normalizedSessionId);
      } catch (e) {
        const msg = String(e?.message || '');
        // 如果是 34010105 或者是明显的区域/登录错误，且没有 hk- 前缀，则尝试追加前缀
        if ((msg.includes('34010105') || /login error/i.test(msg)) && parseRegionalSessionInput(normalizedSessionId).region === 'us') {
          console.log(`[account] 账号 ${account.email} 遭遇区域错误，尝试追加 hk- 前缀重试...`);
          finalSessionId = `hk-${normalizedSessionId}`;
          info = await settingsService.getJimengSessionInfo(finalSessionId);
        } else {
          throw e; // 抛出给外层，进入浏览器兜底阶段
        }
      }

      const synced = await this.applySyncResult(account, info, finalSessionId, { persist });
      return await this.syncFastZeroCreditUiProbe(synced, { persist });
    } catch (error) {
      const message = String(error?.message || '同步失败');
      console.warn(`[account] 账号 ${account.email} API 同步失败: ${message}`);

      // 2. 第二阶段：浏览器兜底 (绕过 WAF/签名校验 或 解决 DNS/SSL 域名解析问题)
      const isRetryableFailure = /1002|1015|34010105|expired|invalid|unauthorized|login error|鉴权失败|fetch|SSL|MISMATCH|timeout|network|ENOTFOUND/i.test(message);
      
      if (isRetryableFailure) {
        console.log(`[account] 账号 ${account.email} 触发浏览器兜底同步...`);
        try {
          // 彻底尊重原始 ID 属性，不再盲目追加 hk-
          let sessionIdToTry = account.session_id || normalizedSessionId;
          
          // 备选域名列表：严格根据前缀路由
          const candidateBaseUrls = parseRegionalSessionInput(sessionIdToTry).region === 'us'
            ? ['https://commerce.us.capcut.com', 'https://commerce-api.capcut.com']
            : ['https://commerce-api.capcut.com', 'https://commerce.capcut.com'];

          let browserResult = null;
          let browserErrorMessage = null;
          let successfulAttemptSid = sessionIdToTry;

          // 核心方案：如果在非港区环境下失败，自动构造一个“港区重试路径”
          const attempts = [
            { sid: sessionIdToTry, desc: parseRegionalSessionInput(sessionIdToTry).region === 'us' ? '默认美区节点' : '港区专用节点' }
          ];
          
          // 如果原始 ID 不是港区，为了防止它是“没标港区的港区号”，我们增加一个香港重试项
          if (parseRegionalSessionInput(sessionIdToTry).region === 'us') {
            attempts.push({ sid: `hk-${sessionIdToTry}`, desc: '自动补全港区节点(救回失败账号)' });
          }

          for (const attempt of attempts) {
            if (browserResult) break;
            
            // 针对当前尝试的 ID 选择最匹配的域名
            const currentCandidateUrls = parseRegionalSessionInput(attempt.sid).region === 'us'
              ? ['https://commerce.us.capcut.com']
              : ['https://commerce-api.capcut.com'];

            for (const baseUrl of currentCandidateUrls) {
              try {
                const creditUrl = `${baseUrl}/commerce/v1/benefits/user_credit_history`;
                console.log(`[account] 正在尝试 (${attempt.desc}) -> ${baseUrl}...`);
                
                const result = await browserService.fetchWithBrowser(attempt.sid, creditUrl, {
                  method: 'POST',
                  data: { count: 100, cursor: "0" },
                  siteType: 'dreamina'
                });

                if (result && (result.ret === '0' || result.total_credit !== undefined)) {
                  browserResult = result;
                  successfulAttemptSid = attempt.sid;
                  console.log(`[account] 同步成功! 关键识别: ${attempt.desc}`);
                  break;
                }
              } catch (e) {
                browserErrorMessage = e.message;
                console.warn(`[account] ${attempt.desc} 尝试失败: ${e.message}`);
              }
            }
          }

          if (browserResult) {
            const benefitAnalysis = analyzeJimengCreditHistory(browserResult);
            const info = {
              normalizedSessionId: normalizedSessionId, // 保持数据库存 Token
              points: browserResult.total_credit !== undefined ? browserResult.total_credit : 0,
              raw: browserResult,
              ...benefitAnalysis
            };

            console.log(`[account] 账号 ${account.email} 浏览器同步成功！积分: ${info.points}`);
            const synced = await this.applySyncResult(account, info, successfulAttemptSid || normalizedSessionId, {
              persist,
              source: 'browser',
            });
            return await this.syncFastZeroCreditUiProbe(synced, { persist });
          }
          
          if (browserErrorMessage) {
             throw new Error(browserErrorMessage);
          }
          throw new Error('浏览器同步未返回有效数据');
        } catch (browserError) {
          const finalErrorMessage = browserError.message;
          console.error(`[account] 账号 ${account.email} 浏览器兜底最终失败: ${finalErrorMessage}`);

          const fallbackAccount = this.decorateAccount(
            { ...account, session_id: normalizedSessionId },
            {
              creditSource: 'error',
              creditSyncedAt: new Date().toISOString(),
              benefitEligibility: 'unknown',
              benefitLabel: (finalErrorMessage.includes('1015') || finalErrorMessage.includes('34010105')) ? '区域待修复' : '同步失败',
              benefitReason: finalErrorMessage,
              syncError: `[browser] ${finalErrorMessage}`,
              syncOk: false,
            }
          );
          return await this.syncFastZeroCreditUiProbe(fallbackAccount, { persist });
        }
      }

      // 3. 最终失败处理
      const syncedAt = new Date().toISOString();
      const failureState = this.buildFailureState({
        message,
        normalizedSessionId,
      });

      if (persist) {
        const db = getDatabase();
        db.prepare(`
          UPDATE accounts
          SET session_id = ?,
              status = ?,
              benefit_eligibility = 'unknown',
              benefit_label = ?,
              benefit_reason = ?,
              usage_status = 'invalid',
              usage_status_label = '失效/鉴权失败',
              credit_synced_at = ?,
              credit_source = 'error',
              sync_error = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          normalizedSessionId,
          failureState.status,
          failureState.benefitLabel,
          failureState.benefitReason,
          syncedAt,
          failureState.syncError,
          account.id
        );
      }

      const latest = persist ? (this.getAccountById(account.id) || account) : account;
      const fallbackAccount = this.decorateAccount(
        { ...latest, session_id: normalizedSessionId },
        {
          creditSource: 'error',
          creditSyncedAt: syncedAt,
          benefitEligibility: 'unknown',
          benefitLabel: failureState.benefitLabel,
          benefitReason: failureState.benefitReason,
          syncError: failureState.syncError,
          syncOk: false,
        }
      );
      return await this.syncFastZeroCreditUiProbe(fallbackAccount, { persist });
    }
  }

  /**
   * 提炼出的通用同步结果应用逻辑
   */
  async applySyncResult(account, info, sessionId, options = {}) {
    const { persist = true, source = 'live' } = options;
    const credits = Number(info.points || 0);
    const syncedAt = new Date().toISOString();
    const shouldResetProbe = this.shouldResetFastZeroCreditProbe(account, sessionId);
    const historyUsage = info?.recentZeroCreditUsage || null;
    const hasHistoryZeroCreditUsage = Boolean(historyUsage?.historyRecordId);
    const historyProbeReason = hasHistoryZeroCreditUsage
      ? `历史记录已检测到 0金额视频生成（historyId=${historyUsage.historyRecordId}${historyUsage.modelReqKey ? `, model=${historyUsage.modelReqKey}` : ''}）`
      : '';
    const usage = this.buildUsageStatus(
      { ...account, session_id: sessionId, credits, status: 'active' },
      info.benefitEligibility,
      true
    );

    if (persist) {
      const db = getDatabase();
      db.prepare(`
        UPDATE accounts
        SET session_id = ?,
            status = 'active',
            credits = ?,
            benefit_eligibility = ?,
            benefit_label = ?,
            benefit_reason = ?,
            benefit_evidence = ?,
            usage_status = ?,
            usage_status_label = ?,
            credit_synced_at = ?,
            credit_source = ?,
            fast_zero_credit_probe_status = CASE
              WHEN ? THEN 'success'
              WHEN ? THEN 'unknown'
              ELSE COALESCE(fast_zero_credit_probe_status, 'unknown')
            END,
            fast_zero_credit_probe_model = CASE
              WHEN ? THEN ?
              WHEN ? THEN NULL
              ELSE fast_zero_credit_probe_model
            END,
            fast_zero_credit_probe_reason = CASE
              WHEN ? THEN ?
              WHEN ? THEN NULL
              ELSE fast_zero_credit_probe_reason
            END,
            fast_zero_credit_probe_checked_at = CASE
              WHEN ? THEN ?
              WHEN ? THEN NULL
              ELSE fast_zero_credit_probe_checked_at
            END,
            fast_zero_credit_ui_status = CASE WHEN ? THEN 'unknown' ELSE COALESCE(fast_zero_credit_ui_status, 'unknown') END,
            fast_zero_credit_ui_credits = CASE WHEN ? THEN NULL ELSE fast_zero_credit_ui_credits END,
            fast_zero_credit_ui_reason = CASE WHEN ? THEN NULL ELSE fast_zero_credit_ui_reason END,
            fast_zero_credit_ui_checked_at = CASE WHEN ? THEN NULL ELSE fast_zero_credit_ui_checked_at END,
            sync_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        sessionId,
        credits,
        info.benefitEligibility,
        info.benefitLabel,
        info.benefitReason,
        info.benefitEvidence,
        usage.usageStatus,
        usage.usageStatusLabel,
        syncedAt,
        source,
        hasHistoryZeroCreditUsage ? 1 : 0,
        shouldResetProbe ? 1 : 0,
        hasHistoryZeroCreditUsage ? 1 : 0,
        historyUsage?.modelReqKey || null,
        shouldResetProbe ? 1 : 0,
        hasHistoryZeroCreditUsage ? 1 : 0,
        historyProbeReason,
        shouldResetProbe ? 1 : 0,
        hasHistoryZeroCreditUsage ? 1 : 0,
        syncedAt,
        shouldResetProbe ? 1 : 0,
        shouldResetProbe ? 1 : 0,
        shouldResetProbe ? 1 : 0,
        shouldResetProbe ? 1 : 0,
        shouldResetProbe ? 1 : 0,
        account.id
      );
    }

    const latest = persist
      ? this.getAccountById(account.id)
      : { ...account, status: 'active', session_id: sessionId, credits };
    
    return this.decorateAccount(latest, {
      creditSource: source,
      creditSyncedAt: syncedAt,
      benefitEligibility: info.benefitEligibility,
      benefitLabel: info.benefitLabel,
      benefitReason: info.benefitReason,
      benefitEvidence: info.benefitEvidence,
      benefitTradeSource: info.benefitTradeSource,
      hasBenefitGrant: info.hasBenefitGrant,
      fastZeroCreditProbeStatus: hasHistoryZeroCreditUsage ? 'success' : undefined,
      fastZeroCreditProbeModel: hasHistoryZeroCreditUsage ? (historyUsage?.modelReqKey || null) : undefined,
      fastZeroCreditProbeReason: hasHistoryZeroCreditUsage ? historyProbeReason : undefined,
      fastZeroCreditProbeCheckedAt: hasHistoryZeroCreditUsage ? syncedAt : undefined,
      ...usage,
      syncOk: true,
    });
  }

  async syncFastZeroCreditUiProbe(accountInput, options = {}) {
    const { persist = true } = options;
    const account = typeof accountInput === 'number' ? this.getAccountById(accountInput) : accountInput;
    if (!account?.id || !account?.session_id) {
      return account ? this.decorateAccount(account) : null;
    }

    const normalizedSessionId = normalizeSessionIdInput(account.session_id);
    const region = parseRegionalSessionInput(normalizedSessionId).region;
    if (!normalizedSessionId || region === 'cn' || String(account.provider || 'dreamina') === 'legacy-jimeng') {
      return this.decorateAccount(account);
    }

    try {
      const uiProbe = await browserService.probeFastVideoNeedCredits(normalizedSessionId, {
        webId: account.web_id || undefined,
        siteType: 'dreamina',
      });

      if (persist) {
        this.markFastZeroCreditUiProbeResult(account.id, uiProbe);
      }

      const latest = persist ? (this.getAccountById(account.id) || account) : account;
      return this.decorateAccount(latest, {
        fastZeroCreditUiStatus: uiProbe.status || 'unknown',
        fastZeroCreditUiCredits:
          Number.isFinite(Number(uiProbe.fastCredits)) ? Number(uiProbe.fastCredits) : null,
        fastZeroCreditUiReason: uiProbe.reason || '',
        fastZeroCreditUiCheckedAt: uiProbe.checkedAt || new Date().toISOString(),
      });
    } catch (error) {
      const checkedAt = new Date().toISOString();
      const reason = error?.message || '网页端 Fast 积分探测失败';
      if (persist) {
        this.markFastZeroCreditUiProbeResult(account.id, {
          status: 'error',
          fastCredits: null,
          checkedAt,
          reason,
        });
      }
      const latest = persist ? (this.getAccountById(account.id) || account) : account;
      return this.decorateAccount(latest, {
        fastZeroCreditUiStatus: 'error',
        fastZeroCreditUiCredits: null,
        fastZeroCreditUiReason: reason,
        fastZeroCreditUiCheckedAt: checkedAt,
      });
    }
  }

  async listAccounts(options = {}) {
    const db = getDatabase();
    const page = parseInt(options.page) || 1;
    const pageSize = parseInt(options.pageSize) || 20;
    const offset = (page - 1) * pageSize;

    const count = db.prepare('SELECT COUNT(*) as total FROM accounts').get().total;
    const accounts = db.prepare(`
      SELECT * FROM accounts
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(pageSize, offset);

    return {
      accounts: accounts.map((account) => this.decorateAccount(account)),
      summary: this.getAccountSummary(),
      pagination: {
        total: count,
        page,
        pageSize,
        totalPages: Math.ceil(count / pageSize)
      }
    };
  }

  async createManualAccount(payload = {}) {
    const db = getDatabase();
    const email = String(payload.email || '').trim().toLowerCase();
    const password = String(payload.password || '').trim();
    const sessionId = normalizeSessionIdInput(payload.sessionId || payload.session_id || '');
    const webId = String(payload.webId || payload.web_id || '').trim() || null;
    const provider = String(payload.provider || 'dreamina').trim() || 'dreamina';
    const inspectAfterCreate = payload.inspectAfterCreate !== false;

    if (!email) {
      throw new Error('邮箱不能为空');
    }

    if (!sessionId && !password) {
      throw new Error('SessionID 和密码至少填写一个');
    }

    const exists = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email);
    if (exists) {
      throw new Error('该邮箱已存在于账号池');
    }

    const insert = db.prepare(`
      INSERT INTO accounts (
        email, password, session_id, web_id, credits, status, provider,
        benefit_eligibility, benefit_label, usage_status, usage_status_label, credit_source, sync_error
      ) VALUES (?, ?, ?, ?, 0, 'active', ?, 'unknown', '待检测', 'unknown', '待确认', 'cached', NULL)
    `);
    const result = insert.run(email, password || null, sessionId || null, webId, provider);
    const createdId = result.lastInsertRowid;

    if (!inspectAfterCreate || !sessionId) {
      return this.decorateAccount(this.getAccountById(createdId));
    }

    return this.inspectAccountById(createdId, { persist: true });
  }

  async updateManualAccount(accountId, payload = {}) {
    const db = getDatabase();
    const current = this.getAccountById(accountId);
    if (!current) {
      throw new Error('账号不存在');
    }

    const email = String(payload.email ?? current.email ?? '').trim().toLowerCase();
    const passwordInput = payload.password;
    const password =
      passwordInput === undefined
        ? (current.password || '')
        : String(passwordInput || '').trim();
    const sessionRaw = payload.sessionId ?? payload.session_id ?? current.session_id ?? '';
    const sessionId = normalizeSessionIdInput(sessionRaw);
    const webIdInput = payload.webId ?? payload.web_id;
    const webId =
      webIdInput === undefined
        ? (current.web_id || null)
        : (String(webIdInput || '').trim() || null);
    const provider = String(payload.provider || current.provider || 'dreamina').trim() || 'dreamina';

    if (!email) {
      throw new Error('邮箱不能为空');
    }

    if (!sessionId && !password) {
      throw new Error('SessionID 和密码至少填写一个');
    }

    const duplicate = db.prepare('SELECT id FROM accounts WHERE email = ? AND id != ?').get(email, accountId);
    if (duplicate) {
      throw new Error('该邮箱已存在于账号池');
    }

    const shouldResetProbe = this.shouldResetFastZeroCreditProbe(current, sessionId);
    db.prepare(`
      UPDATE accounts
      SET email = ?,
          password = ?,
          session_id = ?,
          web_id = ?,
          provider = ?,
          fast_zero_credit_probe_status = CASE WHEN ? THEN 'unknown' ELSE COALESCE(fast_zero_credit_probe_status, 'unknown') END,
          fast_zero_credit_probe_model = CASE WHEN ? THEN NULL ELSE fast_zero_credit_probe_model END,
          fast_zero_credit_probe_reason = CASE WHEN ? THEN NULL ELSE fast_zero_credit_probe_reason END,
          fast_zero_credit_probe_checked_at = CASE WHEN ? THEN NULL ELSE fast_zero_credit_probe_checked_at END,
          fast_zero_credit_ui_status = CASE WHEN ? THEN 'unknown' ELSE COALESCE(fast_zero_credit_ui_status, 'unknown') END,
          fast_zero_credit_ui_credits = CASE WHEN ? THEN NULL ELSE fast_zero_credit_ui_credits END,
          fast_zero_credit_ui_reason = CASE WHEN ? THEN NULL ELSE fast_zero_credit_ui_reason END,
          fast_zero_credit_ui_checked_at = CASE WHEN ? THEN NULL ELSE fast_zero_credit_ui_checked_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      email,
      password || null,
      sessionId || null,
      webId,
      provider,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      shouldResetProbe ? 1 : 0,
      accountId
    );

    return this.decorateAccount(this.getAccountById(accountId));
  }

  async inspectAccountById(accountId, options = {}) {
    const account = this.getAccountById(accountId);
    if (!account) {
      throw new Error('账号不存在');
    }
    return this.inspectAccount(account, options);
  }

  async refreshAccountSession(accountInput, options = {}) {
    const {
      syncAfterRefresh = true,
      jobId = null,
      log = null,
      reason = '',
    } = options;

    const account = typeof accountInput === 'number' ? this.getAccountById(accountInput) : accountInput;
    if (!account) {
      throw new Error('账号不存在');
    }
    if (!account.password) {
      throw new Error('该账号未保存密码，无法自动刷新 SessionID');
    }

    const appendLog = typeof log === 'function' ? log : (message) => registrationService.log(jobId, message);
    if (reason) {
      appendLog(`准备刷新 ${account.email} 的 SessionID，原因：${reason}`);
    } else {
      appendLog(`准备刷新 ${account.email} 的 SessionID...`);
    }

    const refreshed = await registrationService.refreshExistingAccountSession(
      { email: account.email, password: account.password },
      jobId
    );

    this.updateAccountSession(account.id, {
      sessionId: buildRegionalSessionId(
        refreshed.sessionId,
        refreshed.region || parseRegionalSessionInput(account.session_id).region || 'us'
      ),
      webId: refreshed.webId || null,
      status: 'active',
      syncError: null,
    });

    appendLog(`已刷新 ${account.email} 的 SessionID，开始校验可用性...`);

    const latest = this.getAccountById(account.id) || account;
    if (!syncAfterRefresh) {
      return this.decorateAccount({
        ...latest,
        session_id: buildRegionalSessionId(
          refreshed.sessionId,
          refreshed.region || parseRegionalSessionInput(account.session_id).region || 'us'
        ),
        web_id: refreshed.webId || latest.web_id || null,
      });
    }

    return this.inspectAccount(latest, { persist: true });
  }

  async refreshAccountSessionById(accountId, options = {}) {
    const account = this.getAccountById(accountId);
    if (!account) {
      throw new Error('账号不存在');
    }

    return this.refreshAccountSession(account, options);
  }

  /**
   * 批量删除账号
   */
  deleteAccountsBatch(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const db = getDatabase();
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM accounts WHERE id IN (${placeholders})`).run(...ids);
  }

  /**
   * 启动指定账号的同步任务
   */
  startSyncBatch(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return null;
    const db = getDatabase();
    const placeholders = ids.map(() => '?').join(',');
    const accounts = db.prepare(`SELECT * FROM accounts WHERE id IN (${placeholders})`).all(...ids);
    
    if (accounts.length === 0) return null;
    
    return this.runSyncJob(accounts, `批量同步 ${accounts.length} 个账号`);
  }

  /**
   * 获取一个可用账号
   */
  async getAvailableAccount(minCredits = 10, options = {}) {
    const db = getDatabase();
    const {
      allowAutoRegister = true,
      registrationAttempt = 0,
      excludeAccountIds = [],
      excludeSessionIds = [],
      modelId = null,
      allowFastZeroCreditProbe = false,
      requireFastZeroCreditProbe = false,
    } = options;

    const whereClauses = [`(status IN ('active', 'out_of_credits') OR COALESCE(credits, 0) >= ?)`];
    const queryParams = [Number(minCredits) || 0];

    const normalizedExcludeAccountIds = Array.from(
      new Set(
        (Array.isArray(excludeAccountIds) ? excludeAccountIds : [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      )
    );

    const normalizedExcludeSessionIds = Array.from(
      new Set(
        (Array.isArray(excludeSessionIds) ? excludeSessionIds : [])
          .map((value) => normalizeSessionIdInput(value))
          .filter(Boolean)
      )
    );

    if (normalizedExcludeAccountIds.length > 0) {
      whereClauses.push(
        `id NOT IN (${normalizedExcludeAccountIds.map(() => '?').join(',')})`
      );
      queryParams.push(...normalizedExcludeAccountIds);
    }

    if (normalizedExcludeSessionIds.length > 0) {
      whereClauses.push(
        `COALESCE(session_id, '') NOT IN (${normalizedExcludeSessionIds.map(() => '?').join(',')})`
      );
      queryParams.push(...normalizedExcludeSessionIds);
    }

    const candidates = db.prepare(`
      SELECT * FROM accounts
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY last_used_at ASC NULLS FIRST, created_at ASC
    `).all(...queryParams);

    const prioritizedCandidates = [...candidates].sort((a, b) => {
      const rank = (account) => {
        if (allowFastZeroCreditProbe && this.isFastZeroCreditProbeCandidate(account, modelId)) {
          return 0;
        }
        if (allowFastZeroCreditProbe && this.shouldRecheckFastZeroCreditProbeCandidate(account, modelId)) {
          return 1;
        }
        if (account.status === 'active' && account.usage_status === 'active' && Number(account.credits || 0) >= minCredits) {
          return 2;
        }
        if (account.status === 'out_of_credits' && account.usage_status === 'active' && Number(account.credits || 0) >= minCredits) {
          return 3;
        }
        if (Number(account.credits || 0) >= minCredits) {
          return 4;
        }
        if (account.usage_status === 'unknown' || account.usage_status === 'invalid') {
          return 5;
        }
        return 99;
      };

      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) return rankDiff;

      const aIsFastVerified = allowFastZeroCreditProbe && this.isFastZeroCreditProbeCandidate(a, modelId);
      const bIsFastVerified = allowFastZeroCreditProbe && this.isFastZeroCreditProbeCandidate(b, modelId);
      const aNeedsFastRecheck = allowFastZeroCreditProbe && this.shouldRecheckFastZeroCreditProbeCandidate(a, modelId);
      const bNeedsFastRecheck = allowFastZeroCreditProbe && this.shouldRecheckFastZeroCreditProbeCandidate(b, modelId);

      if (aIsFastVerified || bIsFastVerified || aNeedsFastRecheck || bNeedsFastRecheck) {
        const statusScore = (account) => {
          let score = 0;
          if (String(account?.status || '') === 'active') score += 100;
          if (this.isCreditSyncFresh(account)) score += 30;
          if (this.isFastZeroCreditUiStatusFresh(account)) score += 20;

          const usageStatus = String(account?.usage_status || '');
          if (usageStatus === 'zero_credits') score += 12;
          else if (usageStatus === 'unknown') score += 8;
          else if (usageStatus === 'no_benefit') score += 6;
          else if (usageStatus === 'active') score += 4;

          const probeStatus = String(account?.fast_zero_credit_probe_status || 'unknown');
          if (probeStatus === 'success') score += 40;
          if (probeStatus === 'failed') score -= 200;

          return score;
        };

        const scoreDiff = statusScore(b) - statusScore(a);
        if (scoreDiff !== 0) return scoreDiff;

        const aLastUsedAt = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
        const bLastUsedAt = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
        if (aLastUsedAt !== bLastUsedAt) {
          if (!aLastUsedAt) return -1;
          if (!bLastUsedAt) return 1;
          return aLastUsedAt - bLastUsedAt;
        }

        const aUiCheckedAt = a.fast_zero_credit_ui_checked_at ? new Date(a.fast_zero_credit_ui_checked_at).getTime() : 0;
        const bUiCheckedAt = b.fast_zero_credit_ui_checked_at ? new Date(b.fast_zero_credit_ui_checked_at).getTime() : 0;
        if (aUiCheckedAt !== bUiCheckedAt) return bUiCheckedAt - aUiCheckedAt;

        const aCreatedAt = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bCreatedAt = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (aCreatedAt !== bCreatedAt) return bCreatedAt - aCreatedAt;
      }

      const aLastUsedAt = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
      const bLastUsedAt = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
      if (aLastUsedAt !== bLastUsedAt) return aLastUsedAt - bLastUsedAt;

      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    for (const candidate of prioritizedCandidates) {
      const isFastProbeCandidate = allowFastZeroCreditProbe && this.isFastZeroCreditProbeCandidate(candidate, modelId);
      const shouldRecheckFastProbeCandidate =
        allowFastZeroCreditProbe && this.shouldRecheckFastZeroCreditProbeCandidate(candidate, modelId);
      const shouldRetryFastUiPaidCandidate =
        allowFastZeroCreditProbe && this.shouldRetryFastZeroCreditUiPaidCandidate(candidate, modelId);

      if (
        !isFastProbeCandidate &&
        !shouldRecheckFastProbeCandidate &&
        !shouldRetryFastUiPaidCandidate &&
        this.isClearlyUnavailableByCache(candidate, minCredits) &&
        this.isCreditSyncFresh(candidate)
      ) {
        continue;
      }

      const syncResult = await this.syncAccountCredits(candidate);
      const refreshed = this.getAccountById(candidate.id);
      if (allowFastZeroCreditProbe && this.isFastZeroCreditProbeCandidate(refreshed, modelId)) {
        db.prepare('UPDATE accounts SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(refreshed.id);
        return refreshed;
      }
      if (allowFastZeroCreditProbe && this.shouldRecheckFastZeroCreditProbeCandidate(refreshed, modelId)) {
        console.log(
          `[account] 命中 Fast 首免待实测候选: ${refreshed.email} (ui=${refreshed.fast_zero_credit_ui_status}, usage=${refreshed.usage_status}, credits=${refreshed.credits})`
        );
        db.prepare('UPDATE accounts SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(refreshed.id);
        return refreshed;
      }
      if (allowFastZeroCreditProbe && shouldRetryFastUiPaidCandidate) {
        console.log(
          `[account] 已复查新号 Fast UI 标价: ${refreshed.email} (ui=${refreshed?.fast_zero_credit_ui_status}, usage=${refreshed?.usage_status}, credits=${refreshed?.credits})`
        );
      }

      if (requireFastZeroCreditProbe) {
        continue;
      }

      if (refreshed?.status === 'active' && Number(refreshed.credits || 0) >= minCredits) {
        db.prepare('UPDATE accounts SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(refreshed.id);
        return refreshed;
      }

      const syncErrorText =
        syncResult?.error ||
        refreshed?.sync_error ||
        '';
      const hasUsableCachedCredits = Number(candidate?.credits || 0) >= minCredits;
      const isAuthSyncFailure = this.isSessionAuthError(syncErrorText || refreshed?.benefit_reason || '');
      const likelyRecoverableCreditSyncFailure =
        hasUsableCachedCredits &&
        String(candidate?.benefit_eligibility || 'unknown') !== 'ineligible' &&
        !isAuthSyncFailure &&
        String(refreshed?.status || candidate?.status || '') !== 'inactive' &&
        (
          Boolean(syncErrorText) ||
          Boolean(syncResult?.error)
        );

      if (likelyRecoverableCreditSyncFailure) {
        const emergencyCandidate = {
          ...(refreshed || candidate),
          session_id: normalizeSessionIdInput(candidate.session_id || refreshed?.session_id || ''),
          credits: Math.max(
            Number(candidate?.credits || 0),
            Number(refreshed?.credits || 0)
          ),
          status: 'active',
          usage_status: refreshed?.usage_status || candidate?.usage_status || 'active',
          sync_error: syncErrorText,
        };
        console.warn(
          `[account] 账号 ${candidate.email} 账本同步失败，但本地缓存仍有 ${emergencyCandidate.credits} 积分；作为应急候选继续尝试实际生成`
        );
        db.prepare('UPDATE accounts SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(candidate.id);
        return emergencyCandidate;
      }
    }

    if (requireFastZeroCreditProbe) {
      throw new Error('没有可用账号（没有可用 0积分 Fast 首免账号）');
    }

    if (!allowAutoRegister || registrationAttempt >= 1) {
      throw new Error(minCredits <= 1 ? '没有可用账号（没有可用正积分账号）' : `没有可用账号（需要至少 ${minCredits} 积分）`);
    }

    console.log('[account] 没有可用账号，正在尝试自动注册...');
    try {
      const newAccount = await registrationService.registerNewAccount();
      const inserted = db.prepare(`
        SELECT * FROM accounts
        WHERE email = ?
        ORDER BY id DESC
        LIMIT 1
      `).get(newAccount.email);

      if (inserted) {
        await this.syncAccountCredits(inserted);
        const refreshed = this.getAccountById(inserted.id);
        if (refreshed?.status === 'active' && Number(refreshed.credits || 0) >= minCredits) {
          db.prepare('UPDATE accounts SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(refreshed.id);
          return refreshed;
        }
      }

      throw new Error('新注册账号未获得足够积分');
    } catch (error) {
      console.error(`[account] 自动注册失败: ${error.message}`);
      throw new Error(
        minCredits <= 1
          ? `没有可用账号（没有可用正积分账号）且自动注册失败: ${error.message}`
          : `没有可用账号（需要至少 ${minCredits} 积分）且自动注册失败: ${error.message}`
      );
    }
  }

  /**
   * 同步账号积分
   */
  async syncAccountCredits(account, options = {}) {
    const {
      allowSessionRefresh = true,
      jobId = null,
      log = null,
    } = options;

    if (!account?.session_id) {
      if (allowSessionRefresh && account?.password) {
        const appendLog = typeof log === 'function' ? log : (message) => registrationService.log(jobId, message);
        appendLog(`账号 ${account.email} 缺少 SessionID，尝试用账号密码重新登录补回...`);
        try {
          const recovered = await this.refreshAccountSession(account, {
            syncAfterRefresh: true,
            jobId,
            log: appendLog,
            reason: '缺少 SessionID',
          });
          return { success: true, account: recovered, refreshedSession: true };
        } catch (refreshError) {
          return { success: false, error: refreshError.message };
        }
      }
      return { success: false, error: '缺少 SessionID' };
    }
    
    try {
      const refreshed = await this.inspectAccount(account, { persist: true });
      const isSuccess = refreshed && refreshed.usageStatus !== 'invalid' && !refreshed.syncError;
      
      if (isSuccess) {
        console.log(
          `[account] 账号 ${account.email} 检测成功: 状态=${refreshed.usageStatusLabel}, 积分=${refreshed.credits}, 权益=${refreshed.benefitLabel}`
        );
        return { success: true, account: refreshed };
      } else {
        console.warn(
          `[account] 账号 ${account.email} 同步结果指示异常: ${refreshed.benefitLabel} | ${refreshed.syncError || refreshed.benefitReason || ''}`
        );
        const errorText = refreshed.syncError || refreshed.benefitReason || refreshed.benefitLabel || '状态异常';
        if (allowSessionRefresh && account.password && this.isSessionAuthError(errorText)) {
          const appendLog = typeof log === 'function' ? log : (message) => registrationService.log(jobId, message);
          appendLog(`账号 ${account.email} 检测到 Session 失效，尝试自动刷新...`);
          try {
            const recovered = await this.refreshAccountSession(account, {
              syncAfterRefresh: true,
              jobId,
              log: appendLog,
              reason: errorText,
            });
            return { success: true, account: recovered, refreshedSession: true };
          } catch (refreshError) {
            appendLog(`账号 ${account.email} 刷新 SessionID 失败: ${refreshError.message}`);
            return { success: false, error: refreshError.message, account: refreshed };
          }
        }
        return { success: false, error: errorText, account: refreshed };
      }
    } catch (error) {
       console.warn(`[account] 账号 ${account.email} 积分执行异常: ${error.message}`);
       if (allowSessionRefresh && account.password && this.isSessionAuthError(error.message)) {
         const appendLog = typeof log === 'function' ? log : (message) => registrationService.log(jobId, message);
         appendLog(`账号 ${account.email} 检测异常可恢复，尝试自动刷新 SessionID...`);
         try {
           const recovered = await this.refreshAccountSession(account, {
             syncAfterRefresh: true,
             jobId,
             log: appendLog,
             reason: error.message,
           });
           return { success: true, account: recovered, refreshedSession: true };
         } catch (refreshError) {
           appendLog(`账号 ${account.email} 刷新 SessionID 失败: ${refreshError.message}`);
           return { success: false, error: refreshError.message };
         }
       }
       return { success: false, error: error.message };
    }
  }

  /**
   * 启动后台同步任务
   */
  startSyncAllAccounts() {
    const db = getDatabase();
    // 同步所有非已删除账号
    const accounts = db.prepare("SELECT * FROM accounts").all();
    return this.runSyncJob(accounts, "同步全量活跃账号");
  }

  /**
   * 运行同步任务逻辑
   */
  runSyncJob(accounts, description = "账号同步任务") {
    const jobId = crypto.randomUUID();
    const job = {
      id: jobId,
      total: accounts.length,
      processed: 0,
      successCount: 0,
      failCount: 0,
      status: 'running',
      logs: [],
      startTime: new Date().toISOString(),
      endTime: null
    };
    
    this.syncJobs.set(jobId, job);

    const log = (msg) => {
      const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      const entry = `[${timestamp}] ${msg}`;
      job.logs.push(entry);
      if (job.logs.length > 200) job.logs.shift();
      console.log(`[sync][job:${jobId.substring(0, 8)}] ${msg}`);
    };

    // 异步执行
    (async () => {
      log(`${description}, 总计 ${accounts.length} 个账号...`);
      
      const concurrency = 5; 
      const queue = [...accounts];
      
      const workers = Array.from({ length: Math.min(concurrency, accounts.length) }, async () => {
        while (queue.length > 0) {
          const account = queue.shift();
          if (!account) break;
          
          try {
            const result = await this.syncAccountCredits(account, { jobId, log });
            if (result.success) {
              job.successCount++;
              log(`✅ [${job.processed + 1}/${job.total}] ${account.email} 同步成功${result.refreshedSession ? '（已自动刷新 Session）' : ''}`);
            } else {
              job.failCount++;
              log(`❌ [${job.processed + 1}/${job.total}] ${account.email} 同步失败: ${result.error || '状态异常'}`);
            }
          } catch (error) {
            job.failCount++;
            log(`❌ [${job.processed + 1}/${job.total}] ${account.email} 执行出错: ${error.message}`);
          } finally {
            job.processed++;
          }
          
          await new Promise(r => setTimeout(r, 500));
        }
      });

      await Promise.all(workers);
      
      job.status = 'completed';
      job.endTime = new Date().toISOString();
      log(`同步任务结束。成功: ${job.successCount}, 失败: ${job.failCount}`);
    })().catch(err => {
      job.status = 'failed';
      log(`同步异常终止: ${err.message}`);
    });

    return jobId;
  }

  startRefreshBatch(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return null;
    const db = getDatabase();
    const placeholders = ids.map(() => '?').join(',');
    const accounts = db.prepare(`SELECT * FROM accounts WHERE id IN (${placeholders})`).all(...ids);

    if (accounts.length === 0) return null;

    return this.runRefreshJob(accounts, `批量刷新 ${accounts.length} 个账号的 SessionID`);
  }

  runRefreshJob(accounts, description = '账号 SessionID 刷新任务') {
    const jobId = crypto.randomUUID();
    const job = {
      id: jobId,
      total: accounts.length,
      processed: 0,
      successCount: 0,
      failCount: 0,
      status: 'running',
      logs: [],
      startTime: new Date().toISOString(),
      endTime: null,
    };

    this.refreshJobs.set(jobId, job);

    const log = (msg) => {
      const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      const entry = `[${timestamp}] ${msg}`;
      job.logs.push(entry);
      if (job.logs.length > 300) job.logs.shift();
      console.log(`[refresh][job:${jobId.substring(0, 8)}] ${msg}`);
    };

    (async () => {
      log(`${description}...`);

      const concurrency = Math.min(2, accounts.length);
      const queue = [...accounts];

      const workers = Array.from({ length: concurrency }, async () => {
        while (queue.length > 0) {
          const account = queue.shift();
          if (!account) break;

          try {
            const refreshed = await this.refreshAccountSession(account, {
              syncAfterRefresh: true,
              jobId,
              log,
              reason: '手动批量刷新',
            });
            job.successCount++;
            log(`✅ [${job.processed + 1}/${job.total}] ${account.email} 刷新成功，当前状态=${refreshed.usageStatusLabel || '待确认'}`);
          } catch (error) {
            job.failCount++;
            log(`❌ [${job.processed + 1}/${job.total}] ${account.email} 刷新失败: ${error.message}`);
          } finally {
            job.processed++;
          }

          await new Promise((r) => setTimeout(r, 800));
        }
      });

      await Promise.all(workers);
      job.status = 'completed';
      job.endTime = new Date().toISOString();
      log(`SessionID 刷新任务结束。成功: ${job.successCount}, 失败: ${job.failCount}`);
    })().catch((error) => {
      job.status = 'failed';
      job.endTime = new Date().toISOString();
      log(`刷新任务异常终止: ${error.message}`);
    });

    return jobId;
  }

  getSyncJob(jobId) {
    return this.syncJobs.get(jobId);
  }

  getAllSyncJobs() {
    return Array.from(this.syncJobs.values());
  }

  getRefreshJob(jobId) {
    return this.refreshJobs.get(jobId);
  }

  getAllRefreshJobs() {
    return Array.from(this.refreshJobs.values());
  }

  /**
   * 同步所有活跃账号积分 (遗留接口，现内部调用 startSyncAllAccounts)
   */
  async syncAllAccounts() {
     const jobId = this.startSyncAllAccounts();
     return { jobId };
  }
}

const accountService = new AccountService();
export default accountService;
