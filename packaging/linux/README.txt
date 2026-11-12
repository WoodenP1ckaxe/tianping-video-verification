天平校验视频分析系统 Linux x86_64 离线安装包

重要：请先解压完整目录，不要只复制其中某个文件。

【普通用户安装，无需 root】

  cd 本安装包目录
  chmod +x install.sh
  ./install.sh

安装完成后会自动启动系统。使用浏览器打开：

  http://127.0.0.1:8080/

安装器会创建桌面/应用菜单入口。以后可通过以下命令打开：

  ~/.local/share/tianping-video-verification/installation/control/service.sh open

【系统级安装】

  sudo ./install.sh --system

系统级安装位置：
  程序：/opt/tianping-video-verification
  数据：/var/lib/tianping-video-verification

【首次登录】

控制台会显示一次性初始口令。也可以查看：

  ~/.local/share/tianping-video-verification/data/initial-password.txt

系统级安装对应：

  /var/lib/tianping-video-verification/initial-password.txt

管理员账号：U000
检验人员账号：U001、U002
复核确认人员账号：U003

所有账号使用同一个一次性初始口令，每人都必须在首次登录后修改为私人密码。

【版本与系统要求】

  x86_64 Linux
  glibc 2.28+
  libstdc++ 6.0.26+

Node.js、FFmpeg、FFprobe 和中文字体均已内置，安装与运行不需要联网。
默认仅本机访问。若确需局域网共享，请使用 --host 0.0.0.0，并由单位网络管理员
配置主机防火墙和访问控制。

【数据保护】

卸载默认保留全部数据。不要直接删除或移动数据库文件。升级或迁移前请先执行备份。

详细步骤见 docs/QUICK_START.html、docs/QUICK_START.md 和 docs/USER_GUIDE.md。
