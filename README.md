# 天平校验视频分析系统

电子天平日常校验视频的采集、分析、人工核对、复核与导出系统。服务端基于
Node.js 24 和 SQLite，前端为无 CDN 的离线静态应用。

本仓库是**源码备份**，只发布实现所需文件。需求文档、项目介绍、早期原型、
测试用例、验收材料、运行数据库、上传视频和日志均保留在本地，不进入 Git。
后续 AI 协作者请先阅读 [AI_CONTEXT.md](AI_CONTEXT.md)。

## 本地运行

需要 Node.js 24 与 FFmpeg/FFprobe。

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
改密，连续 5 次输错会锁定 10 分钟。生产部署必须通过环境变量提供独立强口令。

## Docker

```bash
cp .env.example .env
# 编辑 .env，替换 INITIAL_PASSWORD
docker compose up -d --build
```

也可以使用 `scripts/start.ps1 -Build` 或 `scripts/start.sh --build`。

## 源码校验与备份

```bash
npm run check
npm run repo:status
npm run repo:create
npm run repo:commit -- -m "描述本次变更"
npm run repo:backup -- -m "描述本次变更"
```

`repo:create` 使用本机 Git Credential Manager 中的 GitHub 登录身份确认或创建
公开仓库。`repo:backup` 会在提交前运行源码校验和发布策略检查，然后提交允许发布
的文件并推送到 GitHub。策略采用明确允许清单，检测到文档、测试、媒体、数据库、
日志或敏感凭据时会拒绝提交或推送。

## 能力边界

当前分析器先从整段视频的多帧画面中自动搜索显示屏区域，再逐秒抽帧执行七段码
模板识别，并以离线 Tesseract 作为彩色/复杂显示屏回退；随后按连续至少 3 秒、
示值变化不超过 1 个 d 聚合稳定段。读数不依赖文件哈希或预置清单。需要锁定固定
机位时可使用 `DISPLAY_REGION=x,y,width,height` 覆盖自动定位。应用不包含在线
识别调用或远程字体依赖。

二维码使用本地 `jsQR` 解码。人员卡未识别、设备卡未识别或卡面与登录人员/OCR
设备不一致时，自动分析任务进入“待人工处理”，不会用登录账号或标称值回退生成
正式记录。每个有效读数必须保存对应识别截图。当前环境仍未提供中文 ASR 模型，
因此“清洁/水平/内部校正”口述项以低置信候选进入人工确认。

## 目录

```text
server.js                  HTTP 入口
src/                       后端、规则和业务服务
public/                    离线 Web 前端
samples/manifests/         三份客户样例的回归基准数据（运行时不参与识别）
scripts/                   启停、维护、校验与仓库管理工具
.github/workflows/         CI 源码校验
```
