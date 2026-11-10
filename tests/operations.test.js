import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ApplicationLogger } from '../src/services/logs.js';
import { StorageService } from '../src/services/storage.js';
import { openDatabase } from '../src/db.js';

const root = resolve(import.meta.dirname, '..');

test('Docker 运行配置包含媒体、字体、健康检查和非 root 用户', () => {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
  assert.match(dockerfile, /FROM node:24/);
  assert.match(dockerfile, /ffmpeg/);
  assert.match(dockerfile, /fonts-noto-cjk/);
  assert.match(dockerfile, /poppler-utils/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /USER node/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
});

test('SQLite 备份生成一致性快照并通过完整性验证', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'tianping-backup-'));
  const dataDir = join(temporary, 'data');
  const backupDir = join(temporary, 'backups');
  mkdirSync(dataDir, { recursive: true });
  const databasePath = join(dataDir, 'tianping.db');
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE sample (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT INTO sample VALUES (?, ?)').run('1', '天平校验');
  db.close();

  try {
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'maintenance.js'), 'backup'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        DATABASE_PATH: databasePath,
        BACKUP_DIR: backupDir,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const backups = readdirSync(backupDir).filter((name) => name.endsWith('.db'));
    assert.equal(backups.length, 1);
    const backupPath = join(backupDir, backups[0]);
    assert.equal(existsSync(backupPath), true);
    const restored = new DatabaseSync(backupPath, { readOnly: true });
    const row = restored.prepare('SELECT value FROM sample WHERE id = ?').get('1');
    const integrity = restored.prepare('PRAGMA integrity_check').get();
    restored.close();
    assert.equal(row.value, '天平校验');
    assert.equal(Object.values(integrity)[0], 'ok');

    const verified = spawnSync(
      process.execPath,
      [join(root, 'scripts', 'maintenance.js'), 'verify', backupPath],
      { cwd: root, encoding: 'utf8', env: { ...process.env, BACKUP_DIR: backupDir } },
    );
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /备份有效/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('离线 Compose 生成器移除构建段并复用本地固定镜像', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'tianping-compose-'));
  const target = join(temporary, 'docker-compose.offline.yml');
  try {
    const result = spawnSync(
      process.execPath,
      [join(root, 'scripts', 'make-offline-compose.js'), target],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const text = readFileSync(target, 'utf8');
    assert.match(text, /image: tianping-system:\d+\.\d+\.\d+/);
    assert.doesNotMatch(text, /^\s+build:/m);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('应用日志按大小轮转、可读取并可导出', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'tianping-logs-'));
  try {
    const logger = new ApplicationLogger({
      config: { dataDir: temporary },
      maxBytes: 64 * 1024
    });
    for (let index = 0; index < 1500; index += 1) {
      logger.info('日志轮转回归测试', { index, payload: 'x'.repeat(80) });
    }
    const status = logger.status();
    assert.ok(status.fileCount >= 2);
    assert.ok(status.totalBytes >= 64 * 1024);
    assert.ok(status.recent.length > 0);
    assert.match(logger.exportText(), /日志轮转回归测试/);

    const old = new Date(Date.now() - 40 * 86_400_000);
    for (const file of logger.listFiles()) {
      utimesSync(join(logger.root, file.name), old, old);
    }
    assert.ok(logger.cleanup(30) >= 1);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('运行状态按在用天平每日一次和平均视频大小预估剩余时长', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'tianping-storage-'));
  const { db } = openDatabase({
    dataDir: temporary,
    initialPassword: 'Tp123456'
  });
  t.after(() => {
    db.close();
    rmSync(temporary, { recursive: true, force: true });
  });
  const videoDir = join(temporary, 'videos');
  mkdirSync(videoDir, { recursive: true });
  const videoPath = join(videoDir, 'sample.mp4');
  writeFileSync(videoPath, Buffer.alloc(10 * 1024 * 1024));
  db.prepare(`
    INSERT INTO tasks (
      id, file_name, file_path, size_bytes, user_id, device_id, status,
      started_at, queued_at, created_at, updated_at
    ) VALUES ('T-STORAGE', 'sample.mp4', ?, ?, 'U001', 'F001', '已完成',
      '2026-11-08 10:00', '2026-11-08 10:00', '2026-11-08 10:00',
      '2026-11-08 10:00')
  `).run(videoPath, 10 * 1024 * 1024);
  db.prepare(`
    UPDATE settings SET value_json = '1' WHERE key = 'videoQuotaGb'
  `).run();
  const storage = new StorageService({
    db,
    config: {
      dataDir: temporary,
      minFreeDiskBytes: 0
    }
  });
  const stats = storage.getStats();
  assert.equal(stats.videoCount, 1);
  assert.equal(stats.storageEstimate.averageVideoBytes, 10 * 1024 * 1024);
  assert.equal(stats.storageEstimate.plannedDailyVideoCount, 2);
  assert.equal(stats.storageEstimate.quotaRetainDays, 50);
  assert.equal(stats.storageEstimate.basis, '按每台在用天平每天 1 次校验记录估算');
});
