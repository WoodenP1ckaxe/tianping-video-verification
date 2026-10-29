import {
  closeSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  statfsSync,
  unlinkSync
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  audit,
  nextTaskId,
  nowDateTime,
  nowIso,
  uniqueFilename
} from '../db.js';
import { HttpError } from '../auth.js';

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov']);
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

function megabytes(bytes) {
  return Math.round((Number(bytes || 0) / 1024 ** 2) * 10) / 10;
}

function diskAvailableBytes(directory) {
  try {
    const stats = statfsSync(directory);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

function uploadDto(row) {
  if (!row) return null;
  return {
    uploadId: row.id,
    fileName: row.original_name,
    sizeBytes: row.size_bytes,
    receivedBytes: row.received_bytes,
    startedAt: row.started_at,
    sha256: row.sha256,
    status: row.status,
    taskId: row.task_id,
    error: row.error_code ? {
      code: row.error_code,
      message: row.error_message
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

export class UploadService {
  constructor({ db, config, logger = console }) {
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.active = new Set();
    this.uploadRoot = path.join(config.dataDir, 'uploads');
    mkdirSync(this.uploadRoot, { recursive: true });
  }

  initialize(actor, payload) {
    const fileName = path.basename(String(payload?.fileName || '').trim());
    const sizeBytes = Number(payload?.sizeBytes);
    const startedAt = String(payload?.startedAt || '').trim().replace('T', ' ');
    const extension = path.extname(fileName).toLowerCase();

    if (!fileName || !ALLOWED_EXTENSIONS.has(extension)) {
      throw new HttpError(415, 'UNSUPPORTED_VIDEO', '仅支持 mp4 或 mov 视频文件');
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      throw new HttpError(400, 'INVALID_SIZE', '视频文件大小无效');
    }
    if (sizeBytes > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, 'VIDEO_TOO_LARGE', '单个视频文件不能超过 500MB');
    }
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(startedAt)) {
      throw new HttpError(400, 'INVALID_START_TIME', '请确认拍摄开始时间，精确到分钟');
    }

    const active = this.db.prepare(`
      SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS user_count,
        COALESCE(SUM(size_bytes), 0) AS reserved_bytes
      FROM uploads
      WHERE status IN ('上传中', '校验中')
    `).get(actor.user.id);
    const perUserLimit = Number(this.config.maxActiveUploadsPerUser || 3);
    const globalLimit = Number(this.config.maxActiveUploadsGlobal || 10);
    const tempLimit = Number(this.config.maxTempUploadBytes || 2 * 1024 ** 3);
    if (Number(active.user_count || 0) >= perUserLimit) {
      throw new HttpError(
        429,
        'UPLOAD_SESSION_LIMIT',
        `每个账号最多同时保留 ${perUserLimit} 个未完成上传，请取消或完成已有上传`
      );
    }
    if (Number(active.total_count || 0) >= globalLimit) {
      throw new HttpError(
        503,
        'UPLOAD_SESSIONS_BUSY',
        '系统当前未完成上传已达到上限，请稍后重试'
      );
    }
    if (Number(active.reserved_bytes || 0) + sizeBytes > tempLimit) {
      throw new HttpError(
        507,
        'UPLOAD_TEMP_QUOTA',
        `未完成上传预留空间不能超过 ${megabytes(tempLimit)}MB，请先完成或取消已有上传`
      );
    }
    const available = diskAvailableBytes(this.config.dataDir);
    const reserve = Number(this.config.minFreeDiskBytes || 512 * 1024 ** 2);
    if (available !== null && available - sizeBytes < reserve) {
      throw new HttpError(
        507,
        'INSUFFICIENT_STORAGE',
        '服务器可用磁盘空间不足，请联系管理员清理存储'
      );
    }

    const id = randomUUID();
    const dir = path.join(this.uploadRoot, id);
    mkdirSync(dir, { recursive: true });
    const tempPath = path.join(dir, `${uniqueFilename(fileName)}.part`);
    closeSync(openSync(tempPath, 'w'));
    const time = nowDateTime();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO uploads (
          id, user_id, original_name, size_bytes, received_bytes, started_at,
          temp_path, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?, '上传中', ?, ?)
      `).run(
        id,
        actor.user.id,
        fileName,
        sizeBytes,
        startedAt,
        tempPath,
        time,
        time
      );
      audit(this.db, actor, {
        type: '视频上传开始',
        objectType: '上传会话',
        objectId: id,
        after: '上传中',
        reason: `文件名 ${fileName}，${(sizeBytes / 1024 / 1024).toFixed(1)}MB，拍摄开始时间 ${startedAt}`,
        result: '成功'
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return uploadDto(this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(id));
  }

  get(actor, uploadId) {
    const row = this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId);
    if (!row) throw new HttpError(404, 'UPLOAD_NOT_FOUND', '上传会话不存在');
    if (row.user_id !== actor.user.id && actor.user.role !== 'admin') {
      throw new HttpError(403, 'FORBIDDEN', '无权访问此上传会话');
    }
    return uploadDto(row);
  }

  async append(actor, uploadId, offsetHeader, req) {
    const row = this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId);
    if (!row) throw new HttpError(404, 'UPLOAD_NOT_FOUND', '上传会话不存在');
    if (row.user_id !== actor.user.id) {
      throw new HttpError(403, 'FORBIDDEN', '只能继续自己的上传会话');
    }
    if (row.status !== '上传中') {
      throw new HttpError(409, 'UPLOAD_NOT_WRITABLE', `上传状态为“${row.status}”，不能继续写入`);
    }

    const offset = Number(offsetHeader);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new HttpError(400, 'INVALID_OFFSET', 'Upload-Offset 必须为非负整数');
    }
    if (offset !== row.received_bytes) {
      throw new HttpError(
        409,
        'UPLOAD_OFFSET_CONFLICT',
        `上传偏移不一致，服务器当前偏移为 ${row.received_bytes}`
      );
    }
    if (this.active.has(uploadId)) {
      throw new HttpError(409, 'UPLOAD_BUSY', '该上传会话已有分片正在写入，请稍后重试');
    }

    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > MAX_CHUNK_BYTES) {
      throw new HttpError(413, 'CHUNK_TOO_LARGE', '单个上传分片不能超过 16MB');
    }
    if (offset + contentLength > row.size_bytes) {
      throw new HttpError(400, 'UPLOAD_SIZE_OVERFLOW', '上传内容超过声明的视频大小');
    }

    this.active.add(uploadId);
    let received = offset;
    let output;
    try {
      output = createWriteStream(row.temp_path, {
        flags: 'r+',
        start: offset
      });
      req.on('data', (chunk) => {
        received += chunk.length;
        if (received > row.size_bytes) {
          req.destroy(new Error('上传内容超过声明大小'));
        }
      });
      try {
        await pipeline(req, output);
      } catch (error) {
        let recoverableOffset = received;
        try {
          recoverableOffset = statSync(row.temp_path).size;
        } catch {
          // Keep the byte count observed on the request stream.
        }
        recoverableOffset = Math.min(recoverableOffset, row.size_bytes);
        this.db.prepare(
          'UPDATE uploads SET received_bytes = ?, updated_at = ? WHERE id = ?'
        ).run(recoverableOffset, nowDateTime(), uploadId);
        throw new HttpError(
          400,
          'UPLOAD_INTERRUPTED',
          '分片上传中断，可从服务器记录的偏移继续上传',
          { receivedBytes: recoverableOffset }
        );
      }

      const actualSize = statSync(row.temp_path).size;
      if (actualSize !== received) {
        throw new HttpError(409, 'UPLOAD_SIZE_MISMATCH', '写入大小与接收大小不一致');
      }
      this.db.prepare(
        'UPDATE uploads SET received_bytes = ?, updated_at = ? WHERE id = ?'
      ).run(received, nowDateTime(), uploadId);

      if (received === row.size_bytes) {
        await this.finalize(actor, uploadId);
      }

      return uploadDto(this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId));
    } finally {
      this.active.delete(uploadId);
    }
  }

  async finalize(actor, uploadId) {
    const claimed = this.db.prepare(`
      UPDATE uploads
      SET status = '校验中', updated_at = ?
      WHERE id = ? AND status = '上传中' AND received_bytes = size_bytes
    `).run(nowDateTime(), uploadId);
    if (!claimed.changes) return;

    const row = this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId);
    let finalPath = null;
    try {
      const sha256 = await sha256File(row.temp_path);
      const size = statSync(row.temp_path).size;
      if (size !== row.size_bytes) {
        throw new Error(`文件大小校验失败：声明 ${row.size_bytes}，实际 ${size}`);
      }

      const taskId = nextTaskId(this.db);
      const finalDir = path.join(
        this.config.dataDir,
        'videos',
        nowDateTime().slice(0, 4),
        nowDateTime().slice(5, 7)
      );
      mkdirSync(finalDir, { recursive: true });
      finalPath = path.join(finalDir, `${taskId}${path.extname(row.original_name)}`);
      copyFileSync(row.temp_path, finalPath);

      const time = nowDateTime();
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare(`
          INSERT INTO tasks (
            id, file_name, file_path, size_bytes, user_id, device_id, status,
            started_at, queued_at, sha256, source_ip, retry_count, warnings_json,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, NULL, '排队中', ?, ?, ?, ?, 0, '[]', ?, ?)
        `).run(
          taskId,
          row.original_name,
          finalPath,
          row.size_bytes,
          row.user_id,
          row.started_at,
          time,
          sha256,
          actor.ip || '',
          time,
          time
        );
        this.db.prepare(`
          UPDATE uploads
          SET status = '已完成', sha256 = ?, task_id = ?, completed_at = ?, updated_at = ?
          WHERE id = ?
        `).run(sha256, taskId, time, time, uploadId);
        audit(this.db, actor, {
          type: '视频上传完成',
          objectType: '分析任务',
          objectId: taskId,
          after: '排队中',
          reason: `文件名 ${row.original_name}；SHA-256 ${sha256}；拍摄开始时间 ${row.started_at}`,
          result: '成功'
        });
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      try {
        unlinkSync(row.temp_path);
      } catch {
        // The committed upload remains retry-safe; orphan cleanup handles residue.
      }
    } catch (error) {
      if (finalPath && existsSync(finalPath)) {
        try {
          unlinkSync(finalPath);
        } catch {
          // Preserve the original upload error.
        }
      }
      this.db.prepare(`
        UPDATE uploads
        SET status = '失败', error_code = 'E-UPLOAD-HASH',
            error_message = ?, updated_at = ?
        WHERE id = ?
      `).run(String(error.message || error).slice(0, 500), nowDateTime(), uploadId);
      audit(this.db, actor, {
        type: '视频上传失败',
        objectType: '上传会话',
        objectId: uploadId,
        after: '失败',
        reason: String(error.message || error),
        result: '失败'
      });
      throw error;
    }
  }

  cancel(actor, uploadId) {
    const row = this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId);
    if (!row) throw new HttpError(404, 'UPLOAD_NOT_FOUND', '上传会话不存在');
    if (row.user_id !== actor.user.id && actor.user.role !== 'admin') {
      throw new HttpError(403, 'FORBIDDEN', '无权取消此上传');
    }
    if (!['上传中', '失败'].includes(row.status)) {
      throw new HttpError(409, 'UPLOAD_NOT_CANCELLABLE', '仅上传中或失败的上传可取消');
    }
    try {
      unlinkSync(row.temp_path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        UPDATE uploads SET status = '已取消', updated_at = ? WHERE id = ?
      `).run(nowDateTime(), uploadId);
      audit(this.db, actor, {
        type: '上传取消',
        objectType: '上传会话',
        objectId: uploadId,
        before: row.status,
        after: '已取消',
        reason: '用户取消尚未完成的上传',
        result: '成功'
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return uploadDto(this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId));
  }

  cleanupExpired() {
    const ttlMinutes = Math.max(1, Number(this.config.uploadSessionTtlMinutes || 120));
    const cutoff = Date.now() - ttlMinutes * 60 * 1000;
    const rows = this.db.prepare(`
      SELECT * FROM uploads
      WHERE status IN ('上传中', '失败', '校验中')
      ORDER BY updated_at ASC
      LIMIT 200
    `).all();
    const uploadRoot = path.resolve(this.uploadRoot) + path.sep;
    let cleaned = 0;
    for (const row of rows) {
      if (this.active.has(row.id)) continue;
      const updated = new Date(`${String(row.updated_at).replace(' ', 'T')}:00+08:00`).getTime();
      if (!Number.isFinite(updated) || updated > cutoff) continue;
      const tempPath = path.resolve(String(row.temp_path || ''));
      if (tempPath.startsWith(uploadRoot)) {
        rmSync(tempPath, { force: true, recursive: false });
        const directory = path.dirname(tempPath);
        if (`${path.resolve(directory)}${path.sep}`.startsWith(uploadRoot)) {
          rmSync(directory, { force: true, recursive: true });
        }
      }
      this.db.prepare(`
        UPDATE uploads
        SET status = '已取消', error_code = 'E-UPLOAD-EXPIRED',
            error_message = ?, updated_at = ?
        WHERE id = ? AND status IN ('上传中', '失败', '校验中')
      `).run(`超过 ${ttlMinutes} 分钟未继续上传`, nowDateTime(), row.id);
      audit(this.db, null, {
        type: '上传清理',
        objectType: '上传会话',
        objectId: row.id,
        before: row.status,
        after: '已取消（超时清理）',
        reason: `超过 ${ttlMinutes} 分钟未继续上传，自动释放临时空间`,
        result: '成功'
      });
      cleaned += 1;
    }

    // Remove orphan upload directories left by an abrupt process exit.
    try {
      const referenced = new Set(
        this.db.prepare("SELECT id FROM uploads WHERE status IN ('上传中', '校验中')")
          .all()
          .map((row) => row.id)
      );
      for (const entry of readdirSync(this.uploadRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || referenced.has(entry.name)) continue;
        const directory = path.join(this.uploadRoot, entry.name);
        if (statSync(directory).mtimeMs <= cutoff) {
          rmSync(directory, { force: true, recursive: true });
        }
      }
    } catch {
      // Directory scanning is best-effort and must not block API availability.
    }
    return cleaned;
  }
}

export const uploadLimits = {
  maxBytes: MAX_UPLOAD_BYTES,
  maxChunkBytes: MAX_CHUNK_BYTES,
  extensions: [...ALLOWED_EXTENSIONS]
};

