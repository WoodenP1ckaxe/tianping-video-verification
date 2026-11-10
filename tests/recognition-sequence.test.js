import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateRecord,
  findSequenceOrderViolation,
} from '../src/rules.js';
import {
  consolidateWeighingReadings,
  groupObservationSamples,
  stableObservationWindow,
} from '../src/services/display-ocr.js';

const device = {
  points: [200, 50, 10],
  ranges: 1,
  range1: { max: 220, d: 0.1 },
  range2: null,
  pointRange: [1, 1, 1],
  tol: 0.05,
};

function orderedReadouts() {
  return [200, 200, 200, 50, 50, 50, 10, 10, 10].map((value, index) => ({
    point: Math.floor(index / 3),
    idx: (index % 3) + 1,
    value,
    off: (index + 1) * 20,
    stable: true,
    conf: 0.96,
    range: 1,
  }));
}

function segments(sequence) {
  return sequence.map((point, index) => ({
    sequence: index + 1,
    point,
    value: device.points[point],
    off: (index + 1) * 20,
    stable: true,
  }));
}

function codes(record) {
  return evaluateRecord(record, device).reasons.map((reason) => reason.code);
}

test('完整且有序的时间序列通过判定', () => {
  const result = evaluateRecord({
    readouts: orderedReadouts(),
    recognition: {
      segments: segments([0, 0, 0, 1, 1, 1, 2, 2, 2]),
    },
  }, device);
  assert.equal(result.pass, true);
  assert.deepEqual(result.recognition.counts, [3, 3, 3]);
});

test('称重组乱序时使用真实时间序列判定', () => {
  const result = evaluateRecord({
    readouts: orderedReadouts(),
    recognition: {
      segments: segments([1, 1, 1, 0, 0, 0, 2, 2, 2]),
    },
  }, device);
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((reason) => reason.code === 'ORDER'));
  assert.deepEqual(result.recognition.sequence, [1, 1, 1, 0, 0, 0, 2, 2, 2]);
});

test('第 4 次称重不会在九项规范化时丢失', () => {
  const result = evaluateRecord({
    readouts: orderedReadouts(),
    recognition: {
      segments: segments([0, 0, 0, 0, 1, 1, 1, 2, 2, 2]),
    },
  }, device);
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((reason) => reason.code === 'DUPLICATE'));
  assert.ok(result.reasons.some((reason) => reason.code === 'EXTRA_READING'));
  assert.deepEqual(result.recognition.counts, [4, 3, 3]);
});

test('离开 L1 后再次称 L1 同时报告乱序和重复', () => {
  const result = evaluateRecord({
    readouts: orderedReadouts(),
    recognition: {
      segments: segments([0, 0, 0, 1, 1, 1, 0, 2, 2, 2]),
    },
  }, device);
  assert.ok(result.reasons.some((reason) => reason.code === 'ORDER'));
  assert.ok(result.reasons.some((reason) => reason.code === 'DUPLICATE'));
});

test('旧记录没有 recognition 证据时按识别帧偏移检测乱序', () => {
  const readouts = orderedReadouts();
  const timeByPoint = {
    0: [140, 160, 180],
    1: [20, 40, 60],
    2: [200, 220, 240],
  };
  const pointIndexes = [0, 0, 0];
  for (const readout of readouts) {
    const point = readout.point;
    readout.off = timeByPoint[point][pointIndexes[point]];
    pointIndexes[point] += 1;
  }
  const result = evaluateRecord({ readouts }, device);
  assert.ok(result.reasons.some((reason) => reason.code === 'ORDER'));
  assert.equal(result.recognition.timelineSource, 'readout-offsets');
});

test('同一标称点的示值波动不拆成多次称重，明确空档后形成新段', () => {
  const sample = (second, value) => ({
    point: 0,
    deviceId: 'F001',
    range: 1,
    device,
    decimals: 4,
    second,
    value,
    displayText: `${value} g`,
    confidence: 0.95,
    ocrMethod: 'test',
    ocrDetails: null,
  });
  const groups = groupObservationSamples([
    sample(0, 200.0008),
    sample(1, 200.0009),
    sample(2, 200.0008),
    sample(3, 200.0009),
    null,
    null,
    null,
    sample(7, 200.0008),
    sample(8, 200.0008),
    sample(9, 200.0009),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].start, 0);
  assert.equal(groups[0].end, 3);
  assert.ok(stableObservationWindow(groups[0]));
});

test('同一次称重的两个短暂稳定平台合并为一个称重段', () => {
  const reading = (start, end, value, stable = true) => ({
    deviceId: 'F002',
    point: 2,
    idx: 1,
    range: 2,
    decimals: 5,
    value,
    stable,
    confidence: 0.98,
    sampleCount: 4,
    off: end,
    segmentStart: start,
    segmentEnd: end,
    observedStart: start,
    observedEnd: end,
    observedMin: value,
    observedMax: value,
    recognizedText: `${value} g`,
    ocrMethod: 'test',
    ocrDetails: null,
  });
  const result = consolidateWeighingReadings([
    reading(0, 3, 2.00006),
    reading(7, 10, 2.00007),
  ]);
  assert.equal(result.readings.length, 1);
  assert.equal(result.readings[0].value, 2.00007);
  assert.equal(result.readings[0].stable, true);
  assert.equal(result.readings[0].mergedWindowCount, 2);
  assert.equal(result.corrections.mergedSameWeighingWindows.length, 1);
});

test('真正的重新称重不会被平台合并逻辑合并', () => {
  const reading = (start, end, value, idx) => ({
    deviceId: 'F002',
    point: 2,
    idx,
    range: 2,
    decimals: 5,
    value,
    stable: true,
    confidence: 0.98,
    sampleCount: 4,
    off: end,
    segmentStart: start,
    segmentEnd: end,
    observedStart: start,
    observedEnd: end,
    observedMin: value,
    observedMax: value,
    recognizedText: `${value} g`,
    ocrMethod: 'test',
    ocrDetails: null,
  });
  const result = consolidateWeighingReadings([
    reading(0, 3, 2.00006, 1),
    reading(20, 23, 2.00007, 2),
  ]);
  assert.equal(result.readings.length, 2);
});

test('称重过程中的短暂错误跨点孤岛不计为额外称重', () => {
  const reading = (point, start, end, value, sampleCount) => ({
    deviceId: 'F002',
    point,
    idx: 1,
    range: 2,
    decimals: 5,
    value,
    stable: true,
    confidence: 0.98,
    sampleCount,
    off: end,
    segmentStart: start,
    segmentEnd: end,
    observedStart: start,
    observedEnd: end,
    observedMin: value,
    observedMax: value,
    recognizedText: `${value} g`,
    ocrMethod: 'test',
    ocrDetails: null,
  });
  const result = consolidateWeighingReadings([
    reading(2, 0, 8, 2.00006, 9),
    reading(1, 9, 12, 20.0002, 4),
    reading(2, 13, 20, 2.00007, 8),
  ]);
  assert.equal(result.readings.length, 1);
  assert.equal(result.readings[0].point, 2);
  assert.equal(result.corrections.discardedTransientReadings.length, 1);
});

test('识别层保留第 4 次及以后称重段', () => {
  const samples = [];
  let second = 0;
  for (let weighing = 0; weighing < 5; weighing += 1) {
    for (let sampleIndex = 0; sampleIndex < 3; sampleIndex += 1) {
      samples.push({
        point: 0,
        deviceId: 'F001',
        range: 1,
        device,
        decimals: 4,
        second: second + sampleIndex,
        value: 200 + weighing * 0.0001,
        displayText: `${200 + weighing * 0.0001} g`,
        confidence: 0.95,
        ocrMethod: 'test',
        ocrDetails: null,
      });
    }
    second += 3;
    samples.push(null, null, null);
    second += 3;
  }
  const groups = groupObservationSamples(samples);
  assert.equal(groups.length, 5);
  assert.equal(groups[0].point, 0);
  assert.equal(groups[4].point, 0);
});

test('识别层按视频时间保留乱序称重组', () => {
  const samples = [];
  let second = 0;
  for (const point of [1, 1, 1, 0, 0, 0, 2, 2, 2]) {
    samples.push({
      point,
      deviceId: 'F001',
      range: 1,
      device,
      decimals: 4,
      second,
      value: device.points[point],
      displayText: `${device.points[point]} g`,
      confidence: 0.95,
      ocrMethod: 'test',
      ocrDetails: null,
    });
    second += 1;
  }
  const groups = groupObservationSamples(samples);
  assert.deepEqual(groups.map((group) => group.point), [1, 0, 2]);
});

test('顺序检查允许缺少中间组但不允许回退到前一组', () => {
  assert.equal(findSequenceOrderViolation([0, 0, 0, 2, 2, 2]), null);
  assert.deepEqual(findSequenceOrderViolation([0, 1, 0]), {
    index: 2,
    expectedMinimumPoint: 1,
    actualPoint: 0,
  });
});
