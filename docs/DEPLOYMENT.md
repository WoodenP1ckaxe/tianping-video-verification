# 部署与运维手册

## 1. 部署形态

系统是单机 B/S 应用。浏览器访问 Web 服务，SQLite、上传文件、识别截图、导出件
和备份均位于数据目录。分析队列默认单消费者，同一时刻只处理一段视频。

推荐生产拓扑：

```text
内网 PC / 手机浏览器
          |
       HTTP/HTTPS
          |
  Docker Compose（单机）
  ├─ Web + 应用 + 分析队列（同一 Node.js 进程）
  ├─ SQLite 数据库
  └─ /app/data 持久卷
```

## 2. 环境要求

| 项目 | 最低配置 |
| --- | --- |
| CPU | 4 核 x86_64 |
| 内存 | 4 GB；建议 8 GB 以上 |
| 数据盘 | 320 GB；视频配额默认 200 GB |
| 显卡 | 不需要 |
| 系统 | Windows 10/11 + WSL2 + Docker Desktop，或 Linux x86_64 |
| 容器 | Docker Engine 20.10+、Compose v2 |
| 时间 | 可访问内网 NTP；时区 `Asia/Shanghai` |

非容器开发需要 Node.js 24+ 与 FFmpeg 7+。使用 Docker 时无需在宿主机安装
Node.js 或 FFmpeg。

## 3. 首次部署

### 3.1 在线构建镜像

在可访问 Docker 镜像源和 Debian 软件源的构建机执行：

```bash
cp .env.example .env
# 编辑 .env，把 INITIAL_PASSWORD 替换为至少 8 位且包含字母、数字的一次性口令
docker compose build
docker compose up -d
docker compose ps
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
notepad .env
.\scripts\start.ps1 -Build
```

Linux：

```bash
sh scripts/start.sh --build
```

浏览器打开 `http://127.0.0.1:8080/`。健康检查：

```bash
curl http://127.0.0.1:8080/healthz
```

响应中的 `status` 应为 `ok`。健康检查同时验证数据库、FFmpeg/FFprobe、PDF 字体、
Poppler 预览和串行队列；任一组件缺失时返回 503。镜像内健康检查每 30 秒执行一次。

### 3.2 离线部署

离线环境按 [OFFLINE_DELIVERY.md](OFFLINE_DELIVERY.md) 导入镜像。不要将
`docker-compose.yml` 中的 `build` 部分作为离线安装前置条件；离线包会附带已移除
构建段的 `docker-compose.offline.yml`。

### 3.3 数据目录与权限

Compose 将宿主机 `./data` 挂载到容器 `/app/data`。Linux 宿主机需允许容器内
`node` 用户（通常 UID 1000）写入：

```bash
mkdir -p data backups
sudo chown -R 1000:1000 data backups
```

不要将数据目录放在系统临时目录。扩容时迁移整个数据目录，并保持目录结构和
文件权限不变。

## 4. 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | 容器内监听地址 |
| `DATA_DIR` | `/app/data` | 数据库、视频、截图、导出件根目录 |
| `FFPROBE_PATH` | 自动查找 | FFprobe 绝对路径 |
| `FFMPEG_PATH` | 自动查找 | FFmpeg 绝对路径 |
| `PDF_FONT_PATH` | 自动查找 | 中文 PDF 字体；镜像默认 Noto Sans CJK |
| `PDFTOPPM_PATH` | `pdftoppm` / 镜像 `/usr/bin/pdftoppm` | 将最终 PDF 逐页渲染为打印预览图片 |
| `SECURE_COOKIE` | `false` | HTTPS 部署时设为 `true` |
| `INITIAL_PASSWORD` | 无 | 新库初始化口令；Compose 启动时强制要求，不提供固定默认值 |
| `TRUST_PROXY` | 空 | 可信反向代理 IP 或 IPv4 CIDR，多个用逗号分隔；为空时忽略 `X-Forwarded-For` |
| `MAX_ACTIVE_UPLOADS_PER_USER` | `3` | 单个账号未完成上传会话上限 |
| `MAX_ACTIVE_UPLOADS_GLOBAL` | `10` | 全系统未完成上传会话上限 |
| `MAX_TEMP_UPLOAD_BYTES` | `2147483648` | 未完成上传声明的临时空间上限（2GB） |
| `UPLOAD_SESSION_TTL_MINUTES` | `120` | 未继续上传的临时会话清理时限 |
| `MIN_FREE_DISK_BYTES` | `536870912` | 接受新上传前必须保留的最小磁盘空间（512MB） |
| `ANALYSIS_INTERVAL_MS` | `600` | 串行分析队列轮询间隔，通常无需调整 |
| `DISPLAY_REGION` | 空（自动定位） | 可选显示屏 ROI 覆盖项，按 `x,y,width,height` 归一化配置；留空时从视频多帧自动搜索 |
| `TIANPING_PORT` | `8080` | Compose 映射到宿主机的端口 |

非容器方式直接运行 `node server.js` 且新数据库未设置 `INITIAL_PASSWORD` 时，系统会
生成随机一次性口令并写入 `<DATA_DIR>/initial-password.txt`。完成全部初始账号改密后
必须删除该文件。Compose 不允许空口令，部署人员必须先创建 `.env` 并设置一次性口令。

SQLite 文件固定位于 `<DATA_DIR>/tianping.db`。维护脚本可通过
`DATABASE_PATH` 指向待检查的备份，但运行中不要另设数据库路径。

判定容差、置信度阈值、存储配额等业务参数应在管理员配置页调整，不通过修改
源代码实现。

## 5. HTTPS 与内网访问

生产环境建议由单位现有内网反向代理终止 TLS，并将请求转发至
`127.0.0.1:8080`。启用 HTTPS 后设置：

```dotenv
SECURE_COOKIE=true
```

反向代理必须保留 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto`，并允许
大文件上传所需的请求体长度。只有将代理地址配置到 `TRUST_PROXY` 后，应用才信任
转发头；直接暴露应用时保持该值为空，防止来源 IP 被伪造。应用自身不访问外网。

## 6. NTP 与时间

- 容器时区固定为 `Asia/Shanghai`。
- 宿主机必须配置内网 NTP；容器采用宿主机系统时间。
- 校验日期取视频拍摄开始日期；读数时间按视频内偏移换算到分钟。
- 视频无拍摄时间元数据时，上传人员必须人工确认，否则不创建队列任务。

## 7. 存储

视频默认配额为 200 GB。达到 90% 时系统告警；达到配额后按最早视频优先清理，
记录、截图、PDF 和审计不受影响。调整配额后检查“系统运行状态”页面。

建议监控：

- `data/` 总量与增长速度；
- SQLite 文件和 WAL 文件大小；
- 分析队列长度、平均耗时和失败次数；
- 最近一次自动备份状态；
- NTP 同步状态。

## 8. 升级

1. 调用管理员备份接口或执行 `scripts/maintenance.js backup`。
2. 记录当前镜像版本与容器健康状态。
3. 停止旧容器，但不删除数据卷。
4. 导入新镜像，保持数据目录不变。
5. 启动后检查 `/healthz`、登录、随机抽查记录与审计日志。
6. 出现阻断问题时停止新容器，按 [BACKUP_RESTORE.md](BACKUP_RESTORE.md) 恢复旧版本。

禁止用新版本容器覆盖旧数据库而不先备份。

## 9. 故障排查

| 现象 | 检查 |
| --- | --- |
| 页面打不开 | `docker compose ps`；端口是否被占用；宿主机防火墙 |
| PDF 导出提示字体不可用 | 容器是否安装 `fonts-noto-cjk`；`PDF_FONT_PATH` 是否有效 |
| PDF 预览提示渲染工具缺失 | 裸机是否安装 Poppler `pdftoppm`；或设置 `PDFTOPPM_PATH` |
| 任务提示媒体工具缺失 | 容器是否安装 `ffmpeg`；`FFPROBE_PATH` 是否有效 |
| 任务一直排队 | 系统状态页；分析服务是否只有一个消费者；查看运行日志 |
| 待人工处理 | 显示屏 ROI 不正确、OCR 未得到有效示值、二维码无法匹配或音频模型不可用；不是“判定不通过” |
| 登录后立即失效 | 系统时间、Cookie 域名、`SECURE_COOKIE` 与 HTTP/HTTPS 是否匹配 |
| 上传断点不一致 | 检查 `Upload-Offset`、数据目录剩余空间和代理请求体上限 |

日志：

```bash
docker compose logs --tail=200 tianping
docker compose logs -f tianping
```

