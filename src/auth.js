import {
  randomBytes,
  timingSafeEqual
} from 'node:crypto';
import { isIP } from 'node:net';
import {
  audit,
  getRawAccount,
  getSetting,
  hashPassword,
  mapAccount,
  nowIso,
  verifyPassword,
  withTransaction
} from './db.js';

export const SESSION_COOKIE = 'tp_session';
export const SESSION_IDLE_MINUTES = 30;
export const SESSION_ABSOLUTE_HOURS = 12;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 10;

export class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function passwordPolicyError(password) {
  const value = String(password || '');
  if (value.length < 8) return '口令长度不少于 8 位';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return '口令必须同时包含字母与数字';
  }
  if (value.length > 128) return '口令长度不能超过 128 位';
  return null;
}

export function parseCookies(req) {
  const result = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

export function serializeSessionCookie(token, secure = false) {
  const maxAge = SESSION_ABSOLUTE_HOURS * 60 * 60;
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : null
  ].filter(Boolean).join('; ');
}

export function clearSessionCookie(secure = false) {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    secure ? 'Secure' : null
  ].filter(Boolean).join('; ');
}

function normalizeIp(value) {
  const text = String(value || '').trim();
  return text.startsWith('::ffff:') ? text.slice(7) : text;
}

function ipv4Number(value) {
  const parts = normalizeIp(value).split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return null;
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function matchesProxyEntry(address, entry) {
  const candidate = String(entry || '').trim();
  if (!candidate) return false;
  if (candidate === '*') return true;
  if (!candidate.includes('/')) {
    return normalizeIp(address) === normalizeIp(candidate);
  }
  const [network, prefixText] = candidate.split('/');
  const prefix = Number(prefixText);
  const networkNumber = ipv4Number(network);
  const addressNumber = ipv4Number(address);
  if (networkNumber === null || addressNumber === null
    || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (addressNumber & mask) === (networkNumber & mask);
}

function trustedProxyEntries(value) {
  if (!value) return [];
  if (value === true) return ['*'];
  if (String(value).toLowerCase() === 'true') return ['*'];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * X-Forwarded-For is ignored unless TRUST_PROXY explicitly names a proxy.
 * This prevents clients from forging audit source addresses in direct deployments.
 */
export function clientIp(req, trustProxy = '') {
  const remote = normalizeIp(req.socket?.remoteAddress || '');
  const trusted = trustedProxyEntries(trustProxy);
  if (!trusted.length || !remote) return remote;

  const trustedAll = trusted.includes('*');
  if (!trustedAll && !trusted.some((entry) => matchesProxyEntry(remote, entry))) {
    return remote;
  }

  const chain = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((item) => normalizeIp(item))
    .filter((item) => isIP(item));
  if (!chain.length) return remote;
  if (trustedAll) return chain[0];

  const candidates = [...chain, remote];
  for (let index = candidates.length - 2; index >= 0; index -= 1) {
    const address = candidates[index];
    if (!trusted.some((entry) => matchesProxyEntry(address, entry))) return address;
  }
  return chain[0];
}

function csrfMatches(expected, actual) {
  if (!expected || !actual) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(actual));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSession(db, userId, req, options = {}) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000;
  db.prepare(`
    INSERT INTO sessions (
      id, user_id, csrf_token, created_at, last_seen, expires_at, ip, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    token,
    userId,
    csrfToken,
    now,
    now,
    expiresAt,
    clientIp(req, options.trustProxy),
    String(req.headers['user-agent'] || '').slice(0, 500)
  );
  return {
    id: token,
    userId,
    csrfToken,
    createdAt: now,
    lastSeen: now,
    expiresAt,
    idleMinutes: Math.max(1, Number(getSetting(db, 'sessionIdleMinutes', SESSION_IDLE_MINUTES)))
  };
}

export function readSession(db, req, options = {}) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;

  const now = Date.now();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(token);
  if (!row) return null;
  const idleMinutes = Math.max(
    1,
    Number(getSetting(db, 'sessionIdleMinutes', SESSION_IDLE_MINUTES))
  );

  if (row.expires_at <= now || row.last_seen + idleMinutes * 60 * 1000 <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
    return null;
  }

  if (options.touch !== false) {
    db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now, token);
  }

  return {
    id: row.id,
    userId: row.user_id,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    lastSeen: options.touch === false ? row.last_seen : now,
    expiresAt: row.expires_at,
    idleMinutes
  };
}

export function destroySession(db, req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
}

export function authenticate(db, req, options = {}) {
  const session = readSession(db, req, options);
  if (!session) return null;
  const raw = getRawAccount(db, session.userId);
  if (!raw || raw.status !== '启用') {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    return null;
  }
  return {
    user: mapAccount(raw),
    session,
    ip: clientIp(req, options.trustProxy)
  };
}

export function requireAuth(db, req, options = {}) {
  const actor = authenticate(db, req, options);
  if (!actor) {
    throw new HttpError(401, 'AUTH_REQUIRED', '登录状态已失效，请重新登录');
  }
  return actor;
}

export function requirePermission(actor, permission) {
  if (!actor?.user?.permissions?.includes(permission)) {
    throw new HttpError(403, 'FORBIDDEN', '当前账号无权执行此操作');
  }
}

export function requireRole(actor, roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(actor?.user?.role)) {
    throw new HttpError(403, 'FORBIDDEN', '当前角色无权执行此操作');
  }
}

export function verifyCsrf(actor, req) {
  const actual = req.headers['x-csrf-token'];
  if (!csrfMatches(actor?.session?.csrfToken, actual)) {
    throw new HttpError(403, 'CSRF_INVALID', '页面安全令牌已失效，请刷新后重试');
  }
}

export function login(db, req, accountId, password, options = {}) {
  const id = String(accountId || '').trim();
  const raw = getRawAccount(db, id);
  if (!raw) {
    audit(db, null, {
      account: id || '未知账号',
      name: '未知账号',
      type: '登录失败',
      objectType: '账号',
      objectId: id,
      reason: '账号不存在',
      sourceIp: clientIp(req, options.trustProxy),
      result: '失败'
    });
    throw new HttpError(401, 'LOGIN_FAILED', '账号或口令错误');
  }

  if (raw.status === '停用' || raw.status === '已删除') {
    audit(db, null, {
      account: raw.id,
      name: raw.name,
      role: raw.role === 'admin' ? '管理员' : raw.role === 'verifier' ? '复核确认人员' : '检验人员',
      type: '登录失败',
      objectType: '账号',
      objectId: id,
      reason: '账号已停用，拒绝登录',
      sourceIp: clientIp(req, options.trustProxy),
      result: '失败'
    });
    throw new HttpError(401, 'ACCOUNT_DISABLED', '该账号已停用，无法登录');
  }

  if (raw.locked_until && Number(raw.locked_until) > Date.now()) {
    audit(db, null, {
      account: raw.id,
      name: raw.name,
      role: raw.role === 'admin' ? '管理员' : raw.role === 'verifier' ? '复核确认人员' : '检验人员',
      type: '登录失败',
      objectType: '账号',
      objectId: id,
      reason: '账号仍处于锁定期',
      sourceIp: clientIp(req, options.trustProxy),
      result: '失败'
    });
    throw new HttpError(
      429,
      'ACCOUNT_LOCKED',
      `账号已锁定，请于 ${new Date(Number(raw.locked_until)).toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })} 后重试`
    );
  }
  if (raw.locked_until && Number(raw.locked_until) <= Date.now()) {
    raw.failed_attempts = 0;
    raw.locked_until = null;
    db.prepare(`
      UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?
    `).run(id);
  }

  if (!verifyPassword(password, raw.password_hash)) {
    const failures = Number(raw.failed_attempts || 0) + 1;
    const lockedUntil = failures >= MAX_FAILED_ATTEMPTS
      ? Date.now() + LOCK_MINUTES * 60 * 1000
      : null;
    withTransaction(db, () => {
      db.prepare(`
        UPDATE users
        SET failed_attempts = ?, locked_until = ?, updated_at = ?
        WHERE id = ?
      `).run(failures, lockedUntil, nowIso(), id);

      audit(db, null, {
        account: raw.id,
        name: raw.name,
        role: raw.role === 'admin' ? '管理员' : raw.role === 'verifier' ? '复核确认人员' : '检验人员',
        type: failures >= MAX_FAILED_ATTEMPTS ? '账号锁定' : '登录失败',
        objectType: '账号',
        objectId: id,
        before: '',
        after: lockedUntil ? `锁定 ${LOCK_MINUTES} 分钟` : `失败 ${failures} 次`,
        reason: '口令错误',
        sourceIp: clientIp(req, options.trustProxy),
        result: '失败'
      });
    });

    if (lockedUntil) {
      throw new HttpError(429, 'ACCOUNT_LOCKED', `连续 ${MAX_FAILED_ATTEMPTS} 次口令错误，账号已锁定 ${LOCK_MINUTES} 分钟`);
    }
    throw new HttpError(
      401,
      'LOGIN_FAILED',
      `账号或口令错误（第 ${failures} 次 / 共 ${MAX_FAILED_ATTEMPTS} 次）`
    );
  }

  let fresh;
  let session;
  let actor;
  withTransaction(db, () => {
    db.prepare(`
      UPDATE users
      SET failed_attempts = 0, locked_until = NULL, last_login = ?, updated_at = ?
      WHERE id = ?
    `).run(new Date().toLocaleString('sv-SE', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).replace('T', ' '), nowIso(), id);

    fresh = mapAccount(getRawAccount(db, id));
    session = createSession(db, id, req, options);
    actor = {
      user: fresh,
      session,
      ip: clientIp(req, options.trustProxy)
    };
    audit(db, actor, {
      type: '登录成功',
      objectType: '账号',
      objectId: id,
      reason: fresh.mustChangePassword ? '首次登录，需强制修改口令' : '',
      result: '成功'
    });
  });

  return { actor, user: fresh };
}

export function changePassword(db, actor, oldPassword, newPassword) {
  const raw = getRawAccount(db, actor.user.id);
  if (!raw) throw new HttpError(404, 'NOT_FOUND', '账号不存在');
  if (!verifyPassword(oldPassword, raw.password_hash)) {
    throw new HttpError(400, 'PASSWORD_MISMATCH', '当前口令不正确');
  }
  const policyError = passwordPolicyError(newPassword);
  if (policyError) throw new HttpError(400, 'PASSWORD_POLICY', policyError);
  if (verifyPassword(newPassword, raw.password_hash)) {
    throw new HttpError(400, 'PASSWORD_REUSED', '新口令不能与当前口令相同');
  }

  const hash = hashPassword(newPassword);
  withTransaction(db, () => {
    db.prepare(`
      UPDATE users
      SET password_hash = ?, must_change_password = 0, failed_attempts = 0,
          locked_until = NULL, updated_at = ?
      WHERE id = ?
    `).run(hash, nowIso(), actor.user.id);
    audit(db, actor, {
      type: '口令修改',
      objectType: '账号',
      objectId: actor.user.id,
      after: '已修改',
      reason: '用户可以修改口令并清除首次登录标记',
      result: '成功'
    });
  });
}

export function logout(db, actor, req) {
  withTransaction(db, () => {
    if (actor) {
      audit(db, actor, {
        type: '登出',
        objectType: '账号',
        objectId: actor.user.id,
        reason: '用户主动退出',
        result: '成功'
      });
    }
    destroySession(db, req);
  });
}

export function publicSession(actor) {
  return {
    user: actor.user,
    csrfToken: actor.session.csrfToken,
    session: {
      lastSeen: actor.session.lastSeen,
      expiresAt: actor.session.expiresAt,
      idleMinutes: actor.session.idleMinutes || SESSION_IDLE_MINUTES
    }
  };
}

