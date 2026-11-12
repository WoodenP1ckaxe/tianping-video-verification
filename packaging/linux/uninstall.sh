#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$INSTALL_DIR/install.env"

case "${1:-}" in
  "") ;;
  --purge-data) PURGE_DATA=1 ;;
  --purge-data-and-confirm)
    PURGE_DATA=1
    PURGE_CONFIRMED=1
    ;;
  --help|-h)
    echo "用法：$0 [--purge-data-and-confirm]"
    echo "默认卸载程序但保留全部数据库、视频、截图和备份。"
    exit 0
    ;;
  *)
    echo "未知参数：$1" >&2
    exit 2
    ;;
esac

if [ ! -f "$ENV_FILE" ] || [ ! -f "$INSTALL_DIR/.tianping-installation" ]; then
  echo "当前目录不是有效的天平校验视频分析系统安装。"
  exit 1
fi

. "$ENV_FILE"

case "$INSTALL_DIR" in
  ""|"/"|"/opt"|"/usr"|"/var"|"$HOME")
    echo "安装目录安全校验失败：$INSTALL_DIR" >&2
    exit 1
    ;;
esac

if [ "$SERVICE_MODE" = "systemd-system" ] && [ "$(id -u)" -ne 0 ]; then
  echo "系统级卸载需要使用 sudo 运行" >&2
  exit 1
fi

"$INSTALL_DIR/control/service.sh" stop >/dev/null 2>&1 || true

if [ "$SERVICE_MODE" = "systemd-system" ]; then
  systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$SERVICE_NAME.service"
  systemctl daemon-reload || true
elif [ "$SERVICE_MODE" = "systemd-user" ]; then
  systemctl --user disable "$SERVICE_NAME" >/dev/null 2>&1 || true
  rm -f "$HOME/.config/systemd/user/$SERVICE_NAME.service"
  systemctl --user daemon-reload || true
fi

rm -f "$HOME/.local/share/applications/tianping-video-verification.desktop"
rm -f "$HOME/.config/autostart/tianping-video-verification.desktop"
if command -v xdg-user-dir >/dev/null 2>&1; then
  desktop_dir=$(xdg-user-dir DESKTOP 2>/dev/null || true)
  [ -n "$desktop_dir" ] && rm -f "$desktop_dir/tianping-video-verification.desktop"
fi

if [ "${PURGE_DATA:-0}" -eq 1 ]; then
  if [ "${PURGE_CONFIRMED:-0}" -ne 1 ]; then
    echo "删除数据必须显式使用 --purge-data-and-confirm。" >&2
    exit 2
  fi
  case "$DATA_DIR" in
    ""|"/"|"/var"|"/usr"|"$HOME") echo "数据目录安全校验失败" >&2; exit 1 ;;
  esac
fi

old_dir=$(CDPATH= cd -- / && pwd)
cd /
rm -rf "$INSTALL_DIR"
rm -rf "${INSTALL_DIR}.previous"
cd "$old_dir" 2>/dev/null || true

if [ "${PURGE_DATA:-0}" -eq 1 ]; then
  rm -rf "$DATA_DIR"
  echo "程序与数据均已删除。"
else
  echo "程序已卸载；数据保留在：$DATA_DIR"
fi
