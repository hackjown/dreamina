import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { getDatabase } from '../database/index.js';

/**
 * 用户认证服务
 * 参考 genai-craft 项目实现
 */

// Session 有效期：7 天
const SESSION_EXPIRY_DAYS = 7;

// 邮件传输器缓存
let cachedMailTransporter = null;
let cachedMailTransporterKey = '';

/**
 * 解析布尔值
 */
function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const str = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(str);
}

/**
 * 获取系统配置值
 */
async function getSystemConfigValue(key) {
  const db = getDatabase();
  try {
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(key);
    return row?.value || '';
  } catch (e) {
    return '';
  }
}

/**
 * 格式化日期时间为本地字符串
 */
function formatDateTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

/**
 * 获取邮件传输器
 */
export async function getMailTransporter() {
  const host = (await getSystemConfigValue('smtp_host') || process.env.SMTP_HOST || '').trim();
  const portRaw = (await getSystemConfigValue('smtp_port') || process.env.SMTP_PORT || '').trim();
  const user = (await getSystemConfigValue('smtp_user') || process.env.SMTP_USER || '').trim();
  const pass = (await getSystemConfigValue('smtp_pass') || process.env.SMTP_PASS || '').trim();
  const secure = parseBoolean(await getSystemConfigValue('smtp_secure') || process.env.SMTP_SECURE, false);
  const rejectUnauthorized = parseBoolean(await getSystemConfigValue('smtp_tls_reject_unauthorized') || process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true);

  const port = portRaw ? parseInt(portRaw, 10) : (secure ? 465 : 587);
  if (!host || !user || !pass || !Number.isFinite(port)) return null;

  const transporterKey = JSON.stringify({ host, port, user, pass, secure, rejectUnauthorized });
  if (cachedMailTransporter && cachedMailTransporterKey === transporterKey) return cachedMailTransporter;

  cachedMailTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized }
  });
  cachedMailTransporterKey = transporterKey;

  return cachedMailTransporter;
}

/**
 * 发送邮箱验证码邮件
 */
export async function sendVerificationEmail(email, code) {
  const transporter = await getMailTransporter();
  const from = (await getSystemConfigValue('smtp_from') || process.env.SMTP_FROM || await getSystemConfigValue('smtp_user') || process.env.SMTP_USER || '').trim();
  const fromName = (await getSystemConfigValue('smtp_from_name') || process.env.SMTP_FROM_NAME || '').trim().replace(/"/g, '');
  const formattedFrom = from && fromName ? `"${fromName}" <${from}>` : from;

  if (!transporter || !from) {
    return false;
  }

  try {
    await transporter.sendMail({
      from: formattedFrom,
      to: email,
      subject: 'Seedance 2.0 注册验证码',
      text: `你的注册验证码是：${code}\n\n有效期：10 分钟\n\n如非本人操作，请忽略此邮件。`
    });
    return true;
  } catch (error) {
    console.error('发送邮件失败:', error);
    return false;
  }
}

/**
 * 生成密码哈希
 */
export function hashPassword(password) {
  // 简单实现，生产环境建议使用 bcrypt
  return crypto.createHash('sha256').update(password + 'seedance_salt_2024').digest('hex');
}

/**
 * 验证密码
 */
export function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}

/**
 * 生成 Session ID
 */
export function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 生成邮箱验证码
 */
export function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 检查邮箱是否有效
 */
export function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

/**
 * 检查密码强度（至少 8 位，包含数字和字母）
 */
export function isStrongPassword(password) {
  if (password.length < 8) return false;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  return hasLetter && hasDigit;
}

function buildDefaultUsername(email = '') {
  const localPart = String(email || '')
    .trim()
    .split('@')[0]
    .replace(/\s+/g, '')
    .slice(0, 32);

  if (localPart) {
    return localPart;
  }

  return `user_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeUsername(username, fallbackEmail = '') {
  const normalized = String(username ?? '').trim() || buildDefaultUsername(fallbackEmail);

  if (!normalized) {
    throw new Error('用户名不能为空');
  }

  if (normalized.length > 32) {
    throw new Error('用户名最多 32 个字符');
  }

  return normalized;
}

function buildInternalEmail() {
  return `${crypto.randomUUID()}@local.seedance.invalid`;
}

function findUserByLoginAccount(db, loginAccount) {
  const normalizedAccount = String(loginAccount ?? '').trim();
  if (!normalizedAccount) {
    return null;
  }

  const loweredAccount = normalizedAccount.toLowerCase();
  return db.prepare(`
    SELECT id, username, email, password_hash, role, status, credits, created_at, updated_at, last_check_in_at
    FROM users
    WHERE lower(username) = ? OR lower(email) = ?
    ORDER BY id ASC
    LIMIT 1
  `).get(loweredAccount, loweredAccount);
}

function mapUserRow(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username || buildDefaultUsername(user.email),
    email: user.email,
    role: user.role,
    status: user.status,
    credits: user.credits,
    createdAt: user.created_at || user.user_created_at || undefined,
    updatedAt: user.updated_at || user.user_updated_at || undefined,
    lastCheckInAt: user.last_check_in_at || user.user_last_check_in_at || undefined,
  };
}

/**
 * 用户注册
 */
export async function registerUser(loginAccount, password) {
  const db = getDatabase();
  const normalizedUsername = normalizeUsername(loginAccount);

  // 验证密码强度
  if (!isStrongPassword(password)) {
    throw new Error('密码至少 8 位，需包含数字和字母');
  }

  // 检查账号是否已存在
  const existingUser = db.prepare(`
    SELECT id FROM users WHERE lower(username) = ?
  `).get(normalizedUsername.toLowerCase());

  if (existingUser) {
    throw new Error('该账号已被注册');
  }

  // 创建用户
  const passwordHash = hashPassword(password);
  const internalEmail = buildInternalEmail();
  const result = db.prepare(`
    INSERT INTO users (username, email, password_hash, role, status, credits)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(normalizedUsername, internalEmail, passwordHash, 'user', 'active', 10);

  // 创建 session
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  db.prepare(`
    INSERT INTO sessions (session_id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(sessionId, Number(result.lastInsertRowid), expiresAt.toISOString());

  // 获取用户信息
  const user = db.prepare(`
    SELECT id, username, email, role, status, credits, created_at
    FROM users
    WHERE id = ?
  `).get(result.lastInsertRowid);

  return {
    sessionId,
    user: mapUserRow(user)
  };
}

/**
 * 用户登录
 */
export async function loginUser(loginAccount, password) {
  const db = getDatabase();
  const normalizedAccount = String(loginAccount || '').trim();

  if (!normalizedAccount) {
    throw new Error('账号不能为空');
  }

  // 查找用户
  const user = findUserByLoginAccount(db, normalizedAccount);

  if (!user) {
    throw new Error('账号不存在');
  }

  if (user.status !== 'active') {
    throw new Error('账号已被禁用');
  }

  // 验证密码
  if (!verifyPassword(password, user.password_hash)) {
    throw new Error('密码错误');
  }

  // 删除过期 sessions
  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();

  // 创建新 session
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  db.prepare(`
    INSERT INTO sessions (session_id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(sessionId, Number(user.id), expiresAt.toISOString());

  return {
    sessionId,
    user: mapUserRow(user)
  };
}

/**
 * 用户登出
 */
export async function logoutUser(sessionId) {
  const db = getDatabase();
  db.prepare(`DELETE FROM sessions WHERE session_id = ?`).run(sessionId);
  return { success: true };
}

/**
 * 获取当前用户信息
 */
export async function getCurrentUser(sessionId) {
  const db = getDatabase();

  const session = db.prepare(`
    SELECT s.*, u.id as user_id, u.username, u.email, u.role, u.status, u.credits,
      u.created_at AS user_created_at, u.updated_at AS user_updated_at, u.last_check_in_at AS user_last_check_in_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.session_id = ? AND s.expires_at > datetime('now')
  `).get(sessionId);

  if (!session) {
    return null;
  }

  return mapUserRow({
    id: session.user_id,
    username: session.username,
    email: session.email,
    role: session.role,
    status: session.status,
    credits: session.credits,
    user_created_at: session.user_created_at,
    user_updated_at: session.user_updated_at,
    user_last_check_in_at: session.user_last_check_in_at,
  });
}

/**
 * 更新当前用户资料
 */
export async function updateCurrentUserProfile(userId, { username, email } = {}) {
  const db = getDatabase();

  const currentUser = db.prepare(`
    SELECT id, username, email, role, status, credits, created_at, updated_at, last_check_in_at
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!currentUser) {
    throw new Error('用户不存在');
  }

  const nextEmail = String(email ?? currentUser.email).trim().toLowerCase() || currentUser.email;
  const nextUsername = normalizeUsername(username ?? currentUser.username, nextEmail);

  const duplicated = db.prepare(`
    SELECT id FROM users WHERE lower(username) = ? AND id != ?
  `).get(nextUsername.toLowerCase(), userId);

  if (duplicated) {
    throw new Error('该账号已被其他用户使用');
  }

  db.prepare(`
    UPDATE users
    SET username = ?, email = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(nextUsername, nextEmail, userId);

  const updated = db.prepare(`
    SELECT id, username, email, role, status, credits, created_at, updated_at, last_check_in_at
    FROM users
    WHERE id = ?
  `).get(userId);

  return mapUserRow(updated);
}

/**
 * 修改密码
 */
export async function changePassword(userId, oldPassword, newPassword) {
  const db = getDatabase();

  // 获取当前用户
  const user = db.prepare(`
    SELECT password_hash FROM users WHERE id = ?
  `).get(userId);

  if (!user) {
    throw new Error('用户不存在');
  }

  // 验证旧密码
  if (!verifyPassword(oldPassword, user.password_hash)) {
    throw new Error('原密码错误');
  }

  // 验证新密码强度
  if (!isStrongPassword(newPassword)) {
    throw new Error('新密码至少 8 位，需包含数字和字母');
  }

  // 更新密码
  const newHash = hashPassword(newPassword);
  db.prepare(`
    UPDATE users SET password_hash = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newHash, userId);

  // 删除所有 sessions（强制重新登录）
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);

  return { success: true };
}

/**
 * 扣减积分
 */
export async function deductCredits(userId, amount) {
  const db = getDatabase();

  const user = db.prepare(`
    SELECT credits FROM users WHERE id = ?
  `).get(userId);

  if (!user) {
    throw new Error('用户不存在');
  }

  if (user.credits < amount) {
    throw new Error('积分不足');
  }

  db.prepare(`
    UPDATE users SET credits = credits - ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(amount, userId);

  return { success: true, remainingCredits: user.credits - amount };
}

/**
 * 充值积分
 */
export async function rechargeCredits(userId, amount) {
  const db = getDatabase();

  db.prepare(`
    UPDATE users SET credits = credits + ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(amount, userId);

  const user = db.prepare(`SELECT credits FROM users WHERE id = ?`).get(userId);
  return { success: true, credits: user.credits };
}

/**
 * 每日签到
 */
export async function checkIn(userId) {
  const db = getDatabase();

  const today = new Date().toISOString().split('T')[0];

  // 检查今天是否已签到
  const lastCheckIn = db.prepare(`
    SELECT created_at FROM check_ins
    WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(userId);

  if (lastCheckIn) {
    const lastDate = new Date(lastCheckIn.created_at).toISOString().split('T')[0];
    if (lastDate === today) {
      throw new Error('今日已签到');
    }
  }

  // 添加签到记录
  const creditsEarned = 2; // 签到奖励 2 积分
  db.prepare(`
    INSERT INTO check_ins (user_id, credits_earned)
    VALUES (?, ?)
  `).run(userId, creditsEarned);

  // 更新用户积分
  db.prepare(`
    UPDATE users SET credits = credits + ?, last_check_in_at = datetime('now')
    WHERE id = ?
  `).run(creditsEarned, userId);

  return { success: true, creditsEarned };
}

/**
 * 获取签到状态
 */
export async function getCheckInStatus(userId) {
  const db = getDatabase();

  const today = new Date().toISOString().split('T')[0];

  const lastCheckIn = db.prepare(`
    SELECT created_at FROM check_ins
    WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(userId);

  let hasCheckedInToday = false;
  if (lastCheckIn) {
    const lastDate = new Date(lastCheckIn.created_at).toISOString().split('T')[0];
    hasCheckedInToday = lastDate === today;
  }

  return {
    hasCheckedInToday,
    totalCheckIns: db.prepare(`
      SELECT COUNT(*) as count FROM check_ins WHERE user_id = ?
    `).get(userId).count
  };
}

/**
 * 生成邮箱验证码并保存
 */
export async function generateAndSaveVerificationCode(email, purpose = 'register', requestIp = '') {
  const db = getDatabase();

  // 验证邮箱格式
  if (!isValidEmail(email)) {
    throw new Error('邮箱格式不正确');
  }

  // 检查发送频率限制（防刷）
  const now = new Date();
  const nowStr = formatDateTime(now);
  const windowStart = new Date(now.getTime() - 60 * 60 * 1000); // 1 小时内
  const windowStartStr = formatDateTime(windowStart);

  const emailCountRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM email_verification_codes
    WHERE email = ? AND purpose = ? AND created_at > ?
  `).get(email, purpose, windowStartStr);

  const ipCountRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM email_verification_codes
    WHERE request_ip = ? AND purpose = ? AND created_at > ?
  `).get(requestIp || '', purpose, windowStartStr);

  const emailCount = emailCountRow?.cnt || 0;
  const ipCount = ipCountRow?.cnt || 0;

  if (emailCount >= 5) {
    throw new Error('该邮箱发送验证码次数过多，请稍后再试');
  }
  if (ipCount >= 20) {
    throw new Error('该 IP 发送验证码次数过多，请稍后再试');
  }

  // 生成验证码和盐
  const code = generateVerificationCode();
  const salt = crypto.randomBytes(16).toString('hex');
  const codeHash = crypto.createHash('sha256').update(`${code}:${salt}`).digest('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 分钟有效

  // 保存验证码（加密存储）
  db.prepare(`
    INSERT INTO email_verification_codes (email, purpose, code_hash, salt, request_ip, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(email, purpose, codeHash, salt, requestIp, expiresAt.toISOString());

  // 发送邮件
  const sentEmail = await sendVerificationEmail(email, code);

  if (!sentEmail && process.env.NODE_ENV === 'production') {
    throw new Error('邮件服务未配置或发送失败，请联系管理员');
  }

  const payload = {
    success: true,
    delivery: sentEmail ? 'email' : 'debug',
    message: sentEmail
      ? '验证码已发送到邮箱，请注意查收'
      : '当前为开发模式，验证码已直接显示在页面中',
  };
  if (!sentEmail) {
    console.log(`[邮箱验证码] ${email}: ${code}`);
    payload.debugCode = code;
  }

  return payload;
}

/**
 * 验证邮箱验证码
 * @param {boolean} consume - 是否消耗验证码（前端验证时为 false，注册时为 true）
 */
export async function verifyEmailCode(email, code, purpose = 'register', consume = false) {
  const db = getDatabase();
  const nowStr = formatDateTime();

  // 查找未使用的验证码记录
  const record = db.prepare(`
    SELECT id, code_hash, salt, attempts, expires_at
    FROM email_verification_codes
    WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(email, purpose, nowStr);

  if (!record) {
    return { valid: false, message: '验证码已过期或不存在' };
  }

  const attempts = record.attempts || 0;
  if (attempts >= 10) {
    return { valid: false, message: '验证码已失效，请重新获取' };
  }

  // 验证验证码
  const expectedHash = crypto.createHash('sha256').update(`${code}:${record.salt}`).digest('hex');
  if (expectedHash !== record.code_hash) {
    // 验证失败，增加尝试次数
    db.prepare('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?').run(record.id);
    return { valid: false, message: '验证码错误' };
  }

  // 验证成功，如果需要则标记为已使用
  if (consume) {
    db.prepare('UPDATE email_verification_codes SET consumed_at = datetime(\'now\') WHERE id = ?').run(record.id);
  }
  return { valid: true };
}

/**
 * 检查邮箱验证码（不消耗，用于前端验证）
 */
export async function checkEmailCode(email, code, purpose = 'register') {
  return verifyEmailCode(email, code, purpose, false);
}

/**
 * 检查邮箱状态（是否已注册）
 */
export async function checkEmailStatus(email) {
  const db = getDatabase();

  const user = db.prepare(`
    SELECT id FROM users WHERE email = ?
  `).get(email);

  return {
    email,
    isRegistered: !!user
  };
}

/**
 * 管理员 - 获取用户列表
 */
export async function getUserList(page = 1, pageSize = 20, filters = {}) {
  const db = getDatabase();

  const offset = (page - 1) * pageSize;

  let whereClause = '1=1';
  const params = [];

  if (filters.role) {
    whereClause += ' AND role = ?';
    params.push(filters.role);
  }

  if (filters.status) {
    whereClause += ' AND status = ?';
    params.push(filters.status);
  }

  if (filters.email) {
    whereClause += ' AND email LIKE ?';
    params.push(`%${filters.email}%`);
  }

  const users = db.prepare(`
    SELECT id, username, email, role, status, credits, created_at, updated_at, last_check_in_at
    FROM users
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  const total = db.prepare(`
    SELECT COUNT(*) as count FROM users WHERE ${whereClause}
  `).get(...params).count;

  return {
    users,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  };
}

/**
 * 管理员 - 获取用户详情
 */
export async function getUserDetail(userId) {
  const db = getDatabase();

  const user = db.prepare(`
    SELECT id, username, email, role, status, credits, created_at, updated_at, last_check_in_at
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!user) {
    return null;
  }

  const checkInCount = db.prepare(`
    SELECT COUNT(*) as count FROM check_ins WHERE user_id = ?
  `).get(userId).count;

  return {
    ...user,
    totalCheckIns: checkInCount
  };
}

/**
 * 管理员 - 更新用户状态
 */
export async function updateUserStatus(userId, status) {
  const db = getDatabase();

  if (!['active', 'disabled'].includes(status)) {
    throw new Error('无效的状态值');
  }

  db.prepare(`
    UPDATE users SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, userId);

  return { success: true };
}

/**
 * 管理员 - 修改用户积分
 */
export async function updateUserCredits(userId, credits, operation = 'set') {
  const db = getDatabase();

  const user = db.prepare(`SELECT credits FROM users WHERE id = ?`).get(userId);
  if (!user) {
    throw new Error('用户不存在');
  }

  let newCredits;
  if (operation === 'set') {
    newCredits = credits;
  } else if (operation === 'add') {
    newCredits = user.credits + credits;
  } else if (operation === 'subtract') {
    newCredits = user.credits - credits;
  } else {
    throw new Error('无效的操作类型');
  }

  if (newCredits < 0) {
    throw new Error('积分不能为负数');
  }

  db.prepare(`
    UPDATE users SET credits = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newCredits, userId);

  return { success: true, credits: newCredits };
}

/**
 * 管理员 - 重置用户密码
 */
export async function resetUserPassword(userId, newPassword) {
  const db = getDatabase();

  if (!isStrongPassword(newPassword)) {
    throw new Error('密码至少 8 位，需包含数字和字母');
  }

  const passwordHash = hashPassword(newPassword);

  db.prepare(`
    UPDATE users SET password_hash = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(passwordHash, userId);

  // 删除所有 sessions
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);

  return { success: true };
}

/**
 * 管理员 - 删除用户
 */
export async function deleteUser(userId, operatorUserId = null) {
  const db = getDatabase();
  const normalizedUserId = Number(userId);
  const normalizedOperatorId = Number(operatorUserId);

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error('无效的用户 ID');
  }

  if (Number.isFinite(normalizedOperatorId) && normalizedUserId === normalizedOperatorId) {
    throw new Error('不能删除当前登录的管理员账号');
  }

  const user = db.prepare(`
    SELECT id, username, email, role
    FROM users
    WHERE id = ?
  `).get(normalizedUserId);

  if (!user) {
    throw new Error('用户不存在');
  }

  const projectIds = db.prepare(`
    SELECT id FROM projects WHERE user_id = ?
  `).all(normalizedUserId).map((row) => row.id);

  const removeUserTransaction = db.transaction(() => {
    if (projectIds.length > 0) {
      const placeholders = projectIds.map(() => '?').join(', ');
      db.prepare(`
        DELETE FROM schedules
        WHERE project_id IN (${placeholders})
      `).run(...projectIds);
    }

    db.prepare(`DELETE FROM tasks WHERE user_id = ?`).run(normalizedUserId);
    db.prepare(`DELETE FROM projects WHERE user_id = ?`).run(normalizedUserId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(normalizedUserId);
  });

  removeUserTransaction();

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
  };
}

/**
 * 管理员 - 获取系统统计
 */
export async function getSystemStats() {
  const db = getDatabase();

  const stats = {
    totalUsers: db.prepare(`SELECT COUNT(*) as count FROM users`).get().count,
    activeUsers: db.prepare(`SELECT COUNT(*) as count FROM users WHERE status = 'active'`).get().count,
    totalProjects: db.prepare(`SELECT COUNT(*) as count FROM projects`).get().count,
    totalTasks: db.prepare(`SELECT COUNT(*) as count FROM tasks`).get().count,
    todayCheckIns: db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count FROM check_ins
      WHERE date(created_at) = date('now')
    `).get().count,
    totalCreditsIssued: db.prepare(`SELECT SUM(credits) as total FROM users`).get().total || 0
  };

  return stats;
}

/**
 * 重置邮件传输器缓存（用于配置更新后）
 */
export function resetMailTransporterCache() {
  cachedMailTransporter = null;
  cachedMailTransporterKey = '';
}
