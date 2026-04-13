import type {
  User,
  ApiKeyItem,
  CreatedApiKey,
  LoginCredentials,
  RegisterCredentials,
  AuthResponse,
  Account,
  AccountPoolSummary,
  RegistrationJob,
  AccountBackgroundJob,
  ManualAccountPayload,
  UpdateManualAccountPayload,
} from '../types';
import { getApiBase } from './apiBase';

const API_BASE = getApiBase();
const AUTH_USER_UPDATED_EVENT = 'seedance-auth-user-updated';

interface EmailCodeResponse {
  success: boolean;
  delivery?: 'email' | 'debug';
  debugCode?: string;
  message?: string;
}

interface UpdateCurrentUserPayload {
  username: string;
}

function emitAuthUserUpdated(user: User | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(AUTH_USER_UPDATED_EVENT, { detail: user }));
}

export function subscribeAuthUserUpdates(handler: (user: User | null) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<User | null>;
    handler(customEvent.detail ?? null);
  };

  window.addEventListener(AUTH_USER_UPDATED_EVENT, listener);
  return () => window.removeEventListener(AUTH_USER_UPDATED_EVENT, listener);
}

/**
 * 获取存储的 Session ID
 */
function getSessionId(): string | null {
  return localStorage.getItem('seedance_session_id');
}

/**
 * 设置 Session ID
 */
function setSessionId(sessionId: string): void {
  localStorage.setItem('seedance_session_id', sessionId);
}

/**
 * 移除 Session ID
 */
function removeSessionId(): void {
  localStorage.removeItem('seedance_session_id');
  localStorage.removeItem('seedance_user_cache');
  emitAuthUserUpdated(null);
}

export function getAuthSessionId(): string | null {
  return getSessionId();
}

export function getAuthHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const sessionId = getSessionId();
  if (!sessionId) {
    throw new Error('未登录');
  }

  return {
    ...headers,
    'X-Session-ID': sessionId,
  };
}

/**
 * 获取缓存的用户信息
 */
function getCachedUser(): User | null {
  const cached = localStorage.getItem('seedance_user_cache');
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 缓存用户信息
 */
function cacheUser(user: User): void {
  localStorage.setItem('seedance_user_cache', JSON.stringify(user));
  emitAuthUserUpdated(user);
}

/**
 * 注册新用户
 */
export async function register(credentials: RegisterCredentials): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(credentials),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '注册失败');
  }

  if (data.data) {
    setSessionId(data.data.sessionId);
    cacheUser(data.data.user);
  }

  return data.data;
}

/**
 * 用户登录
 */
export async function login(credentials: LoginCredentials): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(credentials),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '登录失败');
  }

  if (data.data) {
    setSessionId(data.data.sessionId);
    cacheUser(data.data.user);
  }

  return data.data;
}

/**
 * 用户登出
 */
export async function logout(): Promise<void> {
  const sessionId = getSessionId();
  if (sessionId) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: {
          'X-Session-ID': sessionId,
        },
      });
    } catch (error) {
      console.error('登出失败:', error);
    }
  }
  removeSessionId();
}

/**
 * 获取当前用户信息
 */
export async function getCurrentUser(): Promise<User | null> {
  const sessionId = getSessionId();

  if (!sessionId) {
    return null;
  }

  try {
    const response = await fetch(`${API_BASE}/auth/me`, {
      headers: {
        'X-Session-ID': sessionId,
      },
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      removeSessionId();
      return null;
    }

    const user = data.data.user;
    cacheUser(user);
    return user;
  } catch (error) {
    console.error('获取用户信息失败:', error);
    return null;
  }
}

/**
 * 修改密码
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const sessionId = getSessionId();

  if (!sessionId) {
    throw new Error('未登录');
  }

  const response = await fetch(`${API_BASE}/auth/password`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
    body: JSON.stringify({ oldPassword, newPassword }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '修改密码失败');
  }

  // 修改密码后需要重新登录
  removeSessionId();
}

/**
 * 更新当前用户资料
 */
export async function updateCurrentUserProfile(payload: UpdateCurrentUserPayload): Promise<User> {
  const response = await fetch(`${API_BASE}/auth/me`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '更新账户资料失败');
  }

  const user = data.data?.user as User;
  cacheUser(user);
  return user;
}

/**
 * 扣减积分
 */
export async function deductCredits(amount: number): Promise<{ remainingCredits: number }> {
  const sessionId = getSessionId();

  if (!sessionId) {
    throw new Error('未登录');
  }

  const response = await fetch(`${API_BASE}/credits/deduct`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
    body: JSON.stringify({ amount }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '扣减积分失败');
  }

  // 更新缓存的用户信息
  const user = getCachedUser();
  if (user) {
    user.credits = data.data.remainingCredits;
    cacheUser(user);
  }

  return data.data;
}

/**
 * 充值积分
 */
export async function rechargeCredits(amount: number): Promise<{ credits: number }> {
  const sessionId = getSessionId();

  if (!sessionId) {
    throw new Error('未登录');
  }

  const response = await fetch(`${API_BASE}/credits/add`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
    body: JSON.stringify({ amount }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '充值积分失败');
  }

  // 更新缓存的用户信息
  const user = getCachedUser();
  if (user) {
    user.credits = data.data.credits;
    cacheUser(user);
  }

  return data.data;
}

/**
 * 每日签到
 */
export async function checkIn(): Promise<{ creditsEarned: number }> {
  const sessionId = getSessionId();

  if (!sessionId) {
    throw new Error('未登录');
  }

  const response = await fetch(`${API_BASE}/credits/checkin`, {
    method: 'POST',
    headers: {
      'X-Session-ID': sessionId,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '签到失败');
  }

  // 更新缓存的用户信息
  const user = getCachedUser();
  if (user) {
    user.credits = (user.credits || 0) + data.data.creditsEarned;
    cacheUser(user);
  }

  return data.data;
}

/**
 * 获取签到状态
 */
export async function getCheckInStatus(): Promise<{ hasCheckedInToday: boolean; totalCheckIns: number }> {
  const sessionId = getSessionId();

  if (!sessionId) {
    throw new Error('未登录');
  }

  const response = await fetch(`${API_BASE}/credits/checkin/status`, {
    headers: {
      'X-Session-ID': sessionId,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '获取签到状态失败');
  }

  return data.data;
}

/**
 * 发送邮箱验证码
 */
export async function sendEmailCode(email: string): Promise<EmailCodeResponse> {
  const response = await fetch(`${API_BASE}/auth/email-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '发送验证码失败');
  }

  const payload = data?.data && typeof data.data === 'object' ? data.data : data;
  return {
    success: Boolean(payload?.success ?? true),
    delivery: payload?.delivery,
    debugCode: payload?.debugCode,
    message: payload?.message,
  };
}

/**
 * 检查邮箱状态
 */
export async function checkEmailStatus(email: string): Promise<{ isRegistered: boolean }> {
  const response = await fetch(`${API_BASE}/auth/email-status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '检查邮箱状态失败');
  }

  return data.data;
}

/**
 * 验证邮箱验证码
 */
export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/verify-email-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, code }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '验证码错误');
  }

  return data;
}

/**
 * 获取当前用户的 Open API Keys
 */
export async function getApiKeys(): Promise<ApiKeyItem[]> {
  const response = await fetch(`${API_BASE}/auth/api-keys`, {
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '获取 API Key 列表失败');
  }

  return Array.isArray(data.data) ? data.data : [];
}

/**
 * 创建新的 Open API Key
 */
export async function createApiKey(name: string): Promise<CreatedApiKey> {
  const response = await fetch(`${API_BASE}/auth/api-keys`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '创建 API Key 失败');
  }

  return data.data;
}

/**
 * 删除 Open API Key
 */
export async function deleteApiKey(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/api-keys/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '删除 API Key 失败');
  }
}

// ============================================================
// 管理员 API
// ============================================================

/**
 * 获取系统统计
 */
export async function getSystemStats(): Promise<{
  totalUsers: number;
  activeUsers: number;
  totalProjects: number;
  totalTasks: number;
  todayCheckIns: number;
  totalCreditsIssued: number;
}> {
  const sessionId = getSessionId();

  if (!sessionId) {
    throw new Error('未登录');
  }

  const response = await fetch(`${API_BASE}/admin/stats`, {
    headers: {
      'X-Session-ID': sessionId,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '获取系统统计失败');
  }

  return data.data;
}

/**
 * 获取用户列表
 */
export async function getUserList(
  page: number = 1,
  pageSize: number = 20,
  filters?: { role?: string; status?: string; email?: string }
): Promise<{
  users: User[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}> {
  const sessionId = getSessionId();

  if (!sessionId) {
    throw new Error('未登录');
  }

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    ...filters,
  } as Record<string, string>);

  const response = await fetch(`${API_BASE}/admin/users?${params.toString()}`, {
    headers: {
      'X-Session-ID': sessionId,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '获取用户列表失败');
  }

  return data.data;
}

/**
 * 获取用户详情
 */
export async function getUserDetail(userId: number): Promise<User | null> {
  const sessionId = getSessionId();

  if (!sessionId) {
    throw new Error('未登录');
  }

  const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
    headers: {
      'X-Session-ID': sessionId,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '获取用户详情失败');
  }

  return data.data;
}

/**
 * 更新用户状态
 */
export async function updateUserStatus(userId: number, status: 'active' | 'disabled'): Promise<void> {
  const sessionId = getSessionId();

  if (!sessionId) {
    throw new Error('未登录');
  }

  const response = await fetch(`${API_BASE}/admin/users/${userId}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
    body: JSON.stringify({ status }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '更新用户状态失败');
  }
}

/**
 * 修改用户积分
 */
export async function updateUserCredits(
  userId: number,
  credits: number,
  operation: 'set' | 'add' | 'subtract' = 'set'
): Promise<void> {
  const sessionId = getSessionId();

  if (!sessionId) {
    throw new Error('未登录');
  }

  const response = await fetch(`${API_BASE}/admin/users/${userId}/credits`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
    body: JSON.stringify({ credits, operation }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '修改用户积分失败');
  }
}

/**
 * 重置用户密码
 */
export async function resetUserPassword(userId: number, newPassword: string): Promise<void> {
  const sessionId = getSessionId();

  if (!sessionId) {
    throw new Error('未登录');
  }

  const response = await fetch(`${API_BASE}/admin/users/${userId}/password`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
    body: JSON.stringify({ newPassword }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '重置用户密码失败');
  }
}

/**
 * 删除用户
 */
export async function deleteUser(userId: number): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '删除用户失败');
  }
}

// ============================================================
// 账号池管理 API
// ============================================================

/**
 * 获取账号池列表 (支持分页)
 */
export async function getAccountPool(
  page = 1,
  pageSize = 20
): Promise<{ accounts: Account[]; pagination: any; summary: AccountPoolSummary }> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const response = await fetch(`${API_BASE}/admin/accounts?${params.toString()}`, {
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '获取账号池失败');
  return {
    accounts: data.data,
    pagination: data.pagination,
    summary: data.summary || {
      total: 0,
      totalCredits: 0,
      allCredits: 0,
      eligibleCount: 0,
      activeCount: 0,
      zeroCreditsCount: 0,
      zeroBalanceCount: 0,
      noBenefitCount: 0,
      invalidCount: 0,
      unknownCount: 0,
      errorCount: 0,
      lastSyncedAt: null,
    },
  };
}

/**
 * 手动添加账号到账号池
 */
export async function createManualAccount(payload: ManualAccountPayload): Promise<Account> {
  const response = await fetch(`${API_BASE}/admin/accounts`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '添加账号失败');
  return data.data;
}

export async function updateManualAccount(id: number, payload: UpdateManualAccountPayload): Promise<Account> {
  const response = await fetch(`${API_BASE}/admin/accounts/${id}`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '编辑账号失败');
  return data.data;
}

/**
 * 检测单个账号状态和积分
 */
export async function inspectAccount(id: number): Promise<Account> {
  const response = await fetch(`${API_BASE}/admin/accounts/${id}/inspect`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '检测账号失败');
  return data.data;
}

/**
 * 立即刷新单个账号 SessionID
 */
export async function refreshAccountSession(id: number): Promise<Account> {
  const response = await fetch(`${API_BASE}/admin/accounts/${id}/refresh-session`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '刷新 SessionID 失败');
  return data.data;
}

/**
 * 批量删除账号
 */
export async function deleteAccountsBatch(ids: number[]): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/accounts/delete-batch`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || '批量删除失败');
  }
}

/**
 * 批量同步账号
 */
export async function syncAccountsBatch(ids: number[]): Promise<{ jobId: string }> {
  const response = await fetch(`${API_BASE}/admin/accounts/sync-batch`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '批量同步启动失败');
  return data.data;
}

/**
 * 批量刷新账号 SessionID
 */
export async function refreshAccountsBatch(ids: number[]): Promise<{ jobId: string }> {
  const response = await fetch(`${API_BASE}/admin/accounts/refresh-batch`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '批量刷新 SessionID 启动失败');
  return data.data;
}

/**
 * 删除账号
 */
export async function deleteAccount(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/admin/accounts/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || '删除账号失败');
  }
}

/**
 * 启动批量注册任务
 */
export async function registerBatch(count: number, provider: string): Promise<{ jobId: string }> {
  const response = await fetch(`${API_BASE}/admin/accounts/register-batch`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ count, provider }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '启动注册任务失败');
  return data.data;
}

/**
 * 获取注册任务状态
 */
export async function getRegistrationJob(jobId: string): Promise<RegistrationJob> {
  const response = await fetch(`${API_BASE}/admin/accounts/registration-jobs/${jobId}`, {
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '获取任务状态失败');
  return data.data;
}

/**
 * 同步所有账号积分
 */
export async function syncAllAccounts(): Promise<{ jobId: string }> {
  const response = await fetch(`${API_BASE}/admin/accounts/sync-all`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '同步任务启动失败');
  return data.data;
}

/**
 * 获取同步任务状态
 */
export async function getSyncJobStatus(jobId: string): Promise<AccountBackgroundJob> {
  const response = await fetch(`${API_BASE}/admin/accounts/sync-jobs/${jobId}`, {
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '获取同步状态失败');
  return data.data;
}

/**
 * 获取 Session 刷新任务状态
 */
export async function getRefreshJobStatus(jobId: string): Promise<AccountBackgroundJob> {
  const response = await fetch(`${API_BASE}/admin/accounts/refresh-jobs/${jobId}`, {
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '获取刷新状态失败');
  return data.data;
}
