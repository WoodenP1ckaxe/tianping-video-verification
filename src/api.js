import {
  createReadStream,
  existsSync,
  statSync
} from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  audit,
  boolInt,
  createNotification,
  getAccount,
  getAccounts,
  getAuditLogCount,
  getAuditLogs,
  getBackups,
  getDevice,
  getDevices,
  getDefaultTemplate,
  getDictionaryItem,
  getDictionaryItems,
  getExports,
  getQueueStats,
  getRawAccount,
  getRawRecord,
  getRecord,
  getRecordCount,
  getRecords,
  getSetting,
  getTask,
  getTasks,
  getTemplate,
  getTemplateVersions,
  getWeightBox,
  getWeightBoxes,
  hashPassword,
  jsonParse,
  jsonString,
  mapAccount,
  markAllNotificationsRead,
  markNotificationRead,
  nowDateTime,
  nowIso,
  getNotificationCount,
  getNotifications,
  setSetting,
  withTransaction
} from './db.js';
import {
  HttpError,
  SESSION_COOKIE,
  authenticate,
  changePassword,
  clearSessionCookie,
  clientIp,
  login,
  logout,
  publicSession,
  passwordPolicyError,
  requireAuth,
  requirePermission,
  requireRole,
  serializeSessionCookie,
  verifyCsrf
} from './auth.js';
import { getAnalyzerStatus } from './services/analyzer.js';
import { getPdfExportStatus } from './services/exporter.js';
import {
  evaluateAndSnapshot,
  recordDevice,
  recordTolerance,
  snapshotEvaluation,
  storedJudgment
} from './services/judgments.js';
import { getPdfPreviewStatus } from './services/pdf-preview.js';
import { APP_VERSION } from './version.js';
import {
  isValidCalendarDate,
  isValidDateTimeMinute
} from './time.js';

const JSON_LIMIT = 2 * 1024 * 1024;
const EXPORT_LIMIT = 1000;
let ntpProbeCache = null;

function sendJson(res, status, body, extraHeaders = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(json);
}

function sendError(res, error) {
  if (res.headersSent) {
    res.destroy(error);
    return;
  }
  const status = Number.isInteger(error?.httpStatus)
    ? error.httpStatus
    : Number.isInteger(error?.status)
      ? error.status
      : 500;
  const code = error?.code || 'INTERNAL_ERROR';
  const message = status >= 500 && !(error instanceof HttpError)
    ? '服务器处理请求时发生错误'
    : String(error?.message || '请求失败');
  sendJson(res, status, {
    error: {
      code,
      message,
      details: error instanceof HttpError || error?.exposeDetails === true
        ? (error?.details ?? null)
        : null
    }
  });
}

async function readJson(req, limit = JSON_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new HttpError(413, 'BODY_TOO_LARGE', '请求内容过大');
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(
        400,
        'INVALID_JSON',
        '请求内容必须是 JSON 对象'
      );
    }
    return value;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求内容不是有效 JSON');
  }
}

function queryObject(url) {
  return Object.fromEntries(url.searchParams.entries());
}

function boolQuery(value) {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

function requireString(value, label, maxLength = 2000) {
  const text = String(value ?? '').trim();
  if (!text) throw new HttpError(400, 'VALIDATION_ERROR', `${label}不能为空`);
  if (text.length > maxLength) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${label}不能超过 ${maxLength} 个字符`);
  }
  return text;
}

function optionalString(value, label, maxLength = 1000) {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${label}不能超过 ${maxLength} 个字符`);
  }
  return text;
}

function stringList(value) {
  const source = Array.isArray(value) ? value : (value ? [value] : []);
  return [...new Set(source.flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean))];
}

function newTemporaryPassword() {
  return `Tp-${randomBytes(15).toString('base64url')}-9a`;
}

function normalizeDate(value, label) {
  const text = String(value || '');
  if (!isValidCalendarDate(text)) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${label}格式应为 YYYY-MM-DD`);
  }
  return text;
}

function normalizeDateTimeMinute(value, label) {
  const text = String(value || '').trim().replace('T', ' ');
  if (!isValidDateTimeMinute(text)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `${label}格式应为 YYYY-MM-DD HH:mm`
    );
  }
  return text;
}

function decodePathSegment(value, label = '路径参数') {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, 'INVALID_PATH_ENCODING', `${label}编码无效`);
  }
}

function parsePositiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${label}必须为正整数`);
  }
  return number;
}

function requireNaturalWeek(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (start.getUTCDay() !== 1 || end.getUTCDay() !== 0) {
    throw new HttpError(
      400,
      'NATURAL_WEEK_REQUIRED',
      '周统计日期必须为同一自然周的周一至周日',
    );
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (days !== 6) {
    throw new HttpError(
      400,
      'NATURAL_WEEK_REQUIRED',
      '周统计必须覆盖且仅覆盖连续 7 天（周一至周日）',
    );
  }
  return { from, to };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function requireIsoWeek(value) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(value || ''));
  if (!match) {
    throw new HttpError(400, 'INVALID_WEEK', '请选择有效周，格式应为 YYYY-Www');
  }
  const year = Number(match[1]);
  const week = Number(match[2]);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const mondayOffset = (januaryFourth.getUTCDay() + 6) % 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - mondayOffset + (week - 1) * 7);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  if (week < 1 || week > 53 || thursday.getUTCFullYear() !== year) {
    throw new HttpError(400, 'INVALID_WEEK', '该年份不存在所选周');
  }
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    from: isoDate(monday),
    to: isoDate(sunday),
    week: `${year}-W${String(week).padStart(2, '0')}`,
  };
}

function detectNtpSync() {
  if (ntpProbeCache && Date.now() - ntpProbeCache.checkedAtMs < 60_000) {
    return ntpProbeCache.value;
  }
  let value;
  if (process.env.NTP_STATUS) {
    value = {
      status: process.env.NTP_STATUS,
      detail: process.env.NTP_STATUS_DETAIL || '由 NTP_STATUS 环境变量指定',
      checkedAt: nowDateTime()
    };
  } else if (process.platform === 'win32') {
    const result = spawnSync('w32tm', ['/query', '/status'], {
      encoding: 'buffer',
      timeout: 1500,
      windowsHide: true
    });
    const decode = (value) => {
      if (!value?.length) return '';
      try {
        return new TextDecoder('gbk').decode(value);
      } catch {
        return Buffer.from(value).toString('utf8');
      }
    };
    const rawText = `${decode(result.stdout)}\n${decode(result.stderr)}`.trim();
    const accessDenied = /拒绝访问|Access is denied|0x80070005/i.test(rawText);
    const text = accessDenied
      ? 'Windows 时间服务状态读取被系统拒绝，请由管理员检查 w32tm /query /status'
      : rawText;
    const localClock = /Local CMOS Clock|Free-running System Clock|本地 CMOS|自由运行/i.test(text);
    value = {
      status: result.status === 0 ? (localClock ? '未同步' : '已同步') : '无法探测',
      detail: text.split(/\r?\n/).filter(Boolean).slice(0, 4).join('；')
        || 'w32tm 未返回同步状态',
      checkedAt: nowDateTime()
    };
  } else {
    const result = spawnSync('timedatectl', ['show', '--property=NTPSynchronized', '--value'], {
      encoding: 'utf8',
      timeout: 1500,
      windowsHide: true
    });
    const output = String(result.stdout || '').trim().toLowerCase();
    value = {
      status: result.status === 0 ? (output === 'yes' ? '已同步' : '未同步') : '无法探测',
      detail: String(result.stderr || result.stdout || '').trim().slice(0, 500)
        || 'timedatectl 未返回同步状态',
      checkedAt: nowDateTime()
    };
  }
  ntpProbeCache = { checkedAtMs: Date.now(), value };
  return value;
}

function roleLabel(role) {
  return role === 'admin' ? '管理员' : role === 'verifier' ? '复核确认人员' : '检验人员';
}

let rulesPromise;
async function getRules() {
  rulesPromise ||= import('./rules.js');
  return rulesPromise;
}

async function evaluate(record, device, options = {}) {
  if (!record || !device) return null;
  const stored = storedJudgment(record);
  if (stored && options.refresh !== true) return stored;
  const rules = await getRules();
  const historicalDevice = recordDevice(record, device);
  const tolerance = recordTolerance(record, historicalDevice);
  const evaluation = rules.evaluateRecord(record, historicalDevice, tolerance);
  return snapshotEvaluation(evaluation);
}

function deviceForRecord(record, currentDevice) {
  return recordDevice(record, currentDevice);
}

function ensureOwner(actor, record, edit = false) {
  if (!record) throw new HttpError(404, 'RECORD_NOT_FOUND', '校验记录不存在');
  if (record.inspector !== actor.user.id) {
    throw new HttpError(403, 'FORBIDDEN', '只有记录归属检验人员可以修改或提交');
  }
  if (edit && !['待提交', '已提交'].includes(record.status)) {
    throw new HttpError(409, 'RECORD_LOCKED', '已复核确认或已作废的记录不可修改');
  }
}

function parseReadoutKey(key) {
  const match = /^I([1-3])-([1-3])$/.exec(String(key));
  if (!match) throw new HttpError(400, 'INVALID_READOUT', '读数编号应为 I1-1 至 I3-3');
  return {
    point: Number(match[1]) - 1,
    idx: Number(match[2])
  };
}

function displayDecimals(device, range) {
  const spec = Number(range) === 2 ? device?.range2 : device?.range1;
  const dmg = Number(spec?.d ?? device?.d ?? 0.1);
  if (!Number.isFinite(dmg) || dmg <= 0) return 4;
  return Math.max(0, Math.min(8, Math.ceil(-Math.log10(dmg / 1000) - 1e-10)));
}

function modifyJsonArray(db, table, column, id, updater) {
  const row = db.prepare(`SELECT ${column} FROM ${table} WHERE id = ?`).get(id);
  const items = jsonParse(row?.[column], []);
  updater(items);
  db.prepare(`UPDATE ${table} SET ${column} = ?, updated_at = ? WHERE id = ?`)
    .run(jsonString(items), nowDateTime(), id);
}

function contentTypeFor(file) {
  if (file.endsWith('.mp4')) return 'video/mp4';
  if (file.endsWith('.mov')) return 'video/quicktime';
  if (file.endsWith('.pdf')) return 'application/pdf';
  if (file.endsWith('.csv')) return 'text/csv; charset=utf-8';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  if (file.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function contentDisposition(fileName, inline = false) {
  const ascii = String(fileName).replaceAll(/[^\x20-\x7E]/g, '_').replaceAll('"', '');
  const encoded = encodeURIComponent(fileName);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function sendBuffer(res, buffer, contentType, fileName, inline = false) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Content-Disposition': contentDisposition(fileName, inline),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(buffer);
}

function pipeFile(filePath, options, res) {
  const stream = createReadStream(filePath, options);
  stream.on('error', (error) => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('文件读取失败');
    } else {
      res.destroy(error);
    }
  });
  stream.pipe(res);
}

function streamFile(req, res, filePath, inline = false, downloadName = null) {
  if (!filePath || !existsSync(filePath)) {
    throw new HttpError(404, 'FILE_NOT_FOUND', '文件不存在或已按容量策略清理');
  }
  const size = statSync(filePath).size;
  const range = req.headers.range;
  const headers = {
    'Content-Type': contentTypeFor(filePath),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=60',
    'X-Content-Type-Options': 'nosniff'
  };
  if (downloadName) {
    headers['Content-Disposition'] = contentDisposition(downloadName, inline);
  }

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) throw new HttpError(416, 'INVALID_RANGE', '视频范围请求无效');
    if (!match[1] && !match[2]) {
      throw new HttpError(416, 'INVALID_RANGE', '视频范围请求无效');
    }
    let start;
    let end;
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        throw new HttpError(416, 'INVALID_RANGE', '视频范围请求无效');
      }
      start = Math.max(0, size - suffixLength);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start > end || start >= size) {
      res.writeHead(416, {
        'Content-Range': `bytes */${size}`,
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify({
        error: {
          code: 'INVALID_RANGE',
          message: '视频范围请求无效',
          details: null
        }
      }));
      return;
    }
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1
    });
    pipeFile(filePath, { start, end }, res);
    return;
  }

  res.writeHead(200, {
    ...headers,
    'Content-Length': size
  });
  pipeFile(filePath, undefined, res);
}

function taskOwnership(actor, task) {
  return actor.user.role !== 'inspector' || task.user === actor.user.id;
}

function publicTask(task) {
  if (!task) return task;
  const { filePath, ...safe } = task;
  return {
    ...safe,
    fileAvailable: Boolean(filePath && existsSync(filePath))
  };
}

function validateDevicePayload(payload, existing = null) {
  const source = { ...(existing || {}), ...(payload || {}) };
  const ranges = Number(source.ranges ?? source.rangeCount ?? 1) === 2 ? 2 : 1;
  const range1 = source.range1 || {
    max: Number(source.max || 220),
    d: Number(source.d || 0.1)
  };
  const range2 = source.range2 || (
    ranges === 2 ? { max: Number(source.range2Max || 40), d: Number(source.range2D || 0.01) } : null
  );
  const points = Array.isArray(source.points)
    ? source.points.map(Number)
    : [source.point1, source.point2, source.point3].map(Number);
  const id = source.id
    ? requireString(source.id, '天平编号', 20)
    : null;
  const uniqueNo = requireString(source.uniqueNo, '天平唯一号', 20);
  if (!/^[A-Za-z0-9]+$/.test(uniqueNo)) {
    throw new HttpError(400, 'VALIDATION_ERROR', '天平唯一号只能包含字母与数字');
  }
  if (id && !/^[A-Za-z0-9-]+$/.test(id)) {
    throw new HttpError(400, 'VALIDATION_ERROR', '天平编号只能包含字母、数字与短横线');
  }
  if (points.length !== 3 || points.some((item) => !Number.isFinite(item) || item <= 0)) {
    throw new HttpError(400, 'VALIDATION_ERROR', '三个砝码标称点必须为正数');
  }
  if (!Number.isFinite(Number(range1.max)) || Number(range1.max) <= 0
    || !Number.isFinite(Number(range1.d)) || Number(range1.d) <= 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', '第一量程与精度必须为正数');
  }
  if (ranges === 2 && (
    !Number.isFinite(Number(range2?.max))
    || Number(range2.max) <= 0
    || !Number.isFinite(Number(range2?.d))
    || Number(range2.d) <= 0
  )) {
    throw new HttpError(400, 'VALIDATION_ERROR', '双量程天平必须填写有效的第二量程与精度');
  }
  const internalCal = source.internalCal || 'NA';
  if (!['自动触发', '手动触发', 'NA'].includes(internalCal)) {
    throw new HttpError(400, 'VALIDATION_ERROR', '内部校正方式无效');
  }
  const tol = Number(source.tol ?? 0.05);
  if (!Number.isFinite(tol) || tol <= 0 || tol > 10) {
    throw new HttpError(400, 'VALIDATION_ERROR', '容差系数必须大于 0 且不超过 10%');
  }
  return {
    ...source,
    id,
    uniqueNo,
    dept: requireString(source.dept, '科室', 100),
    ranges,
    range1: { max: Number(range1.max), d: Number(range1.d) },
    range2: ranges === 2
      ? { max: Number(range2.max), d: Number(range2.d) }
      : null,
    max: Number(range1.max),
    d: Number(range1.d),
    internalCal,
    points,
    pointRange: ranges === 2
      ? [1, 2, 2]
      : [1, 1, 1],
    tol,
    defaultBox: source.defaultBox ? String(source.defaultBox).trim().toUpperCase() : null,
    qrContent: source.qrContent === '天平唯一号' ? '天平唯一号' : '天平编号',
    status: source.status === '停用' ? '停用' : '在用',
    remark: String(source.remark || '').slice(0, 1000)
  };
}

function nextDeviceId(db) {
  const rule = db.prepare(`
    SELECT value FROM dictionary_items
    WHERE category = 'device_numbering_rule' AND status = '启用'
    ORDER BY sort_order, id LIMIT 1
  `).get()?.value || 'F{seq:03}';
  const token = /^(.*?)\{seq:(\d+)\}(.*)$/.exec(rule);
  const percent = /^(.*?)%0?(\d+)d(.*)$/.exec(rule);
  const prefix = token?.[1] ?? percent?.[1] ?? 'F';
  const width = Math.max(1, Number(token?.[2] || percent?.[2] || 3));
  const suffix = token?.[3] ?? percent?.[3] ?? '';
  const rows = db.prepare(`
    SELECT id FROM devices WHERE id LIKE ?
  `).all(`${prefix}%${suffix}`);
  const max = rows.reduce((value, row) => {
    const id = String(row.id);
    if (!id.startsWith(prefix) || !id.endsWith(suffix)) return value;
    const middle = id.slice(prefix.length, suffix ? -suffix.length : undefined);
    const match = /^\d+$/.exec(middle);
    return match ? Math.max(value, Number(middle)) : value;
  }, 0);
  return `${prefix}${String(max + 1).padStart(width, '0')}${suffix}`;
}

function nextTemplateVersion(db) {
  const row = db.prepare(`
    SELECT version FROM template_versions ORDER BY id DESC LIMIT 1
  `).get();
  const number = Number(String(row?.version || 'v0').replace(/\D/g, '')) || 0;
  return `v${number + 1}`;
}

export class ApiRouter {
  constructor({ db, config, uploads, storage, queue, logger = console }) {
    this.db = db;
    this.config = config;
    this.uploads = uploads;
    this.storage = storage;
    this.queue = queue;
    this.logger = logger;
  }

  auditQuery(actor, type, objectType, objectId, reason) {
    audit(this.db, actor, {
      type,
      objectType,
      objectId,
      reason,
      result: '成功'
    });
  }

  async handle(req, res, url) {
    const pathname = url.pathname;
    if (pathname !== '/healthz' && pathname !== '/api/health'
      && !pathname.startsWith('/api/')) return false;
    let actorForAudit = null;
    let match;

    try {
      if (req.method === 'GET' && (pathname === '/healthz' || pathname === '/api/health')) {
        let database = 'ok';
        try {
          this.db.prepare('SELECT 1').get();
        } catch {
          database = 'error';
        }
        const analyzer = getAnalyzerStatus(this.config);
        const pdfFont = getPdfExportStatus();
        const pdfPreview = getPdfPreviewStatus(this.config);
        const queue = {
          running: this.queue.running === true,
          stats: getQueueStats(this.db)
        };
        const healthy = database === 'ok'
          && analyzer.available
          && pdfFont.available
          && pdfPreview.available
          && queue.running;
        sendJson(res, healthy ? 200 : 503, {
          status: healthy ? 'ok' : 'error',
          service: 'tianping-video-verification',
          version: APP_VERSION,
          database,
          analyzer,
          pdf: {
            fontAvailable: pdfFont.available,
            previewAvailable: pdfPreview.available
          },
          queue,
          time: nowDateTime(),
          timezone: 'Asia/Shanghai'
        });
        return true;
      }

      if (req.method === 'POST' && pathname === '/api/auth/login') {
        const body = await readJson(req);
        const { actor, user } = login(
          this.db,
          req,
          body.account,
          body.password,
          {
            trustProxy: this.config.trustProxy,
            captchaToken: body.captchaToken,
            captchaAnswer: body.captchaAnswer
          }
        );
        const secure = this.config.secureCookie === true
          || (
            Boolean(this.config.trustProxy)
            && String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https'
          );
        sendJson(res, 200, {
          ...publicSession(actor),
          user
        }, {
          'Set-Cookie': serializeSessionCookie(actor.session.id, secure)
        });
        return true;
      }

      if (req.method === 'GET' && pathname === '/api/auth/captcha') {
        throw new HttpError(
          410,
          'CAPTCHA_DISABLED',
          '当前登录策略采用账号锁定，不再使用图片验证码'
        );
      }

      const actor = requireAuth(this.db, req, {
        trustProxy: this.config.trustProxy
      });
      actorForAudit = actor;
      const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
      if (mutating) verifyCsrf(actor, req);
      const passwordChangeAllowed = (
        req.method === 'POST' && pathname === '/api/auth/change-password'
      ) || (
        req.method === 'POST' && pathname === '/api/auth/logout'
      ) || (
        req.method === 'GET' && pathname === '/api/session'
      );
      if (actor.user.mustChangePassword && !passwordChangeAllowed) {
        throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', '首次登录必须先修改口令');
      }

      if (req.method === 'GET' && pathname === '/api/session') {
        sendJson(res, 200, {
          authenticated: true,
          ...publicSession(actor)
        });
        return true;
      }

      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        logout(this.db, actor, req);
        sendJson(res, 200, { ok: true }, {
          'Set-Cookie': clearSessionCookie(this.config.secureCookie === true)
        });
        return true;
      }

      if (req.method === 'POST' && pathname === '/api/auth/change-password') {
        const body = await readJson(req);
        changePassword(
          this.db,
          actor,
          requireString(body.currentPassword, '当前口令', 128),
          requireString(body.newPassword, '新口令', 128)
        );
        sendJson(res, 200, {
          ok: true,
          user: getAccount(this.db, actor.user.id)
        });
        return true;
      }

      if (req.method === 'GET' && pathname === '/api/state') {
        const state = await this.buildState(actor);
        this.auditQuery(
          actor,
          '查询记录列表',
          '校验记录',
          'state',
          `加载工作台快照，共 ${state.records.length} 条记录`,
          5 * 60_000
        );
        sendJson(res, 200, state);
        return true;
      }

      if (pathname === '/api/notifications') {
        if (req.method === 'GET') {
          const q = queryObject(url);
          const page = parsePositiveInteger(q.page, 1, '页码');
          const pageSize = Math.min(
            100,
            parsePositiveInteger(q.pageSize, 20, '每页条数')
          );
          const unread = boolQuery(q.unread) === true;
          const total = getNotificationCount(this.db, actor.user.id, { unread });
          sendJson(res, 200, {
            items: getNotifications(this.db, actor.user.id, {
              unread,
              limit: pageSize,
              offset: (page - 1) * pageSize
            }),
            total,
            unreadCount: getNotificationCount(this.db, actor.user.id, {
              unread: true
            }),
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(total / pageSize))
          });
          return true;
        }
      }

      if (req.method === 'POST' && pathname === '/api/notifications/read-all') {
        const changed = markAllNotificationsRead(this.db, actor.user.id);
        sendJson(res, 200, { ok: true, changed });
        return true;
      }

      match = /^\/api\/notifications\/(\d+)\/read$/.exec(pathname);
      if (req.method === 'POST' && match) {
        const changed = markNotificationRead(
          this.db,
          actor.user.id,
          Number(match[1])
        );
        if (!changed) {
          throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', '通知不存在或已读');
        }
        sendJson(res, 200, { ok: true });
        return true;
      }

      if (req.method === 'GET' && pathname === '/api/qr/cards.csv') {
        requireRole(actor, 'admin');
        const rows = [
          ...getAccounts(this.db)
            .filter((account) => account.role !== 'verifier')
            .map((account) => [
              '人员卡',
              account.id,
              account.name,
              roleLabel(account.role),
              account.status,
              `PERSON:${account.id}`
            ]),
          ...getDevices(this.db).map((device) => [
            '设备卡',
            device.id,
            device.uniqueNo,
            device.dept,
            device.status,
            `DEVICE:${device.id}`
          ])
        ];
        const csv = toCsv(
          ['卡片类型', '卡片编号', '姓名或唯一号', '角色或科室', '状态', '二维码内容'],
          rows
        );
        const fileName = `二维码卡片内容清单_${nowDateTime().slice(0, 10).replaceAll('-', '')}.csv`;
        audit(this.db, actor, {
          type: '导出',
          objectType: '二维码卡片',
          objectId: 'inventory',
          after: `${rows.length} 条`,
          reason: '管理员批量导出人员卡与设备卡内容清单',
          result: '成功'
        });
        sendBuffer(
          res,
          Buffer.from(`\uFEFF${csv}`, 'utf8'),
          'text/csv; charset=utf-8',
          fileName
        );
        return true;
      }

      if (req.method === 'GET' && pathname === '/api/qr/person.svg') {
        requireRole(actor, ['inspector', 'admin']);
        const requestedId = String(url.searchParams.get('account') || actor.user.id).trim();
        if (requestedId !== actor.user.id && actor.user.role !== 'admin') {
          throw new HttpError(403, 'FORBIDDEN', '检验人员只能导出本人员工二维码');
        }
        const account = getAccount(this.db, requestedId);
        if (!account || account.status !== '启用') {
          throw new HttpError(404, 'ACCOUNT_NOT_FOUND', '人员账号不存在或已停用');
        }
        if (account.role === 'verifier') {
          throw new HttpError(409, 'PERSON_QR_NOT_APPLICABLE', '复核确认人员不生成个人二维码');
        }
        const { generatePersonCardSvg } = await import('./services/qr.js');
        const fileLabel = `人员二维码_${account.id}.svg`;
        if (url.searchParams.get('download') === '1') {
          audit(this.db, actor, {
            type: '导出',
            objectType: '人员二维码',
            objectId: account.id,
            after: fileLabel,
            reason: requestedId === actor.user.id
              ? '人员导出本人身份二维码卡片'
              : '管理员导出人员身份二维码卡片',
            result: '成功'
          });
        }
        sendBuffer(
          res,
          Buffer.from(generatePersonCardSvg({
            ...account,
            roleLabel: roleLabel(account.role)
          }), 'utf8'),
          'image/svg+xml; charset=utf-8',
          fileLabel,
          url.searchParams.get('download') !== '1'
        );
        return true;
      }

      match = /^\/api\/qr\/device\/([^/]+)\.svg$/.exec(pathname);
      if (req.method === 'GET' && match) {
        requireRole(actor, ['inspector', 'verifier', 'admin']);
        const device = getDevice(this.db, decodePathSegment(match[1], '天平编号'));
        if (!device) throw new HttpError(404, 'DEVICE_NOT_FOUND', '天平档案不存在');
        const { generateDeviceCardSvg } = await import('./services/qr.js');
        const fileLabel = `天平二维码_${device.id}.svg`;
        if (url.searchParams.get('download') === '1') {
          audit(this.db, actor, {
            type: '导出',
            objectType: '天平二维码',
            objectId: device.id,
            after: fileLabel,
            reason: '用户查询并导出设备二维码卡片',
            result: '成功'
          });
        }
        sendBuffer(
          res,
          Buffer.from(generateDeviceCardSvg(device), 'utf8'),
          'image/svg+xml; charset=utf-8',
          fileLabel,
          url.searchParams.get('download') !== '1'
        );
        return true;
      }

      if (req.method === 'POST' && pathname === '/api/uploads/init') {
        requirePermission(actor, 'upload.own');
        const body = await readJson(req);
        sendJson(res, 201, this.uploads.initialize(actor, body));
        return true;
      }

      match = /^\/api\/uploads\/([^/]+)\/content$/.exec(pathname);
      if (match && req.method === 'PUT') {
        requirePermission(actor, 'upload.own');
        const result = await this.uploads.append(
          actor,
          match[1],
          req.headers['upload-offset'],
          req
        );
        sendJson(res, 200, result);
        return true;
      }

      match = /^\/api\/uploads\/([^/]+)\/confirm-time$/.exec(pathname);
      if (match && req.method === 'POST') {
        requirePermission(actor, 'upload.own');
        const body = await readJson(req);
        sendJson(res, 200, await this.uploads.confirmTime(
          actor,
          match[1],
          body.startedAt,
        ));
        return true;
      }

      match = /^\/api\/uploads\/([^/]+)$/.exec(pathname);
      if (match && req.method === 'GET') {
        requirePermission(actor, 'upload.own');
        sendJson(res, 200, this.uploads.get(actor, match[1]));
        return true;
      }
      if (match && req.method === 'DELETE') {
        requirePermission(actor, 'upload.own');
        sendJson(res, 200, this.uploads.cancel(actor, match[1]));
        return true;
      }

      if (req.method === 'GET' && pathname === '/api/tasks') {
        const q = queryObject(url);
        sendJson(res, 200, {
          items: getTasks(
            this.db,
            actor,
            q.scope === 'own' ? 'own' : 'all'
          ).map(publicTask)
        });
        return true;
      }

      match = /^\/api\/tasks\/([^/]+)\/(retry|cancel|manual-complete|purge)$/.exec(pathname);
      if (match && req.method === 'POST') {
        const task = getTask(this.db, match[1]);
        if (!task) throw new HttpError(404, 'TASK_NOT_FOUND', '分析任务不存在');
        if (match[2] === 'purge') {
          requireRole(actor, 'admin');
          const linkedRecord = this.db.prepare(
            'SELECT id FROM records WHERE task_id = ? LIMIT 1'
          ).get(task.id);
          if ((task.recordId && getRawRecord(this.db, task.recordId))
            || linkedRecord) {
            throw new HttpError(
              409,
              'TASK_HAS_RECORD',
              '任务已生成记录，只能归档记录，不能清理任务'
            );
          }
          if (!['失败', '待人工处理', '已取消'].includes(task.status)) {
            throw new HttpError(
              409,
              'TASK_NOT_PURGEABLE',
              '仅失败、待人工处理或已取消任务可以清理'
            );
          }
          if (task.filePath && existsSync(task.filePath)) {
            throw new HttpError(
              409,
              'TASK_FILE_PRESENT',
              '任务源文件仍存在，不能按无效任务清理；请先核实文件或改用取消/归档流程'
            );
          }
          const body = await readJson(req);
          const reason = requireString(body.reason, '清理理由', 1000);
          withTransaction(this.db, () => {
            this.db.prepare(
              'UPDATE uploads SET task_id = NULL WHERE task_id = ?'
            ).run(task.id);
            this.db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
            audit(this.db, actor, {
              type: '无效任务清理',
              objectType: '分析任务',
              objectId: task.id,
              before: `${task.status} / ${task.code || '无错误码'}`,
              after: '已清理',
              reason,
              result: '成功'
            });
          });
          sendJson(res, 200, { ok: true, taskId: task.id });
          return true;
        }
        const verifierRecovery = match[2] === 'retry'
          && actor.user.role === 'verifier'
          && task.status === '待人工处理'
          && actor.user.permissions.includes('masterdata.write');
        if (!verifierRecovery) requirePermission(actor, 'tasks.manage');
        if (match[2] === 'retry') {
          sendJson(res, 200, publicTask(this.queue.enqueue(task.id, actor)));
        } else if (match[2] === 'cancel') {
          sendJson(res, 200, publicTask(this.queue.cancel(task.id, actor)));
        } else {
          const body = await readJson(req);
          const record = await this.queue.manualComplete(task.id, actor, body);
          sendJson(res, 201, {
            record,
            evaluation: await evaluate(record, getDevice(this.db, record.device))
          });
        }
        return true;
      }

      match = /^\/api\/tasks\/([^/]+)$/.exec(pathname);
      if (match && req.method === 'GET') {
        const task = getTask(this.db, match[1]);
        if (!task) throw new HttpError(404, 'TASK_NOT_FOUND', '分析任务不存在');
        if (!taskOwnership(actor, task)) {
          throw new HttpError(403, 'FORBIDDEN', '只能查看本人的分析任务');
        }
        sendJson(res, 200, publicTask(task));
        return true;
      }

      if (req.method === 'GET' && pathname === '/api/records') {
        requirePermission(actor, 'records.read');
        const q = queryObject(url);
        const requestedDevices = [
          ...url.searchParams.getAll('devices'),
          ...(q.device ? [q.device] : []),
        ].flatMap((value) => String(value).split(','))
          .map((value) => value.trim())
          .filter(Boolean);
        const devices = [...new Set(requestedDevices)].slice(0, 100);
        const page = parsePositiveInteger(q.page, 1, '页码');
        const pageSize = Math.min(
          200,
          parsePositiveInteger(q.pageSize ?? q.limit, 50, '每页条数')
        );
        const filters = {
          devices: devices.length ? devices : undefined,
          inspector: q.inspector || undefined,
          from: q.from ? normalizeDate(q.from, '起始日期') : undefined,
          to: q.to ? normalizeDate(q.to, '结束日期') : undefined,
          status: q.status || undefined,
          conclusion: ['通过', '不通过'].includes(q.conclusion)
            ? q.conclusion
            : undefined,
          submittedFrom: q.submittedFrom
            ? normalizeDate(q.submittedFrom, '提交起始日期')
            : undefined,
          submittedTo: q.submittedTo
            ? normalizeDate(q.submittedTo, '提交结束日期')
            : undefined,
          includeVoided: undefined
        };
        if (filters.from && filters.to && filters.from > filters.to) {
          throw new HttpError(400, 'INVALID_DATE_RANGE', '起始日期不能晚于结束日期');
        }
        if (filters.submittedFrom && filters.submittedTo
          && filters.submittedFrom > filters.submittedTo) {
          throw new HttpError(
            400,
            'INVALID_DATE_RANGE',
            '提交起始日期不能晚于提交结束日期'
          );
        }
        const total = getRecordCount(this.db, filters);
        const records = getRecords(this.db, {
          ...filters,
          limit: pageSize,
          offset: (page - 1) * pageSize
        });
        const pageRecords = await Promise.all(records.map(async (record) => ({
          ...record,
          evaluation: await evaluate(record, getDevice(this.db, record.device))
        })));
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        this.auditQuery(
          actor,
          '查询记录列表',
          '校验记录',
          'records',
          `筛选条件 ${JSON.stringify(q)}；第 ${page}/${totalPages} 页，返回 ${pageRecords.length}/${total} 条`,
          30_000
        );
        sendJson(res, 200, {
          items: pageRecords,
          total,
          page,
          pageSize,
          totalPages
        });
        return true;
      }

      match = /^\/api\/records\/([^/]+)\/video$/.exec(pathname);
      if (match && req.method === 'GET') {
        requirePermission(actor, 'records.read');
        const record = getRecord(this.db, match[1]);
        if (!record) throw new HttpError(404, 'RECORD_NOT_FOUND', '校验记录不存在');
        const task = record.taskId ? getTask(this.db, record.taskId) : null;
        this.auditQuery(
          actor,
          '查看原始视频',
          '校验记录',
          record.id,
          '读取按记录关联的原始视频证据',
          60_000
        );
        if (!task?.filePath || !existsSync(task.filePath)) {
          throw new HttpError(410, 'VIDEO_CLEANED', '视频已按容量策略清理，记录与截图仍可查');
        }
        streamFile(req, res, task.filePath, true);
        return true;
      }

      match = /^\/api\/records\/([^/]+)\/screenshots\/([^/]+)$/.exec(pathname);
      if (match && req.method === 'GET') {
        requirePermission(actor, 'records.read');
        if (!/^(?:I[1-3]-[1-3]|R\d{1,3})\.(jpg|jpeg|png)$/i.test(match[2])) {
          throw new HttpError(400, 'INVALID_FILE', '截图文件名无效');
        }
        const record = getRecord(this.db, match[1]);
        if (!record) throw new HttpError(404, 'RECORD_NOT_FOUND', '校验记录不存在');
        this.auditQuery(
          actor,
          '查看识别截图',
          '校验记录',
          `${record.id}:${match[2]}`,
          '读取示值识别截图证据',
          60_000
        );
        const file = path.join(
          this.config.dataDir,
          'screenshots',
          record.id,
          match[2]
        );
        streamFile(req, res, file, true);
        return true;
      }

      match = /^\/api\/records\/([^/]+)\/readouts\/([^/]+)$/.exec(pathname);
      if (match && req.method === 'POST') {
        requireRole(actor, 'inspector');
        const body = await readJson(req);
        const updated = this.updateReadout(actor, match[1], match[2], body);
        sendJson(res, 200, {
          record: updated,
          evaluation: await evaluate(updated, getDevice(this.db, updated.device))
        });
        return true;
      }

      match = /^\/api\/records\/([^/]+)\/check\/([^/]+)$/.exec(pathname);
      if (match && req.method === 'POST') {
        requireRole(actor, 'inspector');
        const body = await readJson(req);
        const updated = this.checkField(
          actor,
          match[1],
          decodePathSegment(match[2], '核对字段'),
          body
        );
        sendJson(res, 200, { record: updated });
        return true;
      }

      match = /^\/api\/records\/([^/]+)\/submit$/.exec(pathname);
      if (match && req.method === 'POST') {
        requirePermission(actor, 'records.submit.own');
        const result = await this.submitRecord(actor, match[1], req);
        sendJson(res, 200, {
          ...result.record,
          record: result.record,
          evaluation: result.evaluation
        });
        return true;
      }

      match = /^\/api\/records\/([^/]+)\/confirm$/.exec(pathname);
      if (match && req.method === 'POST') {
        requirePermission(actor, 'records.verified');
        sendJson(res, 200, this.confirmRecord(actor, match[1], req));
        return true;
      }

      match = /^\/api\/records\/([^/]+)\/reject$/.exec(pathname);
      if (match && req.method === 'POST') {
        requirePermission(actor, 'records.verified');
        const body = await readJson(req);
        sendJson(res, 200, this.rejectRecord(actor, match[1], body.reason, req));
        return true;
      }

      match = /^\/api\/records\/([^/]+)\/void$/.exec(pathname);
      if (match && req.method === 'POST') {
        requirePermission(actor, 'records.void');
        const body = await readJson(req);
        sendJson(res, 200, this.voidRecord(actor, match[1], body.reason, req));
        return true;
      }

      match = /^\/api\/records\/([^/]+)$/.exec(pathname);
      if (match && req.method === 'GET') {
        requirePermission(actor, 'records.read');
        const record = getRecord(this.db, match[1]);
        if (!record) throw new HttpError(404, 'RECORD_NOT_FOUND', '校验记录不存在');
        const device = deviceForRecord(record, getDevice(this.db, record.device));
        this.auditQuery(
          actor,
          '查看记录详情',
          '校验记录',
          record.id,
          '查看判定依据、修改痕迹与追溯信息',
          60_000
        );
        sendJson(res, 200, {
          record,
          device,
          evaluation: await evaluate(record, device),
          template: getTemplate(this.db, record.templateVersion),
          task: record.taskId ? publicTask(getTask(this.db, record.taskId)) : null
        });
        return true;
      }
      if (match && req.method === 'PATCH') {
        requireRole(actor, 'inspector');
        const body = await readJson(req);
        const updated = this.updateRecordField(actor, match[1], body);
        sendJson(res, 200, {
          record: updated,
          evaluation: await evaluate(updated, getDevice(this.db, updated.device))
        });
        return true;
      }

      if (pathname === '/api/devices') {
        if (req.method === 'GET') {
          sendJson(res, 200, { items: getDevices(this.db, queryObject(url)) });
          return true;
        }
        requirePermission(actor, 'masterdata.write');
        const body = await readJson(req);
        sendJson(res, 201, this.saveDevice(actor, body, false));
        return true;
      }

      match = /^\/api\/devices\/([^/]+)$/.exec(pathname);
      if (match) {
        if (req.method === 'GET') {
          const device = getDevice(this.db, match[1]);
          if (!device) throw new HttpError(404, 'DEVICE_NOT_FOUND', '天平档案不存在');
          sendJson(res, 200, device);
          return true;
        }
        if (req.method === 'PATCH') {
          requirePermission(actor, 'masterdata.write');
          const body = await readJson(req);
          sendJson(res, 200, this.saveDevice(actor, { ...body, id: match[1] }, true));
          return true;
        }
      }

      if (pathname === '/api/weight-boxes') {
        if (req.method === 'GET') {
          sendJson(res, 200, { items: getWeightBoxes(this.db) });
          return true;
        }
        requirePermission(actor, 'masterdata.write');
        const body = await readJson(req);
        sendJson(res, 201, this.saveWeightBox(actor, body, false));
        return true;
      }

      match = /^\/api\/weight-boxes\/([^/]+)$/.exec(pathname);
      if (match && req.method === 'PATCH') {
        requirePermission(actor, 'masterdata.write');
        const body = await readJson(req);
        sendJson(res, 200, this.saveWeightBox(actor, { ...body, id: match[1] }, true));
        return true;
      }

      if (pathname === '/api/dictionaries') {
        if (req.method === 'GET') {
          sendJson(res, 200, {
            items: getDictionaryItems(this.db, queryObject(url))
          });
          return true;
        }
        requirePermission(actor, 'masterdata.write');
        const body = await readJson(req);
        sendJson(res, 201, this.saveDictionaryItem(actor, body, false));
        return true;
      }

      match = /^\/api\/dictionaries\/([^/]+)$/.exec(pathname);
      if (match && req.method === 'PATCH') {
        requirePermission(actor, 'masterdata.write');
        const body = await readJson(req);
        sendJson(res, 200, this.saveDictionaryItem(actor, body, Number(match[1])));
        return true;
      }

      if (pathname === '/api/templates') {
        if (req.method === 'GET') {
          sendJson(res, 200, {
            current: getTemplate(this.db),
            versions: getTemplateVersions(this.db)
          });
          return true;
        }
        requirePermission(actor, 'template.write');
        const body = await readJson(req);
        sendJson(res, 201, this.saveTemplate(actor, body));
        return true;
      }

      if (pathname === '/api/accounts') {
        if (req.method === 'GET') {
          requirePermission(actor, 'accounts.write');
          sendJson(res, 200, { items: getAccounts(this.db) });
          return true;
        }
        requirePermission(actor, 'accounts.write');
        const body = await readJson(req);
        sendJson(res, 201, this.saveAccount(actor, body, false));
        return true;
      }

      match = /^\/api\/accounts\/([^/]+)$/.exec(pathname);
      if (match) {
        requirePermission(actor, 'accounts.write');
        if (req.method === 'PATCH') {
          const body = await readJson(req);
          sendJson(res, 200, this.saveAccount(actor, { ...body, id: match[1] }, true));
          return true;
        }
        if (req.method === 'DELETE') {
          sendJson(res, 200, this.deleteAccount(actor, match[1]));
          return true;
        }
      }

      match = /^\/api\/accounts\/([^/]+)\/reset-password$/.exec(pathname);
      if (match && req.method === 'POST') {
        requirePermission(actor, 'accounts.write');
        sendJson(res, 200, this.resetPassword(actor, match[1]));
        return true;
      }

      if (req.method === 'GET' && pathname === '/api/audit') {
        requirePermission(actor, 'audit.read');
        const q = queryObject(url);
        const page = parsePositiveInteger(q.page, 1, '页码');
        const pageSize = Math.min(
          200,
          parsePositiveInteger(q.pageSize ?? q.limit, 60, '每页条数')
        );
        const filters = {
          from: q.from ? normalizeDate(q.from, '起始日期') : undefined,
          to: q.to ? normalizeDate(q.to, '结束日期') : undefined,
          account: q.account || undefined,
          type: q.type || undefined,
          objectId: q.objectId || undefined
        };
        const total = getAuditLogCount(this.db, filters);
        let rows;
        if (q.format === 'csv') {
          rows = [];
          for (let offset = 0; offset < total; offset += 5000) {
            rows.push(...getAuditLogs(this.db, {
              ...filters,
              limit: Math.min(5000, total - offset),
              offset
            }));
          }
        } else {
          rows = getAuditLogs(this.db, {
            ...filters,
            limit: pageSize,
            offset: (page - 1) * pageSize
          });
        }
        if (q.format === 'csv') {
          const csv = toCsv(
            ['时间', '操作人', '姓名', '角色', '类型', '对象类型', '对象标识', '修改前', '修改后', '理由', '来源', '结果'],
            rows.map((row) => [
              row.time, row.account, row.name, row.role, row.type, row.objType,
              row.obj, row.before, row.after, row.reason, row.ip, row.result
            ])
          );
          sendBuffer(
            res,
            Buffer.from(`\uFEFF${csv}`, 'utf8'),
            'text/csv; charset=utf-8',
            `审计日志_${nowDateTime().slice(0, 10).replaceAll('-', '')}.csv`
          );
          audit(this.db, actor, {
            type: '导出',
            objectType: '审计日志',
            objectId: '审计事件',
            after: `CSV，共 ${rows.length} 条`,
            reason: '导出审计日志',
            result: '成功'
          });
        } else {
          sendJson(res, 200, {
            items: rows,
            total,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(total / pageSize))
          });
        }
        return true;
      }

      if (pathname === '/api/system' && req.method === 'GET') {
        requirePermission(actor, 'system.read');
        sendJson(res, 200, this.systemState(actor));
        return true;
      }

      if (pathname === '/api/system/logs' && req.method === 'GET') {
        requirePermission(actor, 'system.read');
        if (!this.logger?.status || !this.logger?.tail || !this.logger?.exportText) {
          throw new HttpError(501, 'APP_LOGS_UNAVAILABLE', '当前运行环境未启用应用日志服务');
        }
        const q = queryObject(url);
        if (q.download === '1' || q.format === 'text') {
          const text = this.logger.exportText();
          const fileName = `应用日志_${nowDateTime().slice(0, 10).replaceAll('-', '')}.log`;
          audit(this.db, actor, {
            type: '导出',
            objectType: '应用日志',
            objectId: 'application',
            after: fileName,
            reason: '导出应用级运行日志',
            result: '成功'
          });
          sendBuffer(
            res,
            Buffer.from(`\uFEFF${text}`, 'utf8'),
            'text/plain; charset=utf-8',
            fileName
          );
        } else {
          sendJson(res, 200, {
            ...this.logger.status(),
            recent: this.logger.tail(Math.min(500, Number(q.limit || 100)))
          });
        }
        return true;
      }

      if (pathname === '/api/system/settings' && req.method === 'PATCH') {
        requirePermission(actor, 'system.read');
        const body = await readJson(req);
        sendJson(res, 200, this.updateSettings(actor, body));
        return true;
      }

      if (pathname === '/api/system/backup' && req.method === 'POST') {
        requirePermission(actor, 'system.read');
        sendJson(res, 201, this.storage.createBackup(actor, '手动'));
        return true;
      }

      if (pathname === '/api/system/cleanup' && req.method === 'POST') {
        requirePermission(actor, 'system.read');
        sendJson(res, 200, {
          cleaned: this.storage.enforceQuota(actor),
          storage: this.storage.getStats()
        });
        return true;
      }

      if (pathname === '/api/docs/sop.pdf' && req.method === 'GET') {
        const exporter = await import('./services/exporter.js');
        const fileName = '天平校验视频分析系统_标准操作流程.pdf';
        const buffer = exporter.generateSopPdf({ exportedAt: new Date() });
        audit(this.db, actor, {
          type: '导出',
          objectType: '操作手册',
          objectId: 'SOP',
          after: fileName,
          reason: '用户下载标准操作流程',
          result: '成功'
        });
        sendBuffer(res, Buffer.from(buffer), 'application/pdf', fileName);
        return true;
      }

      if (pathname === '/api/docs/blank.pdf' && req.method === 'GET') {
        const exporter = await import('./services/exporter.js');
        const fileName = '电子天平日常校验空白记录表.pdf';
        const buffer = exporter.generateBlankFormPdf({ exportedAt: new Date() });
        audit(this.db, actor, {
          type: '导出',
          objectType: '空白记录表',
          objectId: 'BLANK',
          after: fileName,
          reason: '用户下载空白校验记录表',
          result: '成功'
        });
        sendBuffer(res, Buffer.from(buffer), 'application/pdf', fileName);
        return true;
      }

      if (req.method === 'GET' && pathname === '/api/previews/sop.png') {
        const exporter = await import('./services/exporter.js');
        const { renderPdfPagePng } = await import('./services/pdf-preview.js');
        const png = await renderPdfPagePng(
          exporter.generateSopPdf({ exportedAt: new Date() }),
          url.searchParams.get('page'),
          this.config
        );
        sendBuffer(res, png, 'image/png', '标准操作流程_预览.png', true);
        return true;
      }

      if (req.method === 'GET' && pathname === '/api/previews/blank.png') {
        const exporter = await import('./services/exporter.js');
        const { renderPdfPagePng } = await import('./services/pdf-preview.js');
        const png = await renderPdfPagePng(
          exporter.generateBlankFormPdf({ exportedAt: new Date() }),
          url.searchParams.get('page'),
          this.config
        );
        sendBuffer(res, png, 'image/png', '空白记录表_预览.png', true);
        return true;
      }

      const previewRecordPngMatch = /^\/api\/previews\/record\/([^/]+)\.png$/.exec(pathname);
      if (req.method === 'GET' && previewRecordPngMatch) {
        requirePermission(actor, 'export.record');
        const generated = await this.handleExport(
          actor,
          res,
          `/api/exports/record/${encodeURIComponent(decodePathSegment(previewRecordPngMatch[1], '记录编号'))}`,
          {},
          { preview: true, capture: true }
        );
        const { renderPdfPagePng } = await import('./services/pdf-preview.js');
        const png = await renderPdfPagePng(
          generated.buffer,
          url.searchParams.get('page'),
          this.config
        );
        sendBuffer(res, png, 'image/png', '校验记录_预览.png', true);
        return true;
      }

      if (req.method === 'GET' && pathname === '/api/previews/week.png') {
        requirePermission(actor, 'export.record');
        const generated = await this.handleExport(
          actor,
          res,
          '/api/exports/week',
          {
            device: url.searchParams.get('device'),
            week: url.searchParams.get('week'),
            from: url.searchParams.get('from'),
            to: url.searchParams.get('to')
          },
          { preview: true, capture: true }
        );
        const { renderPdfPagePng } = await import('./services/pdf-preview.js');
        const png = await renderPdfPagePng(
          generated.buffer,
          url.searchParams.get('page'),
          this.config
        );
        sendBuffer(res, png, 'image/png', '周统计_预览.png', true);
        return true;
      }

      if (req.method === 'GET' && pathname === '/api/previews/sop.pdf') {
        const exporter = await import('./services/exporter.js');
        sendBuffer(
          res,
          Buffer.from(exporter.generateSopPdf({ exportedAt: new Date() })),
          'application/pdf',
          '天平校验视频分析系统_标准操作流程.pdf',
          true
        );
        return true;
      }

      if (req.method === 'GET' && pathname === '/api/previews/blank.pdf') {
        const exporter = await import('./services/exporter.js');
        sendBuffer(
          res,
          Buffer.from(exporter.generateBlankFormPdf({ exportedAt: new Date() })),
          'application/pdf',
          '电子天平日常校验空白记录表.pdf',
          true
        );
        return true;
      }

      const previewRecordMatch = /^\/api\/previews\/record\/([^/]+)\.pdf$/.exec(pathname);
      if (req.method === 'GET' && previewRecordMatch) {
        requirePermission(actor, 'export.record');
        await this.handleExport(
          actor,
          res,
          `/api/exports/record/${encodeURIComponent(decodePathSegment(previewRecordMatch[1], '记录编号'))}`,
          {},
          { preview: true }
        );
        return true;
      }

      if (req.method === 'GET' && pathname === '/api/previews/week.pdf') {
        requirePermission(actor, 'export.record');
        await this.handleExport(
          actor,
          res,
          '/api/exports/week',
          {
            device: url.searchParams.get('device'),
            week: url.searchParams.get('week'),
            from: url.searchParams.get('from'),
            to: url.searchParams.get('to')
          },
          { preview: true }
        );
        return true;
      }

      if (req.method === 'POST' && pathname.startsWith('/api/exports/')) {
        requirePermission(actor, 'export.record');
        const body = await readJson(req);
        await this.handleExport(actor, res, pathname, body);
        return true;
      }

      throw new HttpError(404, 'API_NOT_FOUND', '接口不存在');
    } catch (error) {
      if (!(error instanceof HttpError)) {
        this.logger.error?.('[api]', error);
      } else if (error.status === 403 && actorForAudit) {
        try {
          audit(this.db, actorForAudit, {
            type: '访问拒绝',
            objectType: '接口',
            objectId: url.pathname,
            after: '403',
            reason: error.message,
            result: '失败'
          });
        } catch {
          // Authentication/authorization failures must still return a response.
        }
      }
      sendError(res, error);
      return true;
    }
  }

  async buildState(actor) {
    const accounts = getAccounts(this.db);
    const devices = getDevices(this.db);
    const records = getRecords(this.db, { limit: 200 });
    const recordStatusRows = this.db.prepare(`
      SELECT status, COUNT(*) AS count FROM records GROUP BY status
    `).all();
    const recordStatus = Object.fromEntries(
      recordStatusRows.map((row) => [row.status, row.count])
    );
    const todayDate = nowDateTime().slice(0, 10);
    const recordSummary = {
      total: getRecordCount(this.db),
      byStatus: recordStatus,
      today: this.db.prepare('SELECT COUNT(*) AS n FROM records WHERE date = ?').get(todayDate).n,
      ownToday: this.db.prepare(
        'SELECT COUNT(*) AS n FROM records WHERE date = ? AND inspector_id = ?'
      ).get(todayDate, actor.user.id).n,
      ownPendingDrafts: this.db.prepare(`
        SELECT COUNT(*) AS n FROM records
        WHERE status = '待提交' AND inspector_id = ?
      `).get(actor.user.id).n
    };
    const tasks = getTasks(this.db, actor, actor.user.role === 'inspector' ? 'own' : 'all');
    const evaluations = {};
    await Promise.all(records.map(async (record) => {
      const device = devices.find((item) => item.id === record.device);
      evaluations[record.id] = await evaluate(record, device);
    }));
    const canSystem = actor.user.permissions.includes('system.read');
    const canAudit = actor.user.permissions.includes('audit.read');
    const canAccounts = actor.user.permissions.includes('accounts.write');
    const notifications = getNotifications(this.db, actor.user.id, { limit: 20 });
    const unreadNotifications = getNotificationCount(
      this.db,
      actor.user.id,
      { unread: true }
    );
    return {
      user: actor.user,
      csrfToken: actor.session.csrfToken,
      accounts: canAccounts
        ? accounts
        : accounts.map(({ id, name, role, status }) => ({
          id,
          name,
          role,
          status
        })),
      devices,
      weightBoxes: getWeightBoxes(this.db),
      dictionaries: getDictionaryItems(this.db),
      records: records.map((record) => ({
        ...record,
        evaluation: evaluations[record.id]
      })),
      recordTotal: getRecordCount(this.db),
      recordSummary,
      tasks: tasks.map(publicTask),
      evaluations,
      audit: canAudit ? getAuditLogs(this.db, { limit: 100 }) : [],
      notifications,
      unreadNotifications,
      template: getTemplate(this.db),
      templateVersions: getTemplateVersions(this.db),
      exports: getExports(this.db, actor),
      storage: canSystem ? this.storage.getStats() : null,
      backups: canSystem ? getBackups(this.db) : [],
      queue: getQueueStats(this.db),
      settings: {
        confidenceThreshold: Number(getSetting(this.db, 'confidenceThreshold', 0.9)),
        capacityWarnPercent: Number(getSetting(this.db, 'capacityWarnPercent', 90)),
        videoQuotaGb: Number(getSetting(this.db, 'videoQuotaGb', 200)),
        logRetentionDays: Number(getSetting(this.db, 'logRetentionDays', 30)),
        recordRetentionYears: Number(getSetting(this.db, 'recordRetentionYears', 5)),
        sessionIdleMinutes: Number(getSetting(this.db, 'sessionIdleMinutes', 30))
      },
      system: canSystem
        ? this.systemState(actor, false)
        : {
          services: [
            { name: 'Web/应用服务', status: '运行中' },
            { name: '分析服务', status: this.queue.running ? '运行中' : '已停止' }
          ],
          queue: getQueueStats(this.db),
          env: {
            timezone: 'Asia/Shanghai',
            serverTime: nowDateTime(),
            analyzerMode: getSetting(this.db, 'analyzerMode', 'local-display-ocr')
          }
        },
      fileRules: {
        formats: ['mp4', 'mov'],
        maxSizeMB: 500,
        maxMinutes: 30,
        chunkSizeMB: 8
      },
      serverTime: nowDateTime(),
      timezone: 'Asia/Shanghai'
    };
  }

  systemState(actor, persistAudit = false) {
    let dbOk = true;
    const start = performance.now();
    try {
      this.db.prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    const dbLatency = Math.round((performance.now() - start) * 100) / 100;
    const queue = getQueueStats(this.db);
    const recentErrors = this.db.prepare(`
      SELECT time, type, object_id, reason FROM audit_logs
      WHERE result IN ('失败', '待处理')
      ORDER BY id DESC LIMIT 20
    `).all().map((row) => ({
      time: row.time,
      type: row.type,
      objectId: row.object_id,
      message: row.reason
    }));
    const analyzerMode = getSetting(this.db, 'analyzerMode', 'local-display-ocr');
    const analyzer = getAnalyzerStatus(this.config);
    const pdfPreview = getPdfPreviewStatus(this.config);
    const pdfFont = getPdfExportStatus();
    const ntp = detectNtpSync();
    if (persistAudit && actor) {
      audit(this.db, actor, {
        type: '健康检查',
        objectType: '系统',
        objectId: 'health',
        after: dbOk ? '正常' : '异常',
        reason: '管理员查看系统运行状态',
        result: dbOk ? '成功' : '失败'
      });
    }
    return {
      services: [
        { name: 'Web/应用服务', status: '运行中', detail: `Node ${process.version}` },
        {
          name: '分析服务',
          status: this.queue.running && analyzer.available ? '运行中' : '异常',
          detail: `单机串行队列；媒体工具 ${analyzer.available ? '可用' : '缺失'}；适配器 ${analyzerMode}`
        },
        {
          name: '数据库',
          status: dbOk ? '运行中' : '异常',
          detail: `SQLite；探测 ${dbLatency}ms`
        },
        {
          name: '文件存储',
          status: '运行中',
          detail: this.config.dataDir
        },
        {
          name: 'PDF 预览',
          status: pdfPreview.available ? '运行中' : '异常',
          detail: pdfPreview.available
            ? '内置 PDFium 可用'
            : 'PDF 预览组件不可用，仍可下载 PDF'
        }
      ],
      queue,
      database: { status: dbOk ? '正常' : '异常', latencyMs: dbLatency },
      storage: this.storage.getStats(),
      logs: this.logger?.status?.() || null,
      backups: getBackups(this.db).slice(0, 20),
      recentErrors,
      analyzer,
      pdf: {
        fontAvailable: pdfFont.available,
        previewAvailable: pdfPreview.available
      },
      env: {
        os: `${process.platform} ${process.arch}`,
        node: process.version,
        timezone: 'Asia/Shanghai',
        serverTime: nowDateTime(),
        uptimeSeconds: Math.round(process.uptime()),
        ntp: ntp.status,
        ntpDetail: ntp.detail,
        ntpCheckedAt: ntp.checkedAt,
        analyzerMode,
        ffprobeConfigured: Boolean(this.config.ffprobePath),
        ffmpegConfigured: Boolean(this.config.ffmpegPath)
      }
    };
  }

  updateReadout(actor, recordId, key, body) {
    const record = getRecord(this.db, recordId);
    ensureOwner(actor, record, true);
    if (record.status !== '待提交') {
      throw new HttpError(409, 'RECORD_NOT_EDITABLE', '仅待提交记录可修正识别读数');
    }
    const { point, idx } = parseReadoutKey(key);
    const valueText = body.value;
    let value = valueText === null || valueText === undefined || valueText === ''
      ? null
      : Number(valueText);
    if (value !== null && !Number.isFinite(value)) {
      throw new HttpError(400, 'INVALID_READOUT', '测量示值必须为数字或留空');
    }
    const index = record.readouts.findIndex(
      (item) => Number(item.point) === point && Number(item.idx) === idx
    );
    if (index < 0) throw new HttpError(404, 'READOUT_NOT_FOUND', '读数不存在');
    const device = deviceForRecord(record, getDevice(this.db, record.device));
    const decimals = displayDecimals(device, record.readouts[index].range);
    if (value !== null) {
      const factor = 10 ** decimals;
      value = Math.round((value + Number.EPSILON) * factor) / factor;
      if (!Number.isFinite(value)) {
        throw new HttpError(400, 'INVALID_READOUT', '测量示值超出可处理范围');
      }
      const range = Number(record.readouts[index].range) === 2 ? 2 : 1;
      const rangeMax = Number(range === 2 ? device.range2?.max : device.range1?.max);
      if (value < 0 || (Number.isFinite(rangeMax) && value > rangeMax)) {
        throw new HttpError(
          400,
          'INVALID_READOUT',
          `测量示值应在 0 至该量程 Max（${rangeMax || '未知'}g）范围内`
        );
      }
    }
    let readoutTime = record.readouts[index].time;
    if (body.time !== undefined) {
      readoutTime = normalizeDateTimeMinute(body.time, '测量时间');
    }
    const before = record.readouts[index].value;
    record.readouts[index] = {
      ...record.readouts[index],
      value,
      time: readoutTime,
      conf: value === null ? 0 : 1,
      stable: value === null ? false : true
    };
    record.checks[`RO:${key}`] = true;
    const reason = optionalString(body.reason, '修正理由', 1000);
    record.modifications.push({
      field: `测量示值(${key})`,
      before: before ?? '（缺次）',
      after: value ?? '（缺次）',
      by: actor.user.id,
      at: nowDateTime(),
      reason: reason || '（未填写）',
      stage: record.status
    });
    const judgedAt = nowDateTime();
    const judgment = evaluateAndSnapshot(
      record,
      device,
      recordTolerance(record, device),
      judgedAt
    );
    withTransaction(this.db, () => {
      this.db.prepare(`
        UPDATE records
        SET readouts_json = ?, checks_json = ?, modifications_json = ?,
            conclusion = ?, judgment_json = ?, judged_at = ?, rule_version = ?,
            tolerance_percent = ?, updated_at = ?
        WHERE id = ?
      `).run(
        jsonString(record.readouts),
        jsonString(record.checks),
        jsonString(record.modifications),
        judgment.conclusion,
        jsonString(judgment),
        judgment.judgedAt,
        judgment.ruleVersion,
        judgment.tol,
        judgedAt,
        recordId
      );
      audit(this.db, actor, {
        type: '字段修改',
        objectType: '校验记录',
        objectId: recordId,
        before: String(before ?? '（缺次）'),
        after: String(value ?? '（缺次）'),
        reason: reason || '未填写理由',
        result: '成功'
      });
    });
    return getRecord(this.db, recordId);
  }

  checkField(actor, recordId, key, body) {
    const record = getRecord(this.db, recordId);
    ensureOwner(actor, record, true);
      if (!/^RO:I[1-3]-[1-3]$/.test(key)) {
      throw new HttpError(400, 'INVALID_CHECK_KEY', '待核对字段标识无效');
    }
    record.checks[key] = true;
    const reason = optionalString(
      body.reason,
      '核对说明',
      1000
    ) || '人工核对确认低置信字段';
    withTransaction(this.db, () => {
      this.db.prepare(`
        UPDATE records SET checks_json = ?, updated_at = ? WHERE id = ?
      `).run(jsonString(record.checks), nowDateTime(), recordId);
      audit(this.db, actor, {
        type: '字段核对',
        objectType: '校验记录',
        objectId: recordId,
        after: key,
        reason,
        result: '成功'
      });
    });
    return getRecord(this.db, recordId);
  }

  updateRecordField(actor, recordId, body) {
    const record = getRecord(this.db, recordId);
    ensureOwner(actor, record, true);
    if (!['待提交', '已提交'].includes(record.status)) {
      throw new HttpError(409, 'RECORD_LOCKED', '已复核确认或已作废的记录不可修改');
    }
    if (record.status === '已提交' && body.field !== 'remark') {
      throw new HttpError(409, 'ONLY_REMARK_EDITABLE', '提交后仅备注字段可由检验人员修改');
    }
    const allowed = {
      cleanliness: '清洁',
      level: '水平调节',
      internalCal: '内部校正是否通过',
      box: '砝码盒编号',
      remark: '备注'
    };
    if (!allowed[body.field]) {
      throw new HttpError(400, 'FIELD_NOT_EDITABLE', '该字段不允许修改');
    }
    const maxLength = body.field === 'remark' ? 2000 : 100;
    let value = optionalString(body.value, allowed[body.field], maxLength);
    if (body.field === 'remark') value = value || '无';
    if (['cleanliness', 'level', 'internalCal'].includes(body.field)
      && !['是', '否', 'NA'].includes(value)) {
      throw new HttpError(400, 'INVALID_VALUE', `${allowed[body.field]}只能为是、否或 NA`);
    }
    if (body.field === 'box') {
      value = value.toUpperCase();
      if (!/^[A-Za-z0-9]{1,10}$/.test(value)) {
        throw new HttpError(400, 'INVALID_BOX', '砝码盒编号须为字母与数字组合且不超过 10 位');
      }
      if (!getWeightBox(this.db, value)) {
        if (!body.createBox) {
          throw new HttpError(409, 'BOX_NOT_FOUND', '该砝码盒不在字典中，请确认并新增', {
            code: value
          });
        }
        this.saveWeightBox(actor, {
          id: value,
          status: '启用',
          remark: '校验记录录入时经确认新增'
        }, false);
      }
    }

    const columnMap = {
      cleanliness: 'cleanliness',
      level: 'level_result',
      internalCal: 'internal_cal',
      box: 'box_id',
      remark: 'remark'
    };
    const before = record[body.field] ?? '（空）';
    if (['cleanliness', 'level', 'internalCal'].includes(body.field)) {
      record.checks[`SP:${body.field}`] = true;
    }
    const reason = optionalString(body.reason, '修改理由', 1000);
    record.modifications.push({
      field: allowed[body.field],
      before,
      after: value,
      by: actor.user.id,
      at: nowDateTime(),
      reason: reason || '（未填写）',
      stage: record.status
    });
    withTransaction(this.db, () => {
      this.db.prepare(`
        UPDATE records
        SET ${columnMap[body.field]} = ?, checks_json = ?, modifications_json = ?, updated_at = ?
        WHERE id = ?
      `).run(value, jsonString(record.checks), jsonString(record.modifications), nowDateTime(), recordId);
      if (body.field === 'box') {
        this.db.prepare('UPDATE weight_boxes SET last_use = ?, updated_at = ? WHERE id = ?')
          .run(record.date, nowDateTime(), value);
      }
      audit(this.db, actor, {
        type: '字段修改',
        objectType: '校验记录',
        objectId: recordId,
        before: String(before),
        after: String(value),
        reason: reason || '未填写理由',
        result: '成功'
      });
    });
    return getRecord(this.db, recordId);
  }

  async submitRecord(actor, recordId, req) {
    const record = getRecord(this.db, recordId);
    ensureOwner(actor, record, true);
    if (record.status !== '待提交') {
      throw new HttpError(409, 'INVALID_STATE', '仅待提交记录可以提交');
    }
    const device = deviceForRecord(record, getDevice(this.db, record.device));
    const evaluation = await evaluate(record, device, { refresh: true });
    const blockers = [];
    if (!record.box) blockers.push('砝码盒编号未填写');
    if (!record.cleanliness) blockers.push('“清洁”未确认');
    if (!record.level) blockers.push('“水平调节”未确认');
    if (!record.internalCal) blockers.push('“内部校正是否通过”未确认');
    const threshold = Number(getSetting(this.db, 'confidenceThreshold', 0.9));
    const lowReadouts = evaluation.items.filter(
      (item) => item.missing || !Number.isFinite(item.conf) || item.conf < threshold
    );
    const uncheckedReadouts = lowReadouts.filter(
      (item) => !record.checks[`RO:${item.key}`]
    );
    if (uncheckedReadouts.length) {
      blockers.push(`存在 ${uncheckedReadouts.length} 个低置信或缺失读数未核对：${uncheckedReadouts.map((item) => item.key).join('、')}`);
    }
    if (blockers.length) {
      throw new HttpError(409, 'SUBMIT_BLOCKED', '提交前校验未通过', blockers);
    }

    const time = nowDateTime();
    withTransaction(this.db, () => {
      const result = this.db.prepare(`
        UPDATE records
        SET status = '已提交', submitted_by = ?, submitted_at = ?,
            submitted_from = ?, conclusion = ?, judgment_json = ?,
            judged_at = ?, rule_version = ?, tolerance_percent = ?, updated_at = ?
        WHERE id = ? AND status = '待提交'
      `).run(
        actor.user.id,
        time,
        sourceTerminal(req, actor.ip),
        evaluation.conclusion,
        jsonString(evaluation),
        evaluation.judgedAt,
        evaluation.ruleVersion,
        evaluation.tol,
        time,
        recordId
      );
      if (!result.changes) {
        throw new HttpError(409, 'INVALID_STATE', '记录状态已变化，请刷新后重试');
      }
      audit(this.db, actor, {
        type: '记录提交',
        objectType: '校验记录',
        objectId: recordId,
        before: '待提交',
        after: '已提交',
        reason: `一键提交（电子确认）；判定结论 ${evaluation.conclusion}`,
        result: '成功'
      });
    });
    return {
      record: getRecord(this.db, recordId),
      evaluation
    };
  }

  confirmRecord(actor, recordId, req) {
    const record = getRecord(this.db, recordId);
    if (!record) throw new HttpError(404, 'RECORD_NOT_FOUND', '校验记录不存在');
    if (record.status !== '已提交') {
      throw new HttpError(409, 'INVALID_STATE', '仅已提交记录可以复核确认');
    }
    if (record.submittedBy === actor.user.id) {
      throw new HttpError(409, 'SEGREGATION_OF_DUTIES', '同一账号不得同时提交并复核确认同一条记录');
    }
    const time = nowDateTime();
    withTransaction(this.db, () => {
      const result = this.db.prepare(`
        UPDATE records
        SET status = '已复核确认', verified_by = ?, verified_at = ?,
            verified_from = ?, updated_at = ?
        WHERE id = ? AND status = '已提交'
      `).run(actor.user.id, time, sourceTerminal(req, actor.ip), time, recordId);
      if (!result.changes) {
        throw new HttpError(409, 'INVALID_STATE', '记录状态已变化，请刷新后重试');
      }
      audit(this.db, actor, {
        type: '记录复核确认',
        objectType: '校验记录',
        objectId: recordId,
        before: '已提交',
        after: '已复核确认',
        reason: '电子签名确认，记录锁定',
        result: '成功'
      });
      createNotification(this.db, {
        recipientId: record.inspector,
        type: '记录复核确认',
        title: `记录 ${record.id} 已复核确认`,
        body: `${actor.user.name} 已完成电子签名，记录字段已锁定。`,
        objectType: '校验记录',
        objectId: record.id,
        createdBy: actor.user.id,
        createdAt: time
      });
    });
    return getRecord(this.db, recordId);
  }

  rejectRecord(actor, recordId, reason, req) {
    const record = getRecord(this.db, recordId);
    if (!record) throw new HttpError(404, 'RECORD_NOT_FOUND', '校验记录不存在');
    if (record.status !== '已提交') {
      throw new HttpError(409, 'INVALID_STATE', '仅已提交记录可以退回');
    }
    const text = optionalString(reason, '退回理由', 1000);
    const time = nowDateTime();
    withTransaction(this.db, () => {
      const result = this.db.prepare(`
        UPDATE records
        SET status = '待提交', rejected_by = ?, rejected_at = ?,
            reject_reason = ?, updated_at = ?
        WHERE id = ? AND status = '已提交'
      `).run(actor.user.id, time, text || null, time, recordId);
      if (!result.changes) {
        throw new HttpError(409, 'INVALID_STATE', '记录状态已变化，请刷新后重试');
      }
      audit(this.db, actor, {
        type: '记录退回',
        objectType: '校验记录',
        objectId: recordId,
        before: '已提交',
        after: '待提交',
        reason: text || '未填写退回理由',
        result: '成功'
      });
      createNotification(this.db, {
        recipientId: record.inspector,
        type: '记录退回',
        title: `记录 ${record.id} 已退回待提交`,
        body: `${actor.user.name} 退回了记录。退回理由：${text || '未填写'}`,
        objectType: '校验记录',
        objectId: record.id,
        createdBy: actor.user.id,
        createdAt: time
      });
    });
    return getRecord(this.db, recordId);
  }

  voidRecord(actor, recordId, reason) {
    const record = getRecord(this.db, recordId);
    if (!record) throw new HttpError(404, 'RECORD_NOT_FOUND', '校验记录不存在');
    if (record.status === '已作废') {
      throw new HttpError(409, 'ALREADY_VOIDED', '该记录已作废');
    }
    const text = requireString(reason, '作废理由', 1000);
    const time = nowDateTime();
    withTransaction(this.db, () => {
      this.db.prepare(`
        UPDATE records
        SET status = '已作废', void_by = ?, void_at = ?, void_reason = ?, updated_at = ?
        WHERE id = ? AND status <> '已作废'
      `).run(actor.user.id, time, text, time, recordId);
      audit(this.db, actor, {
        type: '记录作废',
        objectType: '校验记录',
        objectId: recordId,
        before: record.status,
        after: '已作废',
        reason: text,
        result: '成功'
      });
      createNotification(this.db, {
        recipientId: record.inspector,
        type: '记录作废',
        title: `记录 ${record.id} 已作废`,
        body: `${actor.user.name} 作废了该记录。理由：${text}`,
        objectType: '校验记录',
        objectId: record.id,
        createdBy: actor.user.id,
        createdAt: time
      });
    });
    return getRecord(this.db, recordId);
  }

  saveDevice(actor, body, existing) {
    const before = existing ? getDevice(this.db, String(body.id)) : null;
    if (existing && !before) throw new HttpError(404, 'DEVICE_NOT_FOUND', '天平档案不存在');
    const device = validateDevicePayload(body, before);
    device.id ||= nextDeviceId(this.db);
    const duplicateUnique = this.db.prepare(
      'SELECT id FROM devices WHERE unique_no = ? AND id <> ?'
    ).get(device.uniqueNo, device.id);
    if (duplicateUnique) {
      throw new HttpError(409, 'DUPLICATE_UNIQUE_NO', `天平唯一号已由 ${duplicateUnique.id} 使用`);
    }
    const time = nowDateTime();
    if (before?.status === '停用' && device.status === '在用'
      && !actor.user.permissions.includes('masterdata.write')) {
      throw new HttpError(403, 'FORBIDDEN', '无权启用天平');
    }
    withTransaction(this.db, () => {
      if (before) {
        this.db.prepare(`
          UPDATE devices SET
            unique_no = ?, dept = ?, max_g = ?, d_mg = ?, range_count = ?,
            range1_max = ?, range1_d = ?, range2_max = ?, range2_d = ?,
            internal_cal = ?, point1 = ?, point2 = ?, point3 = ?,
            point_range_json = ?, tol = ?, default_box = ?, qr_content = ?,
            status = ?, remark = ?, updated_at = ?
          WHERE id = ?
        `).run(
          device.uniqueNo, device.dept, device.max, device.d, device.ranges,
          device.range1.max, device.range1.d, device.range2?.max ?? null,
          device.range2?.d ?? null, device.internalCal,
          device.points[0], device.points[1], device.points[2],
          jsonString(device.pointRange), device.tol, device.defaultBox,
          device.qrContent, device.status, device.remark, time, device.id
        );
      } else {
        this.db.prepare(`
          INSERT INTO devices (
            id, unique_no, dept, max_g, d_mg, range_count,
            range1_max, range1_d, range2_max, range2_d, internal_cal,
            point1, point2, point3, point_range_json, tol, default_box,
            qr_content, status, remark, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          device.id, device.uniqueNo, device.dept, device.max, device.d, device.ranges,
          device.range1.max, device.range1.d, device.range2?.max ?? null,
          device.range2?.d ?? null, device.internalCal,
          device.points[0], device.points[1], device.points[2],
          jsonString(device.pointRange), device.tol, device.defaultBox,
          device.qrContent, device.status, device.remark, time, time
        );
      }
      audit(this.db, actor, {
        type: '天平档案变更',
        objectType: '天平档案',
        objectId: device.id,
        before: before ? jsonString(before) : '',
        after: jsonString(device),
        reason: before ? '修改天平档案' : '新增天平档案',
        result: '成功'
      });
    });
    return getDevice(this.db, device.id);
  }

  saveWeightBox(actor, body, existing) {
    const id = requireString(body.id, '砝码盒编号', 10).toUpperCase();
    if (!/^[A-Za-z0-9]{1,10}$/.test(id)) {
      throw new HttpError(400, 'VALIDATION_ERROR', '砝码盒编号只能包含字母与数字，最多 10 位');
    }
    const before = getWeightBox(this.db, id);
    if (existing && !before) throw new HttpError(404, 'BOX_NOT_FOUND', '砝码盒不存在');
    if (!existing && before) throw new HttpError(409, 'DUPLICATE_BOX', '砝码盒编号已存在');
    const status = body.status === undefined
      ? (before?.status === '停用' ? '停用' : '启用')
      : (body.status === '停用' ? '停用' : '启用');
    const remark = String(
      body.remark === undefined ? (before?.remark || '') : body.remark
    ).slice(0, 1000);
    const time = nowDateTime();
    withTransaction(this.db, () => {
      if (before) {
        this.db.prepare(`
          UPDATE weight_boxes SET status = ?, remark = ?, updated_at = ? WHERE id = ?
        `).run(status, remark, time, id);
      } else {
        this.db.prepare(`
          INSERT INTO weight_boxes (
            id, status, remark, last_use, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, ?, ?)
        `).run(id, status, remark, time, time);
      }
      audit(this.db, actor, {
        type: '砝码盒字典变更',
        objectType: '砝码盒字典',
        objectId: id,
        before: before ? jsonString(before) : '',
        after: jsonString({ id, status, remark }),
        reason: before ? '修改砝码盒字典' : '新增砝码盒字典',
        result: '成功'
      });
    });
    return getWeightBox(this.db, id);
  }

  saveDictionaryItem(actor, body, existingId = false) {
    const before = existingId ? getDictionaryItem(this.db, existingId) : null;
    if (existingId && !before) {
      throw new HttpError(404, 'DICTIONARY_NOT_FOUND', '数据字典项不存在');
    }
    const category = String(body.category || before?.category || '');
    const labels = {
      department: '科室',
      internal_cal: '内部校正方式',
      device_numbering_rule: '天平编号规则'
    };
    if (!labels[category]) {
      throw new HttpError(400, 'INVALID_DICTIONARY_CATEGORY', '数据字典类别无效');
    }
    const value = requireString(body.value ?? before?.value, '字典值', 100);
    const label = optionalString(body.label ?? before?.label ?? value, '显示名称', 100) || value;
    const status = body.status === undefined
      ? (before?.status === '停用' ? '停用' : '启用')
      : (body.status === '停用' ? '停用' : '启用');
    const sortOrder = Number(body.sortOrder ?? before?.sortOrder ?? 100);
    if (!Number.isSafeInteger(sortOrder) || sortOrder < -10000 || sortOrder > 10000) {
      throw new HttpError(400, 'INVALID_SORT_ORDER', '排序值必须是 -10000 至 10000 的整数');
    }
    if (category === 'device_numbering_rule'
      && !/\{seq:\d+\}/.test(value)
      && !/%0?\d+d/.test(value)) {
      throw new HttpError(
        400,
        'INVALID_DEVICE_NUMBER_RULE',
        '天平编号规则必须包含 {seq:03} 或 %03d 形式的流水号占位符',
      );
    }
    const duplicate = this.db.prepare(`
      SELECT id FROM dictionary_items
      WHERE category = ? AND value = ? AND id <> ?
    `).get(category, value, before?.id || 0);
    if (duplicate) {
      throw new HttpError(409, 'DUPLICATE_DICTIONARY_ITEM', '同类别下已存在相同字典值');
    }
    const time = nowDateTime();
    let id = before?.id;
    withTransaction(this.db, () => {
      if (before) {
        this.db.prepare(`
          UPDATE dictionary_items
          SET category = ?, value = ?, label = ?, status = ?, sort_order = ?,
              remark = ?, updated_at = ?
          WHERE id = ?
        `).run(
          category,
          value,
          label,
          status,
          sortOrder,
          optionalString(body.remark ?? before.remark, '备注', 1000),
          time,
          before.id,
        );
      } else {
        const result = this.db.prepare(`
          INSERT INTO dictionary_items (
            category, value, label, status, sort_order, remark, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          category,
          value,
          label,
          status,
          sortOrder,
          optionalString(body.remark, '备注', 1000),
          time,
          time,
        );
        id = Number(result.lastInsertRowid);
      }
      if (category === 'device_numbering_rule' && status === '启用') {
        this.db.prepare(`
          UPDATE dictionary_items SET status = '停用', updated_at = ?
          WHERE category = 'device_numbering_rule' AND id <> ? AND status = '启用'
        `).run(time, id);
      }
      const after = getDictionaryItem(this.db, id);
      audit(this.db, actor, {
        type: '基础数据字典变更',
        objectType: labels[category],
        objectId: String(id),
        before: before ? jsonString(before) : '',
        after: jsonString(after),
        reason: before ? '修改数据字典项' : '新增数据字典项',
        result: '成功'
      });
    });
    return getDictionaryItem(this.db, id);
  }

  saveTemplate(actor, body) {
    const current = getTemplate(this.db);
    const reset = body.reset === true;
    const config = reset
      ? getDefaultTemplate()
      : {
        ...current,
        ...(body.config || body),
        version: undefined,
        createdAt: undefined,
        createdBy: undefined
      };
    const tol = Number(config.tol);
    if (!Number.isFinite(tol) || tol <= 0 || tol > 10) {
      throw new HttpError(400, 'INVALID_TOLERANCE', '容差系数必须大于 0 且不超过 10%');
    }
    config.tol = tol;
    config.printTime = config.printTime !== false;
    config.useTemplatePoints = config.useTemplatePoints === true;
    if (!Array.isArray(config.points) || config.points.length !== 3) {
      throw new HttpError(400, 'INVALID_TEMPLATE_POINTS', '模板标称点必须包含 L1、L2、L3 三个值');
    }
    config.points = config.points.map((value, index) => {
      const point = Number(value);
      if (!Number.isFinite(point) || point <= 0 || point > 100000) {
        throw new HttpError(400, 'INVALID_TEMPLATE_POINTS', `L${index + 1} 标称点必须为大于 0 的数值`);
      }
      return point;
    });
    config.footerNote = String(config.footerNote || '').slice(0, 2000);
    config.footerExtra = String(config.footerExtra || '').slice(0, 4000);
    if (!Array.isArray(config.fields) || !config.fields.length) {
      throw new HttpError(400, 'INVALID_TEMPLATE', '模板字段配置不能为空');
    }
    const fieldKeys = new Set();
    config.fields = config.fields.map((field, index) => {
      if (!field || typeof field !== 'object' || Array.isArray(field)) {
        throw new HttpError(
          400,
          'INVALID_TEMPLATE',
          `模板字段第 ${index + 1} 项必须是对象`
        );
      }
      const key = String(field.key || '').trim();
      const label = String(field.label || '').trim();
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) {
        throw new HttpError(
          400,
          'INVALID_TEMPLATE',
          `模板字段第 ${index + 1} 项缺少有效标识`
        );
      }
      if (!label || label.length > 100) {
        throw new HttpError(
          400,
          'INVALID_TEMPLATE',
          `模板字段 ${key} 的显示名称不能为空且不能超过 100 个字符`
        );
      }
      if (fieldKeys.has(key)) {
        throw new HttpError(400, 'INVALID_TEMPLATE', `模板字段标识重复：${key}`);
      }
      fieldKeys.add(key);
      return {
        key,
        label,
        show: field.show !== false,
        locked: field.locked === true
      };
    });
    const version = nextTemplateVersion(this.db);
    config.version = version;
    const summary = String(body.summary || (reset ? '恢复默认模板' : '模板参数调整')).slice(0, 1000);
    withTransaction(this.db, () => {
      this.db.prepare(`
        INSERT INTO template_versions (
          version, config_json, created_at, created_by, summary
        ) VALUES (?, ?, ?, ?, ?)
      `).run(version, jsonString(config), nowDateTime(), actor.user.id, summary);
      audit(this.db, actor, {
        type: '模板参数变更',
        objectType: '记录模板',
        objectId: version,
        before: jsonString(current ? {
          version: current.version,
          tol: current.tol,
          printTime: current.printTime,
          footerNote: current.footerNote,
          footerExtra: current.footerExtra,
          fields: current.fields,
          points: current.points,
          useTemplatePoints: current.useTemplatePoints
        } : null),
        after: jsonString({
          version,
          tol: config.tol,
          printTime: config.printTime,
          footerNote: config.footerNote,
          footerExtra: config.footerExtra,
          fields: config.fields,
          points: config.points,
          useTemplatePoints: config.useTemplatePoints
        }),
        reason: `${summary}；已记录配置前后差异，仅对新生成记录生效`,
        result: '成功'
      });
    });
    return getTemplate(this.db, version);
  }

  saveAccount(actor, body, existing) {
    const id = requireString(body.id, '账号编号', 20);
    if (!/^[A-Za-z0-9-]+$/.test(id)) {
      throw new HttpError(400, 'VALIDATION_ERROR', '账号编号只能包含字母、数字与短横线');
    }
    const before = getRawAccount(this.db, id);
    if (existing && !before) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
    if (!existing && before) throw new HttpError(409, 'DUPLICATE_ACCOUNT', '账号编号已存在');
    const name = requireString(body.name, '姓名', 100);
    const role = String(body.role || (before?.role || 'inspector'));
    if (!['admin', 'inspector', 'verifier'].includes(role)) {
      throw new HttpError(400, 'VALIDATION_ERROR', '角色无效');
    }
    if (before?.id === actor.user.id && role !== 'admin') {
      throw new HttpError(409, 'SELF_ROLE_CHANGE', '不能修改当前登录管理员自身的角色');
    }
    if (before?.role === 'admin' && role !== 'admin') {
      const adminCount = this.db.prepare(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = '启用'"
      ).get().n;
      if (adminCount <= 1) {
        throw new HttpError(409, 'LAST_ADMIN', '系统至少保留一个启用状态的管理员');
      }
    }
    const status = String(body.status || (before?.status === '停用' ? '停用' : '启用'));
    if (!['启用', '停用'].includes(status)) {
      throw new HttpError(400, 'VALIDATION_ERROR', '账号状态无效');
    }
    if (before?.id === actor.user.id && status !== '启用') {
      throw new HttpError(409, 'SELF_DISABLE', '不能停用当前登录账号');
    }
    const time = nowDateTime();
    let temporaryPassword = null;
    const initialPassword = before
      ? null
      : (body.initialPassword ? String(body.initialPassword) : null);
    if (!before && !initialPassword) temporaryPassword = newTemporaryPassword();
    if (!before) {
      const policyError = passwordPolicyError(initialPassword || temporaryPassword);
      if (policyError) throw new HttpError(400, 'PASSWORD_POLICY', policyError);
    }
    withTransaction(this.db, () => {
      if (before) {
        this.db.prepare(`
          UPDATE users SET name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?
        `).run(name, role, status, time, id);
      } else {
        this.db.prepare(`
          INSERT INTO users (
            id, name, role, status, password_hash, must_change_password,
            failed_attempts, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
        `).run(
          id,
          name,
          role,
          status,
          hashPassword(initialPassword || temporaryPassword),
          time,
          time
        );
      }
      audit(this.db, actor, {
        type: before ? '账号修改' : '账号新增',
        objectType: '账号',
        objectId: id,
        before: before ? `${before.name} / ${before.role} / ${before.status}` : '',
        after: `${name} / ${role} / ${status}`,
        reason: before ? '维护账号与角色' : '新增账号，首次登录强制改密',
        result: '成功'
      });
    });
    const account = getAccount(this.db, id);
    return temporaryPassword
      ? { ...account, temporaryPassword }
      : account;
  }

  deleteAccount(actor, id) {
    const before = getRawAccount(this.db, id);
    if (!before) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
    if (id === actor.user.id) {
      throw new HttpError(409, 'SELF_DELETE', '不能删除当前登录账号');
    }
    if (before.role === 'admin') {
      const adminCount = this.db.prepare(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = '启用'"
      ).get().n;
      if (adminCount <= 1) {
        throw new HttpError(409, 'LAST_ADMIN', '不能删除系统中最后一个启用的管理员');
      }
    }
    withTransaction(this.db, () => {
      this.db.prepare(`
        UPDATE users SET status = '已删除', updated_at = ? WHERE id = ?
      `).run(nowDateTime(), id);
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      audit(this.db, actor, {
        type: '账号删除',
        objectType: '账号',
        objectId: id,
        before: `${before.name} / ${before.status}`,
        after: '已删除（历史操作保留）',
        reason: '删除账号登录能力，历史记录和审计日志保持不变',
        result: '成功'
      });
    });
    return { ok: true };
  }

  resetPassword(actor, id) {
    const before = getRawAccount(this.db, id);
    if (!before) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
    const initialPassword = newTemporaryPassword();
    withTransaction(this.db, () => {
      this.db.prepare(`
        UPDATE users
        SET password_hash = ?, must_change_password = 1, failed_attempts = 0,
            locked_until = NULL, updated_at = ?
        WHERE id = ?
      `).run(hashPassword(initialPassword), nowIso(), id);
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      audit(this.db, actor, {
        type: '口令重置',
        objectType: '账号',
        objectId: id,
        after: '重置为一次性口令，首次登录强制改密',
        reason: '管理员重置口令',
        result: '成功'
      });
    });
    return {
      ok: true,
      mustChangePassword: true,
      temporaryPassword: initialPassword
    };
  }

  updateSettings(actor, body) {
    const before = this.systemState(actor, false);
    if (body.videoQuotaGb !== undefined) {
      this.storage.setQuotaGb(actor, body.videoQuotaGb);
    }
    const numericSettings = {
      capacityWarnPercent: [1, 100],
      confidenceThreshold: [0.01, 1],
      logRetentionDays: [30, 3650],
      recordRetentionYears: [5, 100],
      sessionIdleMinutes: [1, 1440]
    };
    for (const [key, range] of Object.entries(numericSettings)) {
      if (body[key] === undefined) continue;
      const value = Number(body[key]);
      if (!Number.isFinite(value) || value < range[0] || value > range[1]) {
        throw new HttpError(400, 'INVALID_SETTING', `${key} 超出允许范围`);
      }
      setSetting(this.db, key, value, actor.user.id);
    }
    if (body.logRetentionDays !== undefined && this.logger?.cleanup) {
      this.logger.cleanup(Number(body.logRetentionDays));
    }
    audit(this.db, actor, {
      type: '系统配置变更',
      objectType: '系统',
      objectId: 'settings',
      before: jsonString(before.queue),
      after: jsonString(body),
      reason: '管理员更新系统运行参数',
      result: '成功'
    });
    return this.systemState(actor, true);
  }

  async handleExport(actor, res, pathname, body, options = {}) {
    const preview = options.preview === true;
    const exporter = await import('./services/exporter.js');
    const single = /^\/api\/exports\/record\/([^/]+)$/.exec(pathname);
    if (single) {
      const record = getRecord(this.db, single[1]);
      if (!record) throw new HttpError(404, 'RECORD_NOT_FOUND', '校验记录不存在');
      const device = deviceForRecord(record, getDevice(this.db, record.device));
      const template = record.templateSnapshot?.version
        ? record.templateSnapshot
        : getTemplate(this.db, record.templateVersion);
      const watermark = record.status === '已复核确认'
        ? ''
        : record.status === '已作废' ? '已作废' : '未复核';
      const fileName = `天平校验记录_${record.device}_${record.date.replaceAll('-', '')}.pdf`;
      const buffer = exporter.generateRecordPdf(record, device, {
        template,
        evaluation: await evaluate(record, device),
        watermark,
        exportedAt: new Date(),
        generatedBy: actor.user.name,
        inspectorName: getAccount(this.db, record.inspector)?.name,
        verifierName: getAccount(this.db, record.verifiedBy)?.name
      });
      if (!preview) {
        this.storage.recordExport(actor, {
          type: '单条 PDF',
          scope: record.id,
          count: 1,
          fileName,
          watermark
        });
        audit(this.db, actor, {
          type: '导出',
          objectType: '校验记录',
          objectId: record.id,
          after: fileName,
          reason: `单条 PDF；水印：${watermark || '无'}`,
          result: '成功'
        });
      }
      if (options.capture === true) {
        return {
          buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
          fileName,
          contentType: 'application/pdf'
        };
      }
      sendBuffer(
        res,
        Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
        'application/pdf',
        fileName,
        preview || Boolean(body.inline)
      );
      return;
    }

    if (pathname === '/api/exports/records') {
      const devices = stringList(body.devices);
      const from = normalizeDate(body.from, '起始日期');
      const to = normalizeDate(body.to, '结束日期');
      if (from > to) throw new HttpError(400, 'INVALID_DATE_RANGE', '起始日期不能晚于结束日期');
      let records = getRecords(this.db, {
        from,
        to,
        devices,
        includeVoided: false
      });
      if (!body.includeUnverified) {
        records = records.filter((record) => record.status === '已复核确认');
      }
      if (!records.length) throw new HttpError(404, 'NO_EXPORT_RECORDS', '没有符合条件的记录');
      if (records.length > EXPORT_LIMIT) {
        throw new HttpError(413, 'EXPORT_TOO_LARGE', `单次最多导出 ${EXPORT_LIMIT} 条记录`);
      }
      const deviceMap = new Map();
      records.forEach((record) => {
        deviceMap.set(
          record.device,
          deviceForRecord(record, getDevice(this.db, record.device))
        );
      });
      const accountRows = getAccounts(this.db);
      const inspectorNames = Object.fromEntries(
        accountRows.map((account) => [account.id, account.name])
      );
      const exportItems = records.map((record) => ({
        record,
        device: deviceForRecord(record, getDevice(this.db, record.device)),
        template: record.templateSnapshot?.version
          ? record.templateSnapshot
          : getTemplate(this.db, record.templateVersion)
      }));
      const exportOptions = {
        devices: [...deviceMap.values()],
        exportedAt: new Date(),
        generatedBy: actor.user.name,
        inspectorNames,
        verifierNames: inspectorNames
      };
      const splitFiles = body.mode === 'per-device-day'
        || body.mode === 'split'
        || body.fileMode === 'per-device-day';
      let fileName;
      let outputBuffer;
      let contentType = 'application/pdf';
      if (splitFiles) {
        const groups = new Map();
        for (const item of exportItems) {
          const key = `${item.record.device}/${item.record.date}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(item);
        }
        const files = [...groups.values()].map((items) => {
          const record = items[0].record;
          return {
            name: `天平校验记录_${record.device}_${record.date.replaceAll('-', '')}.pdf`,
            data: exporter.generateBatchPdf(items, exportOptions)
          };
        });
        outputBuffer = exporter.generateZip(files);
        fileName = `天平校验记录分文件_${from.replaceAll('-', '')}-${to.replaceAll('-', '')}.zip`;
        contentType = 'application/zip';
      } else {
        fileName = `天平校验记录_${devices.join('-')}_${from.replaceAll('-', '')}-${to.replaceAll('-', '')}.pdf`;
        outputBuffer = exporter.generateBatchPdf(exportItems, exportOptions);
      }
      this.storage.recordExport(actor, {
        type: splitFiles ? '批量 PDF（逐台每日分文件）' : '批量 PDF（合并）',
        scope: `${devices.join('、')} / ${from} ~ ${to}`,
        count: records.length,
        fileName,
        watermark: body.includeUnverified ? '未复核记录带水印' : ''
      });
      audit(this.db, actor, {
        type: '导出',
        objectType: '校验记录',
        objectId: devices.join(','),
        after: `${fileName}，${records.length} 条`,
        reason: `批量 PDF；模式 ${splitFiles ? '逐台每日分文件' : '合并文件'}；日期 ${from} ~ ${to}`,
        result: '成功'
      });
      sendBuffer(res, Buffer.from(outputBuffer), contentType, fileName);
      return;
    }

    if (pathname === '/api/exports/week') {
      const device = getDevice(this.db, requireString(body.device, '天平编号', 20));
      if (!device) throw new HttpError(404, 'DEVICE_NOT_FOUND', '天平档案不存在');
      const selectedWeek = body.week
        ? requireIsoWeek(body.week)
        : requireNaturalWeek(
          normalizeDate(body.from, '起始日期'),
          normalizeDate(body.to, '结束日期')
        );
      const { from, to } = selectedWeek;
      const records = getRecords(this.db, { device: device.id, from, to })
        .filter((record) => record.status === '已复核确认');
      if (!records.length) throw new HttpError(404, 'NO_EXPORT_RECORDS', '所选周没有已复核确认记录');
      const accountNames = Object.fromEntries(
        getAccounts(this.db).map((account) => [account.id, account.name])
      );
      const fileName = `天平校验周统计_${device.id}_${(selectedWeek.week || from).replaceAll('-', '')}.pdf`;
      const buffer = await exporter.generateWeekPdf(records, [
        deviceForRecord(records[0], device)
      ], {
        device,
        from,
        to,
        week: selectedWeek.week || null,
        weekLabel: selectedWeek.week
          ? `${selectedWeek.week}（${from} ~ ${to}）`
          : `${from} ~ ${to}`,
        inspectorNames: accountNames,
        verifierNames: accountNames,
        exportedAt: new Date(),
        generatedBy: actor.user.name
      });
      if (!preview) {
        this.storage.recordExport(actor, {
          type: '周统计 PDF',
          scope: `${device.id} / ${selectedWeek.week || `${from} ~ ${to}`}`,
          count: records.length,
          fileName
        });
        audit(this.db, actor, {
          type: '导出',
          objectType: '校验记录',
          objectId: device.id,
          after: fileName,
          reason: `周统计 PDF；日期 ${from} ~ ${to}`,
          result: '成功'
        });
      }
      if (options.capture === true) {
        return {
          buffer: Buffer.from(buffer),
          fileName,
          contentType: 'application/pdf'
        };
      }
      sendBuffer(res, Buffer.from(buffer), 'application/pdf', fileName, preview);
      return;
    }

    if (pathname === '/api/exports/csv') {
      const type = String(body.type || 'records');
      const csvFilters = {
        from: body.from ? normalizeDate(body.from, '起始日期') : undefined,
        to: body.to ? normalizeDate(body.to, '结束日期') : undefined,
        devices: stringList(body.devices),
        inspector: body.inspector || undefined,
        status: body.status || undefined,
        conclusion: ['通过', '不通过'].includes(body.conclusion)
          ? body.conclusion
          : undefined,
        includeVoided: type === 'readouts' ? false : undefined
      };
      let headers;
      let rows;
      if (type === 'readouts') {
        headers = ['记录编号', '校验日期', '天平编号', '天平唯一号', '砝码盒编号', '检验人员', '复核确认人', '复核时间', '读数编号', '标称值(g)', '示值(g)', '时间', '是否在限内', '判定结论'];
        const candidates = getRecords(this.db, csvFilters);
        const records = [];
        for (const record of candidates) {
          const evaluation = await evaluate(record, getDevice(this.db, record.device));
          if (!csvFilters.conclusion || evaluation?.conclusion === csvFilters.conclusion) {
            records.push({ record, evaluation });
          }
        }
        rows = [];
        for (const { record, evaluation } of records) {
          const device = getDevice(this.db, record.device);
          for (const item of evaluation.items) {
            rows.push([
              record.id, record.date, record.device,
              record.deviceSnapshot?.uniqueNo || device?.uniqueNo || '',
              record.box,
              getAccount(this.db, record.inspector)?.name || record.inspector,
              getAccount(this.db, record.verifiedBy)?.name || record.verifiedBy || '',
              record.verifiedAt || '',
              item.key, item.L, item.value, item.time, item.inLimit ? '是' : '否',
              evaluation.conclusion
            ]);
          }
        }
      } else if (type === 'devices') {
        headers = ['天平编号', '天平唯一号', '科室', 'Max(g)', 'd(mg)', '量程数量', 'L1(g)', 'L2(g)', 'L3(g)', '状态', '备注'];
        rows = getDevices(this.db).map((device) => [
          device.id, device.uniqueNo, device.dept, device.max, device.d,
          device.ranges, ...device.points, device.status, device.remark
        ]);
      } else {
        headers = ['记录编号', '校验日期', '天平编号', '天平唯一号', '砝码盒编号', '检验人员', '判定结论', '复核状态', '提交时间', '复核确认人', '复核时间', '备注'];
        const records = getRecords(this.db, csvFilters);
        rows = [];
        for (const record of records) {
          const device = getDevice(this.db, record.device);
          const evaluation = await evaluate(record, device);
          if (csvFilters.conclusion && evaluation?.conclusion !== csvFilters.conclusion) continue;
          rows.push([
            record.id, record.date, record.device,
            record.deviceSnapshot?.uniqueNo || device?.uniqueNo || '',
            record.box,
            getAccount(this.db, record.inspector)?.name || record.inspector,
            evaluation.conclusion, record.status, record.submittedAt,
            getAccount(this.db, record.verifiedBy)?.name || record.verifiedBy || '',
            record.verifiedAt, record.remark || ''
          ]);
        }
      }
      const csv = toCsv(headers, rows);
      const fileName = `天平校验_${type}_${nowDateTime().slice(0, 10).replaceAll('-', '')}.csv`;
      this.storage.recordExport(actor, {
        type: 'CSV',
        scope: type,
        count: rows.length,
        fileName
      });
      audit(this.db, actor, {
        type: '导出',
        objectType: '校验记录',
        objectId: type,
        after: `${fileName}，${rows.length} 行`,
        reason: '导出 CSV',
        result: '成功'
      });
      sendBuffer(
        res,
        Buffer.from(`\uFEFF${csv}`, 'utf8'),
        'text/csv; charset=utf-8',
        fileName
      );
      return;
    }

    throw new HttpError(404, 'EXPORT_NOT_FOUND', '导出接口不存在');
  }
}

function sourceTerminal(req, ip = '') {
  const userAgent = String(req?.headers?.['user-agent'] || '');
  const platform = /Mobile|Android|iPhone|iPad/i.test(userAgent)
    ? '手机浏览器'
    : 'PC浏览器';
  return `${ip || '未知IP'} / ${platform}`;
}

function toCsv(headers, rows) {
  const escape = (value) => {
    let text = value === null || value === undefined ? '' : String(value);
    if (typeof value === 'string') {
      const normalized = text.replace(/^[\u0000-\u0020\uFEFF]+/, '');
      if (/^[=+\-@]/.test(normalized)) text = `'${text}`;
    }
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    headers.map(escape).join(','),
    ...rows.map((row) => row.map(escape).join(','))
  ].join('\r\n');
}

