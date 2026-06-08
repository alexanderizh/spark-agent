#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/build-script/common.sh"

# agent-server: Midway.js 后端 API 服务
# 构建上下文为 monorepo 根目录（pnpm workspace）
build_and_push_image "agent-server" "${ROOT_DIR}/apps/server/Dockerfile" "${ROOT_DIR}"
