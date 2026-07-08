#!/usr/bin/env bash
#==============================================================
# Spark Agent 官网：构建 Docker 镜像并推送到腾讯云镜像仓库
#
# 用法（在仓库根目录或任意目录执行均可）:
#   bash apps/website/scripts/build-push-image.sh
#
# 可选环境变量:
#   workspace              腾讯云镜像仓库命名空间（默认 spark_ai）
#   docker_id / docker_pwd 镜像仓库凭据（未登录时用于 docker login）
#   REGISTRY               默认 ccr.ccs.tencentyun.com
#   REPO                   默认 spark-website
#   VITE_RELEASES_API_BASE 构建期烘进 bundle 的版本中心 API 基地址
#   PUSH=0                 只构建不推送
#==============================================================
set -euo pipefail

REGISTRY="${REGISTRY:-ccr.ccs.tencentyun.com}"
NAMESPACE="${workspace:-spark_ai}"
REPO="${REPO:-spark-website}"
PUSH="${PUSH:-1}"
VITE_RELEASES_API_BASE="${VITE_RELEASES_API_BASE:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBSITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$WEBSITE_DIR/../.." && pwd)"

log(){ printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
die(){ printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

cd "$REPO_ROOT" || die "无法进入仓库根目录: $REPO_ROOT"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
TAG="$(date +%Y%m%d)-${COMMIT}"
IMAGE="${REGISTRY}/${NAMESPACE}/${REPO}"

log "构建镜像 ${IMAGE}:${TAG}（commit=${COMMIT}）"
docker build -f apps/website/Dockerfile \
  --build-arg "VITE_RELEASES_API_BASE=${VITE_RELEASES_API_BASE}" \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  apps/website

docker images | grep "${REPO}" | head -5

if [ "$PUSH" = "0" ]; then
  log "PUSH=0，跳过推送"
  exit 0
fi

if [ -n "${docker_id:-}" ] && [ -n "${docker_pwd:-}" ]; then
  log "登录 ${REGISTRY}"
  echo "$docker_pwd" | docker login "$REGISTRY" -u "$docker_id" --password-stdin
fi

log "推送 ${IMAGE}:${TAG} 与 :latest"
docker push "${IMAGE}:${TAG}"
docker push "${IMAGE}:latest"
log "完成: ${IMAGE}:${TAG}"
