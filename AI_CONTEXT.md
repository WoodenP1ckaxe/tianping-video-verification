# AI 协作说明

## 仓库定位

这是天平校验视频分析系统的源码仓库。项目由 AI 持续协作开发，后续 AI 应先读
本文件，再按任务需要读取 `ARCHITECTURE.md` 和源码。

仓库包含 `docs/`、`tests/` 和运行实现，用于交付与 CI。客户原始需求、项目介绍、
早期静态原型、运行数据库、上传视频、截图、日志和本机 `verification/` 产物不入 Git。

## 入口与调用链

- `server.js`：配置、HTTP 服务启动、静态资源与优雅退出。
- `src/api.js`：REST API、鉴权/CSRF/角色检查、业务编排。
- `src/db.js`：SQLite schema、初始化数据、事务、持久化映射。
- `src/rules.js`：九次示值、稳定段、量程切换和容差判定纯函数。
- `src/services/uploads.js`：分片上传、哈希与上传会话。
- `src/services/queue.js`：串行分析队列及重启恢复。
- `src/services/analyzer.js`：媒体校验、OCR 结果整理与人工处理适配。
- `src/services/display-ocr.js`：逐秒帧提取、七段码模板 OCR、Tesseract 回退、稳定段提取。
- `src/services/judgments.js`：判定快照生成、持久化与历史记录回填。
- `src/services/exporter.js`：CSV、PDF 和打印数据。
- `src/services/qr.js`：离线生成带类型前缀、人员/设备大号标识的 SVG 身份卡。
- `src/version.js`：从 `package.json` 读取唯一运行时版本号。
- `public/assets/app.js`：单页面前端及 API 调用。
- `samples/manifests/`：三份客户样例的回归基准数据，不参与生产识别。

## 必须保持的不变量

1. 所有判定必须经过 `src/rules.js`，界面和识别结果不能绕过规则。
2. 权限、首次改密和 CSRF 校验必须在服务端执行。
3. 识别必须读取真实视频帧，不得按文件哈希或样例清单静默填入读数。
4. 上传文件、数据库、视频、截图和导出物不得进入源码仓库。
5. 新文件若确实属于运行实现，必须同时加入 `scripts/repo-manager.mjs` 的允许清单。
6. `package.json`、`package-lock.json` 与 Compose 镜像标签必须保持同一 SemVer。

## 版本管理

`repo:commit` 和 `repo:backup` 是一键发布流程：发现源码变化时自动递增 patch
版本、创建 `vX.Y.Z` 标签并一起提交，随后推送 `main` 与可达标签到 GitHub。需要
提升 minor 或 major 时分别追加 `-- --bump minor` 或 `-- --bump major`。不要
手工只改其中一个版本字段。

## 修改后的检查

```bash
npm run check
npm test
npm run repo:check
```

测试与文档属于发布文件。CI 必须运行 `npm run check` 和 `npm test`。涉及上传、
鉴权或导出的变更，还应启动服务做接口与浏览器冒烟检查。

## 已知能力边界

内置分析器已使用多帧候选搜索自动定位显示屏，再以本地七段码模板和离线
Tesseract 识别数字，并用 jsQR 扫描人员/设备二维码。二维码解码支持同帧多个码和
跨抽样帧身份合并，设备二维码长期出现在视频中属于正常场景。人员卡或设备卡缺失、
无法唯一解码、与登录人员或读数设备不一致时，不得生成自动正式记录。每个有效读数
必须有识别截图。`DISPLAY_REGION` 仅作为固定机位覆盖项。

识别候选不得按预期 L1/L2/L3 顺序过滤。分析结果中的 `recognition.segments` 是
规则判定所使用的完整时间序列，可包含第 4 次及以后称重；`readouts` 仍固定为九项
用于记录展示和人工修正，不能反过来覆盖完整时序证据。

同一次称重的阶梯稳定平台必须先按“间隔不超过 10 秒且漂移不超过 20d”合并，不能
因 OCR 短暂丢失而直接生成重复称重。短暂跨点误识别应保存在 corrections 证据中，
不能静默删除；真正的重新称重仍应保留为独立时间序列段。

按当前产品决策，本版本暂不实现 ASR/语音识别；清洁、水平调节和内部校正结果由
记录核对页人工观察确认。不得把 ASR 标为已完成，也不得用固定阈值伪造二维码置信度。
仍需用客户扩样完成自动定位、字段准确率、CPU 和性能验收；三段样例清单只是当前
识别器的回归基线，不等同于人工字段准确率。
