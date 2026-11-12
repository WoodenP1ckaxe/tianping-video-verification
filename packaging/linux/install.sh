#!/bin/sh
set -eu

BUNDLE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SYSTEM_MODE=0
AUTO_START=1
START_NOW=1
PORT=8080
HOST=127.0.0.1
INSTALL_DIR=
DATA_DIR=

usage() {
  cat <<'EOF'
天平校验视频分析系统 Linux 离线安装器

用法：
  ./install.sh                 安装到当前用户目录，无需 root
  sudo ./install.sh --system   安装为系统服务，使用专用低权限账号

可选参数：
  --port PORT                  本机端口，默认 8080；冲突时安装继续但启动会报错
  --host ADDRESS               监听地址，默认 127.0.0.1；局域网共享才使用 0.0.0.0
  --install-dir PATH           自定义安装目录
  --data-dir PATH              自定义数据目录
  --autostart                  登录桌面后自动启动（仅当前用户模式）
  --no-autostart               不创建登录自动启动项
  --no-start                   完成安装但不立即启动
  --help                       显示本帮助

安装完成后的常用命令：
  <安装目录>/control/service.sh open
  <安装目录>/control/service.sh status
  <安装目录>/control/service.sh restart
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --system) SYSTEM_MODE=1 ;;
    --autostart) AUTO_START=1 ;;
    --no-autostart) AUTO_START=0 ;;
    --no-start) START_NOW=0 ;;
    --port)
      [ "$#" -ge 2 ] || { echo "--port 缺少参数" >&2; exit 2; }
      PORT=$2
      shift
      ;;
    --host)
      [ "$#" -ge 2 ] || { echo "--host 缺少参数" >&2; exit 2; }
      HOST=$2
      shift
      ;;
    --install-dir)
      [ "$#" -ge 2 ] || { echo "--install-dir 缺少参数" >&2; exit 2; }
      INSTALL_DIR=$2
      shift
      ;;
    --data-dir)
      [ "$#" -ge 2 ] || { echo "--data-dir 缺少参数" >&2; exit 2; }
      DATA_DIR=$2
      shift
      ;;
    --help|-h) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

case "$PORT" in
  ''|*[!0-9]*) echo "端口必须是数字" >&2; exit 2 ;;
esac
if [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then
  echo "端口必须在 1024 到 65535 之间" >&2
  exit 2
fi

chmod 755 "$BUNDLE_DIR/runtime/node" "$BUNDLE_DIR/runtime/bin/ffmpeg" \
  "$BUNDLE_DIR/runtime/bin/ffprobe" "$BUNDLE_DIR/control/service.sh" 2>/dev/null || true
if [ ! -x "$BUNDLE_DIR/runtime/node" ] || [ ! -f "$BUNDLE_DIR/app/server.js" ]; then
  echo "安装包不完整：缺少内置 Node 或应用文件" >&2
  exit 1
fi

if [ "$(uname -m)" != "x86_64" ]; then
  echo "当前安装包仅支持 x86_64 Linux，检测到：$(uname -m)" >&2
  exit 1
fi

if ! "$BUNDLE_DIR/runtime/node" -e "process.exit(0)"; then
  echo "内置 Node.js 无法在当前系统运行。通常需要 glibc 2.28+ 与 libstdc++ 6.0.26+。" >&2
  exit 1
fi
if ! "$BUNDLE_DIR/runtime/bin/ffmpeg" -version >/dev/null 2>&1; then
  echo "内置 FFmpeg 无法运行，安装已停止" >&2
  exit 1
fi

DATA_HOME=${XDG_DATA_HOME:-"$HOME/.local/share"}
if [ "$SYSTEM_MODE" -eq 1 ]; then
  [ "$(id -u)" -eq 0 ] || { echo "--system 模式需要使用 sudo 运行" >&2; exit 1; }
  INSTALL_DIR=${INSTALL_DIR:-/opt/tianping-video-verification}
  DATA_DIR=${DATA_DIR:-/var/lib/tianping-video-verification}
  SERVICE_USER=tianping-video-verification
  SERVICE_NAME=tianping-video-verification
else
  INSTALL_DIR=${INSTALL_DIR:-"$DATA_HOME/tianping-video-verification/installation"}
  DATA_DIR=${DATA_DIR:-"$DATA_HOME/tianping-video-verification/data"}
  SERVICE_USER=
  SERVICE_NAME=tianping-video-verification
fi

mkdir -p "$(dirname "$INSTALL_DIR")" "$(dirname "$DATA_DIR")"
if [ -e "$INSTALL_DIR" ] && [ ! -f "$INSTALL_DIR/.tianping-installation" ]; then
  echo "目标安装目录不是本系统的既有安装，已停止：$INSTALL_DIR" >&2
  exit 1
fi

if [ -x "$INSTALL_DIR/control/service.sh" ]; then
  "$INSTALL_DIR/control/service.sh" stop >/dev/null 2>&1 || true
fi

if [ "$SYSTEM_MODE" -eq 1 ]; then
  if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    nologin=/usr/sbin/nologin
    [ -x "$nologin" ] || nologin=/sbin/nologin
    useradd --system --home-dir "$DATA_DIR" --shell "$nologin" "$SERVICE_USER"
  fi
  mkdir -p "$DATA_DIR" "$DATA_DIR/logs" "$DATA_DIR/backups"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
else
  mkdir -p "$DATA_DIR" "$DATA_DIR/logs" "$DATA_DIR/backups"
fi
chmod 700 "$DATA_DIR"

stage="$INSTALL_DIR.new.$$"
previous="$INSTALL_DIR.previous"
rm -rf "$stage"
mkdir -p "$stage"

cleanup_stage() {
  rm -rf "$stage"
}
trap cleanup_stage EXIT HUP INT TERM

cp -a "$BUNDLE_DIR/app" "$stage/app"
cp -a "$BUNDLE_DIR/runtime" "$stage/runtime"
cp -a "$BUNDLE_DIR/control" "$stage/control"
cp -a "$BUNDLE_DIR/docs" "$stage/docs"
cp -a "$BUNDLE_DIR/licenses" "$stage/licenses"
cp -a "$BUNDLE_DIR/icon.png" "$stage/icon.png"
cp -a "$BUNDLE_DIR/VERSION" "$stage/VERSION"
: >"$stage/.tianping-installation"

sh_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

SERVICE_MODE=manual
if [ "$SYSTEM_MODE" -eq 1 ] && command -v systemctl >/dev/null 2>&1 \
  && [ -d /run/systemd/system ]; then
  SERVICE_MODE=systemd-system
elif [ "$SYSTEM_MODE" -eq 0 ] && command -v systemctl >/dev/null 2>&1 \
  && [ -d /run/systemd/system ] && systemctl --user show-environment >/dev/null 2>&1; then
  SERVICE_MODE=systemd-user
fi

{
  printf 'INSTALL_DIR=%s\n' "$(sh_quote "$INSTALL_DIR")"
  printf 'DATA_DIR=%s\n' "$(sh_quote "$DATA_DIR")"
  printf 'PORT=%s\n' "$(sh_quote "$PORT")"
  printf 'HOST=%s\n' "$(sh_quote "$HOST")"
  printf 'SERVICE_NAME=%s\n' "$(sh_quote "$SERVICE_NAME")"
  printf 'SERVICE_MODE=%s\n' "$(sh_quote "$SERVICE_MODE")"
} >"$stage/install.env"

chmod 755 "$stage/control/service.sh"
chmod 755 "$stage/control/uninstall.sh" 2>/dev/null || true
chmod -R u+rwX,go+rX,go-w "$stage"
chmod 755 "$stage/runtime/node" "$stage/runtime/bin/ffmpeg" \
  "$stage/runtime/bin/ffprobe" "$stage/control/service.sh" \
  "$stage/control/uninstall.sh"

if [ "$SERVICE_MODE" = "systemd-user" ] || [ "$SERVICE_MODE" = "systemd-system" ]; then
  unit_file="$stage/tianping-video-verification.service"
  {
    echo '[Unit]'
    echo 'Description=天平校验视频分析系统'
    echo 'After=network.target'
    echo
    echo '[Service]'
    echo 'Type=simple'
    if [ -n "$SERVICE_USER" ]; then
      echo "User=$SERVICE_USER"
      echo "Group=$SERVICE_USER"
    fi
    echo "WorkingDirectory=\"$INSTALL_DIR/app\""
    echo 'Environment="NODE_ENV=production"'
    echo 'Environment="NODE_NO_WARNINGS=1"'
    echo 'Environment="TZ=Asia/Shanghai"'
    echo "Environment=\"HOST=$HOST\""
    echo "Environment=\"PORT=$PORT\""
    echo "Environment=\"DATA_DIR=$DATA_DIR\""
    echo "Environment=\"FFMPEG_PATH=$INSTALL_DIR/runtime/bin/ffmpeg\""
    echo "Environment=\"FFPROBE_PATH=$INSTALL_DIR/runtime/bin/ffprobe\""
    echo "Environment=\"PDF_FONT_PATH=$INSTALL_DIR/runtime/fonts/NotoSansCJKsc-VF.ttf\""
    echo "ExecStart=\"$INSTALL_DIR/runtime/node\" \"$INSTALL_DIR/app/server.js\""
    echo 'Restart=on-failure'
    echo 'RestartSec=3'
    echo 'UMask=0077'
    echo
    echo '[Install]'
    if [ "$SERVICE_MODE" = "systemd-user" ]; then
      echo 'WantedBy=default.target'
    else
      echo 'WantedBy=multi-user.target'
    fi
  } >"$unit_file"
  cp -a "$unit_file" "$stage/control/tianping-video-verification.service"
fi

if [ -e "$INSTALL_DIR" ]; then
  rm -rf "$previous"
  mv "$INSTALL_DIR" "$previous"
fi
mv "$stage" "$INSTALL_DIR"
trap - EXIT HUP INT TERM

if [ "$SERVICE_MODE" = "systemd-system" ]; then
  install -m 0644 "$INSTALL_DIR/tianping-video-verification.service" \
    "/etc/systemd/system/$SERVICE_NAME.service"
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null
elif [ "$SERVICE_MODE" = "systemd-user" ]; then
  systemd_user_dir="$HOME/.config/systemd/user"
  mkdir -p "$systemd_user_dir"
  install -m 0644 "$INSTALL_DIR/tianping-video-verification.service" \
    "$systemd_user_dir/$SERVICE_NAME.service"
  systemctl --user daemon-reload
  if [ "$AUTO_START" -eq 1 ]; then
    systemctl --user enable "$SERVICE_NAME" >/dev/null
  fi
fi

if [ "$SYSTEM_MODE" -eq 0 ]; then
  app_dir="$HOME/.local/share/applications"
  mkdir -p "$app_dir"
  cat >"$app_dir/tianping-video-verification.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=天平校验视频分析系统
Comment=启动天平校验视频分析系统
Exec="$INSTALL_DIR/control/service.sh" open
Icon=$INSTALL_DIR/icon.png
Terminal=false
Categories=Office;Science;
StartupNotify=true
EOF
  chmod 755 "$app_dir/tianping-video-verification.desktop"

  desktop_dir=
  if command -v xdg-user-dir >/dev/null 2>&1; then
    desktop_dir=$(xdg-user-dir DESKTOP 2>/dev/null || true)
  fi
  if [ -z "$desktop_dir" ] || [ "$desktop_dir" = "$HOME" ]; then
    [ -d "$HOME/Desktop" ] && desktop_dir="$HOME/Desktop"
  fi
  if [ -n "$desktop_dir" ] && [ -d "$desktop_dir" ]; then
    cp "$app_dir/tianping-video-verification.desktop" \
      "$desktop_dir/tianping-video-verification.desktop"
    chmod 755 "$desktop_dir/tianping-video-verification.desktop"
  fi

  if [ "$AUTO_START" -eq 1 ]; then
    autostart_dir="$HOME/.config/autostart"
    mkdir -p "$autostart_dir"
    cat >"$autostart_dir/tianping-video-verification.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=天平校验视频分析系统
Exec="$INSTALL_DIR/control/service.sh" start
X-GNOME-Autostart-enabled=true
Terminal=false
NoDisplay=true
EOF
  fi
fi

if [ "$START_NOW" -eq 1 ]; then
  "$INSTALL_DIR/control/service.sh" start
else
  echo "安装完成。运行以下命令启动："
  echo "  $INSTALL_DIR/control/service.sh start"
fi

echo
echo "安装目录：$INSTALL_DIR"
echo "数据目录：$DATA_DIR（升级和卸载默认不会删除）"
echo "访问地址：http://127.0.0.1:$PORT/"
echo "服务管理：$INSTALL_DIR/control/service.sh start|stop|restart|status|open"
if [ -f "$DATA_DIR/initial-password.txt" ]; then
  echo
  sed -n '1,5p' "$DATA_DIR/initial-password.txt"
  echo "首次登录账号：U000（管理员）、U001/U002（检验）、U003（复核）"
fi
