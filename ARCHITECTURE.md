# 共享架构与接口契约

## 1. 运行基线

- Node.js `>=24`，ESM。
- SQLite 使用 Node 内建 `node:sqlite`。
- HTTP 服务使用 Node 内建 `node:http`，不依赖外网包。
- FFprobe/FFmpeg 由环境变量 `FFPROBE_PATH`、`FFMPEG_PATH` 指向；未安装时仍可
  启动 Web 服务，但分析任务会以明确的能力错误失败。
- 数据目录由 `DATA_DIR` 指定，默认 `tianping-system/data`。
- 监听地址 `HOST`（默认 `0.0.0.0`）、端口 `PORT`（默认 `8080`）。
- 时区固定 `Asia/Shanghai`，用户可见时间格式 `YYYY-MM-DD HH:mm`。

## 2. 目录边界

```text
tianping-system/
  server.js
  src/
    db.js
    auth.js
    api.js
    rules.js
    services/
      analyzer.js
      queue.js
      uploads.js
      storage.js
      exporter.js
  public/
    index.html
    assets/
  samples/manifests/
  tests/
  docs/
  scripts/
```

模块只修改自己产物，若需要修改共享文件，先在最终说明中列出具体冲突点。

## 3. 用户、权限和会话

角色值固定为 `admin`、`inspector`、`verifier`。权限能力值：

- `upload.own`
- `tasks.own` / `tasks.all`
- `tasks.manage`
- `records.read`
- `records.edit.own`
- `records.submit.own`
- `records.verified`
- `records.void`
- `masterdata.write`
- `template.write`
- `accounts.write`
- `audit.read`
- `system.read`
- `export.record`

会话 Cookie 名 `tp_session`，HttpOnly、SameSite=Lax、生产环境可配置 Secure。
登录成功后响应包含 `csrfToken`。除登录外所有 `POST/PUT/PATCH/DELETE` 必须带
请求头 `X-CSRF-Token`。

## 4. 统一 JSON 错误

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "面向用户的中文说明",
    "details": []
  }
}
```

HTTP 状态使用 400/401/403/404/409/413/415/429/500。接口不得把堆栈返回给浏览器。

## 5. 核心数据形状

时间均为上海时区 `YYYY-MM-DD HH:mm`，数据库存储 ISO 文本。

### user

```json
{
  "id": "U001",
  "name": "李一",
  "role": "inspector",
  "status": "启用",
  "mustChangePassword": true,
  "permissions": ["upload.own", "tasks.own", "records.read"]
}
```

### device

```json
{
  "id": "F001",
  "uniqueNo": "DZTP170911C",
  "dept": "化学室",
  "max": 220,
  "d": 0.1,
  "ranges": 1,
  "range1": {"max": 220, "d": 0.1},
  "range2": null,
  "internalCal": "手动触发",
  "points": [200, 50, 10],
  "pointRange": [1, 1, 1],
  "tol": 0.05,
  "defaultBox": "FM2512920",
  "qrContent": "天平编号",
  "qrValue": "F001",
  "status": "在用",
  "remark": ""
}
```

### readout

`point` 为 0..2，`idx` 为 1..3，`range` 为 1 或 2。

```json
{
  "point": 0,
  "idx": 1,
  "value": 200.0062,
  "unit": "g",
  "off": 32,
  "time": "2026-09-28 08:32",
  "conf": 0.997,
  "stable": true,
  "range": 1,
  "screenshot": "screenshots/<recordId>/I1-1.jpg"
}
```

### record

```json
{
  "id": "20260928-F001-01",
  "date": "2026-09-28",
  "device": "F001",
  "inspector": "U001",
  "box": "FM2512920",
  "startTime": "2026-09-28 08:31",
  "duration": 393,
  "file": "VID_20260928_0831.mp4",
  "fileSize": 26.9,
  "sha": "a7f3c9e2b41d8c05",
  "status": "待提交",
  "cleanliness": "是",
  "level": "是",
  "internalCal": "是",
  "remark": "无",
  "readouts": [],
  "rangeSwitch": true,
  "personCard": {"account": "U001", "conf": 0.997},
  "deviceCard": {"code": "F001", "conf": 0.996},
  "speech": {},
  "modifications": [],
  "templateVersion": "v1",
  "analyzedAt": "2026-09-28 08:46",
  "taskId": "T-20260928-002",
  "submittedBy": null,
  "submittedAt": null,
  "verifiedBy": null,
  "verifiedAt": null,
  "voidBy": null,
  "voidAt": null,
  "voidReason": null
}
```

记录状态只允许：

`待提交 → 已提交 → 已复核确认`；
`待提交/已提交 → 已作废`；
`已提交 → 待提交`（退回）。

### task

```json
{
  "id": "T-20260928-001",
  "file": "VID_20260928_0831.mp4",
  "size": 26.9,
  "device": "F001",
  "user": "U001",
  "status": "排队中",
  "queuedAt": "2026-09-28 08:33",
  "startedAt": null,
  "finishedAt": null,
  "durationMs": null,
  "recordId": null,
  "code": null,
  "reason": null,
  "sha": "..."
}
```

任务状态：`排队中`、`分析中`、`已完成`、`失败`、`待人工处理`、`已取消`。

## 6. HTTP API

### 认证和状态

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `GET /api/session`
- `GET /api/state`：返回页面渲染所需的集合快照

### 上传

- `POST /api/uploads/init`
- `GET /api/uploads/:uploadId`
- `PUT /api/uploads/:uploadId/content`，请求头 `Upload-Offset`，原始分片
- `DELETE /api/uploads/:uploadId`

### 业务

- `GET /api/tasks?scope=own|all`
- `POST /api/tasks/:id/retry`
- `POST /api/tasks/:id/cancel`
- `POST /api/tasks/:id/manual-complete`
- `GET /api/records`
- `GET /api/records/:id`
- `PATCH /api/records/:id`
- `POST /api/records/:id/readouts/:key`
- `POST /api/records/:id/check/:key`
- `POST /api/records/:id/submit`
- `POST /api/records/:id/confirm`
- `POST /api/records/:id/reject`
- `POST /api/records/:id/void`
- `GET/POST/PATCH /api/devices`
- `GET/POST/PATCH /api/weight-boxes`
- `GET/POST /api/templates`
- `GET/POST/PATCH/DELETE /api/accounts`
- `GET /api/audit`
- `GET /api/system`
- `POST /api/system/backup`

### 导出

- `POST /api/exports/record/:id`
- `POST /api/exports/records`
- `POST /api/exports/week`
- `POST /api/exports/csv`

导出成功响应为二进制附件，并写审计日志。

### 健康

- `GET /healthz`
- `GET /api/health`

## 7. 判定引擎契约

`src/rules.js` 导出：

```js
evaluateRecord(record, device, tolerancePercent)
```

返回：

```js
{
  conclusion: "通过" | "不通过",
  pass: true,
  tol: 0.05,
  reasons: [{code, label, detail}],
  items: [{
    key, L, value, dec, lim: {lo, hi}, dev,
    inLimit, missing, stable, conf, range
  }]
}
```

必须覆盖附录 C 的边界值、缺次、重复、顺序错误、不稳定和双量程缺切换。

## 8. 分析适配器契约

`src/services/analyzer.js` 默认导出：

```js
async function analyzeVideo(context)
```

`context` 包含 `{filePath, sha256, startedAt, uploadedBy, devices, config}`。

成功后返回：

```js
{
  engine: "sample-manifest",
  personCard: {account, conf},
  deviceCard: {code, conf},
  deviceId: "F001",
  durationSeconds: 393.62,
  rangeSwitch: true,
  readouts: [],
  speech: {},
  screenshots: [],
  warnings: []
}
```

错误使用 `AnalyzerError(code, message, status)`，其中 `status` 可为
`待人工处理` 或 `失败`。未知哈希绝不返回伪造读数。

## 9. 队列契约

- 同一时刻最多一个任务处于 `分析中`。
- 启动时把遗留 `分析中` 改为 `失败`（`E-RESTARTED`），`排队中` 保持不变。
- 按 `queued_at, rowid` 严格 FIFO。
- 完成/失败在单个事务中更新任务、记录和审计。
- 任务重试复用原任务 ID，不生成重复记录。

## 10. 前端要求

- 所有数据请求经 `/api`，不得依赖 `file://` 或原型内存状态。
- 修改请求携带 CSRF 头；401 时回到登录页；403 展示明确提示。
- 上传使用 4~8 MiB 分片和 `Upload-Offset`，刷新后可从服务端 offset 续传。
- 低置信读数、缺次、不稳定、超限必须在视觉上可区分。
- 页面需要可打印版式，隐藏导航/按钮；正式导出由服务端生成。
- 不使用任何 CDN、外链字体、远程图片、遥测或在线分析服务。

