#!/bin/sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "用法：$0 <Linux 安装包.tar.gz>" >&2
  exit 2
fi

ARCHIVE=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/tianping-smoke.XXXXXX")
PORT=18089

cleanup() {
  if [ -x "$TMP_ROOT/install/control/service.sh" ]; then
    "$TMP_ROOT/install/control/service.sh" stop >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$TMP_ROOT/unpack"
tar -xzf "$ARCHIVE" -C "$TMP_ROOT/unpack"
BUNDLE=$(find "$TMP_ROOT/unpack" -mindepth 1 -maxdepth 1 -type d | head -n 1)
if [ -z "$BUNDLE" ] || [ ! -f "$BUNDLE/install.sh" ]; then
  echo "安装包目录结构无效" >&2
  exit 1
fi

sh "$BUNDLE/install.sh" \
  --no-start \
  --no-autostart \
  --install-dir "$TMP_ROOT/install" \
  --data-dir "$TMP_ROOT/data" \
  --port "$PORT"

"$TMP_ROOT/install/control/service.sh" start
health=$("$TMP_ROOT/install/runtime/node" -e "
  fetch('http://127.0.0.1:$PORT/healthz')
    .then(async r => {
      const body = await r.json();
      if (body.status !== 'ok') {
        console.error(JSON.stringify(body));
        process.exit(1);
      }
      console.log(JSON.stringify(body));
    })
    .catch(error => { console.error(error); process.exit(1); });
")
echo "Linux 健康检查：$health"
"$TMP_ROOT/install/control/service.sh" status

home=$("$TMP_ROOT/install/runtime/node" -e "
  fetch('http://127.0.0.1:$PORT/').then(async r => {
    if (!r.ok) process.exit(1);
    const text = await r.text();
    if (!text.includes('天平校验视频分析系统')) process.exit(1);
  }).catch(() => process.exit(1));
")
echo "Linux 安装、启动、健康检查和首页验证通过"

"$TMP_ROOT/install/control/service.sh" stop
sh "$TMP_ROOT/install/control/uninstall.sh" --purge-data-and-confirm
if [ -e "$TMP_ROOT/install" ] || [ -e "$TMP_ROOT/data" ]; then
  echo "Linux 卸载或数据清理不完整" >&2
  exit 1
fi
echo "Linux 卸载与显式数据清理验证通过"
