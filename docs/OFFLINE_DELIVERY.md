# 离线交付与安装

## 1. 在有网络的构建机准备

构建机需有 Docker、Docker Compose v2，以及访问基础镜像和 Debian 软件源的权限。

```bash
cd tianping-system
node scripts/make-offline-bundle.js
```

结果位于 `dist/`：

```text
dist/
  tianping-system-1.0.0.tar
  docker-compose.offline.yml
```

镜像包含 Node.js 24、FFmpeg、Noto Sans CJK、Tesseract.js WASM/英文训练数据、
jsQR、qrcode-generator、Poppler `pdftoppm` 和其他运行时依赖。依赖由 Dockerfile 中的 `npm ci` 安装进镜像；离线部署
只需导入已构建好的镜像 tar，不需要在内网执行 npm 安装或下载模型。

生成校验文件：

```bash
sha256sum dist/tianping-system-1.0.0.tar > dist/SHA256SUMS.txt
sha256sum dist/docker-compose.offline.yml >> dist/SHA256SUMS.txt
```

PowerShell：

```powershell
Get-FileHash .\dist\tianping-system-1.0.0.tar -Algorithm SHA256
Get-FileHash .\dist\docker-compose.offline.yml -Algorithm SHA256
```

## 2. 离线安装

将以下内容复制到隔离内网服务器：

- 镜像 tar；
- `docker-compose.offline.yml`；
- `docs/`；
- 空的 `data/`、`backups/` 目录；
- `SHA256SUMS.txt`。

校验后执行：

```bash
sha256sum -c SHA256SUMS.txt
docker load -i tianping-system-1.0.0.tar
mkdir -p data backups
docker compose -f docker-compose.offline.yml up -d
docker compose -f docker-compose.offline.yml ps
```

Windows Docker Desktop 使用 PowerShell 的 `Get-FileHash` 核对校验值，然后：

```powershell
docker load -i .\tianping-system-1.0.0.tar
docker compose -f .\docker-compose.offline.yml up -d
```

## 3. 验收检查

1. `GET http://127.0.0.1:8080/healthz` 返回 200。
2. 登录三个角色，完成首次改密。
3. 上传一段样例视频，确认队列任务生成。
4. 确认样例判定结果，并由另一角色复核。
5. 生成并打开中文 PDF，确认字体、页码和签字栏正常。
6. 执行备份，使用完整性检查命令验证。

## 4. 离线升级

旧镜像应保留至少一个可回退版本。导入新镜像时使用新的 tag，验证后将 Compose
文件中的 tag 切换。不要删除旧数据库备份。

## 5. 介质与许可证

- 记录基础镜像、FFmpeg、Noto CJK 字体、Node.js、Tesseract.js、Tesseract 英文
  训练数据、jsQR 与 qrcode-generator 的版本及许可证。
- 正式交付时应由组织法务确认所有第三方组件的商业使用许可。
- 不得将客户视频、数据库或审计导出件放入构建缓存、日志或外部镜像仓库。

