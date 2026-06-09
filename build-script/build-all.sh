#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo ""
echo "========================================="
echo "  Spark Agent - 构建并推送全部镜像"
echo "========================================="
echo ""

bash "${ROOT_DIR}/build-script/build-agent-server.sh"

echo ""
echo "========================================="
echo "  全部镜像构建完成!"
echo "========================================="
