import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  statfsSync,
  unlinkSync
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  audit,
  getSetting,
  nowDateTime,
  setSetting
} from '../db.js';
import { HttpError } from '../auth.js';

function walkFiles(root) {
  const result = [];
  if (!existsSync(root)) return result;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        const stat = statSync(fullPath);
        result.push({
          path: fullPath,
          size: stat.size,
          mtimeMs: stat.mtimeMs
        });
      }
    }
  }
  return result;
}

function sumFiles(files) {
  return files.reduce((total, file) => total + file.size, 0);
}

export class StorageService {
  constructor({ db, config, logger = console }) {
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.videoRoot = path.join(config.dataDir, 'videos');
    this.screenshotRoot = path.join(config.dataDir, 'screenshots');
    this.exportRoot = path.join(config.dataDir, 'exports');
    this.backupRoot = path.join(config.dataDir, 'backups');
    this.uploadRoot = path.join(config.dataDir, 'uploads');
    [
      this.videoRoot,
      this.screenshotRoot,
      this.exportRoot,
      this.backupRoot,
      this.uploadRoot
    ].forEach((dir) => mkdirSync(dir, { recursive: true }));
  }

  getQuotaGb() {
    return Number(getSetting(this.db, 'videoQuotaGb', 200));
  }

  setQuotaGb(actor, value) {
    const quota = Number(value);
    if (!Number.isFinite(quota) || quota < 1 || quota > 100000) {
      throw new HttpError(400, 'INVALID_QUOTA', '视频配额必须是 1GB 以上、100000GB 以下的数值');
    }
    const before = this.getQuotaGb();
    setSetting(this.db, 'videoQuotaGb', quota, actor.user.id);
    audit(this.db, actor, {
      type: '容量配置变更',
      objectType: '存储',
      objectId: '视频配额',
      before: `${before}GB`,
      after: `${quota}GB`,
      reason: '管理员调整视频存储配额',
      result: '成功'
    });
    return this.getStats();
  }

  getStats() {
    const videos = walkFiles(this.videoRoot);
    const screenshots = walkFiles(this.screenshotRoot);
    const exports = walkFiles(this.exportRoot);
    const backups = walkFiles(this.backupRoot);
    const pendingUploads = walkFiles(this.uploadRoot);
    const usedBytes = sumFiles(videos);
    const quotaGb = this.getQuotaGb();
    const quotaBytes = quotaGb * 1024 ** 3;
    const percent = quotaBytes ? Math.round((usedBytes / quotaBytes) * 10000) / 100 : 0;
    const threshold = Number(getSetting(this.db, 'capacityWarnPercent', 90));
    const taskFiles = new Map(
      this.db.prepare(`
        SELECT device_id, file_path FROM tasks
        WHERE device_id IS NOT NULL AND file_path IS NOT NULL
      `).all().map((row) => [path.resolve(row.file_path), row.device_id])
    );
    const deviceUsage = new Map();
    for (const file of videos) {
      const deviceId = taskFiles.get(path.resolve(file.path));
      if (!deviceId) continue;
      const current = deviceUsage.get(deviceId) || { id: deviceId, count: 0, size_bytes: 0 };
      current.count += 1;
      current.size_bytes += file.size;
      deviceUsage.set(deviceId, current);
    }
    const byDeviceRows = [...deviceUsage.values()]
      .sort((left, right) => right.size_bytes - left.size_bytes);
    const dailyBytes = this.dailyVideoBytes();
    const remainingBytes = Math.max(0, quotaBytes - usedBytes);
    const retainDays = dailyBytes > 0
      ? Math.max(0, Math.floor(remainingBytes / dailyBytes))
      : null;
    const warningActive = getSetting(this.db, 'capacityWarningActive', false);
    if (percent >= threshold && !warningActive) {
      audit(this.db, null, {
        type: '容量告警',
        objectType: '存储',
        objectId: '视频配额',
        before: `${percent}%`,
        after: `达到 ${threshold}% 告警阈值`,
        reason: `视频存储已用 ${usedBytes} bytes / ${quotaBytes} bytes`,
        result: '待处理'
      });
      setSetting(this.db, 'capacityWarningActive', true);
    } else if (percent < threshold && warningActive) {
      setSetting(this.db, 'capacityWarningActive', false);
    }

    return {
      quotaGb,
      usedGb: Math.round((usedBytes / 1024 ** 3) * 100) / 100,
      usedBytes,
      percent,
      threshold,
      warning: percent >= threshold,
      retainDays,
      byDevice: byDeviceRows.map((row) => ({
        id: row.id,
        count: row.count,
        sizeGb: Math.round((Number(row.size_bytes || 0) / 1024 ** 3) * 100) / 100
      })),
      screenshotBytes: sumFiles(screenshots),
      exportBytes: sumFiles(exports),
      backupBytes: sumFiles(backups),
      pendingUploadBytes: sumFiles(pendingUploads),
      pendingUploadCount: pendingUploads.length,
      diskAvailableBytes: this.diskAvailableBytes(),
      videoCount: videos.length,
      cleaned: this.db.prepare(
        'SELECT * FROM cleanup_log ORDER BY id DESC LIMIT 50'
      ).all().map((row) => ({
        time: row.cleaned_at,
        file: path.basename(row.file_path),
        size: Math.round((row.size_bytes / 1024 ** 2) * 10) / 10,
        reason: row.reason
      }))
    };
  }

  dailyVideoBytes() {
    const files = walkFiles(this.videoRoot);
    if (!files.length) return 0;
    const oldest = Math.min(...files.map((file) => file.mtimeMs));
    const days = Math.max(1, (Date.now() - oldest) / (24 * 60 * 60 * 1000));
    return sumFiles(files) / days;
  }

  diskAvailableBytes() {
    try {
      const stats = statfsSync(this.config.dataDir);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return null;
    }
  }

  enforceQuota(actor = null) {
    const quotaBytes = this.getQuotaGb() * 1024 ** 3;
    let stats = this.getStats();
    if (stats.usedBytes < quotaBytes) return [];

    const files = walkFiles(this.videoRoot)
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    const cleaned = [];
    for (const file of files) {
      if (stats.usedBytes < quotaBytes) break;
      if (this.isActiveAnalysis(file.path)) continue;
      try {
        unlinkSync(file.path);
      } catch (error) {
        if (error.code !== 'ENOENT') continue;
      }
      this.db.prepare(`
        INSERT INTO cleanup_log (cleaned_at, file_path, size_bytes, reason)
        VALUES (?, ?, ?, ?)
      `).run(
        nowDateTime(),
        file.path,
        file.size,
        '视频存储达到配额，按最早优先自动清理'
      );
      audit(this.db, actor, {
        type: '视频清理',
        objectType: '存储',
        objectId: path.basename(file.path),
        before: '存在',
        after: '已清理',
        reason: '视频存储达到配额，按最早优先自动清理；记录与截图保留',
        result: '成功'
      });
      cleaned.push({
        path: file.path,
        size: file.size
      });
      stats = this.getStats();
    }
    return cleaned;
  }

  isActiveAnalysis(filePath) {
    const row = this.db.prepare(
      "SELECT 1 FROM tasks WHERE file_path = ? AND status = '分析中' LIMIT 1"
    ).get(filePath);
    return Boolean(row);
  }

  createBackup(actor, type = '手动') {
    if (!this.config.dbPath || !existsSync(this.config.dbPath)) {
      throw new HttpError(500, 'BACKUP_FAILED', '数据库文件不可用，无法备份');
    }
    const stamp = `${nowDateTime().replaceAll(/[-: ]/g, '')}-${randomUUID().slice(0, 6)}`;
    const fileName = `tianping-${stamp}.db`;
    const target = path.join(this.backupRoot, fileName);
    const id = `BK-${randomUUID().slice(0, 8).toUpperCase()}`;
    try {
      const sqliteTarget = target.replaceAll("'", "''");
      this.db.exec(`VACUUM INTO '${sqliteTarget}'`);
      const integrity = this.db.prepare('PRAGMA integrity_check').get();
      if (integrity?.integrity_check !== 'ok') {
        throw new Error(`备份完整性检查失败：${integrity?.integrity_check || '未知结果'}`);
      }
      const size = statSync(target).size;
      this.db.prepare(`
        INSERT INTO backups (
          id, created_at, created_by, type, file_name, size_bytes, status, message
        ) VALUES (?, ?, ?, ?, ?, ?, '成功', ?)
      `).run(
        id,
        nowDateTime(),
        actor?.user?.id || 'U000',
        type,
        fileName,
        size,
        '数据库、配置与模板版本备份完成'
      );
      audit(this.db, actor, {
        type: '备份执行',
        objectType: '系统',
        objectId: fileName,
        after: '成功',
        reason: `备份大小 ${size} bytes；类型 ${type}`,
        result: '成功'
      });
      return {
        id,
        file: fileName,
        size,
        status: '成功',
        createdAt: nowDateTime()
      };
    } catch (error) {
      try {
        if (existsSync(target)) unlinkSync(target);
      } catch {
        // Keep original failure.
      }
      this.db.prepare(`
        INSERT INTO backups (
          id, created_at, created_by, type, file_name, size_bytes, status, message
        ) VALUES (?, ?, ?, ?, ?, NULL, '失败', ?)
      `).run(
        id,
        nowDateTime(),
        actor?.user?.id || 'U000',
        type,
        fileName,
        String(error.message || error)
      );
      throw new HttpError(500, 'BACKUP_FAILED', `备份失败：${error.message || error}`);
    }
  }

  maybeDailyBackup() {
    const now = nowDateTime();
    const hour = Number(now.slice(11, 13));
    // 02:00 是计划时间；若宿主机在时间窗内离线，启动后当天首次检查会补跑。
    if (hour < 2) return null;
    const date = now.slice(0, 10);
    const existing = this.db.prepare(`
      SELECT id FROM backups
      WHERE type = '自动' AND status = '成功' AND created_at LIKE ?
      LIMIT 1
    `).get(`${date}%`);
    if (existing) return null;
    try {
      this.pruneBackups(30);
      return this.createBackup(null, '自动');
    } catch (error) {
      audit(this.db, null, {
        type: '备份执行',
        objectType: '系统',
        objectId: '每日自动备份',
        after: '失败',
        reason: String(error.message || error).slice(0, 1000),
        result: '失败'
      });
      this.logger.error?.('[backup]', error);
      return null;
    }
  }

  pruneBackups(retentionDays = 30) {
    const cutoff = Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    for (const file of walkFiles(this.backupRoot)) {
      if (file.mtimeMs >= cutoff || !file.path.endsWith('.db')) continue;
      try {
        unlinkSync(file.path);
      } catch {
        // A locked or externally managed backup remains visible in the list.
      }
    }
  }

  recordExport(actor, { type, scope, count, fileName, watermark = '' }) {
    const id = `EX-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.db.prepare(`
      INSERT INTO exports (
        id, created_at, created_by, type, scope, record_count,
        file_name, watermark, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '成功')
    `).run(
      id,
      nowDateTime(),
      actor.user.id,
      type,
      scope,
      count,
      fileName,
      watermark
    );
    return id;
  }
}

