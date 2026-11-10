import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AnalyzerError,
  analyzeVideo,
  getAnalyzerStatus,
  metadataStartTime,
  parseCardIdentities,
} from '../src/services/analyzer.js';
import { evaluateRecord } from '../src/rules.js';
import {
  rankDisplayCandidates,
  terminateDisplayOcr
} from '../src/services/display-ocr.js';

after(async () => {
  await terminateDisplayOcr();
});

const sampleDirectory = resolve(
  import.meta.dirname,
  '../../客户原需求/测试视频样例',
);

const devices = [
  {
    id: 'F001',
    uniqueNo: 'DZTP170911C',
    dept: '化学室',
    max: 220,
    d: 0.1,
    ranges: 1,
    range1: { max: 220, d: 0.1 },
    range2: null,
    points: [200, 50, 10],
    pointRange: [1, 1, 1],
    tol: 0.05,
  },
  {
    id: 'F002',
    uniqueNo: 'SJS2605002',
    dept: '化学室',
    max: 120,
    d: 0.1,
    ranges: 2,
    range1: { max: 120, d: 0.1 },
    range2: { max: 40, d: 0.01 },
    points: [100, 20, 2],
    pointRange: [1, 2, 2],
    tol: 0.05,
  },
];

const samples = [
  {
    file: '295ed49aaa4dc37eadf402db4d0b7434.mp4',
    sha256: '920B7864BC2ED6D0A006189AF47613854B7F2FA630E9504FC43378615CAE23AE',
    conclusion: '通过',
    deviceId: 'F001',
  },
  {
    file: '13d9ccc8268f3f6c7d1dfd33e9716159.mp4',
    sha256: '574C0617BAE5AAD69AD7B318EE59F5E22C87311DC0D4931CB1E5D90148A30B32',
    conclusion: '不通过',
    deviceId: 'F002',
  },
  {
    file: '63bb2c36627c4e7efdfa6cf7a85bddec.mp4',
    sha256: 'EBCF18D525394DA664FFC37AD4FE691ADE2C33FF0106B4343B410E322EBCEFD0',
    conclusion: '通过',
    deviceId: 'F002',
  },
];

test('分析器报告真实能力状态', () => {
  const status = getAnalyzerStatus();
  assert.equal(status.supportsDisplayOcr, true);
  assert.equal(status.supportsArbitraryVideoOcr, true);
  assert.equal(status.engine, 'local-display-ocr');
  assert.equal(status.unsupportedVideoBehavior.includes('人工处理'), true);
});

test('人员卡支持系统允许的字母、数字与短横线账号', () => {
  const parsed = parseCardIdentities(
    [{ data: 'INSPECTOR-01' }, { data: 'DEVICE:F002' }],
    [{ id: 'INSPECTOR-01' }],
    devices,
  );
  assert.deepEqual(parsed.personIdentities, ['INSPECTOR-01']);
  assert.deepEqual(parsed.deviceIdentities, ['F002']);
  assert.deepEqual(parsed.cardConflicts, []);
});

test('视频拍摄时间元数据按上海时区转换为记录时间', () => {
  assert.equal(
    metadataStartTime('2026-09-28T03:05:00.000000Z'),
    '2026-09-28 11:05',
  );
  assert.equal(metadataStartTime('not-a-date'), null);
});

test('显示区候选优先保留已验证的默认固定机位', () => {
  const ranked = rankDisplayCandidates([
    {
      region: { x: 0.1, y: 0.62, width: 0.84, height: 0.16 },
      prior: false,
      matches: 2,
      pointCount: 2,
      deviceCount: 1,
      averageError: 0.0000045,
      confidence: 0.966
    },
    {
      region: { x: 0.1195, y: 0.651, width: 0.7537, height: 0.1198 },
      prior: true,
      matches: 2,
      pointCount: 2,
      deviceCount: 1,
      averageError: 0.0000045,
      confidence: 0.96
    }
  ]);
  assert.equal(ranked[0].prior, true);
});

for (const sample of samples) {
  test(`真实 OCR 分析 ${sample.file} 得到 ${sample.conclusion}`, {
    timeout: 180_000,
  }, async (t) => {
    const filePath = join(sampleDirectory, sample.file);
    if (!existsSync(filePath)) {
      t.skip('客户样例视频未随测试工作区提供');
      return;
    }
    const temp = mkdtempSync(join(tmpdir(), 'tianping-analysis-'));
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    const result = await analyzeVideo({
      filePath,
      sha256: 'F'.repeat(64),
      startedAt: '2026-09-28 08:30',
      uploadedBy: 'U001',
      devices,
      recordId: `TEST-${sample.deviceId}`,
      config: {
        dataDir: temp,
        screenshotDir: join(temp, 'screenshots'),
        analysisTimeoutMs: 90_000,
      },
    });
    assert.equal(result.deviceId, sample.deviceId);
    assert.equal(result.readouts.length, 9);
    assert.deepEqual(
      result.recognition.segments.map((segment) => segment.point),
      [0, 0, 0, 1, 1, 1, 2, 2, 2],
    );
    assert.deepEqual(result.recognition.pointCounts, [3, 3, 3]);
    assert.match(result.engine, /tesseract|seven-segment/i);
    assert.ok(result.ocr.scannedFrames > 0);
    const device = devices.find((candidate) => candidate.id === result.deviceId);
    const evaluation = evaluateRecord({
      readouts: result.readouts,
      rangeSwitch: result.rangeSwitch,
    }, device, device.tol);
    assert.equal(evaluation.conclusion, sample.conclusion);
    assert.ok(result.readouts.every((readout) => (
      readout.value === null
      || (
        readout.frame?.marked
        && Number.isFinite(readout.frame.offsetSeconds)
        && readout.frame.bbox?.width > 0
        && readout.frame.displayText
      )
    )));
    assert.ok(result.screenshots.every((screenshot) => (
      screenshot.bbox?.width > 0
      && Number.isFinite(screenshot.offsetSeconds)
      && screenshot.displayText
    )));
    assert.ok(result.media.duration > 60);
    assert.equal(result.media.videoCodec, 'h264');
    assert.equal(result.personCard, null);
    assert.equal(result.deviceCard, null);
    assert.equal(result.ocr.personInference, 'missing');
    assert.equal(result.ocr.deviceInference, 'registered-points');
    assert.equal(result.ocr.displayRegionSource, 'automatic-candidate-search');
    assert.ok(result.ocr.displayRegionMatches >= 2);
    const manifest = JSON.parse(readFileSync(
      join(
        import.meta.dirname,
        '..',
        'samples',
        'manifests',
        `${sample.sha256}.json`
      ),
      'utf8'
    ));
    const actualReadouts = new Map(result.readouts.map((readout) => [
      `${readout.point}:${readout.idx}`,
      readout
    ]));
    for (const expected of manifest.readouts) {
      const actual = actualReadouts.get(`${expected.point}:${expected.idx}`);
      assert.ok(actual, `缺少 ${expected.point}:${expected.idx}`);
      assert.equal(actual.value, expected.value);
      assert.equal(actual.off, expected.off);
      assert.equal(actual.stable, expected.stable);
      assert.equal(actual.range, expected.range);
    }
    if (device.ranges === 2) {
      assert.equal(result.rangeSwitch, true);
      assert.ok(result.rangeTransition);
      assert.equal(result.rangeTransition.fromRange, 1);
      assert.equal(result.rangeTransition.toRange, 2);
      assert.ok(result.rangeTransition.endOffsetSeconds >= result.rangeTransition.startOffsetSeconds);
    }
    assert.ok(readdirSync(join(temp, 'screenshots', `TEST-${sample.deviceId}`)).length >= 8);
  });
}

test('显示屏 ROI 无有效读数时不会被伪装成自动识别成功', {
  timeout: 60_000,
}, async (t) => {
  const sample = samples[0];
  const filePath = join(sampleDirectory, sample.file);
  if (!existsSync(filePath)) {
    t.skip('客户样例视频未随测试工作区提供');
    return;
  }
  await assert.rejects(
    analyzeVideo({
      filePath,
      sha256: '0'.repeat(64),
      startedAt: '2026-09-28 08:30',
      uploadedBy: 'U001',
      devices,
      config: {
        analysisTimeoutMs: 90_000,
        displayRegion: {
          x: 0.5,
          y: 0.02,
          width: 0.3,
          height: 0.08,
        },
        enableTesseractFallback: false,
      },
    }),
    (error) => error instanceof AnalyzerError &&
      error.code === 'E_DISPLAY_OCR_FAILED' &&
      error.status === '待人工处理',
  );
});
