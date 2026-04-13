import fs from 'fs';
import { getDatabase } from '../database/index.js';
import { normalizeSessionIdInput } from './sessionIdUtils.js';

function extractAssignmentValue(token = '', keys = []) {
  const lower = String(token || '').trim().toLowerCase();
  for (const key of keys) {
    const prefix = `${key.toLowerCase()}=`;
    if (lower.startsWith(prefix)) {
      return String(token).slice(prefix.length).trim();
    }
  }
  return null;
}

function parseCreditsValue(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const matched = text.match(/-?\d+/);
  return matched ? Number.parseInt(matched[0], 10) : null;
}

function splitImportLine(line) {
  if (line.includes('----')) {
    return line.split('----').map((part) => part.trim());
  }
  if (line.includes('\t')) {
    return line.split('\t').map((part) => part.trim());
  }
  if (line.includes(',')) {
    return line.split(',').map((part) => part.trim());
  }
  return line.split(/\s+/).map((part) => part.trim());
}

function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

class AccountPoolService {
  parseImportLine(rawLine, lineNumber) {
    const line = String(rawLine || '').trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) {
      return null;
    }

    const parts = splitImportLine(line).filter((part) => part !== '');
    if (parts.length === 0) {
      return null;
    }

    const email = String(parts[0] || '').trim().toLowerCase();
    if (!isValidEmail(email)) {
      throw new Error(`第 ${lineNumber} 行邮箱格式不正确`);
    }

    let password = null;
    let sessionId = null;
    let webId = null;
    let provider = 'dreamina';
    let status = 'active';
    let credits = null;

    for (let index = 1; index < parts.length; index += 1) {
      const token = String(parts[index] || '').trim();
      if (!token) continue;

      const sessionValue =
        extractAssignmentValue(token, ['sessionid', 'session_id', 'session']) ||
        (sessionId ? null : (/^[a-z]{2}-/i.test(token) || /^[a-f0-9]{20,}$/i.test(token) ? token : null));
      if (sessionValue) {
        sessionId = normalizeSessionIdInput(sessionValue);
        continue;
      }

      const webIdValue = extractAssignmentValue(token, ['webid', 'web_id', '_tea_web_id']);
      if (webIdValue) {
        webId = webIdValue;
        continue;
      }

      const providerValue = extractAssignmentValue(token, ['provider']);
      if (providerValue) {
        provider = providerValue || 'dreamina';
        continue;
      }

      const statusValue = extractAssignmentValue(token, ['status']);
      if (statusValue) {
        status = statusValue || 'active';
        continue;
      }

      const creditsValue =
        extractAssignmentValue(token, ['credits', 'credit', 'points', 'score']) || null;
      if (creditsValue !== null) {
        credits = parseCreditsValue(creditsValue);
        continue;
      }

      if (password === null) {
        password = token;
        continue;
      }

      if (sessionId === null) {
        sessionId = normalizeSessionIdInput(token);
        continue;
      }

      if (credits === null) {
        const parsedCredits = parseCreditsValue(token);
        if (parsedCredits !== null) {
          credits = parsedCredits;
          continue;
        }
      }

      if (webId === null) {
        webId = token;
      }
    }

    if (!password && !sessionId) {
      throw new Error(`第 ${lineNumber} 行至少需要密码或 SessionID`);
    }

    return {
      email,
      password: password || null,
      sessionId: sessionId || null,
      webId: webId || null,
      provider: provider || 'dreamina',
      status: status || 'active',
      credits: Number.isFinite(credits) ? credits : null,
    };
  }

  importFromText(text, options = {}) {
    const content = String(text || '');
    if (!content.trim()) {
      throw new Error('导入内容不能为空');
    }

    const overwriteExisting = options.overwriteExisting !== false;
    const db = getDatabase();
    const lines = content.split(/\r?\n/);

    const stats = {
      total: 0,
      imported: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      importedIds: [],
      errorLines: [],
    };

    const findByEmail = db.prepare('SELECT * FROM accounts WHERE email = ?');
    const insertAccount = db.prepare(`
      INSERT INTO accounts (
        email, password, session_id, web_id, credits, status, provider,
        benefit_eligibility, benefit_label, usage_status, usage_status_label, credit_source, sync_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', '待检测', 'unknown', '待确认', 'cached', NULL)
    `);
    const updateAccount = db.prepare(`
      UPDATE accounts
      SET password = ?,
          session_id = ?,
          web_id = ?,
          credits = ?,
          status = ?,
          provider = ?,
          credit_source = CASE WHEN ? THEN 'cached' ELSE COALESCE(credit_source, 'cached') END,
          credit_synced_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE credit_synced_at END,
          sync_error = NULL,
          benefit_eligibility = CASE WHEN ? THEN 'unknown' ELSE COALESCE(benefit_eligibility, 'unknown') END,
          benefit_label = CASE WHEN ? THEN '待检测' ELSE COALESCE(benefit_label, '待检测') END,
          benefit_reason = CASE WHEN ? THEN NULL ELSE benefit_reason END,
          benefit_evidence = CASE WHEN ? THEN NULL ELSE benefit_evidence END,
          usage_status = CASE WHEN ? THEN 'unknown' ELSE COALESCE(usage_status, 'unknown') END,
          usage_status_label = CASE WHEN ? THEN '待确认' ELSE COALESCE(usage_status_label, '待确认') END,
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
    `);

    const transaction = db.transaction(() => {
      for (let index = 0; index < lines.length; index += 1) {
        const rawLine = lines[index];
        const trimmed = String(rawLine || '').trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
          continue;
        }

        stats.total += 1;

        try {
          const parsed = this.parseImportLine(rawLine, index + 1);
          if (!parsed) {
            stats.skipped += 1;
            continue;
          }

          const existing = findByEmail.get(parsed.email);
          if (!existing) {
            const result = insertAccount.run(
              parsed.email,
              parsed.password,
              parsed.sessionId,
              parsed.webId,
              Number.isFinite(parsed.credits) ? parsed.credits : 0,
              parsed.status,
              parsed.provider
            );
            stats.created += 1;
            stats.imported += 1;
            stats.importedIds.push(Number(result.lastInsertRowid));
            continue;
          }

          if (!overwriteExisting) {
            stats.skipped += 1;
            continue;
          }

          const nextPassword = parsed.password || existing.password || null;
          const nextSessionId = parsed.sessionId || existing.session_id || null;
          if (!nextPassword && !nextSessionId) {
            throw new Error(`第 ${index + 1} 行更新后仍缺少密码和 SessionID`);
          }

          const currentSession = normalizeSessionIdInput(existing.session_id || '');
          const incomingSession = normalizeSessionIdInput(nextSessionId || '');
          const sessionChanged = Boolean(incomingSession) && currentSession !== incomingSession;
          const nextCredits = Number.isFinite(parsed.credits) ? parsed.credits : Number(existing.credits || 0);

          updateAccount.run(
            nextPassword,
            nextSessionId,
            parsed.webId || existing.web_id || null,
            nextCredits,
            parsed.status || existing.status || 'active',
            parsed.provider || existing.provider || 'dreamina',
            Number.isFinite(parsed.credits) ? 1 : 0,
            Number.isFinite(parsed.credits) ? 1 : 0,
            sessionChanged ? 1 : 0,
            sessionChanged ? 1 : 0,
            sessionChanged ? 1 : 0,
            sessionChanged ? 1 : 0,
            sessionChanged ? 1 : 0,
            sessionChanged ? 1 : 0,
            sessionChanged ? 1 : 0,
            sessionChanged ? 1 : 0,
            sessionChanged ? 1 : 0,
            sessionChanged ? 1 : 0,
            sessionChanged ? 1 : 0,
            sessionChanged ? 1 : 0,
            existing.id
          );
          stats.updated += 1;
          stats.imported += 1;
          stats.importedIds.push(existing.id);
        } catch (error) {
          stats.errors += 1;
          if (stats.errorLines.length < 20) {
            stats.errorLines.push(error?.message || `第 ${index + 1} 行导入失败`);
          }
        }
      }
    });

    transaction();
    return stats;
  }

  importFromTextFile(filePath, options = {}) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    return this.importFromText(text, options);
  }

  getStats() {
    const db = getDatabase();
    const result = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN credits > 0 THEN 1 ELSE 0 END) as usable,
        SUM(CASE WHEN status = 'banned' THEN 1 ELSE 0 END) as banned
      FROM accounts
    `).get();
    return result;
  }
}

export const accountPoolService = new AccountPoolService();
export default accountPoolService;
