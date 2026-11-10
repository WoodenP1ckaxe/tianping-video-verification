import {
  audit,
  getDevices,
  getRecord,
  jsonParse,
  jsonString,
  nowDateTime
} from '../db.js';
import {
  DEFAULT_TOLERANCE_PERCENT,
  evaluateRecord
} from '../rules.js';

export function recordDevice(record, currentDevice) {
  return {
    ...(currentDevice || {}),
    ...(record?.deviceSnapshot || {})
  };
}

export function recordTolerance(record, device, template = null) {
  const candidates = [
    device?.tol,
    record?.tolerancePercent,
    template?.tol,
    record?.templateSnapshot?.tol,
    DEFAULT_TOLERANCE_PERCENT
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return DEFAULT_TOLERANCE_PERCENT;
}

export function snapshotEvaluation(evaluation, judgedAt = nowDateTime()) {
  return {
    conclusion: evaluation.conclusion,
    pass: evaluation.pass,
    tol: evaluation.tol,
    reasons: evaluation.reasons,
    items: evaluation.items,
    recognition: evaluation.recognition,
    ruleVersion: evaluation.ruleVersion,
    judgedAt
  };
}

export function evaluateAndSnapshot(record, device, tolerancePercent, judgedAt) {
  const evaluation = evaluateRecord(record, device, tolerancePercent);
  return snapshotEvaluation(evaluation, judgedAt);
}

export function persistJudgment(db, recordId, judgment, options = {}) {
  if (options.touch === false) {
    db.prepare(`
      UPDATE records
      SET conclusion = ?, judgment_json = ?, judged_at = ?, rule_version = ?,
          tolerance_percent = ?
      WHERE id = ?
    `).run(
      judgment.conclusion,
      jsonString(judgment),
      judgment.judgedAt,
      judgment.ruleVersion,
      judgment.tol,
      recordId
    );
    return;
  }
  db.prepare(`
    UPDATE records
    SET conclusion = ?, judgment_json = ?, judged_at = ?, rule_version = ?,
        tolerance_percent = ?, updated_at = ?
    WHERE id = ?
  `).run(
    judgment.conclusion,
    jsonString(judgment),
    judgment.judgedAt,
    judgment.ruleVersion,
    judgment.tol,
    nowDateTime(),
    recordId
  );
}

export function storedJudgment(record) {
  if (!record?.judgment?.conclusion
    || !Array.isArray(record.judgment.items)
    || !Array.isArray(record.judgment.reasons)) {
    return null;
  }
  return record.judgment;
}

export function backfillStoredJudgments(db) {
  const devices = new Map(getDevices(db).map((device) => [device.id, device]));
  const rows = db.prepare(`
    SELECT id
    FROM records
    WHERE conclusion IS NULL
      OR judgment_json IS NULL
      OR judgment_json = '{}'
      OR judged_at IS NULL
      OR rule_version IS NULL
    ORDER BY id
  `).all();
  if (!rows.length) return 0;
  let updated = 0;
  let skipped = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      try {
        const record = getRecord(db, row.id);
        const device = recordDevice(record, devices.get(record.device));
        if (!device?.points?.length) {
          skipped += 1;
          continue;
        }
        const raw = db.prepare(
          'SELECT judgment_json FROM records WHERE id = ?'
        ).get(record.id);
        const existing = jsonParse(raw?.judgment_json, {});
        let judgment = storedJudgment({ ...record, judgment: existing });
        if (!judgment) {
          judgment = evaluateAndSnapshot(
            record,
            device,
            recordTolerance(record, device),
            record.analyzedAt || record.createdAt || nowDateTime()
          );
        }
        persistJudgment(db, record.id, judgment, { touch: false });
        updated += 1;
      } catch {
        skipped += 1;
      }
    }
    if (updated || skipped) {
      audit(db, null, {
        type: '历史判定快照补齐',
        objectType: '校验记录',
        objectId: 'legacy-records',
        after: `${updated} 条已补齐，${skipped} 条因档案或数据异常跳过`,
        reason: '首次启动时把历史记录固定为可追溯的判定快照',
        result: skipped ? '待处理' : '成功'
      });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return updated;
}
