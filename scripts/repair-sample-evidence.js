import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeVideo } from '../src/services/analyzer.js';
import { evaluateRecord } from '../src/rules.js';
import {
  audit,
  getDevices,
  nowDateTime,
} from '../src/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const dbPath = path.join(dataDir, 'tianping.db');
const db = new DatabaseSync(dbPath);

const candidates = db.prepare(`
  SELECT r.*, t.file_path AS task_file_path
  FROM records r
  JOIN tasks t ON t.id = r.task_id
  WHERE r.status = '待提交'
    AND (
      lower(r.sha256) = '920b7864bc2ed6d0a006189af47613854b7f2fa630e9504fc43378615cae23ae'
      OR lower(r.sha256) = '574c0617bae5aad69ad7b318ee59f5e22c87311dc0d4931cb1e5d90148a30b32'
      OR lower(r.sha256) = 'ebcf18d525394da664ffc37ad4fe691ade2c33ff0106b4343b410e322ebcefd0'
    )
`).all();

if (!candidates.length) {
  console.log('没有需要校准的待提交样例记录。');
  db.close();
  process.exit(0);
}

const devices = getDevices(db);
let repaired = 0;

for (const record of candidates) {
  if (!record.task_file_path) {
    console.warn(`跳过 ${record.id}：原始视频路径不存在`);
    continue;
  }
  const analysis = await analyzeVideo({
    filePath: record.task_file_path,
    sha256: record.sha256,
    startedAt: record.started_at,
    uploadedBy: record.inspector_id,
    devices,
    recordId: record.id,
    config: {
      ...process.env,
      dataDir,
      screenshotDir: path.join(dataDir, 'screenshots'),
      ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
      ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
    },
  });
  const device = devices.find((candidate) => candidate.id === analysis.deviceId);
  const preview = {
    readouts: analysis.readouts,
    rangeSwitch: analysis.rangeSwitch,
    tolerancePercent: device.tol,
  };
  const evaluation = evaluateRecord(preview, device, device.tol);
  const time = nowDateTime();
  db.prepare(`
    UPDATE records
    SET readouts_json = ?,
        person_card_json = ?,
        device_card_json = ?,
        range_switch = ?,
        duration_seconds = ?,
        device_id = ?,
        analyzed_at = ?,
        updated_at = ?
    WHERE id = ? AND status = '待提交'
  `).run(
    JSON.stringify(analysis.readouts),
    JSON.stringify(analysis.personCard),
    JSON.stringify(analysis.deviceCard),
    // Legacy speech_json remains in old databases but is no longer part of the workflow.
    analysis.rangeSwitch ? 1 : 0,
    analysis.durationSeconds,
    analysis.deviceId,
    time,
    time,
    record.id,
  );
  audit(db, null, {
    type: '样例识别帧校准',
    objectType: '校验记录',
    objectId: record.id,
    before: '旧偏移与识别值',
    after: `9 个真实视频帧已框选；复算结论 ${evaluation.conclusion}`,
    reason: '修正样例清单与真实视频帧不一致的问题',
    result: '成功',
  });
  repaired += 1;
  console.log(
    `${record.id}: 已绑定 9 个真实识别帧，` +
    `复算结论=${evaluation.conclusion}，` +
    `依据=${evaluation.reasons.map((reason) => reason.label).join('、') || '全部满足'}`,
  );
}

db.close();
console.log(`识别帧校准完成：${repaired} 条待提交记录。`);
