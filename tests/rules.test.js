import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateLimits,
  decimalsFromD,
  evaluateRecord,
  recommendPoints,
  submitBlockers,
} from '../src/rules.js';

const singleRange = {
  id: 'F001',
  ranges: 1,
  range1: { max: 220, d: 0.1 },
  range2: null,
  points: [200, 50, 10],
  pointRange: [1, 1, 1],
  tol: 0.05,
};

const doubleRange = {
  id: 'F002',
  ranges: 2,
  range1: { max: 120, d: 0.1 },
  range2: { max: 40, d: 0.01 },
  points: [100, 20, 2],
  pointRange: [1, 2, 2],
  tol: 0.05,
};

function readouts(values, ranges = null) {
  return values.map((value, index) => ({
    point: Math.floor(index / 3),
    idx: (index % 3) + 1,
    value,
    unit: 'g',
    off: 30 + index * 20,
    conf: 0.995,
    stable: true,
    range: ranges?.[Math.floor(index / 3)] || 1,
  }));
}

test('小数位与附录 C 的限度一致', () => {
  assert.equal(decimalsFromD(0.1), 4);
  assert.equal(decimalsFromD(0.01), 5);
  assert.equal(decimalsFromD(1), 3);
  assert.deepEqual(calculateLimits(200, 4, 0.05), { lo: 199.9, hi: 200.1 });
  assert.deepEqual(calculateLimits(50, 4, 0.05), { lo: 49.975, hi: 50.025 });
  assert.deepEqual(calculateLimits(20, 5, 0.05), { lo: 19.99, hi: 20.01 });
});

test('单量程合格记录通过且全部读数在限内', () => {
  const values = [200.0062, 200.0031, 199.9987, 50.0002, 49.9988, 50.0011, 10.0001, 9.9994, 10.0006];
  const result = evaluateRecord({ readouts: readouts(values), rangeSwitch: true }, singleRange);
  assert.equal(result.conclusion, '通过');
  assert.equal(result.pass, true);
  assert.equal(result.reasons.length, 0);
  assert.equal(result.items.length, 9);
  assert.ok(result.items.every((item) => item.inLimit));
});

test('容差上下限端点判为在限内', () => {
  const values = [199.9, 200.1, 200, 49.975, 50.025, 50, 9.995, 10.005, 10];
  const result = evaluateRecord({ readouts: readouts(values), rangeSwitch: true }, singleRange);
  assert.equal(result.conclusion, '通过');
  assert.ok(result.items.every((item) => item.inLimit));
});

test('超限值给出具体编号、限度与偏差', () => {
  const values = [200.0062, 200.3374, 199.9, 50.0002, 49.9749, 50.0008, 10.0001, 9.9997, 10.0003];
  const result = evaluateRecord({ readouts: readouts(values), rangeSwitch: true }, singleRange);
  assert.equal(result.conclusion, '不通过');
  const overLimit = result.reasons.filter((reason) => reason.code === 'OVER_LIMIT');
  assert.equal(overLimit.length, 2);
  assert.match(overLimit[0].detail, /I1-2/);
  assert.match(overLimit[1].detail, /I2-2/);
  assert.equal(result.items[2].inLimit, true);
});

test('缺次、重复和顺序错误均产生明确原因', () => {
  const normal = readouts([
    200, 200, 200, 50, 50, 50, 10, 10, 10,
  ]);
  const missing = normal.map((item, index) => index === 8 ? { ...item, value: null } : item);
  const missingResult = evaluateRecord({ readouts: missing, rangeSwitch: true }, singleRange);
  assert.equal(missingResult.conclusion, '不通过');
  assert.ok(missingResult.reasons.some((reason) => reason.code === 'MISSING'));

  const duplicate = [...normal.slice(0, 4), ...normal.slice(3)];
  const duplicateResult = evaluateRecord({ readouts: duplicate, rangeSwitch: true }, singleRange);
  assert.ok(duplicateResult.reasons.some((reason) => reason.code === 'DUPLICATE'));

  const wrongOrder = [normal[3], ...normal.slice(0, 3), ...normal.slice(4)];
  const orderResult = evaluateRecord({ readouts: wrongOrder, rangeSwitch: true }, singleRange);
  assert.ok(orderResult.reasons.some((reason) => reason.code === 'ORDER'));
});

test('不稳定读数判为不通过', () => {
  const values = [200, 200, 200, 50, 50, 50, 10, 10, 10];
  const list = readouts(values);
  list[3].stable = false;
  const result = evaluateRecord({ readouts: list, rangeSwitch: true }, singleRange);
  assert.equal(result.conclusion, '不通过');
  assert.ok(result.reasons.some((reason) => reason.code === 'UNSTABLE'));
});

test('双量程检查切换段和量程归属', () => {
  const values = [100.0003, 100.0001, 99.9998, 20.00005, 19.99998, 20.00008, 2.00001, 1.99998, 2.00002];
  const list = readouts(values, [1, 2, 2]);
  const pass = evaluateRecord({ readouts: list, rangeSwitch: true }, doubleRange);
  assert.equal(pass.conclusion, '通过');
  assert.deepEqual([...new Set(pass.items.map((item) => item.range))], [1, 2]);

  const noSwitch = evaluateRecord({ readouts: list, rangeSwitch: false }, doubleRange);
  assert.ok(noSwitch.reasons.some((reason) => reason.code === 'NO_RANGE_SWITCH'));

  const wrongRange = readouts(values, [1, 1, 2]);
  const wrongResult = evaluateRecord({ readouts: wrongRange, rangeSwitch: true }, doubleRange);
  assert.ok(wrongResult.reasons.some((reason) => reason.code === 'WRONG_RANGE'));
});

test('标称点推荐覆盖说明书两种典型天平', () => {
  assert.deepEqual(recommendPoints(singleRange), [200, 50, 10]);
  assert.deepEqual(recommendPoints(doubleRange), [100, 20, 2]);
});

test('提交前阻止未核对低置信字段', () => {
  const values = [200.0062, 200.0031, 199.9987, 50.0002, 49.9988, 50.0011, 10.0001, 9.9994, 10.0006];
  const list = readouts(values);
  list[1].conf = 0.65;
  const record = {
    readouts: list,
    rangeSwitch: true,
    box: 'FM2512920',
    cleanliness: '是',
    level: '是',
    internalCal: '是',
    checkedFields: {},
  };
  assert.ok(submitBlockers(record, singleRange).some((message) => message.includes('I1-2')));
  record.checkedFields['RO:I1-2'] = true;
  assert.deepEqual(submitBlockers(record, singleRange), []);
});
