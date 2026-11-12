# 天平校验视频分析系统

电子天平日常校验视频的采集、分析、人工核对、复核与导出系统。服务端基于
Node.js 24 和 SQLite，前端为无 CDN 的离线静态应用。

本仓库包含运行实现、自动化测试和交付文档。客户原始需求、早期原型、运行数据库、
上传视频、截图、日志及本机验证产物不进入 Git。
后续 AI 协作者请先阅读 [AI_CONTEXT.md](AI_CONTEXT.md)。

## 本地运行

需要 Node.js 24 与 FFmpeg/FFprobe。PDF 打印预览使用随应用安装的 PDFium
WebAssembly，不需要操作系统预装 Poppler。

```powershell
npm ci
$env:INITIAL_PASSWORD = "<设置至少 8 位且同时包含字母和数字的一次性口令>"
node server.js
```

```bash
npm ci
INITIAL_PASSWORD='<设置至少 8 位且同时包含字母和数字的一次性口令>' node server.js
```

不设置 `INITIAL_PASSWORD` 时，首次初始化会生成随机口令并写入
`data/initial-password.txt`。浏览器访问 `http://127.0.0.1:8080/`；首次登录强制
改密。连续 5 次口令错误会锁定账号 10 分钟；未知账号按来源限流。生产部署必须
通过环境变量提供独立强口令。

## Docker

```bash
cp .env.example .env
# 编辑 .env，替换 INITIAL_PASSWORD
docker compose up -d --build
```

也可以使用 `scripts/start.ps1 -Build` 或 `scripts/start.sh --build`。

## 离线安装包

正式客户交付优先使用 `release/` 下的原生安装包：Windows 包提供简体中文图形化
安装向导和本机控制面板；Linux 包支持普通用户目录安装及 `--system` 系统服务
安装。两者均内置 Node.js、FFmpeg、FFprobe、中文字体和 PDFium，不要求客户预装
Docker、Node.js 或媒体工具。构建方法见 [docs/PACKAGING.md](docs/PACKAGING.md)。

## 源码校验与备份

```bash
npm run check
npm test
npm run repo:status
npm run repo:create
npm run repo:commit -- -m "描述本次变更"
npm run repo:backup -- -m "描述本次变更"
```

`repo:create` 使用本机 Git Credential Manager 中的 GitHub 登录身份确认或创建
公开仓库。`repo:commit` 是一键发布命令：运行源码校验和发布策略检查、提交允许
发布的文件、推送 `main`，并同时推送可达的版本标签。`repo:backup` 是同一流程的
别名。策略采用明确允许清单，检测到文档、测试、媒体、数据库、日志或敏感凭据时
会拒绝提交或推送。

有源码变化时，`repo:commit` 和 `repo:backup` 会自动递增 patch 版本并对齐
`package.json`、`package-lock.json` 与 Compose 镜像标签，同时创建 `vX.Y.Z`
本地标签。版本提升级别可以显式指定：

```bash
npm run repo:commit -- --bump minor -m "新增兼容功能"
npm run repo:backup -- --bump major -m "不兼容变更"
```

## 能力边界

当前分析器先从整段视频的多帧画面中自动搜索显示屏区域，再逐秒抽帧执行七段码
模板识别，并以离线 Tesseract 作为彩色/复杂显示屏回退；随后按连续至少 3 秒、
示值变化不超过 1 个 d 聚合稳定段。读数不依赖文件哈希或预置清单。需要锁定固定
机位时可使用 `DISPLAY_REGION=x,y,width,height` 覆盖自动定位。应用不包含在线
识别调用或远程字体依赖。

识别器不再按预期称重顺序过滤候选。每段真实视频中的称重都会进入全局时间序列，
包括乱序段、未稳定段和第 4 次及以后的段；九项明细用于记录展示，而规则同时读取
完整时间序列，因此“重复/多次称重”和“顺序错误”不会在归一化时被消除。记录详情
页会展示该时序，并为额外称重段保留识别截图。

同一次称重可能出现“先稳定、再变化约 1d、再次稳定”的多个平台。识别器会把
间隔不超过 10 秒、同标称点且漂移不超过 20d 的相邻平台合并为一次称重；若中间
只有持续不超过 5 秒的错误跨点读数，则记录为已丢弃的瞬时候选，不另计一次称重。
真正的重新取放通常具有更长间隔，仍作为独立称重段保留。

二维码使用本地 `jsQR` 解码，系统内直接生成 H 级纠错身份卡。检验人员可下载本人卡，
并可按编号查询天平、导出设备卡；复核确认人员只提供设备卡入口，没有个人二维码。人员卡与长期张贴的设备卡同屏时，分析器
会执行同帧多码检测并跨抽样帧合并身份。卡面缺失、冲突或与登录人员/OCR 设备不一致
时，任务进入“待人工处理”，不会用登录账号或标称值回退生成正式记录。

记录在生成、读数修正和提交时写入固定判定快照，包括结论、依据、容差、规则版本
和判定时间；之后详情、筛选、CSV 与 PDF 均读取该快照。记录退回、复核、作废和
任务失败会进入站内通知中心；上传进度与失败原因在上传页和分析任务页查看。

按当前需求决策，本版本暂不实现中文 ASR、语音关键词和语音冲突编号。“清洁/水平
调节/内部校正是否通过”由操作人员在记录
核对页现场观察确认。每个有效读数仍必须保存对应真实识别截图。

运行状态页根据视频配额、磁盘可用空间、已有视频平均大小和在用天平数量估算可存储
时长，默认按“每台在用天平每天 1 次校验记录”规划。周统计表可直接选择自然周；
天平原历史页提供按 L1/L2/L3 自动缩放的示值误差曲线。所有用户均可在系统内阅读、
打印或下载标准操作流程 PDF。

## 目录

```text
server.js                  HTTP 入口
src/                       后端、规则和业务服务
public/                    离线 Web 前端
  samples/manifests/         三份客户样例的自动识别回归基准（不参与生产识别）
  tests/                     自动化回归测试
  docs/                      部署、用户、数据库和验收文档
scripts/                   启停、维护、校验与仓库管理工具
.github/workflows/         CI 源码校验
```
