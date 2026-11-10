import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startServer } from '../server.js';

const samplePath = resolve(
  import.meta.dirname,
  '../../客户原需求/测试视频样例/295ed49aaa4dc37eadf402db4d0b7434.mp4',
);

function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values[0]?.split(';', 1)[0] || '';
}

async function assertStatus(response, expected) {
  if (response.status !== expected) {
    assert.fail(`HTTP ${response.status}，预期 ${expected}：${await response.text()}`);
  }
}

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
    this.csrf = '';
  }

  async request(path, options = {}) {
    const headers = {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(this.cookie ? { Cookie: this.cookie } : {}),
      ...(this.csrf && options.method && !['GET', 'HEAD'].includes(options.method)
        ? { 'X-CSRF-Token': this.csrf }
        : {}),
      ...(options.headers || {}),
    };
    if (options.rawBody) {
      headers['Content-Type'] = 'application/octet-stream';
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.rawBody || (options.body ? JSON.stringify(options.body) : undefined),
    });
    return response;
  }

  async loginAndChangePassword(account) {
    const loginResponse = await this.request('/api/auth/login', {
      method: 'POST',
      body: { account, password: 'Tp123456' },
    });
    await assertStatus(loginResponse, 200);
    this.cookie = cookieFrom(loginResponse);
    const login = await loginResponse.json();
    this.csrf = login.csrfToken;
    assert.equal(login.user.mustChangePassword, true);

    const changeResponse = await this.request('/api/auth/change-password', {
      method: 'POST',
      body: {
        currentPassword: 'Tp123456',
        newPassword: 'TpNew1234',
      },
    });
    await assertStatus(changeResponse, 200);
  }
}

test('真实上传 API 与契约分析器完成提交、复核与 PDF 导出', {
  timeout: 90_000,
}, async (t) => {
  if (!existsSync(samplePath)) {
    t.skip('客户样例视频未随测试工作区提供');
    return;
  }
  const temporary = mkdtempSync(join(tmpdir(), 'tianping-api-'));
  const fixtureDir = join(temporary, 'fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  const values = [
    200.0062, 200.0031, 199.9987,
    50.0002, 49.9988, 50.0011,
    10.0001, 9.9994, 10.0006
  ];
  const screenshots = values.map((value, index) => {
    const key = `I${Math.floor(index / 3) + 1}-${(index % 3) + 1}`;
    const path = join('fixtures', `${key}.jpg`);
    writeFileSync(join(temporary, path), Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]));
    return {
      key,
      path,
      offsetSeconds: 30 + index * 30,
      bbox: { x: 0.12, y: 0.65, width: 0.75, height: 0.12 },
      displayText: `${value} g`
    };
  });
  const analyzer = async (context) => {
    const device = context.devices.find((item) => item.id === 'F001');
    return {
      engine: 'test-contract-analyzer',
      personCard: { account: 'U001', conf: 0.99, source: 'qr' },
      deviceCard: { code: 'F001', conf: 0.99, source: 'qr' },
      deviceId: device.id,
      inferredDeviceId: device.id,
      durationSeconds: 272,
      media: {
        duration: 272,
        creationTime: null,
        videoCodec: 'h264'
      },
      startTime: context.startedAt,
      startTimeSource: 'user-confirmed',
      rangeSwitch: true,
      readouts: values.map((value, index) => ({
        point: Math.floor(index / 3),
        idx: (index % 3) + 1,
        value,
        unit: 'g',
        off: 30 + index * 30,
        conf: 0.995,
        stable: true,
        range: 1,
        recognizedText: `${value} g`,
        bbox: { x: 0.12, y: 0.65, width: 0.75, height: 0.12 },
        frame: {
          offsetSeconds: 30 + index * 30,
          bbox: { x: 0.12, y: 0.65, width: 0.75, height: 0.12 },
          displayText: `${value} g`,
          source: 'video-frame',
          marked: true
        },
        ocr: { method: 'seven-segment-template' }
      })),
      recognition: {
        schemaVersion: 1,
        strategy: 'independent-time-ordered-weighing-segments',
        segments: values.map((value, index) => ({
          sequence: index + 1,
          point: Math.floor(index / 3),
          idx: (index % 3) + 1,
          value,
          off: 30 + index * 30,
          stable: true,
        })),
        sequence: [0, 0, 0, 1, 1, 1, 2, 2, 2],
        pointCounts: [3, 3, 3],
        totalSegments: 9,
        orderViolation: null,
      },
      screenshots,
      warnings: [],
      ocr: { cardConflicts: [] }
    };
  };
  const port = 19000 + Math.floor(Math.random() * 500);
  const app = await startServer({
    port,
    host: '127.0.0.1',
    dataDir: temporary,
    initialPassword: 'Tp123456',
    workerIntervalMs: 60,
    analyzer
  });
  t.after(async () => {
    await app.close();
    rmSync(temporary, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).database, 'ok');

  const inspector = new ApiClient(baseUrl);
  await inspector.loginAndChangePassword('U001');
  const stateResponse = await inspector.request('/api/state');
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.user.role, 'inspector');
  assert.ok(state.devices.some((device) => device.id === 'F001'));
  assert.ok(state.tasks.every((item) => !('filePath' in item)));
  assert.ok(state.accounts.every((account) =>
    !('lastLogin' in account)
    && !('mustChangePassword' in account)
    && !('failedAttempts' in account)
  ));

  const tooLongRemark = await inspector.request('/api/records/20260926-F001-03', {
    method: 'PATCH',
    body: { field: 'remark', value: 'x'.repeat(2001) },
  });
  assert.equal(tooLongRemark.status, 400);

  const extremeReadout = await inspector.request(
    '/api/records/20260926-F001-03/readouts/I1-1',
    {
      method: 'POST',
      body: { value: 1e308, reason: '范围测试' },
    },
  );
  assert.equal(extremeReadout.status, 400);

  const video = readFileSync(samplePath);
  const unconfirmed = await inspector.request('/api/uploads/init', {
    method: 'POST',
    body: {
      fileName: 'unconfirmed.mp4',
      sizeBytes: video.length,
      startedAt: '2026-09-28 11:05',
      timeConfirmed: false,
      expectedDeviceId: 'F001',
    },
  });
  assert.equal(unconfirmed.status, 201);
  const unconfirmedUpload = await unconfirmed.json();
  const cancelUnconfirmed = await inspector.request(
    `/api/uploads/${unconfirmedUpload.uploadId}`,
    { method: 'DELETE' }
  );
  assert.equal(cancelUnconfirmed.status, 200);

  const initResponse = await inspector.request('/api/uploads/init', {
    method: 'POST',
    body: {
      fileName: '295ed49aaa4dc37eadf402db4d0b7434.mp4',
      sizeBytes: video.length,
      startedAt: '2026-09-28 11:05',
      timeConfirmed: false,
      expectedDeviceId: 'F001',
    },
  });
  await assertStatus(initResponse, 201);
  const upload = await initResponse.json();
  assert.match(upload.duplicateWarning, /F001/);
  assert.match(upload.duplicateWarning, /可继续上传/);
  let offset = 0;
  const chunkSize = 8 * 1024 * 1024;
  let completed;
  while (offset < video.length) {
    const end = Math.min(video.length, offset + chunkSize);
    const chunk = video.subarray(offset, end);
    const response = await inspector.request(`/api/uploads/${upload.uploadId}/content`, {
      method: 'PUT',
      rawBody: chunk,
      headers: {
        'Upload-Offset': String(offset),
        'Content-Length': String(chunk.length),
      },
    });
    if (end === video.length) {
      assert.equal(response.status, 400);
      const error = await response.json();
      assert.equal(error.error.code, 'TIME_CONFIRMATION_REQUIRED');
      offset = video.length;
    } else {
      await assertStatus(response, 200);
      completed = await response.json();
      offset = completed.receivedBytes;
    }
  }
  const awaitingTime = await inspector.request(`/api/uploads/${upload.uploadId}`);
  await assertStatus(awaitingTime, 200);
  const pendingUpload = await awaitingTime.json();
  assert.equal(pendingUpload.status, '上传中');
  assert.equal(pendingUpload.receivedBytes, video.length);
  assert.equal(pendingUpload.timeConfirmed, false);

  const confirmTime = await inspector.request(
    `/api/uploads/${upload.uploadId}/confirm-time`,
    {
      method: 'POST',
      body: { startedAt: '2026-09-28 11:05' }
    }
  );
  await assertStatus(confirmTime, 200);
  completed = await confirmTime.json();
  assert.equal(completed.timeConfirmed, true);
  assert.equal(completed.status, '已完成');
  assert.ok(completed.taskId);
  assert.equal(completed.sha256.toLowerCase(), '920b7864bc2ed6d0a006189af47613854b7f2fa630e9504fc43378615cae23ae');

  let task;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const response = await inspector.request(`/api/tasks/${completed.taskId}`);
    await assertStatus(response, 200);
    task = await response.json();
    if (['已完成', '失败', '待人工处理'].includes(task.status)) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  assert.equal(task.status, '已完成', task.reason);
  assert.ok(task.recordId);

  const detailResponse = await inspector.request(`/api/records/${task.recordId}`);
  await assertStatus(detailResponse, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.evaluation.conclusion, '通过');
  assert.equal(detail.record.readouts.length, 9);
  assert.deepEqual(detail.record.recognition.sequence, [0, 0, 0, 1, 1, 1, 2, 2, 2]);
  assert.equal(detail.record.recognition.totalSegments, 9);
  assert.ok(detail.record.readouts.every((readout) => readout.screenshot));
  assert.ok(detail.record.readouts.every((readout) => (
    readout.frame?.marked
    && readout.bbox?.width > 0
    && readout.ocr?.method
  )));
  assert.equal('speech' in detail.record, false);
  for (const field of ['cleanliness', 'level', 'internalCal']) {
    const fieldResponse = await inspector.request(`/api/records/${task.recordId}`, {
      method: 'PATCH',
      body: { field, value: '是', reason: '现场视觉复核确认' },
    });
    await assertStatus(fieldResponse, 200);
  }

  const submitResponse = await inspector.request(`/api/records/${task.recordId}/submit`, {
    method: 'POST',
    body: {},
  });
  await assertStatus(submitResponse, 200);
  const submitted = await submitResponse.json();
  assert.equal((submitted.record?.status || submitted.status), '已提交');

  const forbidden = await inspector.request(`/api/records/${task.recordId}/confirm`, {
    method: 'POST',
    body: {},
  });
  assert.equal(forbidden.status, 403);

  const verifier = new ApiClient(baseUrl);
  await verifier.loginAndChangePassword('U003');
  const confirmResponse = await verifier.request(`/api/records/${task.recordId}/confirm`, {
    method: 'POST',
    body: {},
  });
  await assertStatus(confirmResponse, 200);
  assert.equal((await confirmResponse.json()).status, '已复核确认');

  const templateStateResponse = await verifier.request('/api/templates');
  await assertStatus(templateStateResponse, 200);
  const templateState = await templateStateResponse.json();
  const templateResponse = await verifier.request('/api/templates', {
    method: 'POST',
    body: {
      config: {
        ...templateState.current,
        points: [201, 51, 11],
        footerExtra: '模板升级后仍保持历史记录快照',
      },
      summary: 'API 回归：修改模板不改变历史记录'
    }
  });
  await assertStatus(templateResponse, 201);
  const newTemplate = await templateResponse.json();
  assert.deepEqual(newTemplate.points, [201, 51, 11]);
  const unchangedDetail = await verifier.request(`/api/records/${task.recordId}`);
  await assertStatus(unchangedDetail, 200);
  const immutableRecord = (await unchangedDetail.json()).record;
  assert.equal(immutableRecord.templateVersion, 'v1');
  assert.deepEqual(immutableRecord.templateSnapshot.points, [200, 50, 10]);

  const personQr = await inspector.request('/api/qr/person.svg?account=U001');
  await assertStatus(personQr, 200);
  assert.match(personQr.headers.get('content-type') || '', /image\/svg\+xml/);
  assert.match(await personQr.text(), />U001</);
  const deviceQr = await inspector.request('/api/qr/device/F001.svg');
  await assertStatus(deviceQr, 200);
  const deviceQrText = await deviceQr.text();
  assert.match(deviceQrText, />F001</);
  assert.match(deviceQrText, /DZTP170911C/);
  assert.equal((await verifier.request('/api/qr/device/F001.svg')).status, 200);
  assert.equal((await verifier.request('/api/qr/person.svg?account=U003')).status, 403);

  const sopResponse = await verifier.request('/api/docs/sop.pdf');
  await assertStatus(sopResponse, 200);
  const sop = Buffer.from(await sopResponse.arrayBuffer());
  assert.equal(sop.subarray(0, 8).toString(), '%PDF-1.7');
  assert.ok(sop.length > 100_000);
  assert.match(
    sopResponse.headers.get('content-disposition') || '',
    /^attachment;/
  );

  const previewRecordResponse = await verifier.request(
    `/api/previews/record/${task.recordId}.pdf`
  );
  await assertStatus(previewRecordResponse, 200);
  assert.match(
    previewRecordResponse.headers.get('content-disposition') || '',
    /^inline;/
  );
  const previewRecordImage = await verifier.request(
    `/api/previews/record/${task.recordId}.png`
  );
  await assertStatus(previewRecordImage, 200);
  const previewPng = Buffer.from(await previewRecordImage.arrayBuffer());
  assert.deepEqual([...previewPng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const blankPreviewResponse = await verifier.request('/api/previews/blank.pdf');
  await assertStatus(blankPreviewResponse, 200);
  assert.equal(
    Buffer.from(await blankPreviewResponse.arrayBuffer()).subarray(0, 8).toString(),
    '%PDF-1.7'
  );
  const sopPreviewResponse = await verifier.request('/api/previews/sop.pdf');
  await assertStatus(sopPreviewResponse, 200);
  assert.match(sopPreviewResponse.headers.get('content-disposition') || '', /^inline;/);

  const pdfResponse = await verifier.request(`/api/exports/record/${task.recordId}`, {
    method: 'POST',
    body: {},
  });
  await assertStatus(pdfResponse, 200);
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.7');
  assert.ok(pdf.length > 100_000);

  const batchResponse = await verifier.request('/api/exports/records', {
    method: 'POST',
    body: {
      devices: ['F001'],
      from: '2026-09-28',
      to: '2026-09-28',
      includeUnverified: false,
    },
  });
  await assertStatus(batchResponse, 200);
  assert.equal(Buffer.from(await batchResponse.arrayBuffer()).subarray(0, 8).toString(), '%PDF-1.7');

  const weekResponse = await verifier.request('/api/exports/week', {
    method: 'POST',
    body: {
      device: 'F001',
      week: '2026-W40',
    },
  });
  await assertStatus(weekResponse, 200);
  assert.equal(Buffer.from(await weekResponse.arrayBuffer()).subarray(0, 8).toString(), '%PDF-1.7');
  const weekPreviewResponse = await verifier.request(
    '/api/previews/week.pdf?device=F001&week=2026-W40'
  );
  await assertStatus(weekPreviewResponse, 200);
  assert.match(
    weekPreviewResponse.headers.get('content-disposition') || '',
    /^inline;/
  );

  const invalidWeek = await verifier.request('/api/exports/week', {
    method: 'POST',
    body: {
      device: 'F001',
      week: '2026-W54',
    },
  });
  assert.equal(invalidWeek.status, 400);
  assert.equal((await invalidWeek.json()).error.code, 'INVALID_WEEK');

  const splitPdf = await verifier.request('/api/exports/records', {
    method: 'POST',
    body: {
      devices: ['F001', 'F002'],
      from: '2026-09-28',
      to: '2026-09-28',
      mode: 'per-device-day',
      includeUnverified: true,
    },
  });
  await assertStatus(splitPdf, 200);
  assert.match(splitPdf.headers.get('content-type') || '', /application\/zip/);
  const splitBuffer = Buffer.from(await splitPdf.arrayBuffer());
  assert.equal(splitBuffer.subarray(0, 4).toString('hex'), '504b0304');
  assert.match(splitBuffer.toString('utf8'), /天平校验记录_F001_20260928\.pdf/);
  assert.match(splitBuffer.toString('utf8'), /天平校验记录_F002_20260928\.pdf/);

  const pagedRecords = await verifier.request(
    '/api/records?devices=F001&devices=F002&page=1&pageSize=1&status=%E5%B7%B2%E5%A4%8D%E6%A0%B8%E7%A1%AE%E8%AE%A4',
  );
  await assertStatus(pagedRecords, 200);
  const paged = await pagedRecords.json();
  assert.equal(paged.page, 1);
  assert.equal(paged.pageSize, 1);
  assert.equal(paged.items.length, 1);
  assert.ok(paged.total >= 1);
  assert.equal(paged.items[0].status, '已复核确认');

  const csvResponse = await verifier.request('/api/exports/csv', {
    method: 'POST',
    body: {
      type: 'records',
      devices: ['F001'],
      from: '2026-09-28',
      to: '2026-09-28',
    },
  });
  await assertStatus(csvResponse, 200);
  const csv = Buffer.from(await csvResponse.arrayBuffer());
  assert.equal(csv[0], 0xef);
  assert.equal(csv[1], 0xbb);
  assert.equal(csv[2], 0xbf);

  const auditResponse = await verifier.request('/api/audit');
  assert.equal(auditResponse.status, 403);

  const admin = new ApiClient(baseUrl);
  await admin.loginAndChangePassword('U000');
  const dictionaryResponse = await admin.request('/api/dictionaries', {
    method: 'POST',
    body: {
      category: 'department',
      value: '仪器室',
      label: '仪器室',
      sortOrder: 30,
      status: '启用',
      remark: '回归测试字典项'
    }
  });
  await assertStatus(dictionaryResponse, 201);
  const dictionary = await dictionaryResponse.json();
  assert.equal(dictionary.value, '仪器室');
  const dictionaryPatch = await admin.request(`/api/dictionaries/${dictionary.id}`, {
    method: 'PATCH',
    body: { ...dictionary, status: '停用' }
  });
  await assertStatus(dictionaryPatch, 200);
  assert.equal((await dictionaryPatch.json()).status, '停用');

  const systemResponse = await admin.request('/api/system');
  await assertStatus(systemResponse, 200);
  const system = await systemResponse.json();
  assert.ok(['已同步', '未同步', '无法探测'].includes(system.env.ntp));
  assert.equal(typeof system.logs.fileCount, 'number');

  const logResponse = await admin.request('/api/system/logs?download=1');
  await assertStatus(logResponse, 200);
  assert.match(logResponse.headers.get('content-type') || '', /text\/plain/);
  assert.match(await logResponse.text(), /服务启动/);

  const adminAudit = await admin.request('/api/audit');
  await assertStatus(adminAudit, 200);
  const auditText = JSON.stringify(await adminAudit.json());
  assert.match(auditText, /记录复核确认/);
  assert.match(auditText, /导出/);
  assert.match(auditText, /查询记录列表/);
  assert.match(auditText, /查看记录详情/);
  assert.throws(
    () => app.db.prepare("UPDATE audit_logs SET reason = 'tampered' WHERE id = 1").run(),
    /append-only/,
  );
  assert.throws(
    () => app.db.prepare('DELETE FROM audit_logs WHERE id = 1').run(),
    /append-only/,
  );
});
