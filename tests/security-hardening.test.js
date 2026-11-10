import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientIp } from '../src/auth.js';
import { startServer } from '../server.js';

function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values[0]?.split(';', 1)[0] || '';
}

function request(baseUrl, path, options = {}, session = null) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(session?.cookie ? { Cookie: session.cookie } : {}),
      ...(session?.csrf && options.method && options.method !== 'GET'
        ? { 'X-CSRF-Token': session.csrf }
        : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
}

test('未显式信任代理时忽略 X-Forwarded-For', () => {
  const requestObject = {
    socket: { remoteAddress: '10.0.0.8' },
    headers: { 'x-forwarded-for': '203.0.113.99' }
  };
  assert.equal(clientIp(requestObject), '10.0.0.8');
  assert.equal(clientIp(requestObject, '10.0.0.8'), '203.0.113.99');
  assert.equal(clientIp(requestObject, '192.168.1.2'), '10.0.0.8');
  assert.equal(clientIp({
    socket: { remoteAddress: '10.0.0.8' },
    headers: { 'x-forwarded-for': '198.51.100.8, 10.0.0.8' }
  }, '10.0.0.0/8'), '198.51.100.8');
});

test('新数据库自动生成一次性初始口令文件', {
  timeout: 30_000
}, async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'tianping-password-'));
  const port = 19600 + Math.floor(Math.random() * 200);
  const app = await startServer({
    port,
    host: '127.0.0.1',
    dataDir: temporary,
    initialPassword: '',
    workerIntervalMs: 60
  });
  t.after(async () => {
    await app.close();
    rmSync(temporary, { recursive: true, force: true });
  });

  assert.ok(app.config.initialPasswordFile);
  assert.ok(existsSync(app.config.initialPasswordFile));
  const content = readFileSync(app.config.initialPasswordFile, 'utf8');
  const password = content.match(/初始口令：(.+)/)?.[1]?.trim();
  assert.ok(password && password.length >= 8);
  assert.match(password, /[A-Za-z]/);
  assert.match(password, /\d/);
  assert.notEqual(password, 'Tp123456');

  const response = await request(`http://127.0.0.1:${port}`, '/api/auth/login', {
    method: 'POST',
    body: { account: 'U000', password }
  });
  assert.equal(response.status, 200);
});

test('上传会话数量有每用户硬上限', {
  timeout: 30_000
}, async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'tianping-upload-limit-'));
  const port = 19800 + Math.floor(Math.random() * 100);
  const app = await startServer({
    port,
    host: '127.0.0.1',
    dataDir: temporary,
    initialPassword: 'Tp123456',
    maxActiveUploadsPerUser: 1,
    maxActiveUploadsGlobal: 2,
    workerIntervalMs: 60
  });
  t.after(async () => {
    await app.close();
    rmSync(temporary, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const loginResponse = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { account: 'U001', password: 'Tp123456' }
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  const session = { cookie: cookieFrom(loginResponse), csrf: login.csrfToken };
  const change = await request(baseUrl, '/api/auth/change-password', {
    method: 'POST',
    body: { currentPassword: 'Tp123456', newPassword: 'TpUpload1234' }
  }, session);
  assert.equal(change.status, 200);

  const payload = {
    fileName: 'reserved.mp4',
    sizeBytes: 1024,
    startedAt: '2026-10-26 10:00',
    timeConfirmed: true,
    expectedDeviceId: 'F001'
  };
  const first = await request(baseUrl, '/api/uploads/init', {
    method: 'POST',
    body: payload
  }, session);
  assert.equal(first.status, 201);
  const firstUpload = await first.json();

  const second = await request(baseUrl, '/api/uploads/init', {
    method: 'POST',
    body: { ...payload, fileName: 'second.mp4' }
  }, session);
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error.code, 'UPLOAD_SESSION_LIMIT');

  const row = app.db.prepare('SELECT temp_path FROM uploads WHERE id = ?')
    .get(firstUpload.uploadId);
  app.db.prepare('UPDATE uploads SET updated_at = ? WHERE id = ?')
    .run('2020-01-01 00:00', firstUpload.uploadId);
  assert.equal(app.uploads.cleanupExpired(), 1);
  assert.equal(
    app.db.prepare('SELECT status FROM uploads WHERE id = ?')
      .get(firstUpload.uploadId).status,
    '已取消'
  );
  assert.equal(existsSync(row.temp_path), false);
});
