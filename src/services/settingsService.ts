import type {
  Settings,
  ApiResponse,
  JimengSessionAccount,
  JimengSessionAccountInput,
  EffectiveSessionResolution,
} from '../types/index';
import { getAuthHeaders } from './authService';
import { getApiBase } from './apiBase';

const API_BASE = getApiBase();

export interface SessionAccountsResponse {
  accounts: JimengSessionAccount[];
  effective: EffectiveSessionResolution;
}

/**
 * 获取全局设置
 */
export async function getSettings(): Promise<Settings> {
  const response = await fetch(`${API_BASE}/settings`);
  const result: ApiResponse<Settings> = await response.json();
  if (!result.success) {
    throw new Error(result.error || '获取设置失败');
  }
  return result.data || {};
}

/**
 * 更新全局设置
 */
export async function updateSettings(
  settings: Record<string, string>
): Promise<Settings> {
  console.log('[settings-service] Updating settings with keys:', Object.keys(settings).join(', '));
  const response = await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  const result: ApiResponse<Settings> = await response.json();
  if (!result.success) {
    throw new Error(result.error || '更新设置失败');
  }
  return result.data!;
}

export async function getSessionAccounts(): Promise<SessionAccountsResponse> {
  const response = await fetch(`${API_BASE}/settings/session-accounts`, {
    headers: getAuthHeaders(),
  });
  const result: ApiResponse<SessionAccountsResponse> = await response.json();
  if (!result.success) {
    throw new Error(result.error || '获取 SessionID 列表失败');
  }
  return result.data!;
}

export async function createSessionAccount(
  input: JimengSessionAccountInput
): Promise<JimengSessionAccount> {
  const response = await fetch(`${API_BASE}/settings/session-accounts`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
  const result: ApiResponse<JimengSessionAccount> = await response.json();
  if (!result.success) {
    throw new Error(result.error || '新增 SessionID 失败');
  }
  return result.data!;
}

export async function updateSessionAccount(
  id: number,
  input: Partial<JimengSessionAccountInput>
): Promise<JimengSessionAccount> {
  const response = await fetch(`${API_BASE}/settings/session-accounts/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
  const result: ApiResponse<JimengSessionAccount> = await response.json();
  if (!result.success) {
    throw new Error(result.error || '更新 SessionID 失败');
  }
  return result.data!;
}

export async function deleteSessionAccount(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/settings/session-accounts/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const result: ApiResponse = await response.json();
  if (!result.success) {
    throw new Error(result.error || '删除 SessionID 失败');
  }
}

export async function setDefaultSessionAccount(id: number): Promise<JimengSessionAccount> {
  const response = await fetch(`${API_BASE}/settings/session-accounts/${id}/default`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const result: ApiResponse<JimengSessionAccount> = await response.json();
  if (!result.success) {
    throw new Error(result.error || '设置默认 SessionID 失败');
  }
  return result.data!;
}

export async function refreshSessionAccount(id: number): Promise<JimengSessionAccount> {
  const response = await fetch(`${API_BASE}/settings/session-accounts/${id}/refresh-session`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const result: ApiResponse<JimengSessionAccount> = await response.json();
  if (!result.success) {
    throw new Error(result.error || '刷新 SessionID 失败');
  }
  return result.data!;
}

export async function testJimengSessionId(
  sessionId: string
): Promise<{ success: boolean; message?: string; error?: string; points?: number; normalizedSessionId?: string }> {
  const response = await fetch(`${API_BASE}/settings/session-accounts/test`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sessionId }),
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || '测试 SessionID 失败');
  }

  return result;
}

export default {
  getSettings,
  updateSettings,
  getSessionAccounts,
  createSessionAccount,
  updateSessionAccount,
  deleteSessionAccount,
  setDefaultSessionAccount,
  refreshSessionAccount,
  testJimengSessionId,
};
