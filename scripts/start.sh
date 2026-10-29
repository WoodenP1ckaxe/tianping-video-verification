#!/usr/bin/env sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_DIR"

if [ "${1:-}" = "--build" ]; then
  docker compose build
fi

docker compose up -d
docker compose ps
echo "系统地址：http://127.0.0.1:${TIANPING_PORT:-8080}"

