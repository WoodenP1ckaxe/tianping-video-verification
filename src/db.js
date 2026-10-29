import { DatabaseSync } from 'node:sqlite';
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from 'node:crypto';
import {
  existsSync,
  mkdirSync
} from 'node:fs';
import path from 'node:path';

export const ROLE_LABELS = {
  admin: '管理员',
  inspector: '检验人员',
  verifier: '复核确认人员'
};

export const PERMISSIONS = {
  admin: [
    'tasks.all',
    'tasks.manage',
    'records.read',
    'records.void',
    'masterdata.write',
    'template.write',
    'accounts.write',
    'audit.read',
    'system.read',
    'export.record'
  ],
  inspector: [
    'upload.own',
    'tasks.own',
    'records.read',
    'records.edit.own',
    'records.submit.own',
    'export.record'
  ],
  verifier: [
    'tasks.all',
    'records.read',
    'records.verified',
    'masterdata.write',
    'template.write',
    'export.record'
  ]
};

export function nowDateTime(date = new Date()) {
  return date.toLocaleString('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).replace('T', ' ');
}

export function nowIso() {
  return new Date().toISOString();
}

export function addMinutes(dateTime, minutes) {
  const normalized = String(dateTime).replace(' ', 'T') + ':00+08:00';
  const d = new Date(normalized);
  d.setMinutes(d.getMinutes() + Number(minutes || 0));
  return nowDateTime(d);
}

export function jsonParse(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function jsonString(value) {
  return JSON.stringify(value ?? null);
}

export function boolInt(value) {
  return value ? 1 : 0;
}

export function truthy(value) {
  return value === true || value === 1 || value === '1';
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, encoded) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const expected = Buffer.from(parts[2], 'hex');
    const actual = scryptSync(String(password), Buffer.from(parts[1], 'hex'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function requestFingerprint(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

export function withTransaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'inspector', 'verifier')),
      status TEXT NOT NULL DEFAULT '启用' CHECK(status IN ('启用', '停用', '已删除')),
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,
      last_login TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      csrf_token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      unique_no TEXT NOT NULL UNIQUE,
      dept TEXT NOT NULL,
      max_g REAL NOT NULL,
      d_mg REAL NOT NULL,
      range_count INTEGER NOT NULL CHECK(range_count IN (1, 2)),
      range1_max REAL NOT NULL,
      range1_d REAL NOT NULL,
      range2_max REAL,
      range2_d REAL,
      internal_cal TEXT NOT NULL,
      point1 REAL NOT NULL,
      point2 REAL NOT NULL,
      point3 REAL NOT NULL,
      point_range_json TEXT NOT NULL,
      tol REAL NOT NULL DEFAULT 0.05,
      default_box TEXT,
      qr_content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '在用' CHECK(status IN ('在用', '停用')),
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_devices_dept_status ON devices(dept, status);

    CREATE TABLE IF NOT EXISTS weight_boxes (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT '启用' CHECK(status IN ('启用', '停用')),
      remark TEXT NOT NULL DEFAULT '',
      last_use TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS template_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL UNIQUE,
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT REFERENCES users(id),
      summary TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      original_name TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      received_bytes INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      temp_path TEXT NOT NULL,
      sha256 TEXT,
      status TEXT NOT NULL CHECK(status IN ('上传中', '校验中', '已完成', '已取消', '失败')),
      task_id TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_uploads_user_status ON uploads(user_id, status);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_path TEXT,
      size_bytes INTEGER NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      device_id TEXT REFERENCES devices(id),
      status TEXT NOT NULL CHECK(status IN (
        '排队中', '分析中', '已完成', '失败', '待人工处理', '已取消'
      )),
      started_at TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      analysis_started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      record_id TEXT,
      error_code TEXT,
      error_reason TEXT,
      sha256 TEXT,
      source_ip TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_queue ON tasks(status, queued_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, queued_at);

    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      device_id TEXT NOT NULL REFERENCES devices(id),
      inspector_id TEXT NOT NULL REFERENCES users(id),
      box_id TEXT,
      started_at TEXT NOT NULL,
      duration_seconds INTEGER,
      file_name TEXT,
      file_size_mb REAL,
      sha256 TEXT,
      status TEXT NOT NULL CHECK(status IN ('待提交', '已提交', '已复核确认', '已作废')),
      cleanliness TEXT,
      level_result TEXT,
      internal_cal TEXT,
      remark TEXT NOT NULL DEFAULT '无',
      readouts_json TEXT NOT NULL DEFAULT '[]',
      speech_json TEXT NOT NULL DEFAULT '{}',
      person_card_json TEXT NOT NULL DEFAULT '{}',
      device_card_json TEXT NOT NULL DEFAULT '{}',
      range_switch INTEGER NOT NULL DEFAULT 1,
      checks_json TEXT NOT NULL DEFAULT '{}',
      modifications_json TEXT NOT NULL DEFAULT '[]',
      template_version TEXT NOT NULL,
      tolerance_percent REAL,
      device_snapshot_json TEXT NOT NULL DEFAULT '{}',
      template_snapshot_json TEXT NOT NULL DEFAULT '{}',
      analyzed_at TEXT NOT NULL,
      task_id TEXT UNIQUE REFERENCES tasks(id),
      submitted_by TEXT REFERENCES users(id),
      submitted_at TEXT,
      submitted_from TEXT,
      verified_by TEXT REFERENCES users(id),
      verified_at TEXT,
      verified_from TEXT,
      rejected_by TEXT REFERENCES users(id),
      rejected_at TEXT,
      reject_reason TEXT,
      void_by TEXT REFERENCES users(id),
      void_at TEXT,
      void_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_records_device_date ON records(device_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_records_status ON records(status, submitted_at);
    CREATE INDEX IF NOT EXISTS idx_records_inspector ON records(inspector_id, date DESC);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL,
      account TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      type TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL DEFAULT '',
      before_value TEXT NOT NULL DEFAULT '',
      after_value TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      source_ip TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '成功',
      session_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(time DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_account_type ON audit_logs(account, type);
    CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
      BEFORE UPDATE ON audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'audit_logs are append-only');
      END;
    CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
      BEFORE DELETE ON audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'audit_logs are append-only');
      END;

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      scope TEXT NOT NULL,
      record_count INTEGER NOT NULL DEFAULT 0,
      file_name TEXT NOT NULL,
      watermark TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '成功'
    );

    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      size_bytes INTEGER,
      status TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS cleanup_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cleaned_at TEXT NOT NULL,
      file_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      reason TEXT NOT NULL
    );
  `);

  // Small migration hook for local databases produced by early builds.
  ensureColumn(db, 'tasks', 'warnings_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'records', 'checks_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'records', 'tolerance_percent', 'REAL');
  ensureColumn(db, 'records', 'device_snapshot_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'records', 'template_snapshot_json', "TEXT NOT NULL DEFAULT '{}'");
}

function insertAudit(db, entry) {
  db.prepare(`
    INSERT INTO audit_logs (
      time, account, name, role, type, object_type, object_id,
      before_value, after_value, reason, source_ip, result, session_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.time || nowDateTime(),
    entry.account || '系统',
    entry.name || '系统',
    entry.role || '系统自动',
    entry.type,
    entry.objectType || '系统',
    entry.objectId || '',
    entry.before ?? '',
    entry.after ?? '',
    entry.reason || '',
    entry.sourceIp || '',
    entry.result || '成功',
    entry.sessionId ? requestFingerprint(entry.sessionId) : null
  );
}

export function audit(db, actor, entry) {
  const user = actor?.user || actor || null;
  insertAudit(db, {
    ...entry,
    account: user?.id || entry.account || '系统',
    name: user?.name || entry.name || '系统',
    role: user ? ROLE_LABELS[user.role] : (entry.role || '系统自动'),
    sourceIp: entry.sourceIp || actor?.ip || '',
    sessionId: actor?.session?.id || null
  });
}

function defaultTemplate() {
  return {
    version: 'v1',
    tol: 0.05,
    printTime: true,
    footerNote: '注：出现异常时应在备注栏准确记录，必要时及时报修。',
    footerExtra: '判定依据：|I − L| ≤ 容差系数 × L；9 次读数全部在限内、读数稳定、顺序正确、双量程量程切换完整时判为“通过”。',
    fields: [
      { key: 'dept', label: '科室', show: true, locked: true },
      { key: 'uniqueNo', label: '天平唯一号', show: true, locked: true },
      { key: 'max', label: 'Max(g)', show: true, locked: true },
      { key: 'd', label: 'd(mg)', show: true, locked: true },
      { key: 'internalCalType', label: '内部校正方式', show: true, locked: true },
      { key: 'date', label: '校验日期', show: true, locked: true },
      { key: 'cleanliness', label: '清洁', show: true, locked: true },
      { key: 'level', label: '水平调节', show: true, locked: true },
      { key: 'internalCal', label: '内部校正是否通过', show: true, locked: true },
      { key: 'remark', label: '备注', show: true, locked: false },
      { key: 'box', label: '砝码盒编号', show: true, locked: false },
      { key: 'time', label: '测量时间', show: true, locked: false },
      { key: 'detail', label: '判定结论明细', show: true, locked: false }
    ]
  };
}

export function getDefaultTemplate() {
  return defaultTemplate();
}

function readout(point, idx, value, range = 1, conf = 0.997, stable = true, offset = 32) {
  return {
    point,
    idx,
    value,
    unit: 'g',
    off: offset,
    time: null,
    conf,
    stable,
    range,
    screenshot: ''
  };
}

function singlePassReadouts() {
  return [
    readout(0, 1, 200.0062, 1, 0.997, true, 32),
    readout(0, 2, 200.0031, 1, 0.995, true, 71),
    readout(0, 3, 199.9987, 1, 0.994, true, 110),
    readout(1, 1, 50.0002, 1, 0.996, true, 149),
    readout(1, 2, 49.9988, 1, 0.994, true, 188),
    readout(1, 3, 50.0011, 1, 0.993, true, 227),
    readout(2, 1, 10.0001, 1, 0.995, true, 266),
    readout(2, 2, 9.9994, 1, 0.993, true, 305),
    readout(2, 3, 10.0006, 1, 0.996, true, 344)
  ].map((item) => ({
    ...item,
    time: addMinutes('2026-09-28 08:31', Math.round(item.off / 60))
  }));
}

function dualPassReadouts() {
  return [
    readout(0, 1, 100.0003, 1, 0.998, true, 35),
    readout(0, 2, 100.0001, 1, 0.995, true, 76),
    readout(0, 3, 99.9998, 1, 0.993, true, 117),
    readout(1, 1, 20.00005, 2, 0.996, true, 164),
    readout(1, 2, 19.99997, 2, 0.994, true, 205),
    readout(1, 3, 20.00012, 2, 0.992, true, 246),
    readout(2, 1, 2.00001, 2, 0.991, true, 287),
    readout(2, 2, 1.99998, 2, 0.993, true, 328),
    readout(2, 3, 2.00002, 2, 0.995, true, 369)
  ].map((item) => ({
    ...item,
    time: addMinutes('2026-09-28 07:58', Math.round(item.off / 60))
  }));
}

function lowConfidenceReadouts() {
  const items = singlePassReadouts();
  items[1].value = 200.0018;
  items[1].conf = 0.735;
  items[2].value = 199.9991;
  items[2].conf = 0.681;
  items[7].conf = 0.812;
  return items;
}

function failedReadouts() {
  const items = singlePassReadouts();
  items[1].value = 200.3374;
  items[1].conf = 0.994;
  items[4].value = 49.9749;
  items[4].conf = 0.902;
  return items;
}

function seedRecord(db, record) {
  const timestamp = nowDateTime();
  const deviceSnapshot = record.deviceSnapshot || getDevice(db, record.device);
  const templateSnapshot = record.templateSnapshot || getTemplate(
    db,
    record.templateVersion || 'v1'
  );
  db.prepare(`
    INSERT OR IGNORE INTO records (
      id, date, device_id, inspector_id, box_id, started_at, duration_seconds,
      file_name, file_size_mb, sha256, status, cleanliness, level_result, internal_cal,
      remark, readouts_json, speech_json, person_card_json, device_card_json,
      range_switch, checks_json, modifications_json, template_version,
      tolerance_percent, device_snapshot_json, template_snapshot_json, analyzed_at,
      task_id, submitted_by, submitted_at, submitted_from, verified_by, verified_at,
      verified_from, rejected_by, rejected_at, reject_reason, void_by, void_at,
      void_reason, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    record.id,
    record.date,
    record.device,
    record.inspector,
    record.box,
    record.startTime,
    record.duration,
    record.file,
    record.fileSize,
    record.sha,
    record.status,
    record.cleanliness,
    record.level,
    record.internalCal,
    record.remark,
    jsonString(record.readouts),
    jsonString(record.speech || {}),
    jsonString(record.personCard || { account: record.inspector, conf: 1 }),
    jsonString(record.deviceCard || { code: record.device, conf: 1 }),
    boolInt(record.rangeSwitch !== false),
    jsonString(record.checks || {}),
    jsonString(record.modifications || []),
    record.templateVersion || 'v1',
    record.tolerancePercent ?? 0.05,
    jsonString(deviceSnapshot || {}),
    jsonString(templateSnapshot || {}),
    record.analyzedAt,
    record.taskId,
    record.submittedBy || null,
    record.submittedAt || null,
    record.submittedFrom || null,
    record.verifiedBy || null,
    record.verifiedAt || null,
    record.verifiedFrom || null,
    record.rejectedBy || null,
    record.rejectedAt || null,
    record.rejectReason || null,
    record.voidBy || null,
    record.voidAt || null,
    record.voidReason || null,
    timestamp,
    timestamp
  );
}

function seedTask(db, task) {
  const timestamp = nowDateTime();
  db.prepare(`
    INSERT OR IGNORE INTO tasks (
      id, file_name, file_path, size_bytes, user_id, device_id, status, started_at,
      queued_at, analysis_started_at, finished_at, duration_ms, record_id,
      error_code, error_reason, sha256, source_ip, retry_count, warnings_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id,
    task.file,
    task.filePath || null,
    Math.round(Number(task.size || 0) * 1024 * 1024),
    task.user,
    task.device || null,
    task.status,
    task.startTime || task.queuedAt,
    task.queuedAt,
    task.startedAt || null,
    task.finishedAt || null,
    task.durationMs || null,
    task.recordId || null,
    task.code || null,
    task.reason || null,
    task.sha || null,
    task.source || '',
    0,
    jsonString(task.warnings || []),
    timestamp,
    timestamp
  );
}

export function seedDatabase(db, config = {}) {
  const initialized = db.prepare(
    "SELECT value_json FROM settings WHERE key = 'initialized'"
  ).get();
  if (initialized) return false;

  const timestamp = nowDateTime();
  const initialPassword = config.initialPassword;
  if (typeof initialPassword !== 'string' || !initialPassword) {
    throw new Error('首次初始化数据库必须提供 INITIAL_PASSWORD');
  }
  const passwordHash = hashPassword(initialPassword);

  withTransaction(db, () => {
    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (
        id, name, role, status, password_hash, must_change_password,
        failed_attempts, last_login, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)
    `);
    [
      ['U000', '系统管理员', 'admin', '启用'],
      ['U001', '李一', 'inspector', '启用'],
      ['U002', '李二', 'inspector', '启用'],
      ['U003', '齐一', 'verifier', '启用'],
      ['U004', '王三', 'inspector', '停用']
    ].forEach(([id, name, role, status]) => {
      insertUser.run(id, name, role, status, passwordHash, timestamp, timestamp);
    });

    const insertDevice = db.prepare(`
      INSERT OR IGNORE INTO devices (
        id, unique_no, dept, max_g, d_mg, range_count,
        range1_max, range1_d, range2_max, range2_d, internal_cal,
        point1, point2, point3, point_range_json, tol, default_box,
        qr_content, status, remark, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertDevice.run(
      'F001', 'DZTP170911C', '化学室', 220, 0.1, 1,
      220, 0.1, null, null, '手动触发',
      200, 50, 10, '[1,1,1]', 0.05, 'FM2512920',
      '天平编号', '在用', 'Sartorius 七段码 LCD 显示屏', timestamp, timestamp
    );
    insertDevice.run(
      'F002', 'SJS2605002', '化学室', 120, 0.1, 2,
      120, 0.1, 40, 0.01, '自动触发',
      100, 20, 2, '[1,2,2]', 0.05, 'FM2512921',
      '天平唯一号', '在用', 'Mettler Toledo 彩色触摸屏，双量程', timestamp, timestamp
    );
    insertDevice.run(
      'F003', 'SJS2401007', '理化室', 620, 1, 1,
      620, 1, null, null, 'NA',
      500, 100, 20, '[1,1,1]', 0.05, 'FM2512922',
      '天平编号', '停用', '设备送检，停用期间不生成新记录', timestamp, timestamp
    );

    const insertBox = db.prepare(`
      INSERT OR IGNORE INTO weight_boxes (
        id, status, remark, last_use, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertBox.run('FM2512920', '启用', '200g / 50g / 10g 一组', '2026-09-28', timestamp, timestamp);
    insertBox.run('FM2512921', '启用', '100g / 20g / 2g 一组', '2026-09-28', timestamp, timestamp);
    insertBox.run('FM2512922', '启用', '500g / 100g / 20g 一组', '2026-09-19', timestamp, timestamp);
    insertBox.run('FM2410088', '停用', '砝码盒胶带磨损待送检', '2026-06-28', timestamp, timestamp);

    const template = defaultTemplate();
    db.prepare(`
      INSERT INTO template_versions (
        version, config_json, created_at, created_by, summary
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      template.version,
      jsonString(template),
      '2026-07-01 09:00',
      'U000',
      '系统初始化默认模板（与客户现行记录表一致）'
    );

    const settings = {
      initialized: true,
      videoQuotaGb: 200,
      capacityWarnPercent: 90,
      confidenceThreshold: 0.9,
      logRetentionDays: 30,
      recordRetentionYears: 5,
      sessionIdleMinutes: 30,
      appVersion: '1.0.0',
      analyzerMode: 'sample-manifest'
    };
    const insertSetting = db.prepare(`
      INSERT INTO settings (key, value_json, updated_at, updated_by)
      VALUES (?, ?, ?, ?)
    `);
    Object.entries(settings).forEach(([key, value]) => {
      insertSetting.run(key, jsonString(value), timestamp, 'U000');
    });

    seedTask(db, {
      id: 'T-20260928-002',
      file: 'VID_20260928_0831.mp4',
      size: 26.9,
      device: 'F001',
      user: 'U001',
      status: '已完成',
      startTime: '2026-09-28 08:31',
      queuedAt: '2026-09-28 08:33',
      startedAt: '2026-09-28 08:35',
      finishedAt: '2026-09-28 08:46',
      durationMs: 660000,
      recordId: '20260928-F001-01',
      sha: 'a7f3c9e2b41d8c05'
    });
    seedTask(db, {
      id: 'T-20260928-001',
      file: 'VID_20260928_0758.mp4',
      size: 29.6,
      device: 'F002',
      user: 'U002',
      status: '已完成',
      startTime: '2026-09-28 07:58',
      queuedAt: '2026-09-28 08:00',
      startedAt: '2026-09-28 08:02',
      finishedAt: '2026-09-28 08:15',
      durationMs: 780000,
      recordId: '20260928-F002-01',
      sha: 'e5a1c4730bd9f260'
    });
    seedTask(db, {
      id: 'T-20260926-001',
      file: 'VID_20260926_0812.mp4',
      size: 24.8,
      device: 'F001',
      user: 'U001',
      status: '已完成',
      startTime: '2026-09-26 08:12',
      queuedAt: '2026-09-26 08:14',
      startedAt: '2026-09-26 08:16',
      finishedAt: '2026-09-26 08:29',
      durationMs: 780000,
      recordId: '20260926-F001-03',
      sha: 'd92b7f140c8a3e51'
    });

    seedRecord(db, {
      id: '20260928-F001-01',
      date: '2026-09-28',
      device: 'F001',
      inspector: 'U001',
      box: 'FM2512920',
      startTime: '2026-09-28 08:31',
      duration: 393,
      file: 'VID_20260928_0831.mp4',
      fileSize: 26.9,
      sha: 'a7f3c9e2b41d8c05',
      status: '已复核确认',
      cleanliness: '是',
      level: '是',
      internalCal: '是',
      remark: '无',
      readouts: singlePassReadouts(),
      speech: {
        cleanliness: { value: '是', conf: 0.96 },
        level: { value: '是', conf: 0.95 },
        internalCal: { value: '是', conf: 0.94 }
      },
      personCard: { account: 'U001', conf: 0.997 },
      deviceCard: { code: 'F001', conf: 0.996 },
      analyzedAt: '2026-09-28 08:46',
      taskId: 'T-20260928-002',
      submittedBy: 'U001',
      submittedAt: '2026-09-28 08:52',
      submittedFrom: 'PC-Chrome / 192.0.2.51',
      verifiedBy: 'U003',
      verifiedAt: '2026-09-28 09:14',
      verifiedFrom: 'PC-Edge / 192.0.2.44'
    });

    seedRecord(db, {
      id: '20260928-F002-01',
      date: '2026-09-28',
      device: 'F002',
      inspector: 'U002',
      box: 'FM2512921',
      startTime: '2026-09-28 07:58',
      duration: 388,
      file: 'VID_20260928_0758.mp4',
      fileSize: 29.6,
      sha: 'e5a1c4730bd9f260',
      status: '已提交',
      cleanliness: '是',
      level: '是',
      internalCal: '是',
      remark: '高量程 3 次 → 切换至低量程 6 次',
      readouts: dualPassReadouts(),
      speech: {
        cleanliness: { value: '是', conf: 0.94 },
        level: { value: '是', conf: 0.93 },
        internalCal: { value: '是', conf: 0.92 }
      },
      personCard: { account: 'U002', conf: 0.997 },
      deviceCard: { code: 'SJS2605002', conf: 0.996 },
      analyzedAt: '2026-09-28 08:15',
      taskId: 'T-20260928-001',
      submittedBy: 'U002',
      submittedAt: '2026-09-28 08:24',
      submittedFrom: '手机-Chrome / 192.0.2.18'
    });

    seedRecord(db, {
      id: '20260926-F001-03',
      date: '2026-09-26',
      device: 'F001',
      inspector: 'U001',
      box: 'FM2512920',
      startTime: '2026-09-26 08:12',
      duration: 355,
      file: 'VID_20260926_0812.mp4',
      fileSize: 24.8,
      sha: 'd92b7f140c8a3e51',
      status: '待提交',
      cleanliness: '是',
      level: '是',
      internalCal: 'NA',
      remark: '无',
      readouts: lowConfidenceReadouts(),
      speech: {
        cleanliness: { value: '是', conf: 0.94 },
        level: { value: '是', conf: 0.91 },
        internalCal: { value: 'NA', conf: 0.58 }
      },
      personCard: { account: 'U001', conf: 0.996 },
      deviceCard: { code: 'F001', conf: 0.995 },
      analyzedAt: '2026-09-26 08:29',
      taskId: 'T-20260926-001'
    });

    insertAudit(db, {
      time: timestamp,
      account: '系统',
      name: '系统',
      role: '系统自动',
      type: '系统初始化',
      objectType: '系统',
      objectId: 'v1',
      after: '初始账号、天平档案、砝码盒与默认模板已创建',
      result: '成功'
    });
  });

  return true;
}

export function openDatabase(config = {}) {
  const dataDir = config.dataDir;
  mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'tianping.db');
  const db = new DatabaseSync(dbPath);
  initSchema(db);
  seedDatabase(db, config);
  return { db, dbPath };
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key);
  return row ? jsonParse(row.value_json, fallback) : fallback;
}

export function setSetting(db, key, value, actorId = 'U000') {
  db.prepare(`
    INSERT INTO settings (key, value_json, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(key, jsonString(value), nowDateTime(), actorId);
}

export function mapAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
    mustChangePassword: truthy(row.must_change_password),
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    lastLogin: row.last_login,
    permissions: PERMISSIONS[row.role] || []
  };
}

export function getAccount(db, id) {
  return mapAccount(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function getRawAccount(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getAccounts(db) {
  return db.prepare('SELECT * FROM users ORDER BY id').all().map(mapAccount);
}

export function mapDevice(row) {
  if (!row) return null;
  return {
    id: row.id,
    uniqueNo: row.unique_no,
    dept: row.dept,
    max: row.max_g,
    d: row.d_mg,
    ranges: row.range_count,
    range1: { max: row.range1_max, d: row.range1_d },
    range2: row.range_count === 2 ? { max: row.range2_max, d: row.range2_d } : null,
    internalCal: row.internal_cal,
    points: [row.point1, row.point2, row.point3],
    pointRange: jsonParse(row.point_range_json, row.range_count === 2 ? [1, 2, 2] : [1, 1, 1]),
    tol: row.tol,
    defaultBox: row.default_box,
    qrContent: row.qr_content,
    qrValue: row.qr_content === '天平唯一号' ? row.unique_no : row.id,
    status: row.status,
    remark: row.remark,
    updatedAt: row.updated_at
  };
}

export function getDevice(db, id) {
  return mapDevice(db.prepare('SELECT * FROM devices WHERE id = ?').get(id));
}

export function getDeviceByUniqueNo(db, uniqueNo) {
  return mapDevice(db.prepare('SELECT * FROM devices WHERE unique_no = ?').get(uniqueNo));
}

export function getDeviceByCode(db, code) {
  return mapDevice(db.prepare(
    'SELECT * FROM devices WHERE id = ? OR unique_no = ?'
  ).get(code, code));
}

export function getDevices(db, filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.dept) {
    clauses.push('dept = ?');
    params.push(filters.dept);
  }
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.q) {
    clauses.push('(id LIKE ? OR unique_no LIKE ?)');
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM devices ${where} ORDER BY id`).all(...params).map(mapDevice);
}

export function mapWeightBox(row) {
  return row ? {
    id: row.id,
    status: row.status,
    remark: row.remark,
    lastUse: row.last_use,
    updatedAt: row.updated_at
  } : null;
}

export function getWeightBoxes(db) {
  return db.prepare('SELECT * FROM weight_boxes ORDER BY id').all().map(mapWeightBox);
}

export function getWeightBox(db, id) {
  return mapWeightBox(db.prepare('SELECT * FROM weight_boxes WHERE id = ?').get(id));
}

export function mapTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    file: row.file_name,
    filePath: row.file_path,
    size: Math.round((row.size_bytes / (1024 * 1024)) * 10) / 10,
    user: row.user_id,
    device: row.device_id,
    status: row.status,
    startTime: row.started_at,
    queuedAt: row.queued_at,
    startedAt: row.analysis_started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    recordId: row.record_id,
    code: row.error_code,
    reason: row.error_reason,
    sha: row.sha256,
    source: row.source_ip,
    retryCount: row.retry_count,
    warnings: jsonParse(row.warnings_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getTask(db, id) {
  return mapTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}

export function getTasks(db, actor, scope = null) {
  const canAll = actor?.user?.role === 'admin' || actor?.user?.role === 'verifier';
  const useAll = canAll && scope !== 'own';
  const rows = useAll
    ? db.prepare('SELECT * FROM tasks ORDER BY queued_at DESC, created_at DESC').all()
    : db.prepare(
      'SELECT * FROM tasks WHERE user_id = ? ORDER BY queued_at DESC, created_at DESC'
    ).all(actor?.user?.id);
  return rows.map(mapTask);
}

export function mapRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    device: row.device_id,
    inspector: row.inspector_id,
    box: row.box_id,
    startTime: row.started_at,
    duration: row.duration_seconds,
    file: row.file_name,
    fileSize: row.file_size_mb,
    sha: row.sha256,
    status: row.status,
    cleanliness: row.cleanliness,
    level: row.level_result,
    internalCal: row.internal_cal,
    remark: row.remark,
    readouts: jsonParse(row.readouts_json, []),
    speech: jsonParse(row.speech_json, {}),
    personCard: jsonParse(row.person_card_json, {}),
    deviceCard: jsonParse(row.device_card_json, {}),
    rangeSwitch: truthy(row.range_switch),
    checks: jsonParse(row.checks_json, {}),
    modifications: jsonParse(row.modifications_json, []),
    templateVersion: row.template_version,
    tolerancePercent: row.tolerance_percent,
    deviceSnapshot: jsonParse(row.device_snapshot_json, {}),
    templateSnapshot: jsonParse(row.template_snapshot_json, {}),
    analyzedAt: row.analyzed_at,
    taskId: row.task_id,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    submittedFrom: row.submitted_from,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    verifiedFrom: row.verified_from,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at,
    rejectReason: row.reject_reason,
    voidBy: row.void_by,
    voidAt: row.void_at,
    voidReason: row.void_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getRawRecord(db, id) {
  return db.prepare('SELECT * FROM records WHERE id = ?').get(id);
}

export function getRecord(db, id) {
  return mapRecord(getRawRecord(db, id));
}

export function getRecords(db, filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.device) {
    clauses.push('device_id = ?');
    params.push(filters.device);
  }
  if (filters.devices?.length) {
    clauses.push(`device_id IN (${filters.devices.map(() => '?').join(',')})`);
    params.push(...filters.devices);
  }
  if (filters.inspector) {
    clauses.push('inspector_id = ?');
    params.push(filters.inspector);
  }
  if (filters.from) {
    clauses.push('date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push('date <= ?');
    params.push(filters.to);
  }
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.includeVoided === false) {
    clauses.push("status <> '已作废'");
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(10000, Math.max(1, Number(filters.limit || 5000)));
  return db.prepare(
    `SELECT * FROM records ${where} ORDER BY id DESC LIMIT ?`
  ).all(...params, limit).map(mapRecord);
}

export function nextRecordId(db, deviceId, date) {
  const compactDate = String(date).replaceAll('-', '');
  const prefix = `${compactDate}-${deviceId}-`;
  const rows = db.prepare(
    'SELECT id FROM records WHERE id LIKE ? ORDER BY id DESC'
  ).all(`${prefix}%`);
  let max = 0;
  for (const row of rows) {
    const value = Number(String(row.id).slice(prefix.length));
    if (Number.isFinite(value)) max = Math.max(max, value);
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

export function nextTaskId(db) {
  const stamp = nowDateTime().replaceAll(/[-: ]/g, '').slice(0, 12);
  const prefix = `T-${stamp}-`;
  let id;
  do {
    id = `${prefix}${randomBytes(3).toString('hex').toUpperCase()}`;
  } while (db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(id));
  return id;
}

export function getTemplate(db, version = null) {
  const row = version
    ? db.prepare('SELECT * FROM template_versions WHERE version = ?').get(version)
    : db.prepare('SELECT * FROM template_versions ORDER BY id DESC LIMIT 1').get();
  if (!row) return null;
  return {
    ...jsonParse(row.config_json, {}),
    version: row.version,
    createdAt: row.created_at,
    createdBy: row.created_by,
    summary: row.summary
  };
}

export function getTemplateVersions(db) {
  return db.prepare(
    'SELECT * FROM template_versions ORDER BY id DESC'
  ).all().map((row) => ({
    id: row.id,
    version: row.version,
    time: row.created_at,
    by: row.created_by,
    summary: row.summary,
    config: jsonParse(row.config_json, {})
  }));
}

export function getAuditLogs(db, filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.from) {
    clauses.push('time >= ?');
    params.push(`${filters.from} 00:00`);
  }
  if (filters.to) {
    clauses.push('time <= ?');
    params.push(`${filters.to} 23:59`);
  }
  if (filters.account) {
    clauses.push('account = ?');
    params.push(filters.account);
  }
  if (filters.type) {
    clauses.push('type = ?');
    params.push(filters.type);
  }
  if (filters.objectId) {
    clauses.push('object_id = ?');
    params.push(filters.objectId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(10000, Math.max(1, Number(filters.limit || 5000)));
  return db.prepare(
    `SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ?`
  ).all(...params, limit).map((row) => ({
    id: `AU-${row.id}`,
    time: row.time,
    account: row.account,
    name: row.name,
    role: row.role,
    type: row.type,
    objType: row.object_type,
    obj: row.object_id,
    before: row.before_value,
    after: row.after_value,
    reason: row.reason,
    ip: row.source_ip,
    result: row.result
  }));
}

export function getExports(db, actor) {
  const rows = actor?.user?.role === 'inspector'
    ? db.prepare('SELECT * FROM exports WHERE created_by = ? ORDER BY created_at DESC LIMIT 200').all(actor.user.id)
    : db.prepare('SELECT * FROM exports ORDER BY created_at DESC LIMIT 200').all();
  return rows.map((row) => ({
    id: row.id,
    time: row.created_at,
    by: row.created_by,
    type: row.type,
    scope: row.scope,
    count: row.record_count,
    files: [row.file_name],
    watermark: row.watermark,
    status: row.status
  }));
}

export function getBackups(db) {
  return db.prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT 100').all()
    .map((row) => ({
      id: row.id,
      time: row.created_at,
      by: row.created_by,
      type: row.type,
      file: row.file_name,
      size: row.size_bytes,
      status: row.status,
      message: row.message
    }));
}

export function getQueueStats(db) {
  const byStatus = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').all()
      .map((row) => [row.status, row.n])
  );
  const durations = db.prepare(`
    SELECT duration_ms FROM tasks
    WHERE status = '已完成' AND duration_ms IS NOT NULL
    ORDER BY finished_at DESC LIMIT 20
  `).all().map((row) => Number(row.duration_ms));
  return {
    queued: byStatus['排队中'] || 0,
    running: byStatus['分析中'] || 0,
    completed: byStatus['已完成'] || 0,
    failed: (byStatus['失败'] || 0) + (byStatus['待人工处理'] || 0),
    averageDurationMs: durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null
  };
}

export function publicUser(db, id) {
  return getAccount(db, id);
}

export function maskSha(value) {
  if (!value) return '';
  return `${String(value).slice(0, 12)}…`;
}

export function stableSecret(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function ensureStorageDirectories(config) {
  const dirs = [
    config.dataDir,
    path.join(config.dataDir, 'uploads'),
    path.join(config.dataDir, 'videos'),
    path.join(config.dataDir, 'screenshots'),
    path.join(config.dataDir, 'exports'),
    path.join(config.dataDir, 'backups'),
    path.join(config.dataDir, 'logs')
  ];
  dirs.forEach((dir) => mkdirSync(dir, { recursive: true }));
  if (!existsSync(path.join(config.dataDir, 'tianping.db'))) {
    mkdirSync(config.dataDir, { recursive: true });
  }
  return dirs;
}

export function uniqueFilename(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  const base = path.basename(String(name || 'video'), ext)
    .replaceAll(/[^\p{L}\p{N}._-]+/gu, '_')
    .slice(0, 80) || 'video';
  return `${base}-${randomUUID().slice(0, 8)}${ext}`;
}

