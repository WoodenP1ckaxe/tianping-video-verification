import { createHash } from 'node:crypto';
import { accessSync, constants, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { locateDisplayRegion, recognizeVideo } from './display-ocr.js';

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_DURATION_SECONDS = 30 * 60;

export class AnalyzerError extends Error {
  constructor(code, message, status = '失败', details = null) {
    super(message);
    this.name = 'AnalyzerError';
    this.code = code;
    this.status = status === '待人工处理' ? '待人工处理' : '失败';
    this.details = details;
  }
}

function findExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const names = [candidate];
    if (!isAbsolute(candidate) && !candidate.includes('/') && !candidate.includes('\\')) {
      names.length = 0;
      const extensions = process.platform === 'win32'
        ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
        : [''];
      for (const directory of (process.env.PATH || '').split(delimiter)) {
        if (!directory) continue;
        for (const extension of extensions) {
          names.push(join(directory, candidate + extension));
        }
      }
    }
    for (const name of names) {
      try {
        accessSync(name, constants.X_OK);
        return name;
      } catch {
        // Windows 下有时不设置 X_OK，可继续用文件存在性判断。
        if (existsSync(name) && !name.toLowerCase().endsWith('.ps1')) return name;
      }
    }
  }
  return null;
}

export function getAnalyzerStatus(config = {}) {
  const ffprobe = findExecutable([
    config.ffprobePath,
    process.env.FFPROBE_PATH,
    'ffprobe',
    'C:\\ffmpeg\\bin\\ffprobe.exe',
    'D:\\ffmpeg\\ffmpeg-7.1-full_build\\bin\\ffprobe.exe',
  ]);
  const ffmpeg = findExecutable([
    config.ffmpegPath,
    process.env.FFMPEG_PATH,
    'ffmpeg',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'D:\\ffmpeg\\ffmpeg-7.1-full_build\\bin\\ffmpeg.exe',
  ]);
  return {
    available: Boolean(ffprobe && ffmpeg),
    mode: 'local-display-ocr',
    engine: 'local-display-ocr',
    mediaTools: {
      ffprobe: Boolean(ffprobe),
      ffmpeg: Boolean(ffmpeg),
    },
    supportsDisplayOcr: true,
    supportsArbitraryVideoOcr: true,
    supportsMultipleQrCodesPerFrame: true,
    speechRecognition: 'removed',
    displayRegionConfigurable: true,
    supportsAutomaticDisplayRegion: true,
    unsupportedVideoBehavior: 'OCR 无法提取稳定示值时转待人工处理，人工核对或补录后进入判定流程',
  };
}

function runProcess(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;
    try {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options.spawnOptions,
      });
    } catch (error) {
      resolvePromise({ code: -1, stdout, stderr: error.message, spawnError: error });
      return;
    }

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // 子进程可能已退出。
      }
      finish({ code: -1, stdout, stderr: `${stderr}\n处理超时`, timedOut: true });
    }, options.timeoutMs || 120_000);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_500_000);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-150_000);
    });
    child.on('error', (error) => {
      finish({ code: -1, stdout, stderr: `${stderr}\n${error.message}`, spawnError: error });
    });
    child.on('close', (code) => finish({ code, stdout, stderr }));
  });
}

async function fileHash(filePath) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolvePromise(hash.digest('hex').toUpperCase()));
  });
}

function parseFrameRate(value) {
  if (!value || typeof value !== 'string') return null;
  const [numerator, denominator = '1'] = value.split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

async function probeMedia(filePath, ffprobePath, timeoutMs) {
  if (!ffprobePath) {
    throw new AnalyzerError(
      'E_MEDIA_TOOL_MISSING',
      '未找到 FFprobe，无法验证视频编码和时长。请安装 FFmpeg 或配置 FFPROBE_PATH 后重试。',
    );
  }
  const result = await runProcess(
    ffprobePath,
    [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    { timeoutMs },
  );
  if (result.code !== 0) {
    throw new AnalyzerError(
      'E_VIDEO_CORRUPT',
      '视频文件损坏、不可读取或不是有效媒体文件。',
      '失败',
      result.stderr.slice(-2000),
    );
  }

  let probe;
  try {
    probe = JSON.parse(result.stdout || '{}');
  } catch {
    throw new AnalyzerError('E_PROBE_INVALID', '视频探测结果无法解析。');
  }

  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (!video) throw new AnalyzerError('E_NO_VIDEO_STREAM', '文件中未找到视频流。');

  const duration = Number(probe.format?.duration ?? video.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AnalyzerError('E_DURATION_UNKNOWN', '无法读取视频时长，请重新导出为标准 MP4。');
  }
  if (duration > MAX_DURATION_SECONDS + 0.5) {
    throw new AnalyzerError('E_TOO_LONG', `视频时长 ${Math.ceil(duration / 60)} 分钟，超过 30 分钟上限。`);
  }
  const codec = String(video.codec_name || '').toLowerCase();
  if (codec !== 'h264') {
    throw new AnalyzerError(
      'E_CODEC_UNSUPPORTED',
      `视频编码为 ${codec || '未知'}，系统仅接受 H.264。请在手机拍摄设置中选择“兼容性最佳”后重新上传。`,
    );
  }
  if (audio && String(audio.codec_name || '').toLowerCase() !== 'aac') {
    throw new AnalyzerError(
      'E_AUDIO_CODEC_UNSUPPORTED',
      `音频编码为 ${audio.codec_name || '未知'}，系统仅接受 AAC。`,
    );
  }

  return {
    duration,
    videoCodec: codec,
    audioCodec: audio?.codec_name || null,
    width: Number(video.width) || null,
    height: Number(video.height) || null,
    frameRate: parseFrameRate(video.r_frame_rate),
    creationTime: probe.format?.tags?.creation_time || null,
  };
}

export async function inspectVideoMetadata({ filePath, config = {} } = {}) {
  const resolved = filePath ? resolve(filePath) : '';
  if (!resolved || !existsSync(resolved)) {
    throw new AnalyzerError('E_FILE_MISSING', '上传的视频文件不存在。');
  }
  const ffprobePath = findExecutable([
    config.ffprobePath,
    process.env.FFPROBE_PATH,
    'ffprobe',
    'C:\\ffmpeg\\bin\\ffprobe.exe',
    'D:\\ffmpeg\\ffmpeg-7.1-full_build\\bin\\ffprobe.exe',
  ]);
  const timeoutMs = Number(config.analysisTimeoutMs) || 20 * 60_000;
  return probeMedia(resolved, ffprobePath, timeoutMs);
}

export async function captureManualEvidence({
  filePath,
  config = {},
  devices = [],
  readouts = [],
  startTime,
  recordId = 'manual',
} = {}) {
  const resolved = filePath ? resolve(filePath) : '';
  if (!resolved || !existsSync(resolved)) {
    throw new AnalyzerError('E_FILE_MISSING', '原始视频不存在，无法补齐人工补录识别帧。');
  }
  const timeoutMs = Number(config.analysisTimeoutMs) || 20 * 60_000;
  const ffprobePath = findExecutable([
    config.ffprobePath,
    process.env.FFPROBE_PATH,
    'ffprobe',
    'C:\\ffmpeg\\bin\\ffprobe.exe',
    'D:\\ffmpeg\\ffmpeg-7.1-full_build\\bin\\ffprobe.exe',
  ]);
  const ffmpegPath = findExecutable([
    config.ffmpegPath,
    process.env.FFMPEG_PATH,
    'ffmpeg',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'D:\\ffmpeg\\ffmpeg-7.1-full_build\\bin\\ffmpeg.exe',
  ]);
  if (!ffmpegPath) {
    throw new AnalyzerError('E_MEDIA_TOOL_MISSING', 'FFmpeg 未安装，无法保存人工补录识别截图。');
  }
  const media = await probeMedia(resolved, ffprobePath, timeoutMs);
  const located = await locateDisplayRegion({
    ffmpegPath,
    filePath: resolved,
    media,
    devices,
    config,
  });
  const region = located?.region || {
    x: 0.1195,
    y: 0.6510,
    width: 0.7537,
    height: 0.1198,
    coordinateSpace: 'normalized-video-frame',
  };
  const root = screenshotRoot({ config });
  if (!root) throw new AnalyzerError('E_SCREENSHOT_ROOT_MISSING', '未配置识别截图目录。');
  const folder = join(root, String(recordId));
  const screenshots = [];
  const evidenceReadouts = [];
  const failures = [];
  for (let index = 0; index < 9; index += 1) {
    const source = readouts[index] || {};
    const point = Math.floor(index / 3);
    const idx = (index % 3) + 1;
    const value = source.value === null || source.value === undefined || source.value === ''
      ? null
      : Number(source.value);
    const off = Number.isFinite(Number(source.off))
      ? Number(source.off)
      : 30 + index * 35;
    const item = {
      ...source,
      point,
      idx,
      value: Number.isFinite(value) ? value : null,
      off,
      time: source.time || timeAt(startTime, off),
      evidenceStatus: 'manual-frame',
      bbox: { ...region },
      frame: {
        offsetSeconds: off,
        time: source.time || timeAt(startTime, off),
        bbox: { ...region },
        displayText: source.recognizedText ||
          (Number.isFinite(value) ? `人工核对 ${value} ${source.unit || 'g'}` : '缺次'),
        source: 'video-frame',
        marked: true
      }
    };
    if (item.value !== null) {
      const key = `I${point + 1}-${idx}`;
      const outputPath = join(folder, `${key}.jpg`);
      const capture = await captureScreenshot({
        ffmpegPath,
        filePath: resolved,
        offsetSeconds: off,
        outputPath,
        timeoutMs,
        bbox: region,
        media,
      });
      if (!capture.ok) {
        failures.push(key);
      } else {
        const configuredDataDir = config.dataDir ? resolve(config.dataDir) : null;
        item.screenshot = configuredDataDir
          ? relative(configuredDataDir, outputPath).replaceAll('\\', '/')
          : outputPath.replaceAll('\\', '/');
        screenshots.push({
          key,
          path: item.screenshot,
          offsetSeconds: off,
          bbox: { ...region },
          displayText: item.frame.displayText,
        });
      }
    }
    evidenceReadouts.push(item);
  }
  if (failures.length) {
    throw new AnalyzerError(
      'E_READING_EVIDENCE_INCOMPLETE',
      `人工补录的有效读数缺少识别截图：${failures.join('、')}`,
      '待人工处理',
      { failures },
    );
  }
  return {
    media,
    readouts: evidenceReadouts,
    screenshots,
    displayRegion: region,
    displayRegionSource: located?.source || 'default-fallback',
    displayRegionConfidence: located?.confidence ?? null,
  };
}

function normalizeDeviceList(devices) {
  if (Array.isArray(devices)) return devices;
  if (devices && typeof devices === 'object') return Object.values(devices);
  return [];
}

function findDevice(devices, identifier) {
  const compact = String(identifier || '').trim();
  return normalizeDeviceList(devices).find((device) =>
    String(device?.id || '') === compact || String(device?.uniqueNo || '') === compact,
  );
}

function formatShanghaiDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace('T', ' ');
}

export function metadataStartTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return null;
  const formatted = formatShanghaiDateTime(text);
  if (!formatted) return null;
  const year = Number(formatted.slice(0, 4));
  return year >= 1970 && year <= 2100 ? formatted : null;
}

function cardIdentity(rawValue, accounts, devices) {
  const raw = String(rawValue || '').trim();
  if (!raw) return { kind: null, value: null, raw };
  const prefixed = raw.match(
    /^(?:(PERSON|人员|USER|ACCOUNT)|(DEVICE|设备|BALANCE|SCALE))\s*[:：-]\s*(.+)$/i,
  );
  const candidate = String(prefixed?.[3] || raw).trim();
  const account = accounts.find((item) =>
    String(item?.id || '').toUpperCase() === candidate.toUpperCase(),
  )?.id;
  const device = devices.find((item) =>
    String(item?.id || '').toUpperCase() === candidate.toUpperCase()
    || String(item?.uniqueNo || '').toUpperCase() === candidate.toUpperCase(),
  );
  if (prefixed?.[1]) {
    return { kind: account ? 'person' : null, value: account || null, raw };
  }
  if (prefixed?.[2]) {
    return { kind: device ? 'device' : null, value: device?.id || null, raw };
  }
  if (Boolean(account) === Boolean(device)) {
    return { kind: null, value: null, raw, ambiguous: Boolean(account && device) };
  }
  return account
    ? { kind: 'person', value: account, raw }
    : { kind: 'device', value: device.id, raw };
}

export function parseCardIdentities(decodedCards, accounts = [], devices = []) {
  const identities = (Array.isArray(decodedCards) ? decodedCards : [])
    .map((card) => cardIdentity(card?.data ?? card, accounts, devices));
  const personIdentities = [...new Set(
    identities.filter((item) => item.kind === 'person').map((item) => item.value),
  )];
  const deviceIdentities = [...new Set(
    identities.filter((item) => item.kind === 'device').map((item) => item.value),
  )];
  const ambiguousCards = identities.filter((item) => item.ambiguous);
  const cardConflicts = [];
  if (personIdentities.length > 1) {
    cardConflicts.push(`识别到多个不同人员卡：${personIdentities.join('、')}`);
  }
  if (deviceIdentities.length > 1) {
    cardConflicts.push(`识别到多个不同设备卡：${deviceIdentities.join('、')}`);
  }
  if (ambiguousCards.length) {
    cardConflicts.push('卡面内容同时匹配人员账号与设备编号，无法确认身份');
  }
  return {
    identities,
    personIdentities,
    deviceIdentities,
    ambiguousCards,
    cardConflicts
  };
}

function parseStartMinute(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0,
    0,
  );
}

function timeAt(startedAt, offsetSeconds) {
  const start = parseStartMinute(startedAt);
  if (!start) return null;
  const value = new Date(start.getTime() + Number(offsetSeconds || 0) * 1000);
  const pad = (number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

async function captureScreenshot({
  ffmpegPath,
  filePath,
  offsetSeconds,
  outputPath,
  timeoutMs,
  bbox,
  media,
}) {
  if (!ffmpegPath) return { ok: false, reason: 'FFmpeg 未安装' };
  mkdirSync(dirname(outputPath), { recursive: true });
  const filters = [];
  if (bbox && media?.width && media?.height) {
    const x = Math.max(0, Math.round(Number(bbox.x) * media.width));
    const y = Math.max(0, Math.round(Number(bbox.y) * media.height));
    const width = Math.max(1, Math.round(Number(bbox.width) * media.width));
    const height = Math.max(1, Math.round(Number(bbox.height) * media.height));
    filters.push(`drawbox=x=${x}:y=${y}:w=${width}:h=${height}:color=yellow@0.95:t=4`);
  }
  filters.push('scale=960:-2');
  const result = await runProcess(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-ss', String(Math.max(0, Number(offsetSeconds) || 0)),
      '-i', filePath,
      '-frames:v', '1',
      '-vf', filters.join(','),
      '-q:v', '2',
      '-y',
      outputPath,
    ],
    { timeoutMs },
  );
  return result.code === 0 && existsSync(outputPath)
    ? { ok: true }
    : { ok: false, reason: result.stderr.slice(-500) || '截图失败' };
}

function screenshotRoot(context) {
  const root = context.config?.screenshotDir ||
    context.config?.screenshotsDir ||
    (context.config?.dataDir ? join(context.config.dataDir, 'screenshots') : null);
  return root ? resolve(root) : null;
}

function validateFrameEvidence(readout, bbox, media, device) {
  if (!bbox) {
    throw new AnalyzerError(
      'E_FRAME_REGION_MISSING',
      `${readout.key} 缺少显示屏识别框，不能作为可核验读数。`,
      '失败',
    );
  }
  const values = [bbox.x, bbox.y, bbox.width, bbox.height].map(Number);
  if (!values.every(Number.isFinite)
    || bbox.x < 0 || bbox.y < 0
    || bbox.width <= 0 || bbox.height <= 0
    || bbox.x + bbox.width > 1.001
    || bbox.y + bbox.height > 1.001) {
    throw new AnalyzerError(
      'E_FRAME_REGION_INVALID',
      `${readout.key} 的显示屏识别框超出视频画面或尺寸无效。`,
      '失败',
    );
  }
  if (Number(readout.off) < 0
    || Number(readout.off) >= Number(media.duration) + 1) {
    throw new AnalyzerError(
      'E_FRAME_OFFSET_INVALID',
      `${readout.key} 的识别帧偏移超出视频时长。`,
      '失败',
      { offsetSeconds: readout.off, durationSeconds: media.duration },
    );
  }
  const displayMatch = String(readout.recognizedText || '')
    .match(/([+-]?\d+(?:\.\d+)?)\s*(mg|g)\b/i);
  if (!displayMatch) {
    throw new AnalyzerError(
      'E_FRAME_TEXT_INVALID',
      `${readout.key} 缺少与识别帧对应的数值文本。`,
      '失败',
    );
  }
  const display = Number(displayMatch[1]);
  const displayInGrams = displayMatch[2].toLowerCase() === 'mg'
    ? display / 1000
    : display;
  const range = Number(readout.range) === 2 ? 2 : 1;
  const rangeD = Number(range === 2 ? device.range2?.d : device.range1?.d);
  const roundingTolerance = Math.max((Number.isFinite(rangeD) ? rangeD : 0.1) / 2000, 1e-9);
  if (Math.abs(displayInGrams - Number(readout.value)) > roundingTolerance) {
    throw new AnalyzerError(
      'E_FRAME_VALUE_MISMATCH',
      `${readout.key} 的帧内文本 ${readout.recognizedText} 与换算读数 ${readout.value}g 不一致。`,
      '失败',
      {
        displayText: readout.recognizedText,
        displayInGrams,
        storedValue: readout.value,
      },
    );
  }
}

/**
 * 分析上传视频。读数来自视频真实帧的本地显示屏 OCR，不使用文件名或哈希查表。
 */
export async function analyzeVideo(context = {}) {
  const filePath = context.filePath ? resolve(context.filePath) : '';
  const config = context.config || {};
  const timeoutMs = Number(config.analysisTimeoutMs) || 20 * 60_000;
  if (!filePath || !existsSync(filePath)) {
    throw new AnalyzerError('E_FILE_MISSING', '上传的视频文件不存在或已被清理。');
  }
  const extension = extname(filePath).toLowerCase();
  if (!['.mp4', '.mov'].includes(extension)) {
    throw new AnalyzerError('E_EXTENSION_UNSUPPORTED', '仅支持 MP4、MOV 视频文件。');
  }
  const size = statSync(filePath).size;
  if (size <= 0) throw new AnalyzerError('E_EMPTY_VIDEO', '上传的视频文件为空。');
  if (size > MAX_FILE_BYTES) {
    throw new AnalyzerError('E_TOO_LARGE', '视频文件超过 500MB 上限。');
  }

  const sha256 = context.sha256
    ? String(context.sha256).toUpperCase()
    : await fileHash(filePath);
  const ffprobePath = findExecutable([
    config.ffprobePath,
    process.env.FFPROBE_PATH,
    'ffprobe',
    'C:\\ffmpeg\\bin\\ffprobe.exe',
    'D:\\ffmpeg\\ffmpeg-7.1-full_build\\bin\\ffprobe.exe',
  ]);
  const ffmpegPath = findExecutable([
    config.ffmpegPath,
    process.env.FFMPEG_PATH,
    'ffmpeg',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'D:\\ffmpeg\\ffmpeg-7.1-full_build\\bin\\ffmpeg.exe',
  ]);
  const media = await probeMedia(filePath, ffprobePath, timeoutMs);
  const devices = normalizeDeviceList(context.devices);
  const accounts = normalizeDeviceList(context.accounts);
  const uploadedBy = String(context.uploadedBy || '').trim();
  const knownAccounts = accounts.length
    ? accounts
    : (uploadedBy ? [{ id: uploadedBy }] : []);
  const effectiveStartedAt = metadataStartTime(media.creationTime)
    || String(context.startedAt || '');
  let recognition;
  try {
    recognition = await recognizeVideo({
      ffmpegPath,
      filePath,
      media,
      devices,
      config,
    });
  } catch (error) {
    throw new AnalyzerError(
      'E_DISPLAY_OCR_FAILED',
      `本地显示屏 OCR 未能生成有效读数：${error.message}`,
      '待人工处理',
      {
        sha256,
        media,
        details: error.stack?.split('\n').slice(0, 4).join('\n') || null,
      },
    );
  }

  const decodedCards = recognition.cards || [];
  const {
    personIdentities,
    deviceIdentities,
    cardConflicts
  } = parseCardIdentities(decodedCards, knownAccounts, devices);

  const inferredDevice = findDevice(devices, recognition.deviceId);
  const cardDevice = deviceIdentities.length === 1
    ? findDevice(devices, deviceIdentities[0])
    : null;
  if (cardDevice && inferredDevice && cardDevice.id !== inferredDevice.id) {
    throw new AnalyzerError(
      'E_DEVICE_IDENTITY_CONFLICT',
      `设备卡识别为 ${cardDevice.id}，读数匹配为 ${inferredDevice.id}，未生成正式记录`,
      '待人工处理',
      { cardDeviceId: cardDevice.id, inferredDeviceId: inferredDevice.id },
    );
  }
  const device = cardDevice || inferredDevice;
  if (!device) {
    throw new AnalyzerError(
      'E_DEVICE_NOT_REGISTERED',
      `设备卡或 OCR 读数未能匹配已登记天平（${recognition.deviceId || '未知设备'}）。`,
      '待人工处理',
      { deviceId: recognition.deviceId },
    );
  }

  const root = screenshotRoot(context);
  const targetFolder = root ? join(root, context.recordId || sha256.slice(0, 12)) : null;
  const warnings = [];
  const screenshots = [];
  const grouped = [[], [], []];
  for (const readout of recognition.readouts) {
    if (readout.point >= 0 && readout.point < 3) grouped[readout.point].push(readout);
  }
  const readouts = [];
  for (let point = 0; point < 3; point += 1) {
    const matches = grouped[point].sort((left, right) => left.off - right.off);
    for (let idx = 1; idx <= 3; idx += 1) {
      const source = matches[idx - 1];
      const key = `I${point + 1}-${idx}`;
      if (!source) {
        const fallbackOffset = matches.at(-1)?.off
          ? Number(matches.at(-1).off) + (idx - matches.length) * 30
          : 30 + (point * 3 + idx - 1) * 35;
        readouts.push({
          point,
          idx,
          value: null,
          unit: 'g',
          off: fallbackOffset,
          conf: 0,
          stable: false,
          range: Number(device.ranges) === 2
            ? (Number(device.pointRange?.[point]) === 2 ? 2 : (point === 0 ? 1 : 2))
            : 1,
          recognizedText: '未识别到该次稳定示值',
          evidenceStatus: 'missing',
        });
        warnings.push(`${key} 未从视频中识别到满足稳定性要求的读数`);
        continue;
      }
      readouts.push({
        ...source,
        idx,
        evidenceStatus: 'ocr-frame',
      });
    }
    if (grouped[point].length > 3) {
      warnings.push(
        `L${point + 1} 识别到 ${grouped[point].length} 个候选称重段，记录仅保留前 3 个；请人工核对是否存在重复称重`,
      );
    }
  }

  for (const readout of readouts) {
    if (readout.value === null) continue;
    const bbox = readout.bbox || recognition.displayRegion;
    readout.bbox = {
      x: Number(bbox.x),
      y: Number(bbox.y),
      width: Number(bbox.width),
      height: Number(bbox.height),
      coordinateSpace: 'normalized-video-frame',
    };
    readout.time = timeAt(effectiveStartedAt, readout.off);
    readout.key = `I${readout.point + 1}-${readout.idx}`;
    readout.recognizedText = readout.recognizedText ||
      `${readout.value} ${readout.unit || 'g'}`;
    validateFrameEvidence(readout, readout.bbox, media, device);
    readout.frame = {
      offsetSeconds: Number(readout.off),
      time: readout.time,
      bbox: { ...readout.bbox },
      displayText: readout.recognizedText,
      source: 'video-frame',
      marked: true,
    };
    if (targetFolder && ffmpegPath) {
      const filename = `${readout.key}.jpg`;
      const outputPath = join(targetFolder, filename);
      const capture = await captureScreenshot({
        ffmpegPath,
        filePath,
        offsetSeconds: readout.off,
        outputPath,
        timeoutMs,
        bbox: readout.bbox,
        media,
      });
      if (capture.ok) {
        const configuredDataDir = config.dataDir ? resolve(config.dataDir) : null;
        readout.screenshot = configuredDataDir
          ? relative(configuredDataDir, outputPath).replaceAll('\\', '/')
          : outputPath.replaceAll('\\', '/');
        screenshots.push({
          key: readout.key,
          path: readout.screenshot,
          offsetSeconds: readout.off,
          bbox: readout.bbox,
          displayText: readout.recognizedText,
        });
      } else {
        warnings.push(`${readout.key} 识别截图生成失败：${capture.reason}`);
      }
    }
  }

  const personCard = personIdentities.length === 1
    ? { account: personIdentities[0], conf: 0.98, source: 'qr' }
    : null;
  const deviceCard = deviceIdentities.length === 1
    ? { code: deviceIdentities[0], conf: 0.98, source: 'qr' }
    : null;
  if (!personCard) {
    warnings.push('未识别到唯一且有效的人员卡；不能生成正式记录');
  }
  if (!deviceCard) {
    warnings.push('未识别到唯一且有效的设备卡；不能用 OCR 标称值推断替代卡面身份');
  }
  if (cardConflicts.length) warnings.push(...cardConflicts);

  return {
    engine: recognition.ocrEngine,
    personCard,
    deviceCard,
    deviceId: device.id,
    inferredDeviceId: inferredDevice?.id || recognition.deviceId || null,
    cardConflicts,
    startTime: effectiveStartedAt,
    startTimeSource: metadataStartTime(media.creationTime) ? 'video-creation-time' : 'user-confirmed',
    creationTime: media.creationTime,
    durationSeconds: media.duration,
    media,
    rangeSwitch: recognition.rangeSwitch,
    rangeTransition: recognition.rangeTransition || null,
    readouts,
    screenshots,
    warnings,
    ocr: {
      engine: recognition.ocrEngine,
      scannedFrames: recognition.scannedFrames,
      matchedFrames: recognition.matchedFrames,
      displayRegion: recognition.displayRegion,
      displayRegionSource: recognition.displayRegionSource,
      displayRegionConfidence: recognition.displayRegionConfidence,
      displayRegionMatches: recognition.displayRegionMatches,
      displayRegionCandidates: recognition.displayRegionCandidates,
      deviceInference: deviceCard ? 'qr' : 'registered-points',
      personInference: personCard ? 'qr' : 'missing',
      decodedCardCount: decodedCards.length,
      cardConflicts,
    },
    capabilityNote: '读数由本地视频帧 OCR 和稳定段检测生成；低置信或缺失项必须人工核对。',
  };
}

export const analyzerStatus = (config = {}) => getAnalyzerStatus(config);
export default analyzeVideo;
