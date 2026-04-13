import { getDatabase } from '../database/index.js';
import * as settingsService from './settingsService.js';
import registrationService from './registration-service.js';
import { buildRegionalSessionId, normalizeSessionIdInput, parseRegionalSessionInput } from './sessionIdUtils.js';

function normalizeSessionId(sessionId) {
  return normalizeSessionIdInput(sessionId);
}

function mapAccount(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name || '',
    sessionId: normalizeSessionId(row.session_id),
    email: row.email || '',
    hasPassword: Boolean(row.password),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getUserAccountRowById(userId, accountId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT *
    FROM jimeng_session_accounts
    WHERE id = ? AND user_id = ?
  `).get(accountId, userId);
}

export function listUserAccounts(userId) {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT *
    FROM jimeng_session_accounts
    WHERE user_id = ?
    ORDER BY is_default DESC, id ASC
  `).all(userId);

  const accounts = rows.map(mapAccount);
  
  // 注入系统自动账号池作为虚拟选项
  const hasDefault = accounts.some(a => a.isDefault);
  accounts.push({
    id: -1, // 特殊 ID
    userId,
    name: '系统自动账号池 (推荐)',
    sessionId: '',
    isDefault: !hasDefault, // 如果没设默认，则默认为它
    isVirtual: true,
    description: '自动注册与轮询，无需输入 SessionID'
  });

  return accounts;
}

export function createUserAccount(userId, payload) {
  const db = getDatabase();
  const sessionId = normalizeSessionId(payload.sessionId);
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  const password = String(payload.password || '');

  if (!sessionId) {
    throw new Error('SessionID 不能为空');
  }

  const existingRows = db.prepare(`
    SELECT id, session_id FROM jimeng_session_accounts
    WHERE user_id = ?
  `).all(userId);

  const exists = existingRows.find((row) => normalizeSessionId(row.session_id) === sessionId);

  if (exists) {
    throw new Error('该 SessionID 已存在');
  }

  const hasAny = db.prepare(`
    SELECT id FROM jimeng_session_accounts
    WHERE user_id = ?
    LIMIT 1
  `).get(userId);

  const isDefault = hasAny ? 0 : 1;

  const result = db.prepare(`
    INSERT INTO jimeng_session_accounts (user_id, name, session_id, email, password, is_default, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(userId, name, sessionId, email, password, isDefault);

  return getUserAccountById(userId, Number(result.lastInsertRowid));
}

export function getUserAccountById(userId, accountId) {
  const row = getUserAccountRowById(userId, accountId);

  return row ? mapAccount(row) : null;
}

export function updateUserAccount(userId, accountId, payload) {
  const db = getDatabase();
  const existingRow = getUserAccountRowById(userId, accountId);
  const existing = existingRow ? mapAccount(existingRow) : null;

  if (!existing) {
    throw new Error('SessionID 账号不存在');
  }

  const nextName = payload.name !== undefined ? String(payload.name || '').trim() : existing.name;
  const nextSessionId = payload.sessionId !== undefined
    ? normalizeSessionId(payload.sessionId)
    : existing.sessionId;
  const nextEmail = payload.email !== undefined ? String(payload.email || '').trim() : String(existingRow.email || '');
  const nextPassword = payload.password !== undefined ? String(payload.password || '') : String(existingRow.password || '');

  if (!nextSessionId) {
    throw new Error('SessionID 不能为空');
  }

  const duplicated = db.prepare(`
    SELECT id, session_id FROM jimeng_session_accounts
    WHERE user_id = ? AND id != ?
  `).all(userId, accountId).find((row) => normalizeSessionId(row.session_id) === nextSessionId);

  if (duplicated) {
    throw new Error('该 SessionID 已存在');
  }

  db.prepare(`
    UPDATE jimeng_session_accounts
    SET name = ?,
        session_id = ?,
        email = ?,
        password = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(nextName, nextSessionId, nextEmail, nextPassword, accountId, userId);

  return getUserAccountById(userId, accountId);
}

export function setDefaultAccount(userId, accountId) {
  const db = getDatabase();
  
  if (accountId === -1) {
    // 设为系统自动账号池（清空所有用户的默认设置）
    db.prepare(`
      UPDATE jimeng_session_accounts
      SET is_default = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(userId);
    return { id: -1, name: '系统自动账号池', isDefault: true, isVirtual: true };
  }

  const existing = getUserAccountById(userId, accountId);
  if (!existing) {
    throw new Error('SessionID 账号不存在');
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE jimeng_session_accounts
      SET is_default = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(userId);

    db.prepare(`
      UPDATE jimeng_session_accounts
      SET is_default = 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(accountId, userId);
  });

  transaction();
  return getUserAccountById(userId, accountId);
}

export function deleteUserAccount(userId, accountId) {
  const db = getDatabase();
  const existing = getUserAccountById(userId, accountId);

  if (!existing) {
    throw new Error('SessionID 账号不存在');
  }

  const transaction = db.transaction(() => {
    db.prepare(`
      DELETE FROM jimeng_session_accounts
      WHERE id = ? AND user_id = ?
    `).run(accountId, userId);
  });

  transaction();
  return { success: true };
}

export async function testSessionId(sessionId) {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized) {
    throw new Error('SessionID 不能为空');
  }

  return settingsService.testSessionId(normalized);
}

export async function refreshUserAccountSession(userId, accountId) {
  const db = getDatabase();
  const existing = getUserAccountRowById(userId, accountId);

  if (!existing) {
    throw new Error('SessionID 账号不存在');
  }

  const email = String(existing.email || '').trim();
  const password = String(existing.password || '');

  if (!email || !password) {
    throw new Error('请先为该账号保存邮箱和密码，再执行一键刷新');
  }

  const refreshed = await registrationService.refreshExistingAccountSession({ email, password });
  const nextSessionId = buildRegionalSessionId(
    refreshed.sessionId,
    refreshed.region || parseRegionalSessionInput(existing.session_id).region || 'us'
  );

  db.prepare(`
    UPDATE jimeng_session_accounts
    SET session_id = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(nextSessionId, accountId, userId);

  return getUserAccountById(userId, accountId);
}

export function resolveEffectiveSession(userId) {
  const db = getDatabase();
  const userDefault = db.prepare(`
    SELECT *
    FROM jimeng_session_accounts
    WHERE user_id = ? AND is_default = 1
    LIMIT 1
  `).get(userId);

  if (userDefault?.session_id) {
    return {
      source: 'user_default',
      sessionId: normalizeSessionId(userDefault.session_id),
      account: mapAccount(userDefault),
    };
  }

  // 如果没有手动设置默认，或者显式指定了系统池（这里暂时逻辑是 fallback）
  // 后续通过 setDefaultAccount(-1) 可以显式控制这里

  const legacyGlobal = settingsService.getLegacyGlobalSessionId();
  if (legacyGlobal) {
    return {
      source: 'legacy_global',
      sessionId: normalizeSessionId(legacyGlobal),
      account: null,
    };
  }

  // 默认返回自动化池
  return {
    source: 'automated_pool',
    sessionId: '',
    account: { id: -1, name: '系统自动账号池' },
  };
}

export default {
  listUserAccounts,
  createUserAccount,
  getUserAccountById,
  updateUserAccount,
  setDefaultAccount,
  deleteUserAccount,
  testSessionId,
  refreshUserAccountSession,
  resolveEffectiveSession,
};
