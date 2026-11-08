/**
 * 天平校验判定引擎。
 *
 * 该模块不依赖数据库、HTTP 或界面，任何调用方使用同一组标称值、容差与读数都会
 * 得到相同结论。示值比较基于十进制容差，边界包含端点。
 */

export const DEFAULT_TOLERANCE_PERCENT = 0.05;
export const LOW_CONFIDENCE_THRESHOLD = 0.9;
const EPSILON = 1e-10;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function decimalsFromD(dmg) {
  const dGram = finiteNumber(dmg);
  if (dGram === null || dGram <= 0) return 4;
  const decimals = Math.ceil(-Math.log10(dGram / 1000) - EPSILON);
  return Math.max(0, Math.min(8, decimals));
}

export function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function formatNumber(value, decimals) {
  const number = finiteNumber(value);
  return number === null ? '—' : number.toFixed(decimals);
}

export function calculateLimits(nominal, decimals, tolerancePercent = DEFAULT_TOLERANCE_PERCENT) {
  const tolerance = finiteNumber(tolerancePercent);
  const safeTolerance = tolerance === null ? DEFAULT_TOLERANCE_PERCENT : tolerance;
  const ratio = safeTolerance / 100;
  return {
    lo: roundTo(Number(nominal) * (1 - ratio), decimals),
    hi: roundTo(Number(nominal) * (1 + ratio), decimals),
  };
}

export function readoutKey(readout, fallbackIndex = -1) {
  if (readout?.key) return String(readout.key);
  const point = Number.isInteger(Number(readout?.point)) ? Number(readout.point) : Math.floor(fallbackIndex / 3);
  const index = Number.isInteger(Number(readout?.idx)) ? Number(readout.idx) : (fallbackIndex % 3) + 1;
  return `I${point + 1}-${index}`;
}

export function getRange(device, point, readout = null) {
  if (Number(device?.ranges) !== 2) return 1;
  const candidate = Number(readout?.range ?? device?.pointRange?.[point]);
  return candidate === 2 ? 2 : 1;
}

export function getRangeDecimals(device, range) {
  const spec = range === 2 ? device?.range2 : device?.range1;
  if (spec?.d !== undefined) return decimalsFromD(spec.d);
  return decimalsFromD(device?.d);
}

export function recommendPoints(device) {
  const max1 = finiteNumber(device?.range1?.max ?? device?.max) ?? 220;
  const max2 = finiteNumber(device?.range2?.max);
  const lower = (value) => {
    const max = Math.max(1, value);
    for (let exponent = 4; exponent >= -2; exponent -= 1) {
      for (const multiplier of [5, 2, 1]) {
        const candidate = multiplier * 10 ** exponent;
        if (candidate <= max + EPSILON) return candidate;
      }
    }
    return max;
  };

  if (Number(device?.ranges) === 2 && max2) {
    return [lower(max1 * 5 / 6), lower(max2 / 2), lower(max2 / 20)];
  }
  const first = lower(max1 * 10 / 11);
  return [first, lower(first / 4), lower(first / 20)];
}

function normalizeReadouts(record) {
  if (!Array.isArray(record?.readouts)) return [];
  return record.readouts.map((readout, index) => ({
    ...readout,
    point: Number(readout?.point),
    idx: Number(readout?.idx ?? ((index % 3) + 1)),
    value: finiteNumber(readout?.value),
    conf: finiteNumber(readout?.conf),
    stable: readout?.stable !== false,
    range: finiteNumber(readout?.range),
  }));
}

function addReason(reasons, code, label, detail) {
  const signature = `${code}\u0000${detail}`;
  if (reasons.some((item) => item.signature === signature)) return;
  reasons.push({ code, label, detail, signature });
}

/**
 * 对完整记录执行可复算判定。
 *
 * @param {object} record
 * @param {object} device
 * @param {number} [tolerancePercent]
 * @returns {{conclusion:string,pass:boolean,tol:number,reasons:object[],items:object[],groups:object[][]}}
 */
export function evaluateRecord(record, device, tolerancePercent) {
  if (!device || !Array.isArray(device.points) || device.points.length !== 3) {
    throw new TypeError('天平档案缺少 3 个砝码标称点');
  }

  const toleranceCandidate = finiteNumber(tolerancePercent ?? record?.tol ?? record?.templateTolerance);
  const tol = toleranceCandidate === null
    ? (finiteNumber(device.tol) ?? DEFAULT_TOLERANCE_PERCENT)
    : toleranceCandidate;
  const sourceReadouts = normalizeReadouts(record);
  const groups = [[], [], []];
  const items = [];
  const reasons = [];
  const sequence = [];

  for (let index = 0; index < sourceReadouts.length; index += 1) {
    const readout = sourceReadouts[index];
    const point = readout.point;
    if (!Number.isInteger(point) || point < 0 || point > 2) {
      addReason(
        reasons,
        'INVALID_GROUP',
        '称重组别异常',
        `第 ${index + 1} 个读数无法归入 L1/L2/L3 中任一组`,
      );
      continue;
    }
    groups[point].push(readout);
    sequence.push(point);

    const nominal = finiteNumber(device.points[point]);
    const expectedRange = Number(device.ranges) === 2
      ? (Number(device.pointRange?.[point]) === 2 ? 2 : (point === 0 ? 1 : 2))
      : 1;
    const range = getRange(device, point, readout);
    const decimals = getRangeDecimals(device, range);
    const limits = calculateLimits(nominal, decimals, tol);
    const value = readout.value;
    const missing = value === null;
    const inLimit = !missing && value >= limits.lo - EPSILON && value <= limits.hi + EPSILON;
    const deviation = missing ? null : roundTo(value - nominal, decimals);

    items.push({
      key: readoutKey(readout, index),
      point,
      idx: readout.idx,
      L: nominal,
      value,
      unit: readout.unit || 'g',
      off: readout.off ?? null,
      time: readout.time ?? null,
      dec: decimals,
      lim: limits,
      dev: deviation,
      range,
      expectedRange,
      rangeLabel: Number(device.ranges) === 2 ? (range === 2 ? '低量程' : '高量程') : '单量程',
      inLimit,
      missing,
      stable: readout.stable,
      conf: readout.conf,
      screenshot: readout.screenshot ?? null,
    });

    if (Number(device.ranges) === 2 && range !== expectedRange) {
      addReason(
        reasons,
        'WRONG_RANGE',
        '量程归属错误',
        `${readoutKey(readout, index)} 应归入${expectedRange === 1 ? '高' : '低'}量程，识别结果为${range === 1 ? '高' : '低'}量程`,
      );
    }
  }

  groups.forEach((group, point) => {
    const nominal = finiteNumber(device.points[point]);
    const valid = group.filter((readout) => readout.value !== null);
    if (valid.length < 3) {
      const missingKeys = group.filter((readout) => readout.value === null)
        .map((readout, index) => readoutKey(readout, point * 3 + index));
      addReason(
        reasons,
        'MISSING',
        '缺次',
        `L${point + 1}（${nominal}g）仅识别到 ${valid.length} 次有效称重，应为 3 次` +
          (missingKeys.length ? `（${missingKeys.join('、')} 未识别到有效读数）` : ''),
      );
    }
    if (group.length > 3) {
      addReason(
        reasons,
        'DUPLICATE',
        '重复称重',
        `L${point + 1}（${nominal}g）识别到 ${group.length} 次称重，多于要求的 3 次`,
      );
    }
  });

  const expectedSequence = [0, 0, 0, 1, 1, 1, 2, 2, 2];
  const sequenceMismatch = sequence.some((point, index) => point !== expectedSequence[index]);
  if (sequenceMismatch) {
    const actual = sequence.map((point) => `L${point + 1}`).join(' → ') || '（无有效读数）';
    addReason(
      reasons,
      'ORDER',
      '顺序错误',
      `实际称重顺序为 ${actual}，与要求的 L1×3 → L2×3 → L3×3 不一致`,
    );
  }

  if (Number(device.ranges) === 2 && record?.rangeSwitch === false) {
    addReason(
      reasons,
      'NO_RANGE_SWITCH',
      '缺少量程切换',
      '双量程天平未识别到量程切换过程段（应完成高量程 3 次，再切换至低量程完成 6 次）',
    );
  }

  items.forEach((item) => {
    if (item.missing) {
      addReason(
        reasons,
        'MISSING_READING',
        '缺次',
        `${item.key} 未识别到有效读数`,
      );
      return;
    }
    if (!item.inLimit) {
      addReason(
        reasons,
        'OVER_LIMIT',
        '示值超限',
        `${item.key} 示值 ${formatNumber(item.value, item.dec)}g 超出限度 ` +
          `${formatNumber(item.lim.lo, item.dec)}g~${formatNumber(item.lim.hi, item.dec)}g` +
          `（偏差 ${signedNumber(item.dev, item.dec)}g）`,
      );
    }
    if (item.stable === false) {
      addReason(
        reasons,
        'UNSTABLE',
        '读数不稳定',
        `${item.key} 在连续不少于 3 秒的区间内未找到变化不超过 1 个分度值 d 的稳定平台段`,
      );
    }
  });

  if (sourceReadouts.length > 9 && sequence.length === 9) {
    addReason(
      reasons,
      'EXTRA_READING',
      '多余读数',
      `识别到 ${sourceReadouts.length} 个读数，完整校验应为 9 个读数`,
    );
  }

  const cleanReasons = reasons.map(({ signature, ...reason }) => reason);
  return {
    conclusion: cleanReasons.length === 0 ? '通过' : '不通过',
    pass: cleanReasons.length === 0,
    tol,
    reasons: cleanReasons,
    items,
    groups,
  };
}

export function signedNumber(value, decimals) {
  const number = finiteNumber(value);
  if (number === null) return '—';
  const formatted = number.toFixed(decimals);
  return number > 0 ? `+${formatted}` : formatted;
}

export function judgementBasis(record, device, result = null) {
  const evaluation = result || evaluateRecord(record, device);
  if (evaluation.pass) {
    return `9 次读数均在 (1±${evaluation.tol}%)×L 限度内（含端点），` +
      `各组各 3 次、顺序正确、读数稳定` +
      (Number(device.ranges) === 2 ? '，且量程切换与量程归属正确' : '') +
      '，判定为“通过”。';
  }
  return `共 ${evaluation.reasons.length} 项不满足：` +
    `${evaluation.reasons.map((reason) => reason.label).join('、')}，判定为“不通过”。`;
}

export function lowConfidenceItems(record, device, threshold = LOW_CONFIDENCE_THRESHOLD) {
  const items = evaluateRecord(record, device).items;
  return items.filter((item) => item.conf === null || item.conf < threshold);
}

export function submitBlockers(record, device, options = {}) {
  const blockers = [];
  const threshold = finiteNumber(options.threshold) ?? LOW_CONFIDENCE_THRESHOLD;
  if (!record?.box) blockers.push('砝码盒编号未填写');
  for (const [field, label] of [
    ['cleanliness', '清洁'],
    ['level', '水平调节'],
    ['internalCal', '内部校正是否通过'],
  ]) {
    if (!record?.[field]) blockers.push(`“${label}”未确认`);
  }

  const checked = record?._checked || record?.checkedFields || {};
  const lowReadouts = lowConfidenceItems(record, device, threshold)
    .filter((item) => !checked[`RO:${item.key}`]);
  if (lowReadouts.length) {
    blockers.push(`存在 ${lowReadouts.length} 个低置信读数未核对：${lowReadouts.map((item) => item.key).join('、')}`);
  }

  const evaluation = evaluateRecord(record, device);
  const missingUnchecked = evaluation.items
    .filter((item) => item.missing && !checked[`RO:${item.key}`])
    .map((item) => item.key);
  if (missingUnchecked.length) {
    blockers.push(`存在未核对的缺次读数：${missingUnchecked.join('、')}；确认异常后可作为不通过记录提交`);
  }
  return blockers;
}

export const rules = {
  DEFAULT_TOLERANCE_PERCENT,
  LOW_CONFIDENCE_THRESHOLD,
  decimalsFromD,
  roundTo,
  formatNumber,
  signedNumber,
  calculateLimits,
  readoutKey,
  getRange,
  getRangeDecimals,
  recommendPoints,
  evaluateRecord,
  judgementBasis,
  lowConfidenceItems,
  submitBlockers,
};

export default rules;
