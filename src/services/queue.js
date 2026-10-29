import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  unlinkSync
} from 'node:fs';
import path from 'node:path';
import {
  addMinutes,
  audit,
  getDevice,
  getDevices,
  getRawRecord,
  getRecord,
  getSetting,
  getTask,
  getTemplate,
  jsonString,
  nextRecordId,
  nowDateTime,
  nowIso,
  withTransaction
} from '../db.js';
import { HttpError } from '../auth.js';

function cleanError(error) {
  return {
    code: error?.code && /^E[-_]/.test(String(error.code))
      ? error.code
      : 'E-ANALYSIS',
    message: String(error?.message || error || '未知分析错误').slice(0, 1000),
    status: error?.taskStatus
      || error?.statusLabel
      || (error?.status === '待人工处理' ? '待人工处理' : '失败')
  };
}

function normalizeReadouts(items, device, startedAt) {
  const source = Array.isArray(items) ? items : [];
  return Array.from({ length: 9 }, (_, index) => {
    const input = source[index];
    const point = Math.floor(index / 3);
    const idx = (index % 3) + 1;
    const object = input && typeof input === 'object'
      ? input
      : { value: input };
    const value = object.value === null || object.value === undefined || object.value === ''
      ? null
      : Number(object.value);
    const range = object.range || (
      device.ranges === 2
        ? (device.pointRange?.[point] || (point === 0 ? 1 : 2))
        : 1
    );
    const off = Number.isFinite(Number(object.off)) ? Number(object.off) : 32 + index * 39;
    return {
      point,
      idx,
      value: Number.isFinite(value) ? value : null,
      unit: object.unit || 'g',
      off,
      time: object.time || addMinutes(startedAt, Math.round(off / 60)),
      conf: Number.isFinite(Number(object.conf)) ? Number(object.conf) : 0.995,
      stable: object.stable !== false,
      range,
      screenshot: object.screenshot || ''
    };
  });
}

function speechValue(speech, key, fallback = '是') {
  const item = speech?.[key];
  if (item && typeof item === 'object') return item.value ?? fallback;
  if (typeof item === 'string') return item;
  return fallback;
}

function stageVideoForRecord(task, recordId, dataDir) {
  if (!task.filePath || !existsSync(task.filePath)) {
    throw new HttpError(500, 'VIDEO_MISSING', '分析任务关联的视频文件不存在');
  }
  const date = recordId.slice(0, 8);
  const targetDir = path.join(
    dataDir,
    'videos',
    date.slice(0, 4),
    date.slice(4, 6),
    task.device,
    recordId
  );
  mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, path.basename(task.filePath));
  // Copy first so a crash before the database commit leaves the queue's source
  // path intact and the task can be retried idempotently.
  copyFileSync(task.filePath, target);
  return { source: task.filePath, target };
}

export class AnalysisQueue {
  constructor({
    db,
    config,
    storageService,
    logger = console,
    intervalMs = 600
  }) {
    this.db = db;
    this.config = config;
    this.storage = storageService;
    this.logger = logger;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
    this.stopping = false;
    this.analyzer = null;
  }

  async loadAnalyzer() {
    if (!this.analyzer) {
      const module = await import('./analyzer.js');
      if (typeof module.analyzeVideo !== 'function') {
        throw new Error('分析适配器未导出 analyzeVideo');
      }
      this.analyzer = module.analyzeVideo;
    }
    return this.analyzer;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    this.recoverInterruptedTasks();
    this.schedule(25);
  }

  schedule(delay = this.intervalMs) {
    if (this.stopping) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.tick().catch((error) => {
        this.logger.error?.('[queue]', error);
        this.schedule(this.intervalMs);
      });
    }, delay);
    this.timer.unref?.();
  }

  async stop() {
    this.stopping = true;
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  recoverInterruptedTasks() {
    const rows = this.db.prepare(
      "SELECT * FROM tasks WHERE status = '分析中'"
    ).all();
    if (!rows.length) return;
    const time = nowDateTime();
    withTransaction(this.db, () => {
      for (const row of rows) {
        this.db.prepare(`
          UPDATE tasks
          SET status = '失败', error_code = 'E-RESTARTED',
              error_reason = '服务重启时任务正在分析，已标记失败，可人工重试',
              finished_at = ?, updated_at = ?
          WHERE id = ?
        `).run(time, time, row.id);
        audit(this.db, null, {
          type: '任务状态变化',
          objectType: '分析任务',
          objectId: row.id,
          before: '分析中',
          after: '失败',
          reason: '服务重启恢复规则：中断任务标记失败，排队任务保留',
          result: '失败'
        });
      }
    });
  }

  async tick() {
    if (!this.running || this.stopping) return;
    const task = this.claimNext();
    if (!task) {
      this.schedule();
      return;
    }

    try {
      const analyzeVideo = await this.loadAnalyzer();
      const result = await analyzeVideo({
        filePath: task.filePath,
        sha256: task.sha,
        startedAt: task.startTime,
        uploadedBy: task.user,
        devices: getDevices(this.db, { status: '在用' }),
        config: this.config
      });
      await this.completeWithResult(task.id, result, null);
    } catch (error) {
      this.failTask(task.id, cleanError(error));
    } finally {
      this.schedule();
      this.storage.enforceQuota(null);
    }
  }

  claimNext() {
    return withTransaction(this.db, () => {
      const active = this.db.prepare(
        "SELECT 1 FROM tasks WHERE status = '分析中' LIMIT 1"
      ).get();
      if (active) return null;
      const row = this.db.prepare(`
        SELECT * FROM tasks
        WHERE status = '排队中'
        ORDER BY queued_at ASC, created_at ASC, rowid ASC
        LIMIT 1
      `).get();
      if (!row) return null;
      const time = nowDateTime();
      this.db.prepare(`
        UPDATE tasks
        SET status = '分析中', analysis_started_at = ?, updated_at = ?
        WHERE id = ? AND status = '排队中'
      `).run(time, time, row.id);
      audit(this.db, null, {
        type: '任务状态变化',
        objectType: '分析任务',
        objectId: row.id,
        before: '排队中',
        after: '分析中',
        reason: '单消费者队列按上传时间 FIFO 开始分析',
        result: '成功'
      });
      return getTask(this.db, row.id);
    });
  }

  async completeWithResult(taskId, result, actor) {
    const task = getTask(this.db, taskId);
    if (!task) throw new HttpError(404, 'TASK_NOT_FOUND', '分析任务不存在');
    if (task.recordId && getRawRecord(this.db, task.recordId)) {
      throw new HttpError(409, 'TASK_ALREADY_COMPLETED', '该任务已生成记录，不能重复生成');
    }

    const personAccount = result?.personCard?.account || task.user;
    if (personAccount !== task.user) {
      const mismatch = new Error(
        `人员卡与登录人员不一致：视频中识别为 ${personAccount}，任务归属 ${task.user}，未生成记录`
      );
      mismatch.code = 'E-1004';
      mismatch.taskStatus = '待人工处理';
      throw mismatch;
    }
    if (!result?.personCard?.account && !result?.manual) {
      const missing = new Error(
        '未识别到人员卡，未生成正式记录；请补拍清晰卡面或由管理员执行人工补录'
      );
      missing.code = 'E-1002';
      missing.taskStatus = '待人工处理';
      throw missing;
    }
    if (!result?.deviceCard?.code && !result?.deviceId) {
      const missing = new Error(
        '未识别到设备卡，未生成正式记录；请补拍清晰卡面或由管理员执行人工补录'
      );
      missing.code = 'E-1003';
      missing.taskStatus = '待人工处理';
      throw missing;
    }

    const device = result.deviceId
      ? getDevice(this.db, result.deviceId)
      : getDeviceByAnyCode(this.db, result.deviceCard.code);
    if (!device) {
      const unknown = new Error(
        `设备二维码 ${result.deviceCard.code} 未登记，请复核确认人员先建立天平档案`
      );
      unknown.code = 'E-1005';
      unknown.taskStatus = '待人工处理';
      throw unknown;
    }
    if (device.status !== '在用') {
      const stopped = new Error(`天平 ${device.id} 已停用，不能生成新记录`);
      stopped.code = 'E-1006';
      stopped.taskStatus = '失败';
      throw stopped;
    }

    const date = task.startTime.slice(0, 10);
    const recordId = nextRecordId(this.db, device.id, date);
    const speech = result.speech || {};
    const template = getTemplate(this.db);
    const readouts = normalizeReadouts(result.readouts, device, task.startTime);
    const warnings = Array.isArray(result.warnings) ? [...result.warnings] : [];
    const sameDayCount = this.db.prepare(`
      SELECT COUNT(*) AS n FROM records
      WHERE device_id = ? AND date = ? AND status <> '已作废'
    `).get(device.id, date).n;
    if (sameDayCount > 0) {
      warnings.push(`该天平当日已有 ${sameDayCount} 条记录；本记录独立生成并独立复核，不覆盖既有记录`);
    }
    let screenshots = Array.isArray(result.screenshots) ? result.screenshots : [];
    screenshots = this.copyScreenshots(recordId, screenshots);
    readouts.forEach((item, index) => {
      const key = `I${item.point + 1}-${item.idx}`;
      const match = screenshots.find((entry) => entry.key === key);
      if (match) item.screenshot = match.relativePath;
    });

    const stagedVideo = stageVideoForRecord(
      { ...task, device: device.id },
      recordId,
      this.config.dataDir
    );
    const finalPath = stagedVideo.target;
    const time = nowDateTime();
    const elapsed = task.startedAt
      ? Math.max(0, new Date().getTime() - new Date(
        task.startedAt.replace(' ', 'T') + ':00+08:00'
      ).getTime())
      : null;

    try {
      withTransaction(this.db, () => {
        this.db.prepare(`
        INSERT INTO records (
          id, date, device_id, inspector_id, box_id, started_at, duration_seconds,
          file_name, file_size_mb, sha256, status, cleanliness, level_result,
          internal_cal, remark, readouts_json, speech_json, person_card_json,
          device_card_json, range_switch, checks_json, modifications_json,
          template_version, tolerance_percent, device_snapshot_json,
          template_snapshot_json, analyzed_at, task_id, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '待提交', ?, ?, ?, '无', ?, ?, ?, ?, ?,
          '{}', '[]', ?, ?, ?, ?, ?, ?, ?, ?
        )
        `).run(
        recordId,
        date,
        device.id,
        task.user,
        device.defaultBox || null,
        task.startTime,
        result.durationSeconds || null,
        task.file,
        task.size,
        task.sha,
        speechValue(speech, 'cleanliness', '是'),
        speechValue(speech, 'level', '是'),
        speechValue(speech, 'internalCal', device.internalCal === 'NA' ? 'NA' : '是'),
        jsonString(readouts),
        jsonString(speech),
        jsonString(result.personCard || { account: task.user, conf: 1 }),
        jsonString(result.deviceCard || { code: device.id, conf: 1 }),
        result.rangeSwitch === false ? 0 : 1,
        template?.version || 'v1',
        Number(template?.tol ?? device.tol ?? 0.05),
        jsonString(device),
        jsonString(template || {}),
        time,
        taskId,
        time,
        time
      );
        this.db.prepare(`
        UPDATE tasks
        SET status = '已完成', device_id = ?, file_path = ?, finished_at = ?,
            duration_ms = ?, record_id = ?, error_code = NULL, error_reason = NULL,
            warnings_json = ?, updated_at = ?
        WHERE id = ?
        `).run(
        device.id,
        finalPath,
        time,
        elapsed,
        recordId,
        jsonString(warnings),
        time,
        taskId
      );
        audit(this.db, actor, {
        type: '分析完成',
        objectType: '分析任务',
        objectId: taskId,
        before: '分析中',
        after: '已完成',
        reason: `生成待提交记录 ${recordId}；分析引擎 ${result.engine || 'unknown'}；读数 ${readouts.filter((item) => item.value !== null).length}/9`,
        result: '成功'
        });
      });
      if (stagedVideo.source !== finalPath && existsSync(stagedVideo.source)) {
        unlinkSync(stagedVideo.source);
      }
    } catch (error) {
      if (stagedVideo.target !== stagedVideo.source && existsSync(stagedVideo.target)) {
        try {
          unlinkSync(stagedVideo.target);
        } catch {
          // Preserve the original analysis error.
        }
      }
      throw error;
    }
    return getRecord(this.db, recordId);
  }

  copyScreenshots(recordId, screenshots) {
    const targetRoot = path.join(
      this.config.dataDir,
      'screenshots',
      recordId
    );
    mkdirSync(targetRoot, { recursive: true });
    const sourceFolders = new Set();
    const rootPrefix = `${path.resolve(this.config.dataDir, 'screenshots')}${path.sep}`;
    const copied = screenshots.map((entry, index) => {
      const key = entry.key || `I${Math.floor(index / 3) + 1}-${(index % 3) + 1}`;
      const rawSource = entry.path || entry;
      const source = typeof rawSource === 'string' && !path.isAbsolute(rawSource)
        ? path.resolve(this.config.dataDir, rawSource)
        : rawSource;
      const targetName = `${key}.jpg`;
      const target = path.join(targetRoot, targetName);
      if (typeof source === 'string' && existsSync(source)) {
        copyFileSync(source, target);
        const absoluteSource = path.resolve(source);
        if (absoluteSource.startsWith(rootPrefix) && absoluteSource !== target) {
          sourceFolders.add(path.dirname(absoluteSource));
          try {
            unlinkSync(absoluteSource);
          } catch {
            // Keep a valid screenshot even if the temporary source cannot be removed.
          }
        }
      }
      return {
        key,
        path: target,
        relativePath: path.posix.join('screenshots', recordId, targetName)
      };
    });
    for (const folder of sourceFolders) {
      try {
        if (readdirSync(folder).length === 0) rmdirSync(folder);
      } catch {
        // A concurrent read or an externally retained file is harmless.
      }
    }
    return copied;
  }

  failTask(taskId, failure) {
    const task = getTask(this.db, taskId);
    if (!task) return;
    const time = nowDateTime();
    const status = failure.status === '待人工处理' ? '待人工处理' : '失败';
    const elapsed = task.startedAt
      ? Math.max(0, Date.now() - new Date(
        task.startedAt.replace(' ', 'T') + ':00+08:00'
      ).getTime())
      : null;
    this.db.prepare(`
      UPDATE tasks
      SET status = ?, finished_at = ?, duration_ms = ?, error_code = ?,
          error_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(status, time, elapsed, failure.code, failure.message, time, taskId);
    audit(this.db, null, {
      type: status === '待人工处理' ? '分析完成' : '分析失败',
      objectType: '分析任务',
      objectId: taskId,
      before: '分析中',
      after: status,
      reason: `${failure.code} ${failure.message}`,
      result: status === '待人工处理' ? '待处理' : '失败'
    });
  }

  enqueue(taskId, actor) {
    const task = getTask(this.db, taskId);
    if (!task) throw new HttpError(404, 'TASK_NOT_FOUND', '分析任务不存在');
    if (!['失败', '待人工处理'].includes(task.status)) {
      throw new HttpError(409, 'TASK_NOT_RETRYABLE', '仅失败或待人工处理的任务可以重试');
    }
    if (task.recordId && getRawRecord(this.db, task.recordId)) {
      throw new HttpError(409, 'TASK_HAS_RECORD', '该任务已有记录，不能重试');
    }
    const time = nowDateTime();
    this.db.prepare(`
      UPDATE tasks
      SET status = '排队中', queued_at = ?, analysis_started_at = NULL,
          finished_at = NULL, duration_ms = NULL, error_code = NULL,
          error_reason = NULL, retry_count = retry_count + 1, updated_at = ?
      WHERE id = ?
    `).run(time, time, taskId);
    audit(this.db, actor, {
      type: '任务状态变化',
      objectType: '分析任务',
      objectId: taskId,
      before: task.status,
      after: '排队中',
      reason: '人工重试；复用原任务 ID，避免重复记录',
      result: '成功'
    });
    return getTask(this.db, taskId);
  }

  cancel(taskId, actor) {
    const task = getTask(this.db, taskId);
    if (!task) throw new HttpError(404, 'TASK_NOT_FOUND', '分析任务不存在');
    if (task.status !== '排队中') {
      throw new HttpError(409, 'TASK_NOT_CANCELLABLE', '仅排队中的任务可以取消');
    }
    const time = nowDateTime();
    this.db.prepare(`
      UPDATE tasks SET status = '已取消', finished_at = ?, updated_at = ?
      WHERE id = ? AND status = '排队中'
    `).run(time, time, taskId);
    audit(this.db, actor, {
      type: '上传取消',
      objectType: '分析任务',
      objectId: taskId,
      before: '排队中',
      after: '已取消',
      reason: '管理员取消排队任务',
      result: '成功'
    });
    return getTask(this.db, taskId);
  }

  async manualComplete(taskId, actor, payload) {
    const task = getTask(this.db, taskId);
    if (!task) throw new HttpError(404, 'TASK_NOT_FOUND', '分析任务不存在');
    if (!['失败', '待人工处理'].includes(task.status)) {
      throw new HttpError(409, 'TASK_NOT_MANUAL', '仅失败或待人工处理的任务可人工补录');
    }
    const device = getDevice(this.db, payload?.deviceId);
    if (!device) throw new HttpError(400, 'DEVICE_REQUIRED', '人工补录必须选择已登记天平');
    if (device.status !== '在用') {
      throw new HttpError(409, 'DEVICE_DISABLED', '停用天平不能生成新记录');
    }

    this.db.prepare(`
      UPDATE tasks SET status = '分析中', analysis_started_at = ?, updated_at = ?
      WHERE id = ?
    `).run(nowDateTime(), nowDateTime(), taskId);

    try {
      const result = {
        engine: 'manual-entry',
        manual: true,
        personCard: {
          account: payload?.personCard?.account || task.user,
          conf: Number(payload?.personCard?.conf || 1)
        },
        deviceCard: {
          code: payload?.deviceCard?.code || device.id,
          conf: Number(payload?.deviceCard?.conf || 1)
        },
        deviceId: device.id,
        durationSeconds: payload?.durationSeconds || null,
        rangeSwitch: payload?.rangeSwitch !== false,
        readouts: payload?.readouts || [],
        speech: payload?.speech || {
          cleanliness: { value: payload?.cleanliness || '是', conf: 1 },
          level: { value: payload?.level || '是', conf: 1 },
          internalCal: { value: payload?.internalCal || '是', conf: 1 }
        },
        screenshots: [],
        warnings: ['本记录通过人工补录生成，请核对原始视频后提交']
      };
      return await this.completeWithResult(taskId, result, actor);
    } catch (error) {
      this.failTask(taskId, cleanError(error));
      throw error;
    }
  }
}

function getDeviceByAnyCode(db, code) {
  return getDevice(db, code)
    || (db.prepare('SELECT id FROM devices WHERE unique_no = ?').get(code)
      ? getDevice(db, db.prepare('SELECT id FROM devices WHERE unique_no = ?').get(code).id)
      : null);
}

