# 共享架构与接口契约

## 1. 运行基线

- Node.js `>=24`，ESM。
- SQLite 使用 Node 内建 `node:sqlite`。
- HTTP 服务使用 Node 内建 `node:http`，不依赖外网包。
- FFprobe/FFmpeg 由环境变量 `FFPROBE_PATH`、`FFMPEG_PATH` 指向；未安装时 Web
  仍可启动，但 `/healthz` 返回 503，分析任务以明确能力错误失败。
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
      logs.js
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

连续 5 次口令错误把账号锁定 10 分钟并返回 423。未知账号按来源 IP 在 5 分钟窗口
限流。当前不再使用登录验证码。

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

HTTP 状态使用 400/401/403/404/409/410/413/415/422/423/429/500/503。接口不得把
堆栈、绝对文件路径或媒体工具原始 stderr 返回给浏览器。

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
  "failedAttempts": 0,
  "lockedUntil": null,
  "isLocked": false,
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
  "value": 200.0009,
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
  "recognition": {
    "schemaVersion": 1,
    "strategy": "independent-time-ordered-weighing-segments",
    "segments": [],
    "sequence": [0, 0, 0, 1, 1, 1, 2, 2, 2],
    "pointCounts": [3, 3, 3],
    "totalSegments": 9,
    "orderViolation": null
  },
  "conclusion": "通过",
  "judgment": {
    "conclusion": "通过",
    "ruleVersion": "2026.11.1",
    "judgedAt": "2026-09-28 08:46",
    "tol": 0.05,
    "reasons": [],
    "items": []
  },
  "rangeSwitch": true,
  "personCard": {"account": "U001", "conf": null, "evidence": {"frameCount": 3}},
  "deviceCard": {"code": "F001", "conf": null, "evidence": {"frameCount": 3}},
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
  "expectedDevice": "F001",
  "user": "U001",
  "status": "排队中",
  "queuedAt": "2026-09-28 08:33",
  "startedAt": null,
  "finishedAt": null,
  "durationMs": null,
  "recordId": null,
  "code": null,
  "reason": null,
  "warnings": [],
  "sha": "..."
}
```

任务状态：`排队中`、`分析中`、`已完成`、`失败`、`待人工处理`、`已取消`。

## 6. HTTP API

### 认证和状态

- `POST /api/auth/login`
- `GET /api/auth/captcha`：旧验证码流程已停用，固定返回 410
- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `GET /api/session`
- `GET /api/state`：返回页面渲染所需的集合快照

### 上传

- `POST /api/uploads/init`
- `GET /api/uploads/:uploadId`
- `PUT /api/uploads/:uploadId/content`，请求头 `Upload-Offset`，原始分片
- `POST /api/uploads/:uploadId/confirm-time`，视频元数据缺失时确认拍摄时间并继续
- `DELETE /api/uploads/:uploadId`

### 业务

- `GET /api/tasks?scope=own|all`
- `POST /api/tasks/:id/retry`
- `POST /api/tasks/:id/cancel`
- `POST /api/tasks/:id/manual-complete`
- `POST /api/tasks/:id/purge`：管理员清理源文件已缺失的失败/待处理/已取消任务
- `GET /api/records?devices=F001&devices=F002&from=&to=&inspector=&status=&conclusion=&page=1&pageSize=50`
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
- `GET /api/notifications?unread=1&page=&pageSize=`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`
- `GET /api/system`
- `POST /api/system/backup`
- `GET /api/qr/person.svg?account=U001`：仅检验人员本人及管理员导出人员使用
- `GET /api/qr/cards.csv`：管理员批量导出人员卡和设备卡内容清单
- `GET /api/qr/device/F001.svg`：检验、复核确认和管理员角色可查询；复核角色无个人二维码
- `GET /api/docs/sop.pdf`
- `GET /api/docs/blank.pdf`
- `GET /api/previews/record/:id.pdf|png`
- `GET /api/previews/week.pdf|png`
- `GET /api/previews/blank.pdf|png`
- `GET /api/previews/sop.pdf|png`

### 导出

- `POST /api/exports/record/:id`
- `POST /api/exports/records`
- `POST /api/exports/week`
- `POST /api/exports/csv`

导出成功响应为二进制附件，并写审计日志。

### 健康

- `GET /healthz`
- `GET /api/health`

健康检查同时验证数据库、FFmpeg/FFprobe、PDF 字体、Poppler 预览和串行队列。
任一必需组件不可用时返回 503。

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
  ruleVersion: "2026.11.1",
  reasons: [{code, label, detail}],
  items: [{
    key, L, value, dec, lim: {lo, hi}, dev,
    inLimit, missing, stable, conf, range
  }]
}
```

必须覆盖附录 C 的边界值、缺次、重复、顺序错误、不稳定和双量程缺切换。
重复与顺序检查优先读取 `record.recognition.segments` 的全局时间序列；该证据在
九项规范化之前生成，因此第 4 次及以后称重不会因 `readouts` 固定为九项而丢失。
旧记录没有该证据时，规则会同时检查读数数组顺序和识别帧时间偏移。

## 8. 分析适配器契约

`src/services/analyzer.js` 默认导出：

```js
async function analyzeVideo(context)
```

`context` 包含 `{filePath, sha256, startedAt, uploadedBy, devices, config}`。

成功后返回：

```js
{
  engine: "tesseract.js-7.0.0 + seven-segment-template",
  personCard: {account, conf},
  deviceCard: {code, conf},
  deviceId: "F001",
  inferredDeviceId: "F001",
  startTime: "2026-09-28 08:31",
  startTimeSource: "video-creation-time",
  durationSeconds: 393.62,
  recognition: {
    schemaVersion: 1,
    strategy: "independent-time-ordered-weighing-segments",
    segments: [],
    sequence: [0, 0, 0, 1, 1, 1, 2, 2, 2],
    pointCounts: [3, 3, 3],
    totalSegments: 9,
    orderViolation: null
  },
  rangeSwitch: true,
  rangeTransition: {fromRange: 1, toRange: 2, startOffsetSeconds, endOffsetSeconds},
  readouts: [],
  screenshots: [],
  warnings: []
}
```

读数由 `src/services/display-ocr.js` 在自动搜索出的显示屏区域上对真实视频帧逐秒
识别，不使用文件哈希查找预置读数。人员卡和设备卡必须是唯一、有效且相互一致的
二维码身份；缺少卡面或缺少任一有效读数截图时，队列不得生成自动正式记录。错误
使用 `AnalyzerError(code, message, status)`，其中 `status` 可为 `待人工处理` 或
`失败`；客户端 HTTP 状态由 `httpStatus` 映射。无法识别稳定示值时不返回伪造读数。

OCR 不按“下一个应识别哪个标称点”过滤帧。设备身份优先由设备二维码确定；没有
可用设备卡时，按完整时间序列中各组覆盖率和稳定性选择最一致的天平档案，而不是
强制按 L1/L2/L3 顺序取值。`recognition.segments` 保留全部识别称重段，规则据此
检查组顺序和第 4 次及以后称重。

稳定平台后可能再次缓慢变化并稳定，这种阶梯不应直接算作第二次称重。分析器会
合并同一设备、同一量程、同一标称点，间隔不超过 10 秒且平台间漂移不超过 20d 的
相邻读数；中间持续不超过 5 秒的跨点瞬时候选写入
`recognition.corrections.discardedTransientReadings`，但不计入称重次数。合并的
来源窗口写入 `corrections.mergedSameWeighingWindows`，供回溯审核。

按当前产品决策，本版本暂不实现 ASR/语音识别。二维码检测支持同一帧内的多个二维码：先解码
主候选，再遮挡其区域继续解码，并以重叠竖/横条带补充扫描；身份在全部抽样帧上
按类型前缀和已登记档案合并。二维码成功解码是离散证据，`conf` 不再写固定概率，
而是保存解码次数、帧数及首末帧偏移。

## 9. 队列契约

- 同一时刻最多一个任务处于 `分析中`。
- 启动时把遗留 `分析中` 改为 `失败`（`E-RESTARTED`），`排队中` 保持不变。
- 按 `queued_at, rowid` 严格 FIFO。
- 完成/失败在单个事务中更新任务、记录和审计。
- 任务重试复用原任务 ID，不生成重复记录。
- 正常关闭时在途任务固定为 `失败/E-SHUTDOWN`；启动恢复把遗留分析中任务标为
  `失败/E-RESTARTED`。
- 完成记录在同事务写入判定快照；之后详情、筛选、CSV 和 PDF 读取固定快照。

## 10. 前端要求

- 所有数据请求经 `/api`，不得依赖 `file://` 或原型内存状态。
- 修改请求携带 CSRF 头；401 时回到登录页；403 展示明确提示。
- 上传使用 4~8 MiB 分片和 `Upload-Offset`，刷新后可从服务端 offset 续传。
- 低置信读数、缺次、不稳定、超限必须在视觉上可区分。
- 页面需要可打印版式，隐藏导航/按钮；正式导出由服务端生成。
- 不使用任何 CDN、外链字体、远程图片、遥测或在线分析服务。
- 连续 5 次口令错误锁定账号 10 分钟；登录页不再请求验证码。
- 记录退回、复核、作废和任务失败写入站内通知。
- 任务警告和审计服务端分页在界面中可见；上传进行状态在“上传校验视频”和
  “分析任务”页面展示，不另设重复的上传历史页面。
- 周统计通过 HTML `week` 输入直接选择自然周，服务端换算周一至周日。
- 曲线图以标称点差值的毫克数绘制，并针对实测波动自动缩放纵轴。
- 检验人员具有只读“天平档案”入口；复核确认人员只显示设备二维码，不显示个人二维码。
- 打印预览由服务端最终 PDF 通过 Poppler 渲染为 PNG，预览、下载与打印共用同一版式。

