import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../server.js';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values[0]?.split(';', 1)[0] || '';
}

class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
    this.csrf = '';
  }

  async request(path, options = {}) {
    const method = options.method || 'GET';
    const headers = {
      ...(this.cookie ? { Cookie: this.cookie } : {}),
      ...(this.csrf && !['GET', 'HEAD'].includes(method)
        ? { 'X-CSRF-Token': this.csrf }
        : {}),
      ...(options.body !== undefined && options.rawBody === undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.headers || {})
    };
    const body = options.rawBody !== undefined
      ? options.rawBody
      : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body
    });
    if (response.headers.get('set-cookie')) {
      this.cookie = cookieFrom(response);
    }
    return response;
  }

  async login(account, password) {
    const response = await this.request('/api/auth/login', {
      method: 'POST',
      body: { account, password }
    });
    if (response.status !== 200) {
      throw new Error(`${response.status}: ${await response.text()}`);
    }
    const body = await response.json();
    this.csrf = body.csrfToken;
    return body;
  }

  async loginAndChange(account, initialPassword, newPassword) {
    const body = await this.login(account, initialPassword);
    if (body.user.mustChangePassword) {
      const response = await this.request('/api/auth/change-password', {
        method: 'POST',
        body: {
          currentPassword: initialPassword,
          newPassword
        }
      });
      if (response.status !== 200) {
        assert.fail(`HTTP ${response.status}: ${await response.text()}`);
      }
    }
  }
}

async function setupServer(t, config = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'tianping-regression-'));
  const app = await startServer({
    port: await freePort(),
    host: '127.0.0.1',
    dataDir,
    initialPassword: 'Tp123456',
    workerIntervalMs: 600_000,
    ...config
  });
  t.after(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    app,
    dataDir,
    baseUrl: `http://127.0.0.1:${app.address.port}`
  };
}

test('输入、鉴权、通知、审计和状态转换回归', {
  timeout: 60_000
}, async (t) => {
  const { app, dataDir, baseUrl } = await setupServer(t);
  const inspector = new Client(baseUrl);
  const verifier = new Client(baseUrl);
  const admin = new Client(baseUrl);
  await inspector.loginAndChange('U001', 'Tp123456', 'TpInspector1234');
  await verifier.loginAndChange('U003', 'Tp123456', 'TpVerifier1234');
  await admin.loginAndChange('U000', 'Tp123456', 'TpAdmin1234');

  const nullLogin = await new Client(baseUrl).request('/api/auth/login', {
    method: 'POST',
    body: null
  });
  assert.equal(nullLogin.status, 400);
  assert.equal((await nullLogin.json()).error.code, 'INVALID_JSON');

  const captcha = await new Client(baseUrl).request(
    '/api/auth/captcha?account=U001'
  );
  assert.equal(captcha.status, 410);
  assert.equal((await captcha.json()).error.code, 'CAPTCHA_DISABLED');

  const invalidDate = await inspector.request(
    '/api/records?from=2026-02-30&to=2026-03-02'
  );
  assert.equal(invalidDate.status, 400);

  const invalidUpload = await inspector.request('/api/uploads/init', {
    method: 'POST',
    body: {
      fileName: 'invalid-date.mp4',
      sizeBytes: 1,
      startedAt: '2026-02-30 25:61',
      timeConfirmed: true,
      expectedDeviceId: 'F001'
    }
  });
  assert.equal(invalidUpload.status, 400);

  const extremePage = await inspector.request('/api/records?page=1e309');
  assert.equal(extremePage.status, 400);
  assert.equal((await extremePage.json()).error.code, 'VALIDATION_ERROR');

  const malformedPath = await inspector.request(
    '/api/qr/device/%E0%A4%A.svg'
  );
  assert.equal(malformedPath.status, 400);

  const persisted = await inspector.request('/api/records/20260928-F001-01');
  assert.equal(persisted.status, 200);
  const persistedBody = await persisted.json();
  assert.equal(persistedBody.record.conclusion, '通过');
  assert.match(persistedBody.record.ruleVersion, /^\d{4}\.\d+\.\d+$/);
  assert.ok(persistedBody.record.judgedAt);
  assert.equal(persistedBody.evaluation.conclusion, '通过');

  const badReadoutTime = await inspector.request(
    '/api/records/20260926-F001-03/readouts/I1-1',
    {
      method: 'POST',
      body: {
        value: 200.0018,
        time: '2026-02-30 25:61',
        reason: '非法时间测试'
      }
    }
  );
  assert.equal(badReadoutTime.status, 400);

  const changedReadout = await inspector.request(
    '/api/records/20260926-F001-03/readouts/I1-1',
    {
      method: 'POST',
      body: {
        value: 200.5,
        reason: '超限回归测试'
      }
    }
  );
  assert.equal(changedReadout.status, 200);
  const changedBody = await changedReadout.json();
  assert.equal(changedBody.record.conclusion, '不通过');
  assert.equal(changedBody.evaluation.conclusion, '不通过');

  const boxCreate = await admin.request('/api/weight-boxes', {
    method: 'POST',
    body: { id: 'TBOX1', status: '停用', remark: '回归测试' }
  });
  assert.equal(boxCreate.status, 201);
  const boxRemark = await admin.request('/api/weight-boxes/TBOX1', {
    method: 'PATCH',
    body: { remark: '仅修改备注' }
  });
  assert.equal(boxRemark.status, 200);
  assert.equal((await boxRemark.json()).status, '停用');

  const dictionaryCreate = await admin.request('/api/dictionaries', {
    method: 'POST',
    body: {
      category: 'department',
      value: '回归科室',
      label: '回归科室',
      status: '停用',
      sortOrder: 1
    }
  });
  assert.equal(dictionaryCreate.status, 201);
  const dictionary = await dictionaryCreate.json();
  const dictionaryLabel = await admin.request(
    `/api/dictionaries/${dictionary.id}`,
    {
      method: 'PATCH',
      body: { label: '回归科室-改名' }
    }
  );
  assert.equal(dictionaryLabel.status, 200);
  assert.equal((await dictionaryLabel.json()).status, '停用');

  const templateState = await admin.request('/api/templates');
  const currentTemplate = await templateState.json();
  const invalidTemplate = await admin.request('/api/templates', {
    method: 'POST',
    body: {
      config: {
        ...currentTemplate.current,
        fields: [null]
      },
      summary: '非法字段回归'
    }
  });
  assert.equal(invalidTemplate.status, 400);

  const videoPath = join(dataDir, 'range-fixture.mp4');
  writeFileSync(videoPath, '0123456789');
  app.db.prepare(`
    UPDATE tasks SET file_path = ? WHERE id = 'T-20260928-002'
  `).run(videoPath);
  const suffixRange = await inspector.request(
    '/api/records/20260928-F001-01/video',
    { headers: { Range: 'bytes=-5' } }
  );
  assert.equal(suffixRange.status, 206);
  assert.equal(await suffixRange.text(), '56789');
  assert.equal(suffixRange.headers.get('content-range'), 'bytes 5-9/10');

  const corrupt = Buffer.from('not-an-mp4');
  const uploadResponse = await inspector.request('/api/uploads/init', {
    method: 'POST',
    body: {
      fileName: 'corrupt.mp4',
      sizeBytes: corrupt.length,
      startedAt: '2026-11-08 10:00',
      timeConfirmed: true,
      expectedDeviceId: 'F001'
    }
  });
  assert.equal(uploadResponse.status, 201);
  const upload = await uploadResponse.json();
  const corruptResult = await inspector.request(
    `/api/uploads/${upload.uploadId}/content`,
    {
      method: 'PUT',
      rawBody: corrupt,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Upload-Offset': '0',
        'Content-Length': String(corrupt.length)
      }
    }
  );
  assert.equal(corruptResult.status, 422);
  const corruptText = await corruptResult.text();
  assert.doesNotMatch(corruptText, /AppData|uploadId|\.part/i);

  const reject = await verifier.request(
    '/api/records/20260928-F002-01/reject',
    {
      method: 'POST',
      body: { reason: '请核对低量程第二次读数' }
    }
  );
  assert.equal(reject.status, 200);
  const owner = new Client(baseUrl);
  await owner.loginAndChange('U002', 'Tp123456', 'TpOwner1234');
  const notifications = await owner.request('/api/notifications?page=1');
  assert.equal(notifications.status, 200);
  const notificationBody = await notifications.json();
  assert.equal(notificationBody.unreadCount, 1);
  const rejectedMessage = notificationBody.items.find((item) => (
    item.type === '记录退回' && item.objectId === '20260928-F002-01'
  ));
  assert.ok(rejectedMessage);
  const markRead = await owner.request(
    `/api/notifications/${rejectedMessage.id}/read`,
    { method: 'POST', body: {} }
  );
  assert.equal(markRead.status, 200);
  assert.equal(
    (await (await owner.request('/api/notifications?unread=1')).json()).unreadCount,
    0
  );

  const audit = await admin.request('/api/audit?page=1&pageSize=2');
  assert.equal(audit.status, 200);
  const auditBody = await audit.json();
  assert.equal(auditBody.pageSize, 2);
  assert.ok(auditBody.items.length <= 2);
  assert.ok(auditBody.total >= auditBody.items.length);

  const cardInventory = await admin.request('/api/qr/cards.csv');
  assert.equal(cardInventory.status, 200);
  const cardText = Buffer.from(await cardInventory.arrayBuffer());
  assert.deepEqual([...cardText.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const decodedCards = cardText.toString('utf8');
  assert.match(decodedCards, /PERSON:U001/);
  assert.match(decodedCards, /DEVICE:F001/);
  assert.doesNotMatch(decodedCards, /PERSON:U003/);

  app.db.prepare(`
    INSERT INTO tasks (
      id, file_name, file_path, size_bytes, user_id, status, started_at,
      queued_at, error_code, error_reason, sha256, created_at, updated_at
    ) VALUES (
      'T-PURGE-001', 'missing.mp4', ?, 10, 'U001', '失败',
      '2026-11-08 10:00', '2026-11-08 10:00', 'E-FILE',
      '源文件缺失', ?, '2026-11-08 10:00', '2026-11-08 10:00'
    )
  `).run(
    join(dataDir, 'does-not-exist.mp4'),
    'F'.repeat(64)
  );
  const purge = await admin.request('/api/tasks/T-PURGE-001/purge', {
    method: 'POST',
    body: { reason: '回归测试：源文件已缺失' }
  });
  assert.equal(purge.status, 200);
  assert.equal(
    app.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE id = ?')
      .get('T-PURGE-001').n,
    0
  );
  assert.equal(
    app.db.prepare(`
      SELECT COUNT(*) AS n FROM audit_logs
      WHERE type = '无效任务清理' AND object_id = 'T-PURGE-001'
    `).get().n,
    1
  );
});

test('修改口令撤销其他会话但保留当前会话', {
  timeout: 30_000
}, async (t) => {
  const { baseUrl } = await setupServer(t);
  const first = new Client(baseUrl);
  await first.loginAndChange('U002', 'Tp123456', 'TpSession1234');
  const second = new Client(baseUrl);
  await second.login('U002', 'TpSession1234');
  const third = new Client(baseUrl);
  await third.login('U002', 'TpSession1234');
  const change = await second.request('/api/auth/change-password', {
    method: 'POST',
    body: {
      currentPassword: 'TpSession1234',
      newPassword: 'TpSession5678'
    }
  });
  assert.equal(change.status, 200);
  assert.equal((await second.request('/api/session')).status, 200);
  assert.equal((await third.request('/api/session')).status, 401);
  assert.equal((await first.request('/api/session')).status, 401);
});

test('健康检查发现媒体和预览工具缺失', {
  timeout: 30_000
}, async (t) => {
  const { baseUrl } = await setupServer(t, {
    ffprobePath: join(tmpdir(), 'missing-ffprobe.exe'),
    ffmpegPath: join(tmpdir(), 'missing-ffmpeg.exe'),
    pdftoppmPath: join(tmpdir(), 'missing-pdftoppm.exe')
  });
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, 'error');
  assert.equal(body.analyzer.available, false);
  assert.equal(body.pdf.previewAvailable, false);
});

test('关闭服务时在途分析任务得到确定失败状态', {
  timeout: 30_000
}, async (t) => {
  const { app, dataDir } = await setupServer(t, {
    workerIntervalMs: 10,
    analyzer: async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      throw new Error('测试分析在停机后才结束');
    }
  });
  app.db.prepare(`
    INSERT INTO tasks (
      id, file_name, file_path, size_bytes, user_id, status, started_at,
      queued_at, sha256, created_at, updated_at
    ) VALUES (
      'T-SHUTDOWN-REGRESSION', 'shutdown.mp4', ?, 16, 'U001', '排队中',
      '2026-11-08 10:00', '2026-11-08 10:00', ?, '2026-11-08 10:00',
      '2026-11-08 10:00'
    )
  `).run(join(tmpdir(), 'shutdown.mp4'), 'A'.repeat(64));
  for (let index = 0; index < 40; index += 1) {
    const status = app.db.prepare(
      'SELECT status FROM tasks WHERE id = ?'
    ).get('T-SHUTDOWN-REGRESSION').status;
    if (status === '分析中') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await app.close();
  const reopened = new DatabaseSync(join(dataDir, 'tianping.db'), {
    readOnly: true
  });
  const row = reopened.prepare(
    'SELECT status, error_code FROM tasks WHERE id = ?'
  ).get('T-SHUTDOWN-REGRESSION');
  reopened.close();
  assert.equal(row.status, '失败');
  assert.equal(row.error_code, 'E-SHUTDOWN');
});
