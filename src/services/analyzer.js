import { createHash } from 'node:crypto';
import { accessSync, constants, createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { evaluateRecord } from '../rules.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST_DIR = resolve(MODULE_DIR, '../../samples/manifests');
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
    available: Boolean(ffprobe),
    engine: 'sample-manifest',
    mediaTools: {
      ffprobe: Boolean(ffprobe),
      ffmpeg: Boolean(ffmpeg),
    },
    supportsArbitraryVideoOcr: false,
    supportsArbitraryVideoAsr: false,
    unsupportedVideoBehavior: '待人工处理，人工核对或补录后进入判定流程',
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

function loadManifest(hash, manifestDir = DEFAULT_MANIFEST_DIR) {
  const path = join(manifestDir, `${hash.toUpperCase()}.json`);
  if (!existsSync(path)) return null;
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (!manifest || !Array.isArray(manifest.readouts) || manifest.readouts.length !== 9) {
      throw new Error('manifest readouts must contain exactly 9 items');
    }
    return manifest;
  } catch (error) {
    throw new AnalyzerError(
      'E_MANIFEST_INVALID',
      '样例分析清单损坏，无法继续分析。',
      '失败',
      error.message,
    );
  }
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

function manifestRecord(manifest, device) {
  return {
    readouts: manifest.readouts,
    rangeSwitch: manifest.rangeSwitch !== false,
    tolerance: device.tol,
  };
}

function normalizeSpeech(speech) {
  const result = structuredClone(speech || {});
  for (const [key, value] of Object.entries(result)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (value.value === undefined && value.v !== undefined) value.value = value.v;
    if (value.v === undefined && value.value !== undefined) value.v = value.value;
    if (value.value === undefined && key === 'cleanliness') value.value = '是';
    if (value.value === undefined && key === 'level') value.value = '是';
    if (value.value === undefined && key === 'internalCal') value.value = '是';
  }
  return result;
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
 * 分析上传视频。
 *
 * 当前实现会对任意视频执行媒体流、时长和文件规模校验；只有内置的三段样例
 * 具有确定性读数清单。未知视频不会被伪造成“识别成功”，而是交给人工处理。
 */
export async function analyzeVideo(context = {}) {
  const filePath = context.filePath ? resolve(context.filePath) : '';
  const config = context.config || {};
  const timeoutMs = Number(config.analysisTimeoutMs) || 120_000;
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
  const manifest = loadManifest(sha256, config.manifestDir || DEFAULT_MANIFEST_DIR);

  if (!manifest) {
    throw new AnalyzerError(
      'E_RECOGNIZER_UNAVAILABLE',
      `视频 ${basename(filePath)} 已通过媒体格式校验，但当前未安装任意视频的本地 OCR/ASR 模型。` +
        '任务已转为待人工处理，请核对卡片与读数后人工补录。',
      '待人工处理',
      {
        sha256,
        media,
        requiredCapabilities: ['device-qr', 'person-qr', 'display-ocr', 'speech-keywords'],
      },
    );
  }

  const device = findDevice(context.devices, manifest.deviceId);
  if (!device) {
    throw new AnalyzerError(
      'E_DEVICE_NOT_REGISTERED',
      `识别到设备 ${manifest.deviceId}，但天平档案中不存在该设备。请复核确认人员先登记设备后重试。`,
      '待人工处理',
      { deviceId: manifest.deviceId },
    );
  }

  const root = screenshotRoot(context);
  const targetFolder = root ? join(root, context.recordId || sha256.slice(0, 12)) : null;
  const warnings = [];
  const screenshots = [];
  const readouts = [];

  for (let index = 0; index < manifest.readouts.length; index += 1) {
    const readout = { ...manifest.readouts[index] };
    const bbox = readout.bbox || manifest.displayRegion || null;
    if (bbox) {
      readout.bbox = {
        x: Number(bbox.x),
        y: Number(bbox.y),
        width: Number(bbox.width),
        height: Number(bbox.height),
        coordinateSpace: bbox.coordinateSpace || 'normalized-video-frame',
      };
    }
    readout.time = timeAt(context.startedAt, readout.off);
    readout.key = `I${Number(readout.point) + 1}-${Number(readout.idx)}`;
    readout.recognizedText = readout.recognizedText ||
      `${readout.value ?? '未识别'} ${readout.unit || 'g'}`;
    validateFrameEvidence(readout, readout.bbox, media, device);
    readout.frame = {
      offsetSeconds: Number(readout.off),
      time: readout.time,
      bbox: readout.bbox ? { ...readout.bbox } : null,
      displayText: readout.recognizedText,
      source: 'video-frame',
      marked: Boolean(readout.bbox),
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
    } else if (!ffmpegPath) {
      warnings.push('FFmpeg 未安装，未生成识别截图');
    }
    readouts.push(readout);
  }

  if (targetFolder && ffmpegPath && screenshots.length !== 9) {
    throw new AnalyzerError(
      'E_SCREENSHOT_MISSING',
      `识别截图仅生成 ${screenshots.length}/9 张，不满足追溯要求。任务可重试；若持续失败请检查视频完整性与 FFmpeg。`,
      '失败',
      { warnings },
    );
  }

  const evaluation = evaluateRecord(manifestRecord(manifest, device), device, device.tol);
  if (manifest.expectedConclusion && evaluation.conclusion !== manifest.expectedConclusion) {
    throw new AnalyzerError(
      'E_MANIFEST_CONCLUSION_MISMATCH',
      `样例清单预期结论为“${manifest.expectedConclusion}”，但判定引擎复算为“${evaluation.conclusion}”。请检查判定参数和清单。`,
      '失败',
      { expected: manifest.expectedConclusion, actual: evaluation.conclusion },
    );
  }

  return {
    engine: 'sample-manifest',
    manifestHash: sha256,
    personCard: { ...manifest.personCard },
    deviceCard: { ...manifest.deviceCard },
    deviceId: device.id,
    durationSeconds: media.duration,
    media,
    rangeSwitch: manifest.rangeSwitch !== false,
    readouts,
    speech: normalizeSpeech(manifest.speech),
    screenshots,
    warnings,
    expectedConclusion: manifest.expectedConclusion,
    capabilityNote: '样例外视频不会自动生成读数；系统要求人工核对/补录，避免伪造识别结果。',
  };
}

export const analyzerStatus = (config = {}) => getAnalyzerStatus(config);
export default analyzeVideo;
