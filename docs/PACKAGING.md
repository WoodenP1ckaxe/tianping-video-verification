# 原生离线安装包

## 1. 交付形态

每次版本构建生成以下文件：

```text
release/vX.Y.Z/
  TianpingVideoVerification-X.Y.Z-Windows-x64-Setup.exe
  TianpingVideoVerification-X.Y.Z-Linux-x64.tar.gz
  使用说明.html
  使用说明.md
  RELEASE_NOTES.md
  SHA256SUMS.txt
```

Windows 安装器使用简体中文图形向导，面向普通用户，默认安装到当前用户目录，
不需要管理员权限。Linux 压缩包先解压，再执行其中的 `install.sh`。

两个安装包均包含：

- Node.js 24；
- FFmpeg 与 FFprobe；
- Noto Sans CJK SC 中文字体；
- 前端、后端和全部 npm 运行依赖；
- PDFium WebAssembly 打印预览组件；
- 使用说明与第三方许可证。

客户安装和运行时不需要联网，也不需要预先安装 Docker、Node.js、FFmpeg、
Poppler 或中文字体。

## 2. Windows 构建

构建机需要 Node.js 24.12.0、PowerShell 7+ 和 Inno Setup 6。构建阶段允许联网
下载固定版本的 Node、FFmpeg/FFprobe、字体和 Inno Setup；生成后的安装包完全可
离线使用。

```powershell
cd tianping-system
npm ci
node scripts/fetch-release-assets.mjs
.\scripts\build-release.ps1
```

可选环境变量：

- `TIANPING_NODE_EXE`：Windows `node.exe` 路径；
- `TIANPING_ISCC`：Inno Setup `ISCC.exe` 路径；
- `TIANPING_ASSET_CACHE`：外部运行时缓存目录。

Windows 安装器默认数据位置：

```text
%LOCALAPPDATA%\TianpingVideoVerificationData
```

数据目录不在程序安装目录中，升级和卸载默认不会删除数据库、视频、截图和备份。

## 3. Linux 构建与安装

两个平台均使用官方 Node.js 24.12.0 运行时和 ffmpeg-static b6.1.1（FFmpeg 6.1.1）
固定静态构建。下载脚本校验每个资产的 SHA-256，不使用会变化的 `latest` 地址。
目标系统需要 x86_64、glibc 2.28+、libstdc++ 6.0.26+。

普通用户安装，无需 root：

```bash
tar -xzf TianpingVideoVerification-X.Y.Z-Linux-x64.tar.gz
cd TianpingVideoVerification-X.Y.Z-linux-x64
sh install.sh
```

系统级安装：

```bash
sudo sh install.sh --system
```

普通用户模式使用以下目录：

```text
~/.local/share/tianping-video-verification/installation
~/.local/share/tianping-video-verification/data
```

系统模式使用以下目录：

```text
/opt/tianping-video-verification
/var/lib/tianping-video-verification
```

有 systemd 时安装器注册服务；没有 systemd 时使用内置 PID 文件启停脚本。系统模式
会创建 `tianping-video-verification` 专用低权限账号。

## 4. 完整性校验

Windows PowerShell：

```powershell
Get-FileHash .\TianpingVideoVerification-*-Windows-x64-Setup.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Linux：

```bash
sha256sum -c SHA256SUMS.txt
```

当前安装器默认未进行商业代码签名。正式客户交付前应使用组织受信任的代码签名
证书签名，并重新生成 `SHA256SUMS.txt`。不得用自签名证书替代正式签名。

## 5. 验收

在尚未安装 Node.js、Docker、FFmpeg、Poppler 的干净系统中至少验证：

1. 断网完成安装；
2. 控制面板可自动选择可用端口并打开浏览器；
3. `/healthz` 返回 `200`，`status` 为 `ok`；
4. 上传样例视频并完成分析；
5. 中文 PDF 下载、预览和打印正常；
6. 停止、重启后数据仍存在；
7. 卸载后程序移除、数据保留；
8. 重新安装后旧数据库可继续使用。

自动化打包后还应执行源码校验、66 项测试和安装包启动烟雾测试。

## 6. 升级与回滚

升级前先备份整个数据目录。Windows 直接运行新安装器并使用原安装目录；Linux
重新执行新版 `install.sh` 会先停止旧服务，再替换程序文件，数据目录保持不变。
Linux 安装器保留一份 `<安装目录>.previous` 供人工回滚。

卸载：

- Windows 在“设置 → 应用”中卸载，默认保留数据；
- Linux 执行安装目录中的 `control/uninstall.sh`
  或 `control/uninstall.sh --purge-data-and-confirm` 明确同时删除数据。
