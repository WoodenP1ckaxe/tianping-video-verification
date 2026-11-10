import { createRequire } from 'node:module';
import { createWorker, OEM, PSM } from 'tesseract.js';
import englishData from '@tesseract.js-data/eng';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const jsQR = require('jsqr');
const jpeg = require('jpeg-js');

const DEFAULT_DISPLAY_REGION = Object.freeze({
  x: 0.1195,
  y: 0.6510,
  width: 0.7537,
  height: 0.1198,
  coordinateSpace: 'normalized-video-frame',
});
const MAX_RELATIVE_ERROR = 0.005;
const MIN_STABLE_SECONDS = 3;
const MAX_OCR_FRAMES = 1800;
const MAX_PLATEAU_MERGE_GAP_SECONDS = 10;
const MAX_SAME_WEIGHING_DRIFT_D = 20;
const MAX_TRANSIENT_SEGMENT_SECONDS = 5;
const TRANSIENT_NEIGHBOR_GAP_SECONDS = 12;

let workerPromise = null;

function run(command, args, { timeoutMs = 600_000, binary = false } = {}) {
  return new Promise((resolvePromise) => {
    let stdout = binary ? [] : '';
    let stderr = '';
    let settled = false;
    let child;

    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolvePromise({ code: -1, stdout, stderr: error.message });
      return;
    }

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ code: -1, stdout, stderr: `${stderr}\nOCR 帧提取超时`, timedOut: true });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (binary) stdout.push(chunk);
      else stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-150_000);
    });
    child.on('error', (error) => {
      finish({ code: -1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on('close', (code) => finish({ code, stdout, stderr }));
  });
}

async function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker(englishData.code, OEM.LSTM_ONLY, {
        langPath: englishData.langPath,
        gzip: englishData.gzip,
        cacheMethod: 'none',
        logger: () => {},
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_char_whitelist: '0123456789.gm-+',
        preserve_interword_spaces: '1',
      });
      return worker;
    })();
  }
  return workerPromise;
}

export async function terminateDisplayOcr() {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}

function normalizeRegion(region = DEFAULT_DISPLAY_REGION) {
  const values = {
    x: Number(region.x),
    y: Number(region.y),
    width: Number(region.width),
    height: Number(region.height),
  };
  if (!Object.values(values).every(Number.isFinite)
    || values.x < 0 || values.y < 0
    || values.width <= 0 || values.height <= 0
    || values.x + values.width > 1.001
    || values.y + values.height > 1.001) {
    throw new Error('显示屏 ROI 必须是画面内有效的归一化矩形');
  }
  return {
    ...values,
    coordinateSpace: 'normalized-video-frame',
  };
}

function extractDisplayFrames(ffmpegPath, filePath, media, region, workDir) {
  const width = Math.max(2, Math.round(media.width * region.width));
  const height = Math.max(2, Math.round(media.height * region.height));
  const x = Math.max(0, Math.round(media.width * region.x));
  const y = Math.max(0, Math.round(media.height * region.y));
  const output = join(workDir, 'frame-%05d.jpg');
  const filter = [
    'fps=1',
    `crop=${width}:${height}:${x}:${y}`,
    'scale=1230:345:flags=lanczos',
  ].join(',');
  return run(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', filePath,
    '-vf', filter,
    '-q:v', '1',
    '-y',
    output,
  ], { timeoutMs: 10 * 60_000 });
}

function normalizeDigits(text) {
  return String(text || '')
    .toUpperCase()
    .replaceAll('O', '0')
    .replaceAll('Q', '0')
    .replaceAll('I', '1')
    .replaceAll('L', '1')
    .replaceAll('|', '1')
    .replaceAll(',', '.');
}

function columnRuns(active, maxGap = 2) {
  if (!active.length) return [];
  const runs = [];
  let start = active[0];
  let previous = active[0];
  for (let index = 1; index < active.length; index += 1) {
    const value = active[index];
    if (value <= previous + maxGap) {
      previous = value;
    } else {
      runs.push([start, previous]);
      start = value;
      previous = value;
    }
  }
  runs.push([start, previous]);
  return runs;
}

function decodeJpeg(buffer) {
  const decoded = jpeg.decode(buffer, {
    useTArray: true,
    formatAsRGBA: true,
  });
  const gray = new Uint8Array(decoded.width * decoded.height);
  for (let index = 0, pixel = 0; index < decoded.data.length; index += 4, pixel += 1) {
    gray[pixel] = Math.round(
      decoded.data[index] * 0.299
      + decoded.data[index + 1] * 0.587
      + decoded.data[index + 2] * 0.114,
    );
  }
  return {
    ...decoded,
    gray,
  };
}

function cropGrayImage(image, region) {
  const x = Math.max(0, Math.min(image.width - 1, Math.round(image.width * region.x)));
  const y = Math.max(0, Math.min(image.height - 1, Math.round(image.height * region.y)));
  const width = Math.max(1, Math.min(image.width - x, Math.round(image.width * region.width)));
  const height = Math.max(1, Math.min(image.height - y, Math.round(image.height * region.height)));
  const gray = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = (y + row) * image.width + x;
    gray.set(image.gray.subarray(sourceOffset, sourceOffset + width), row * width);
  }
  return { width, height, gray };
}

async function extractProbeFrame(ffmpegPath, filePath, media, workDir, fraction) {
  const offset = Math.max(1, Math.min(media.duration - 1, media.duration * fraction));
  const outputPath = join(workDir, `display-probe-${Math.round(fraction * 100)}.jpg`);
  const result = await run(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', String(offset),
    '-i', filePath,
    '-frames:v', '1',
    '-q:v', '2',
    '-y',
    outputPath,
  ], { timeoutMs: 30_000 });
  return result.code === 0 ? outputPath : null;
}

export function rankDisplayCandidates(candidates = []) {
  return [...candidates].filter(Boolean).sort((left, right) => (
    right.matches - left.matches
    || right.pointCount - left.pointCount
    || right.deviceCount - left.deviceCount
    || Number(right.prior) - Number(left.prior)
    || left.averageError - right.averageError
    || right.confidence - left.confidence
  ));
}

async function autoLocateDisplayRegion({
  ffmpegPath,
  filePath,
  media,
  workDir,
  devices,
  debug = false,
}) {
  const candidates = [];
  const seen = new Set();
  const addCandidate = (region, prior = false) => {
    const normalized = normalizeRegion(region);
    const key = [normalized.x, normalized.y, normalized.width, normalized.height]
      .map((value) => Number(value).toFixed(3)).join('/');
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ ...normalized, prior });
  };
  addCandidate(DEFAULT_DISPLAY_REGION, true);
  for (const device of devices) {
    if (device?.displayRegion) addCandidate(device.displayRegion);
  }
  for (const x of [0.05, 0.10, 0.15]) {
    for (const y of [0.55, 0.62, 0.66, 0.70, 0.74]) {
      for (const width of [0.76, 0.84]) {
        for (const height of [0.08, 0.12, 0.16]) {
          addCandidate({ x, y, width, height });
        }
      }
    }
  }

  const frames = [];
  for (const fraction of [0.25, 0.50, 0.75]) {
    const framePath = await extractProbeFrame(
      ffmpegPath,
      filePath,
      media,
      workDir,
      fraction,
    );
    if (framePath) frames.push(decodeJpeg(readFileSync(framePath)));
  }
  if (!frames.length) return null;

  const ranked = rankDisplayCandidates(candidates.map((region) => {
    const deviceVotes = new Map();
    const pointVotes = new Map();
    let matches = 0;
    let errorSum = 0;
    let confidenceSum = 0;
    for (const frame of frames) {
      const recognized = recognizeSevenSegment(cropGrayImage(frame, region));
      if (!recognized) continue;
      const sample = inferReadout(
        recognized.text,
        devices,
        recognized.confidence,
        recognized.method,
        recognized.digits,
      );
      if (!sample) continue;
      matches += 1;
      errorSum += Number(sample.relativeError || 0);
      confidenceSum += Number(sample.confidence || recognized.confidence || 0);
      deviceVotes.set(sample.deviceId, (deviceVotes.get(sample.deviceId) || 0) + 1);
      pointVotes.set(sample.point, (pointVotes.get(sample.point) || 0) + 1);
    }
    if (matches < Math.min(2, frames.length)) return null;
    return {
      region,
      prior: region.prior === true,
      matches,
      deviceCount: deviceVotes.size,
      pointCount: pointVotes.size,
      averageError: errorSum / matches,
      confidence: confidenceSum / matches,
    };
  }).filter(Boolean));
  if (!ranked[0]) return null;
  return {
    ...ranked[0],
    candidates: debug ? ranked.slice(0, 12).map((item) => ({
      ...item,
      region: { ...item.region }
    })) : undefined
  };
}

function preprocessForTesseract(image) {
  const output = Buffer.alloc(image.width * image.height * 4);
  for (let pixel = 0, offset = 0; pixel < image.gray.length; pixel += 1, offset += 4) {
    const value = image.gray[pixel] < 120 ? 255 : 0;
    output[offset] = value;
    output[offset + 1] = value;
    output[offset + 2] = value;
    output[offset + 3] = 255;
  }
  return Buffer.from(jpeg.encode({
    data: output,
    width: image.width,
    height: image.height,
  }, 92).data);
}

async function recognizeWithTesseract(worker, image) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await worker.recognize(preprocessForTesseract(image));
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

function rowBand(mask, width, height) {
  const fractions = new Float32Array(height);
  for (let y = 0; y < height; y += 1) {
    let dark = 0;
    for (let x = 15; x < width - 15; x += 1) {
      if (mask[y * width + x]) dark += 1;
    }
    fractions[y] = dark / Math.max(1, width - 30);
  }
  const active = [];
  for (let y = 0; y < height; y += 1) {
    if (fractions[y] > 0.015 && fractions[y] < 0.45) active.push(y);
  }
  const runs = columnRuns(active, 2);
  return runs.find(([start, end]) => end - start > 40) || null;
}

function hasDigitBand(image) {
  const mask = new Uint8Array(image.width * image.height);
  for (let index = 0; index < image.gray.length; index += 1) {
    mask[index] = image.gray[index] < 100 ? 1 : 0;
  }
  return Boolean(rowBand(mask, image.width, image.height));
}

function segmentFraction(mask, width, x0, x1, y0, y1, fx0, fx1, fy0, fy1) {
  const boxWidth = x1 - x0 + 1;
  const boxHeight = y1 - y0 + 1;
  const left = x0 + Math.floor(boxWidth * fx0);
  const right = Math.min(x1 + 1, x0 + Math.max(left - x0 + 1, Math.floor(boxWidth * fx1)));
  const top = y0 + Math.floor(boxHeight * fy0);
  const bottom = Math.min(y1 + 1, y0 + Math.max(top - y0 + 1, Math.floor(boxHeight * fy1)));
  let dark = 0;
  let total = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      total += 1;
      if (mask[y * width + x]) dark += 1;
    }
  }
  return total ? dark / total : 0;
}

const DIGIT_PATTERNS = Object.freeze({
  0: [1, 1, 1, 1, 1, 1, 0],
  1: [0, 1, 1, 0, 0, 0, 0],
  2: [1, 1, 0, 1, 1, 0, 1],
  3: [1, 1, 1, 1, 0, 0, 1],
  4: [0, 1, 1, 0, 0, 1, 1],
  5: [1, 0, 1, 1, 0, 1, 1],
  6: [1, 0, 1, 1, 1, 1, 1],
  7: [1, 1, 1, 0, 0, 0, 0],
  8: [1, 1, 1, 1, 1, 1, 1],
  9: [1, 1, 1, 1, 0, 1, 1],
});

function classifyDigit(mask, width, box, narrow) {
  if (narrow) return { digit: 1, confidence: 0.98 };
  const { x0, x1, y0, y1 } = box;
  const scores = [
    segmentFraction(mask, width, x0, x1, y0, y1, .18, .82, .04, .17),
    segmentFraction(mask, width, x0, x1, y0, y1, .72, .96, .16, .45),
    segmentFraction(mask, width, x0, x1, y0, y1, .72, .96, .55, .84),
    segmentFraction(mask, width, x0, x1, y0, y1, .18, .82, .83, .97),
    segmentFraction(mask, width, x0, x1, y0, y1, .04, .28, .55, .84),
    segmentFraction(mask, width, x0, x1, y0, y1, .04, .28, .16, .45),
    segmentFraction(mask, width, x0, x1, y0, y1, .18, .82, .43, .57),
  ];
  const pattern = [
    scores[0] > .18,
    scores[1] > .45,
    scores[2] > .38,
    scores[3] > .35,
    scores[4] > .42,
    scores[5] > .45,
    scores[6] > .24,
  ].map(Number);
  let bestDigit = null;
  let bestDistance = Infinity;
  for (const [digit, expected] of Object.entries(DIGIT_PATTERNS)) {
    const distance = expected.reduce(
      (sum, value, index) => sum + (value === pattern[index] ? 0 : 1),
      0,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestDigit = Number(digit);
    }
  }
  return {
    digit: bestDistance <= 2 ? bestDigit : null,
    confidence: Math.max(0, 1 - bestDistance / 7),
    segmentScores: scores.map((value) => Number(value.toFixed(3))),
  };
}

function detectDecimalIndex(mask, width, boxes) {
  let best = null;
  for (let index = 0; index < boxes.length - 1; index += 1) {
    const leftBox = boxes[index];
    const rightBox = boxes[index + 1];
    const gapLeft = leftBox.x1 + 1;
    const gapRight = rightBox.x0 - 1;
    const gapWidth = gapRight - gapLeft + 1;
    if (gapWidth < 2) continue;
    const top = Math.max(
      leftBox.y0,
      Math.min(leftBox.y1, rightBox.y1) - Math.round((leftBox.y1 - leftBox.y0) * .28),
    );
    const bottom = Math.min(leftBox.y1, rightBox.y1);
    let dark = 0;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = gapLeft; x <= gapRight; x += 1) {
        dark += mask[y * width + x];
      }
    }
    const score = dark / Math.max(1, gapWidth);
    if (!best || score > best.score) {
      best = { index: index + 1, score, dark, gapWidth };
    }
  }
  return best && best.dark >= 12 && best.score >= 0.8 ? best.index : null;
}

function recognizeSevenSegment(image) {
  const { width, height, gray } = image;
  const scale = width / 1230;
  for (const threshold of [90, 100, 108]) {
    const mask = new Uint8Array(width * height);
    for (let index = 0; index < gray.length; index += 1) {
      mask[index] = gray[index] < threshold ? 1 : 0;
    }
    const band = rowBand(mask, width, height);
    if (!band) continue;
    const scanY0 = band[0];
    const scanY1 = Math.min(height, scanY0 + Math.round(190 * scale));
    const projection = new Uint16Array(width);
    for (let y = scanY0; y < scanY1; y += 1) {
      for (let x = 0; x < width; x += 1) {
        projection[x] += mask[y * width + x];
      }
    }
    const active = [];
    const minProjection = Math.max(5, Math.round(8 * scale));
    for (let x = 0; x < width; x += 1) {
      if (projection[x] > minProjection) active.push(x);
    }
    const runs = columnRuns(active, Math.max(2, Math.round(2 * scale)));
    let boxes = [];
    for (const [x0, x1] of runs) {
      if (x0 < Math.round(150 * scale) || x1 >= Math.round(1100 * scale)) continue;
      let top = scanY1;
      let bottom = scanY0;
      for (let y = scanY0; y < scanY1; y += 1) {
        let dark = 0;
        for (let x = x0; x <= x1; x += 1) {
          dark += mask[y * width + x];
        }
        if (dark > 2) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      const boxHeight = bottom - top + 1;
      const boxWidth = x1 - x0 + 1;
      if (boxHeight < Math.round(60 * scale) || boxWidth < Math.round(7 * scale)) continue;
      boxes.push({ x0, x1, y0: top, y1: bottom, width: boxWidth, height: boxHeight });
    }
    boxes.sort((left, right) => left.x0 - right.x0);
    const clusters = [];
    for (const box of boxes) {
      const current = clusters.at(-1);
      if (current && box.x0 - current.at(-1).x1 <= Math.round(100 * scale)) {
        current.push(box);
      } else {
        clusters.push([box]);
      }
    }
    boxes = clusters.sort((left, right) => (
      right.length - left.length
      || (right.at(-1).x1 - right[0].x0) - (left.at(-1).x1 - left[0].x0)
    ))[0] || [];
    if (boxes.length < 5 || boxes.length > 8) continue;
    const wideWidths = boxes.map((box) => box.width).filter((value) => value > 35 * scale);
    const medianWidth = wideWidths.sort((left, right) => left - right)[Math.floor(wideWidths.length / 2)] || 1;
    const digits = [];
    const confidences = [];
    const details = [];
    for (const box of boxes) {
      const classified = classifyDigit(mask, width, box, box.width < medianWidth * 0.72);
      if (classified.digit === null) {
        digits.length = 0;
        break;
      }
      digits.push(classified.digit);
      confidences.push(classified.confidence);
      details.push({
        digit: classified.digit,
        x: box.x0,
        width: box.width,
        height: box.height,
      });
    }
    if (digits.length >= 5) {
      const decimalIndex = detectDecimalIndex(mask, width, boxes);
      const digitsText = digits.join('');
      const text = decimalIndex
        ? `${digitsText.slice(0, decimalIndex)}.${digitsText.slice(decimalIndex)}`
        : digitsText;
      return {
        text,
        method: 'seven-segment-template',
        confidence: confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
        digits: details,
        decimalIndex,
      };
    }
  }
  return null;
}

export function recognizeSevenSegmentFrame(jpegBuffer) {
  return recognizeSevenSegment(decodeJpeg(jpegBuffer));
}

export async function locateDisplayRegion({
  ffmpegPath,
  filePath,
  media,
  devices,
  config = {},
}) {
  if (config.displayRegion) {
    return {
      region: normalizeRegion(config.displayRegion),
      source: 'configured',
      confidence: 1,
      matches: 0
    };
  }
  const workDir = mkdtempSync(join(tmpdir(), 'tianping-display-locate-'));
  try {
    const result = await autoLocateDisplayRegion({
      ffmpegPath,
      filePath,
      media,
      workDir,
      devices,
      debug: config.debugOcr === true,
    });
    return result ? {
      region: result.region,
      source: 'automatic-candidate-search',
      confidence: result.confidence,
      matches: result.matches,
      candidates: result.candidates
    } : null;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function inferReadout(
  text,
  devices,
  ocrConfidence = 0,
  ocrMethod = 'tesseract',
  ocrDetails = null,
  preferredDeviceId = null,
) {
  const cleaned = normalizeDigits(text);
  const numberMatches = cleaned.match(/\d+(?:\.\d+)?/g) || [];
  if (!numberMatches.length) return null;

  const candidates = [];
  for (const device of devices) {
    const points = Array.isArray(device.points) ? device.points : [];
    for (let point = 0; point < points.length; point += 1) {
      const nominal = Number(points[point]);
      if (!Number.isFinite(nominal) || nominal <= 0) continue;
      const range = Number(device.ranges) === 2
        ? (Number(device.pointRange?.[point]) === 2 ? 2 : (point === 0 ? 1 : 2))
        : 1;
      const dGram = Number(range === 2 ? device.range2?.d : device.range1?.d) / 1000;
      const decimals = Number.isFinite(dGram) && dGram > 0
        ? Math.max(0, Math.min(8, Math.ceil(-Math.log10(dGram) - 1e-9)))
        : 4;
      const displayUnit = Number(device.ranges) === 2 && point > 0 ? 'mg' : 'g';
      const factor = displayUnit === 'mg' ? 1000 : 1;
      const displayNominal = nominal * factor;
      const integerDigits = String(Math.trunc(displayNominal)).length;
      const displayDecimals = displayUnit === 'mg'
        ? Math.max(1, decimals - 3)
        : decimals;

      for (const numberText of numberMatches) {
        // 七段码和 Tesseract 已识别出小数点时，直接按屏幕值换算。
        // 保留传统重建逻辑只用于小数点漏识别的回退，避免把 2 g 与 20 g 混淆。
        if (numberText.includes('.')) {
          const parsed = Number(numberText);
          if (!Number.isFinite(parsed)) continue;
          const valueInGrams = parsed / factor;
          const relativeError = Math.abs(valueInGrams - nominal) / nominal;
          if (relativeError > MAX_RELATIVE_ERROR) continue;
          const rounded = Number(valueInGrams.toFixed(decimals));
          candidates.push({
            device,
            deviceId: device.id,
            point,
            range,
            value: rounded,
            displayValue: parsed,
            displayUnit,
            displayText: `${numberText} ${displayUnit}`,
            relativeError,
            confidence: Math.max(0, Math.min(1, Number(ocrConfidence) || 0)),
            ocrMethod,
            ocrDetails,
            decimals,
          });
          continue;
        }
        const digits = numberText.replace('.', '');
        if (digits.length <= integerDigits) continue;
        const availableDecimals = digits.length - integerDigits;
        const significantDigits = digits.slice(
          0,
          integerDigits + Math.max(1, Math.min(displayDecimals, availableDecimals)),
        );
        const fractionalDigits = significantDigits.slice(integerDigits);
        if (fractionalDigits.length === 1 && fractionalDigits === '0') continue;
        const reconstructed = `${significantDigits.slice(0, integerDigits)}.${fractionalDigits}`;
        const parsed = Number(reconstructed);
        if (!Number.isFinite(parsed)) continue;
        const valueInGrams = parsed / factor;
        const relativeError = Math.abs(valueInGrams - nominal) / nominal;
        if (relativeError > MAX_RELATIVE_ERROR) continue;
        const rounded = Number(valueInGrams.toFixed(decimals));
        candidates.push({
          device,
          deviceId: device.id,
          point,
          range,
          value: rounded,
          displayValue: parsed,
          displayUnit,
          displayText: `${reconstructed} ${displayUnit}`,
          relativeError,
          confidence: Math.max(0, Math.min(1, Number(ocrConfidence) || 0)),
          ocrMethod,
          ocrDetails,
          decimals,
        });
      }
    }
  }
  if (!candidates.length) return null;
  let preferred = preferredDeviceId
    ? candidates.filter((candidate) => candidate.deviceId === preferredDeviceId)
    : candidates;
  if (!preferred.length) preferred = candidates;
  if (preferred.length) {
    return preferred.sort((left, right) => left.relativeError - right.relativeError)[0];
  }
  return candidates.sort((left, right) => {
    const errorDifference = left.relativeError - right.relativeError;
    if (Math.abs(errorDifference) > 1e-12) return errorDifference;
    return Number(right.confidence) - Number(left.confidence);
  })[0];
}

function resultText(result) {
  return result?.data?.text?.trim() || '';
}

function resultConfidence(result) {
  const words = result?.data?.words || [];
  const wordConfidence = words
    .map((word) => Number(word.confidence))
    .filter((value) => Number.isFinite(value));
  if (wordConfidence.length) {
    return wordConfidence.reduce((sum, value) => sum + value, 0) / wordConfidence.length / 100;
  }
  return Math.max(0, Number(result?.data?.confidence) || 0) / 100;
}

export function groupObservationSamples(samples, { minimumSamples = 3 } = {}) {
  const groups = [];
  let current = null;

  for (const sample of samples) {
    if (!sample) {
      if (current && sample === null) current.gap += 1;
      if (current && current.gap > 2) {
        groups.push(current);
        current = null;
      }
      continue;
    }
    const compatible = current
      && current.point === sample.point
      && current.deviceId === sample.deviceId;
    if (!compatible) {
      if (current) groups.push(current);
      current = {
        point: sample.point,
        deviceId: sample.deviceId,
        range: sample.range,
        nominal: sample.device.points[sample.point],
        decimals: sample.decimals,
        start: sample.second,
        end: sample.second,
        gap: 0,
        values: [sample.value],
        seconds: [sample.second],
        texts: [sample.displayText],
        confidences: [sample.confidence],
        methods: [sample.ocrMethod],
        details: [sample.ocrDetails],
      };
    } else {
      current.end = sample.second;
      current.gap = 0;
      current.values.push(sample.value);
      current.seconds.push(sample.second);
      current.texts.push(sample.displayText);
      current.confidences.push(sample.confidence);
      current.methods.push(sample.ocrMethod);
      current.details.push(sample.ocrDetails);
    }
  }
  if (current) groups.push(current);
  return groups.filter((group) => group.values.length >= minimumSamples);
}

export function stableObservationWindow(group) {
  const dGram = 10 ** -group.decimals;
  let best = null;
  for (let start = 0; start < group.values.length; start += 1) {
    let min = group.values[start];
    let max = group.values[start];
    for (let end = start; end < group.values.length; end += 1) {
      min = Math.min(min, group.values[end]);
      max = Math.max(max, group.values[end]);
      if (max - min > dGram + 1e-12) break;
      const duration = group.seconds[end] - group.seconds[start] + 1;
      let largestGap = 0;
      for (let index = start + 1; index <= end; index += 1) {
        largestGap = Math.max(
          largestGap,
          group.seconds[index] - group.seconds[index - 1],
        );
      }
      if (duration >= MIN_STABLE_SECONDS
        && largestGap <= 3
        && (!best || duration > group.seconds[best.end] - group.seconds[best.start] + 1)) {
        best = { start, end };
      }
    }
  }
  return best;
}

function groupToReading(group) {
  const window = stableObservationWindow(group);
  const sourceStart = window?.start ?? 0;
  const sourceEnd = window?.end ?? group.values.length - 1;
  const values = group.values.slice(sourceStart, sourceEnd + 1);
  const texts = group.texts.slice(sourceStart, sourceEnd + 1);
  const confidences = group.confidences.slice(sourceStart, sourceEnd + 1);
  const latestIndex = sourceEnd;
  const stableSpan = window
    ? group.seconds[sourceEnd] - group.seconds[sourceStart] + 1
    : 0;
  const totalSpan = group.end - group.start + 1;
  const stableCoverage = totalSpan ? stableSpan / totalSpan : 0;
  const stable = Boolean(window) && stableSpan >= 3 && stableCoverage >= 0.5;
  return {
    deviceId: group.deviceId,
    point: group.point,
    value: group.values[latestIndex],
    decimals: group.decimals,
    range: group.range,
    unit: 'g',
    off: group.start + latestIndex,
    segmentStart: group.start + sourceStart,
    segmentEnd: group.start + sourceEnd,
    stable,
    confidence: Math.max(
      0,
      Math.min(1, confidences.reduce((sum, value) => sum + Number(value || 0), 0)
        / Math.max(1, confidences.length)),
    ),
    recognizedText: texts.at(-1),
    ocrMethod: group.methods[latestIndex],
    ocrDetails: group.details[latestIndex],
    sampleCount: values.length,
    observedMin: Math.min(...values),
    observedMax: Math.max(...values),
    observedStart: group.start,
    observedEnd: group.end,
  };
}

function readingBoundary(reading, edge) {
  const fallback = Number(reading?.off);
  const value = Number(
    edge === 'start'
      ? (reading?.observedStart ?? reading?.segmentStart ?? fallback)
      : (reading?.observedEnd ?? reading?.segmentEnd ?? fallback),
  );
  return Number.isFinite(value) ? value : fallback;
}

function readingGap(left, right) {
  return Math.max(
    0,
    readingBoundary(right, 'start') - readingBoundary(left, 'end'),
  );
}

function readingDuration(reading) {
  return Math.max(
    0,
    readingBoundary(reading, 'end') - readingBoundary(reading, 'start'),
  );
}

function readingWindows(reading) {
  if (Array.isArray(reading?.mergedWindows) && reading.mergedWindows.length) {
    return reading.mergedWindows;
  }
  return [{
    start: reading?.segmentStart ?? reading?.off,
    end: reading?.segmentEnd ?? reading?.off,
    value: reading?.value,
    stable: reading?.stable === true,
  }];
}

function mergeRelatedReadings(left, right) {
  const chosen = right.stable === true
    ? right
    : (left.stable === true ? left : right);
  const mergedWindows = [...readingWindows(left), ...readingWindows(right)];
  const leftCount = Math.max(1, Number(left.sampleCount) || 1);
  const rightCount = Math.max(1, Number(right.sampleCount) || 1);
  return {
    ...chosen,
    stable: left.stable === true || right.stable === true,
    confidence: (
      Number(left.confidence || 0) * leftCount
      + Number(right.confidence || 0) * rightCount
    ) / (leftCount + rightCount),
    sampleCount: leftCount + rightCount,
    observedMin: Math.min(Number(left.observedMin), Number(right.observedMin)),
    observedMax: Math.max(Number(left.observedMax), Number(right.observedMax)),
    observedStart: Math.min(
      readingBoundary(left, 'start'),
      readingBoundary(right, 'start'),
    ),
    observedEnd: Math.max(
      readingBoundary(left, 'end'),
      readingBoundary(right, 'end'),
    ),
    mergedWindowCount: readingWindows(left).length + readingWindows(right).length,
    mergedWindows,
    consolidationReason: 'same-weighing-plateau-merge',
  };
}

/**
 * 一段实际称重可能包含多个短暂稳定平台。仅在时间接近且漂移不超过 20d 时
 * 合并同点平台；真正重新加载砝码通常会产生更长的取放间隔，因而仍保留为独立段。
 */
export function consolidateWeighingReadings(readings, options = {}) {
  const mergeGapSeconds = Number(options.mergeGapSeconds)
    || MAX_PLATEAU_MERGE_GAP_SECONDS;
  const maxDriftD = Number(options.maxDriftD) || MAX_SAME_WEIGHING_DRIFT_D;
  const transientMaxSeconds = Number(options.transientMaxSeconds)
    || MAX_TRANSIENT_SEGMENT_SECONDS;
  const neighborGapSeconds = Number(options.neighborGapSeconds)
    || TRANSIENT_NEIGHBOR_GAP_SECONDS;
  const ordered = [...readings].sort(
    (left, right) => readingBoundary(left, 'start') - readingBoundary(right, 'start'),
  );
  const kept = [];
  const discardedTransientReadings = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    const currentStart = readingBoundary(current, 'start');
    const currentEnd = readingBoundary(current, 'end');
    const localSupport = [0, 0, 0];
    for (let neighborIndex = 0; neighborIndex < ordered.length; neighborIndex += 1) {
      if (neighborIndex === index) continue;
      const neighbor = ordered[neighborIndex];
      const neighborStart = readingBoundary(neighbor, 'start');
      const neighborEnd = readingBoundary(neighbor, 'end');
      const nearby = neighborEnd >= currentStart - neighborGapSeconds
        && neighborStart <= currentEnd + neighborGapSeconds;
      if (nearby && Number.isInteger(neighbor.point)) {
        localSupport[neighbor.point] += Math.max(1, Number(neighbor.sampleCount) || 1);
      }
    }
    const competingSupport = localSupport.reduce(
      (maximum, count, point) => point === current.point ? maximum : Math.max(maximum, count),
      0,
    );
    const transientCrossPoint = readingDuration(current) <= transientMaxSeconds
      && localSupport[current.point] === 0
      && competingSupport >= Math.max(3, Number(current.sampleCount) || 1);
    if (transientCrossPoint) {
      discardedTransientReadings.push({
        ...current,
        discardReason: 'transient-cross-point-island',
        previousGapSeconds: previous ? readingGap(previous, current) : null,
        nextGapSeconds: next ? readingGap(current, next) : null,
        localSupport,
      });
      continue;
    }
    kept.push(current);
  }

  const mergedReadings = [];
  const mergedSameWeighingWindows = [];
  for (const reading of kept) {
    const previous = mergedReadings.at(-1);
    const driftLimit = 10 ** -Number(reading.decimals) * maxDriftD + 1e-12;
    const sameWeighing = previous
      && previous.point === reading.point
      && previous.deviceId === reading.deviceId
      && previous.range === reading.range
      && readingGap(previous, reading) <= mergeGapSeconds
      && Math.abs(Number(previous.value) - Number(reading.value)) <= driftLimit;
    if (!sameWeighing) {
      mergedReadings.push(reading);
      continue;
    }
    mergedSameWeighingWindows.push({
      point: reading.point,
      gapSeconds: readingGap(previous, reading),
      fromValue: previous.value,
      toValue: reading.value,
      fromStart: previous.observedStart,
      fromEnd: previous.observedEnd,
      toStart: reading.observedStart,
      toEnd: reading.observedEnd,
    });
    mergedReadings[mergedReadings.length - 1] = mergeRelatedReadings(previous, reading);
  }

  return {
    readings: mergedReadings,
    corrections: {
      mergedSameWeighingWindows,
      discardedTransientReadings,
    },
  };
}

function scoreDeviceReadings(readings) {
  if (!readings.length) return Number.NEGATIVE_INFINITY;
  const pointCounts = [0, 0, 0];
  for (const reading of readings) pointCounts[reading.point] += 1;
  const coveredPoints = pointCounts.filter((count) => count > 0).length;
  const completePoints = pointCounts.filter((count) => count >= 3).length;
  const canonicalCoverage = pointCounts.reduce((sum, count) => sum + Math.min(count, 3), 0);
  const stableCount = readings.filter((reading) => reading.stable).length;
  const extraPenalty = Math.max(0, readings.length - 12);
  const confidence = readings.reduce(
    (sum, reading) => sum + Number(reading.confidence || 0),
    0,
  ) / readings.length;
  return coveredPoints * 1_000_000
    + completePoints * 100_000
    + canonicalCoverage * 1_000
    + stableCount * 100
    + confidence * 10
    - extraPenalty;
}

function qrBounds(result, offsetX = 0, offsetY = 0) {
  const points = result?.location
    ? [
      result.location.topLeftCorner,
      result.location.topRightCorner,
      result.location.bottomRightCorner,
      result.location.bottomLeftCorner,
    ]
    : [];
  if (!points.length) return null;
  const xs = points.map((point) => Number(point.x) + offsetX);
  const ys = points.map((point) => Number(point.y) + offsetY);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function eraseQrArea(pixels, width, height, bounds) {
  if (!bounds) return;
  const padding = Math.max(6, Math.round(Math.min(bounds.width, bounds.height) * 0.14));
  const left = Math.max(0, Math.floor(bounds.x - padding));
  const right = Math.min(width, Math.ceil(bounds.x + bounds.width + padding));
  const top = Math.max(0, Math.floor(bounds.y - padding));
  const bottom = Math.min(height, Math.ceil(bounds.y + bounds.height + padding));
  for (let y = top; y < bottom; y += 1) {
    let offset = (y * width + left) * 4;
    for (let x = left; x < right; x += 1) {
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = 255;
      offset += 4;
    }
  }
}

/**
 * jsQR 一次通常只返回一个二维码。此函数先解码最大候选，再擦除其区域继续
 * 查找，并对四个重叠分区补充扫描，以兼容人员卡与长期张贴的设备卡同屏。
 */
export function decodeQrCodesFromPixels(
  sourcePixels,
  width,
  height,
  maxCodes = 4
) {
  if (!sourcePixels || !width || !height) return [];
  const working = new Uint8ClampedArray(sourcePixels);
  const found = [];
  const seen = new Set();
  const add = (result, offsetX = 0, offsetY = 0) => {
    const data = String(result?.data || '').trim();
    if (!data || seen.has(data)) return false;
    seen.add(data);
    found.push({
      data,
      location: qrBounds(result, offsetX, offsetY),
    });
    return true;
  };

  for (let attempt = 0; attempt < maxCodes; attempt += 1) {
    const decoded = jsQR(working, width, height, { inversionAttempts: 'attemptBoth' });
    if (!decoded) break;
    const before = found.length;
    add(decoded);
    const bounds = qrBounds(decoded);
    eraseQrArea(working, width, height, bounds);
    if (found.length === before && attempt >= 1) break;
  }

  if (found.length < 2) {
    const overlapX = Math.round(width * 0.1);
    const overlapY = Math.round(height * 0.1);
    const halfWidth = Math.ceil(width / 2) + overlapX;
    const halfHeight = Math.ceil(height / 2) + overlapY;
    // Full-height vertical strips retain the square-ish framing jsQR expects
    // for side-by-side cards; horizontal strips cover vertically stacked cards.
    const regions = [
      [0, 0, Math.min(width, halfWidth), height],
      [Math.max(0, width - halfWidth), 0, Math.min(width, halfWidth), height],
      [0, 0, width, Math.min(height, halfHeight)],
      [0, Math.max(0, height - halfHeight), width, Math.min(height, halfHeight)],
    ];
    for (const [left, top, regionWidth, regionHeight] of regions) {
      if (found.length >= maxCodes) break;
      const crop = new Uint8ClampedArray(regionWidth * regionHeight * 4);
      for (let row = 0; row < regionHeight; row += 1) {
        const sourceStart = ((top + row) * width + left) * 4;
        crop.set(
          sourcePixels.subarray(sourceStart, sourceStart + regionWidth * 4),
          row * regionWidth * 4
        );
      }
      const decoded = jsQR(crop, regionWidth, regionHeight, {
        inversionAttempts: 'attemptBoth',
      });
      if (decoded) add(decoded, left, top);
    }
  }
  return found;
}

async function decodeCards(ffmpegPath, filePath, media, timeoutMs = 120_000) {
  const width = Number(media.width);
  const height = Number(media.height);
  if (!width || !height) return [];
  const result = await run(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-t', '40',
    '-i', filePath,
    '-vf', 'fps=1/2',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    'pipe:1',
  ], { timeoutMs, binary: true });
  if (result.code !== 0) return [];
  const data = Buffer.concat(result.stdout);
  const frameBytes = width * height * 4;
  const found = [];
  for (let offset = 0, second = 0; offset + frameBytes <= data.length; offset += frameBytes, second += 2) {
    const pixels = new Uint8ClampedArray(data.subarray(offset, offset + frameBytes));
    const decodedCards = decodeQrCodesFromPixels(pixels, width, height);
    for (const [index, decoded] of decodedCards.entries()) {
      found.push({
        data: decoded.data,
        location: decoded.location,
        frameOffsetSeconds: second,
        sameFrameIndex: index,
        sameFrameCount: decodedCards.length,
      });
    }
  }
  return found;
}

function inferDeviceFromCards(cards, devices) {
  const matches = new Set();
  for (const card of cards) {
    const raw = String(card?.data ?? card ?? '').trim();
    if (!raw || /^(?:PERSON|人员|USER|ACCOUNT)\s*[:：-]/i.test(raw)) continue;
    const candidate = raw
      .replace(/^(?:DEVICE|设备|BALANCE|SCALE)\s*[:：-]\s*/i, '')
      .trim();
    const device = devices.find((item) => (
      String(item?.id || '').toUpperCase() === candidate.toUpperCase()
      || String(item?.uniqueNo || '').toUpperCase() === candidate.toUpperCase()
    ));
    if (device) matches.add(device.id);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

export async function recognizeVideo({
  ffmpegPath,
  filePath,
  media,
  devices,
  config = {},
}) {
  if (!ffmpegPath) throw new Error('FFmpeg 未安装，无法执行 OCR');
  if (!media?.width || !media?.height) throw new Error('视频尺寸未知，无法定位显示屏');

  const normalizedDevices = (devices || []).filter((device) => device?.status !== '停用');
  if (!normalizedDevices.length) throw new Error('没有可用的天平档案');
  const workDir = mkdtempSync(join(tmpdir(), 'tianping-display-ocr-'));
  let regionResult = null;
  let displayRegionSource = 'configured';
  if (config.displayRegion) {
    regionResult = {
      region: normalizeRegion(config.displayRegion),
      confidence: 1,
      matches: 0,
    };
  } else if (config.autoDisplayRegion !== false) {
    regionResult = await autoLocateDisplayRegion({
      ffmpegPath,
      filePath,
      media,
      workDir,
      devices: normalizedDevices,
      debug: config.debugOcr === true,
    });
    displayRegionSource = regionResult ? 'automatic-candidate-search' : 'default-fallback';
  } else {
    displayRegionSource = 'default-fallback';
  }
  const region = normalizeRegion(
    regionResult?.region
    || normalizedDevices[0]?.displayRegion
    || DEFAULT_DISPLAY_REGION,
  );
  const cards = await decodeCards(ffmpegPath, filePath, media, config.cardScanTimeoutMs);
  const cardDeviceId = inferDeviceFromCards(cards, normalizedDevices);
  let worker = null;
  const observations = [];
  const rawObservations = [];

  try {
    const extraction = await extractDisplayFrames(
      ffmpegPath,
      filePath,
      media,
      region,
      workDir,
    );
    if (extraction.code !== 0) {
      throw new Error(`显示屏帧提取失败：${extraction.stderr.slice(-500)}`);
    }
    const frames = readdirSync(workDir)
      .filter((name) => /^frame-\d+\.jpg$/i.test(name))
      .sort()
      .slice(0, Math.min(MAX_OCR_FRAMES, Math.ceil(media.duration)));
    if (!frames.length) throw new Error('视频中没有可读取的显示屏帧');

    for (let second = 0; second < frames.length; second += 1) {
      const framePath = join(workDir, frames[second]);
      const buffer = readFileSync(framePath);
      const image = decodeJpeg(buffer);
      const sevenSegment = config.disableSevenSegment
        ? null
        : recognizeSevenSegment(image);
      rawObservations.push(sevenSegment ? {
        second,
        text: sevenSegment.text,
        confidence: sevenSegment.confidence,
      } : null);
      const sample = sevenSegment
        ? inferReadout(
          sevenSegment.text,
          normalizedDevices,
          sevenSegment.confidence,
          sevenSegment.method,
          sevenSegment.digits,
          cardDeviceId,
        )
        : null;
      observations.push(sample ? {
        second,
        text: sevenSegment.text,
        confidence: sevenSegment.confidence,
        method: sevenSegment.method,
        details: sevenSegment.digits,
      } : null);
    }

    if (observations.filter(Boolean).length < 6 && config.enableTesseractFallback !== false) {
      observations.length = 0;
      rawObservations.length = 0;
      worker ||= await getOcrWorker();
      for (let second = 0; second < frames.length; second += 1) {
        const image = decodeJpeg(readFileSync(join(workDir, frames[second])));
        if (!hasDigitBand(image)) {
          observations.push(null);
          continue;
        }
        const result = await recognizeWithTesseract(worker, image);
        rawObservations.push({
          second,
          text: resultText(result),
          confidence: resultConfidence(result),
        });
        const sample = inferReadout(
          resultText(result),
          normalizedDevices,
          resultConfidence(result),
          'tesseract',
          null,
          cardDeviceId,
        );
        observations.push(sample ? {
          second,
          text: resultText(result),
          confidence: resultConfidence(result),
          method: 'tesseract',
          details: null,
        } : null);
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  const deviceAnalyses = normalizedDevices.map((device) => {
    const samplesForDevice = observations.map((observation) => {
      if (!observation) return null;
      const sample = inferReadout(
        observation.text,
        [device],
        observation.confidence,
        observation.method,
        observation.details,
        device.id,
      );
      return sample ? { ...sample, second: observation.second } : null;
    });
    const observationGroups = groupObservationSamples(samplesForDevice);
    const rawReadings = observationGroups.map(groupToReading)
      .sort((left, right) => left.off - right.off);
    const consolidated = consolidateWeighingReadings(rawReadings, {
      mergeGapSeconds: config.plateauMergeGapSeconds,
      maxDriftD: config.plateauMergeToleranceD,
      transientMaxSeconds: config.transientSegmentMaxSeconds,
      neighborGapSeconds: config.transientNeighborGapSeconds,
    });
    return {
      device,
      samples: samplesForDevice,
      observationGroups,
      rawReadings,
      readings: consolidated.readings,
      corrections: consolidated.corrections,
      score: scoreDeviceReadings(consolidated.readings),
    };
  });
  const preferredAnalysis = cardDeviceId
    ? deviceAnalyses.find((analysis) => analysis.device.id === cardDeviceId)
    : null;
  const selectedAnalysis = preferredAnalysis?.readings.length
    ? preferredAnalysis
    : [...deviceAnalyses].sort((left, right) => right.score - left.score)[0];
  if (!selectedAnalysis?.readings.length) {
    throw new Error('OCR 未识别到与天平标称点匹配的稳定示值');
  }

  const {
    device,
    samples,
    observationGroups,
    readings,
    corrections,
  } = selectedAnalysis;
  const deviceId = device.id;
  const selected = readings;
  const finalReadouts = [];
  const segments = [];
  const pointCounts = [0, 0, 0];
  for (const [sequenceIndex, reading] of selected.entries()) {
    pointCounts[reading.point] += 1;
    const segment = {
      sequence: sequenceIndex + 1,
      point: reading.point,
      idx: pointCounts[reading.point],
      value: reading.value,
      unit: 'g',
      off: reading.off,
      conf: Number(reading.confidence.toFixed(3)),
      stable: reading.stable,
      range: reading.range,
      recognizedText: reading.recognizedText,
      mergedWindowCount: Number(reading.mergedWindowCount) || 1,
      bbox: { ...region },
      ocr: {
        engine: `tesseract.js-7.0.0/eng-4.0.0+seven-segment-template`,
        method: reading.ocrMethod,
        digits: reading.ocrDetails,
        sampleCount: reading.sampleCount,
        observedMin: reading.observedMin,
        observedMax: reading.observedMax,
        segmentStart: reading.segmentStart,
        segmentEnd: reading.segmentEnd,
        observedStart: reading.observedStart,
        observedEnd: reading.observedEnd,
        mergedWindows: reading.mergedWindows || undefined,
        consolidationReason: reading.consolidationReason || null,
      },
    };
    segments.push(segment);
    if (segment.idx <= 3) finalReadouts.push(segment);
  }

  finalReadouts.sort((left, right) => Number(left.off) - Number(right.off));
  const selectedDevice = normalizedDevices.find((device) => device.id === deviceId);
  let rangeSwitch = true;
  let rangeTransition = null;
  if (Number(selectedDevice?.ranges) === 2) {
    const firstLow = segments.findIndex((readout) => Number(readout.range) === 2);
    const highBeforeSwitch = firstLow > 0
      && segments.slice(0, firstLow).every((readout) => Number(readout.range) === 1);
    const noHighAfterSwitch = firstLow >= 0
      && segments.slice(firstLow).every((readout) => Number(readout.range) === 2);
    rangeSwitch = highBeforeSwitch && noHighAfterSwitch;
    if (rangeSwitch) {
      const lastHigh = segments[firstLow - 1];
      const firstAfterSwitch = segments[firstLow];
      const gapSeconds = Math.max(
        0,
        Number(firstAfterSwitch.off) - Number(lastHigh.off),
      );
      rangeSwitch = gapSeconds <= 120;
      rangeTransition = {
        detected: rangeSwitch,
        method: 'stable-reading-sequence',
        fromRange: 1,
        toRange: 2,
        startOffsetSeconds: Number(lastHigh.off),
        endOffsetSeconds: Number(firstAfterSwitch.off),
        gapSeconds,
        sampleCountBefore: firstLow,
        sampleCountAfter: segments.length - firstLow
      };
    }
  }

  return {
    deviceId,
    readouts: finalReadouts,
    segments,
    pointCounts,
    corrections,
    rangeSwitch,
    rangeTransition,
    cards,
    cardDeviceId,
    displayRegion: region,
    displayRegionSource,
    displayRegionConfidence: regionResult?.confidence ?? null,
    displayRegionMatches: regionResult?.matches ?? 0,
    displayRegionCandidates: regionResult?.candidates,
    ocrEngine: 'tesseract.js-7.0.0 + seven-segment-template',
    scannedFrames: samples.length,
    matchedFrames: samples.filter(Boolean).length,
    debugGroups: config.debugOcr
      ? observationGroups.map((group) => ({
        point: group.point,
        deviceId: group.deviceId,
        start: group.start,
        end: group.end,
        seconds: group.seconds,
        values: group.values,
        decimals: group.decimals,
        texts: group.texts,
      }))
      : undefined,
    debugSamples: config.debugOcr
      ? samples.filter(Boolean).map((sample) => ({
        second: sample.second,
        point: sample.point,
        value: sample.value,
        text: sample.displayText,
      }))
      : undefined,
    debugRawSamples: config.debugOcr
      ? rawObservations.filter(Boolean)
      : undefined,
  };
}

