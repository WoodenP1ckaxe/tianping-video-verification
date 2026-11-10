import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase } from '../src/db.js';
import { AnalysisQueue } from '../src/services/queue.js';

function insertTask(db, id, status = '分析中', options = {}) {
  const dataDir = db.path;
  const filePath = options.filePath || join(dataDir, 'source.mp4');
  const size = options.size || 10;
  if (!options.filePath) writeFileSync(filePath, 'test-video');
  db.prepare(`
    INSERT INTO tasks (
      id, file_name, file_path, size_bytes, user_id, status,
      started_at, queued_at, analysis_started_at, sha256, created_at, updated_at
    ) VALUES (?, 'source.mp4', ?, ?, 'U001', ?, '2026-09-28 11:05',
      '2026-09-28 11:06', '2026-09-28 11:06', ?, '2026-09-28 11:06',
      '2026-09-28 11:06')
  `).run(id, filePath, size, status, 'A'.repeat(64));
  return filePath;
}

function readouts() {
  const values = [
    200.0062, 200.0031, 199.9987,
    50.0002, 49.9988, 50.0011,
    10.0001, 9.9994, 10.0006
  ];
  return values.map((value, index) => ({
    value,
    conf: 0.99,
    stable: true,
    range: 1,
    off: 30 + index * 30
  }));
}

function screenshotFixtures(db) {
  const folder = join(db.path, 'fixtures');
  mkdirSync(folder, { recursive: true });
  return Array.from({ length: 9 }, (_, index) => {
    const key = `I${Math.floor(index / 3) + 1}-${(index % 3) + 1}`;
    const relativePath = join('fixtures', `${key}.jpg`);
    writeFileSync(join(db.path, relativePath), Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]));
    return { key, path: relativePath };
  });
}

function setup(t) {
  const temporary = mkdtempSync(join(tmpdir(), 'tianping-identity-'));
  const { db } = openDatabase({
    dataDir: temporary,
    initialPassword: 'Tp123456'
  });
  Object.defineProperty(db, 'path', { value: temporary });
  const queue = new AnalysisQueue({
    db,
    config: { dataDir: temporary },
    storageService: { enforceQuota() {} }
  });
  t.after(() => {
    db.close();
    rmSync(temporary, { recursive: true, force: true });
  });
  return { db, queue, temporary };
}

test('自动分析缺少任一卡面时不生成正式记录', async (t) => {
  const { db, queue } = setup(t);
  insertTask(db, 'T-IDENTITY-001');
  await assert.rejects(
    queue.completeWithResult('T-IDENTITY-001', {
      personCard: null,
      deviceCard: { code: 'F001', conf: 0.99 },
      deviceId: 'F001',
      readouts: readouts(),
      rangeSwitch: true,
      screenshots: []
    }),
    (error) => error.code === 'E-1002' && /未生成正式记录/.test(error.message)
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM records WHERE task_id = ?')
      .get('T-IDENTITY-001').n,
    0
  );
});

test('人员卡与登录人员不一致时不生成正式记录', async (t) => {
  const { db, queue } = setup(t);
  insertTask(db, 'T-IDENTITY-002');
  await assert.rejects(
    queue.completeWithResult('T-IDENTITY-002', {
      personCard: { account: 'U002', conf: 0.99 },
      deviceCard: { code: 'F001', conf: 0.99 },
      deviceId: 'F001',
      readouts: readouts(),
      rangeSwitch: true,
      screenshots: []
    }),
    (error) => error.code === 'E-1004'
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM records WHERE task_id = ?')
      .get('T-IDENTITY-002').n,
    0
  );
});

test('设备卡与读数识别的天平不一致时不生成正式记录', async (t) => {
  const { db, queue } = setup(t);
  insertTask(db, 'T-IDENTITY-004');
  await assert.rejects(
    queue.completeWithResult('T-IDENTITY-004', {
      personCard: { account: 'U001', conf: 0.99 },
      deviceCard: { code: 'F002', conf: 0.99 },
      deviceId: 'F001',
      readouts: readouts(),
      rangeSwitch: true,
      screenshots: []
    }),
    (error) => error.code === 'E-1007'
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM records WHERE task_id = ?')
      .get('T-IDENTITY-004').n,
    0
  );
});

test('卡面齐全但有效读数缺少识别截图时仍不生成正式记录', async (t) => {
  const { db, queue } = setup(t);
  insertTask(db, 'T-IDENTITY-003');
  await assert.rejects(
    queue.completeWithResult('T-IDENTITY-003', {
      personCard: { account: 'U001', conf: 0.99 },
      deviceCard: { code: 'F001', conf: 0.99 },
      deviceId: 'F001',
      readouts: readouts(),
      rangeSwitch: true,
      screenshots: []
    }),
    (error) => error.code === 'E-READING-EVIDENCE-INCOMPLETE'
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM records WHERE task_id = ?')
      .get('T-IDENTITY-003').n,
    0
  );
});

test('模板选择标称点覆盖时，判定快照使用模板值', async (t) => {
  const { db, queue } = setup(t);
  insertTask(db, 'T-TEMPLATE-POINTS');
  const screenshots = screenshotFixtures(db);
  const currentTemplate = JSON.parse(
    db.prepare('SELECT config_json FROM template_versions ORDER BY id DESC LIMIT 1')
      .get().config_json
  );
  const record = await queue.completeWithResult('T-TEMPLATE-POINTS', {
    engine: 'test-contract-analyzer',
    personCard: { account: 'U001', conf: 0.99 },
    deviceCard: { code: 'F001', conf: 0.99 },
    deviceId: 'F001',
    readouts: readouts(),
    rangeSwitch: true,
    screenshots,
    analysisTemplate: {
      ...currentTemplate,
      points: [201, 51, 11],
      useTemplatePoints: true
    }
  });
  assert.deepEqual(record.deviceSnapshot.points, [201, 51, 11]);
  assert.deepEqual(record.templateSnapshot.points, [201, 51, 11]);
  assert.equal(record.templateSnapshot.useTemplatePoints, true);
});

test('管理员人工补录仍从原始视频补齐全部有效读数截图', {
  timeout: 120_000
}, async (t) => {
  const samplePath = resolve(
    import.meta.dirname,
    '../../客户原需求/测试视频样例/295ed49aaa4dc37eadf402db4d0b7434.mp4'
  );
  if (!existsSync(samplePath)) {
    t.skip('客户样例视频未随测试工作区提供');
    return;
  }
  const { db, queue } = setup(t);
  insertTask(db, 'T-MANUAL-EVIDENCE', '待人工处理', {
    filePath: samplePath,
    size: statSync(samplePath).size
  });
  const record = await queue.manualComplete(
    'T-MANUAL-EVIDENCE',
    { user: { id: 'U000', name: '系统管理员', role: 'admin' }, ip: '127.0.0.1' },
    {
      deviceId: 'F001',
      rangeSwitch: true,
      readouts: readouts(),
      cleanliness: '是',
      level: '是',
      internalCal: '是'
    }
  );
  assert.ok(record.readouts.every((item) => item.screenshot));
  assert.ok(record.readouts.every((item) => item.evidenceStatus === 'manual-frame'));
  assert.ok(record.rangeTransition === null || typeof record.rangeTransition === 'object');
});
