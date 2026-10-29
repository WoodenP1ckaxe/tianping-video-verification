import {
  chmodSync,
  createReadStream,
  existsSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiRouter } from './src/api.js';
import {
  ensureStorageDirectories,
  getSetting,
  openDatabase
} from './src/db.js';
import { AnalysisQueue } from './src/services/queue.js';
import { StorageService } from './src/services/storage.js';
import { UploadService } from './src/services/uploads.js';

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));

function envBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function envPositiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function loadConfig(overrides = {}) {
  const dataDir = path.resolve(
    overrides.dataDir
      || process.env.DATA_DIR
      || path.join(APP_ROOT, 'data')
  );
  const initialPassword = overrides.initialPassword
    ?? process.env.INITIAL_PASSWORD
    ?? null;
  return {
    ...overrides,
    rootDir: APP_ROOT,
    publicDir: path.join(APP_ROOT, 'public'),
    dataDir,
    host: overrides.host || process.env.HOST || '0.0.0.0',
    port: Number(overrides.port || process.env.PORT || 8080),
    initialPassword: initialPassword === null || initialPassword === ''
      ? null
      : String(initialPassword),
    secureCookie: overrides.secureCookie
      ?? envBoolean('SESSION_SECURE', envBoolean('SECURE_COOKIE', false)),
    trustProxy: overrides.trustProxy ?? process.env.TRUST_PROXY ?? '',
    ffprobePath: overrides.ffprobePath || process.env.FFPROBE_PATH || 'ffprobe',
    ffmpegPath: overrides.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg',
    workerIntervalMs: Number(
      overrides.workerIntervalMs
      ?? process.env.ANALYSIS_INTERVAL_MS
      ?? 600
    ),
    maxActiveUploadsPerUser: overrides.maxActiveUploadsPerUser
      ?? envPositiveInteger('MAX_ACTIVE_UPLOADS_PER_USER', 3),
    maxActiveUploadsGlobal: overrides.maxActiveUploadsGlobal
      ?? envPositiveInteger('MAX_ACTIVE_UPLOADS_GLOBAL', 10),
    maxTempUploadBytes: overrides.maxTempUploadBytes
      ?? envPositiveInteger('MAX_TEMP_UPLOAD_BYTES', 2 * 1024 ** 3),
    uploadSessionTtlMinutes: overrides.uploadSessionTtlMinutes
      ?? envPositiveInteger('UPLOAD_SESSION_TTL_MINUTES', 120),
    minFreeDiskBytes: overrides.minFreeDiskBytes
      ?? envPositiveInteger('MIN_FREE_DISK_BYTES', 512 * 1024 ** 2)
  };
}

function prepareInitialPassword(config) {
  const databasePath = path.join(config.dataDir, 'tianping.db');
  if (existsSync(databasePath)) return;

  if (config.initialPassword && (
    config.initialPassword.length < 8
    || !/[A-Za-z]/.test(config.initialPassword)
    || !/\d/.test(config.initialPassword)
  )) {
    throw new Error('INITIAL_PASSWORD 至少 8 位，且必须同时包含字母与数字');
  }

  if (!config.initialPassword) {
    config.initialPassword = `Tp-${randomBytes(18).toString('base64url')}-9a`;
    const passwordFile = path.join(config.dataDir, 'initial-password.txt');
    writeFileSync(
      passwordFile,
      [
        '天平校验视频分析系统首次部署口令',
        `初始口令：${config.initialPassword}`,
        '全部初始账号共享该口令，首次登录后必须立即修改。',
        '完成初始化后请删除本文件。',
        ''
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600, flag: 'w' }
    );
    try {
      chmodSync(passwordFile, 0o600);
    } catch {
      // Windows ACLs are managed by the filesystem; mode is best effort there.
    }
    config.initialPasswordFile = passwordFile;
  }
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.pdf': 'application/pdf'
  }[ext] || 'application/octet-stream';
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'"
    ].join('; ')
  };
}

function serveStatic(req, res, publicDir, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  let requested;
  try {
    requested = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('请求路径无效');
    return true;
  }

  if (requested === '/' || requested === '') requested = '/index.html';
  const normalized = path.normalize(requested).replaceAll('\\', '/');
  const fullPath = path.resolve(publicDir, `.${normalized}`);
  const prefix = `${path.resolve(publicDir)}${path.sep}`;
  if (fullPath !== path.join(path.resolve(publicDir), 'index.html')
    && !fullPath.startsWith(prefix)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('禁止访问');
    return true;
  }

  let target = fullPath;
  if (!existsSync(target) || !statSync(target).isFile()) {
    if (!path.extname(normalized)) {
      target = path.join(publicDir, 'index.html');
    } else {
      return false;
    }
  }
  if (!existsSync(target) || !statSync(target).isFile()) return false;

  const stat = statSync(target);
  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, ...securityHeaders() });
    res.end();
    return true;
  }
  const cache = target.endsWith('index.html')
    ? 'no-cache'
    : 'public, max-age=300, must-revalidate';
  res.writeHead(200, {
    'Content-Type': mimeType(target),
    'Content-Length': stat.size,
    'Cache-Control': cache,
    ETag: etag,
    ...securityHeaders()
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    const stream = createReadStream(target);
    stream.on('error', (error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('静态资源读取失败');
      } else {
        res.destroy(error);
      }
    });
    stream.pipe(res);
  }
  return true;
}

export async function startServer(overrides = {}) {
  const config = loadConfig(overrides);
  ensureStorageDirectories(config);
  prepareInitialPassword(config);
  const { db, dbPath } = openDatabase({
    ...config,
    dataDir: config.dataDir,
    initialPassword: config.initialPassword
  });
  config.dbPath = dbPath;

  const storage = new StorageService({ db, config });
  const uploads = new UploadService({ db, config });
  const queue = new AnalysisQueue({
    db,
    config,
    storageService: storage,
    intervalMs: config.workerIntervalMs
  });
  const api = new ApiRouter({ db, config, uploads, storage, queue });

  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || 'localhost';
      const url = new URL(req.url || '/', `http://${host}`);
      if (await api.handle(req, res, url)) return;
      if (serveStatic(req, res, config.publicDir, url.pathname)) return;
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        ...securityHeaders()
      });
      res.end('页面或资源不存在');
    } catch (error) {
      console.error('[server]', error);
      if (!res.headersSent) {
        res.writeHead(500, {
          'Content-Type': 'application/json; charset=utf-8'
        });
        res.end(JSON.stringify({
          error: {
            code: 'INTERNAL_ERROR',
            message: '服务器处理请求时发生错误'
          }
        }));
      } else {
        res.destroy();
      }
    }
  });

  server.requestTimeout = 30 * 60 * 1000;
  server.headersTimeout = 60 * 1000;
  server.keepAliveTimeout = 10 * 1000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  queue.start();
  uploads.cleanupExpired();
  storage.maybeDailyBackup();
  const backupTimer = setInterval(() => {
    uploads.cleanupExpired();
    storage.maybeDailyBackup();
  }, 15 * 60 * 1000);
  backupTimer.unref?.();

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(backupTimer);
    await queue.stop();
    await new Promise((resolve) => server.close(() => resolve()));
    db.close();
  };
  const onSignal = async () => {
    await close();
    process.exit(0);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  return {
    config,
    db,
    server,
    queue,
    storage,
    uploads,
    close,
    address: server.address()
  };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  startServer()
    .then(({ config, address }) => {
      const host = typeof address === 'object' && address
        ? address.address
        : config.host;
      console.log(`天平校验视频分析系统已启动：http://${host}:${config.port}`);
      console.log(`数据目录：${config.dataDir}`);
      if (config.initialPasswordFile) {
        console.log(`首次部署口令已写入：${config.initialPasswordFile}`);
        console.log('完成全部初始账号改密后，请删除该文件。');
      }
    })
    .catch((error) => {
      console.error('启动失败：', error);
      process.exitCode = 1;
    });
}

