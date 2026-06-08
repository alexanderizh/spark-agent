#!/usr/bin/env bash
# Docker 镜像构建与推送公共函数
# 使用方式: source common.sh && build_and_push_image <镜像名> <Dockerfile路径> <构建上下文>
#
# 可选环境变量:
#   IMAGE_TAG      - 镜像标签 (默认: git short SHA + 时间戳)
#   PUSH_LATEST    - 是否同时推送 latest 标签 (默认: true)
#   BUILD_ONLY     - 设为 true 仅构建不推送
#   TARGET_PLATFORM - 目标平台 (默认: linux/amd64)

# ── 腾讯云镜像仓库配置 ────────────────────────────────────
readonly TCR_REGISTRY="ccr.ccs.tencentyun.com"
readonly TCR_NAMESPACE="spark_ai"

set -euo pipefail

# ── 颜色输出 ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_step()  { echo -e "${CYAN}[STEP]${NC} $*"; }

# ── 环境变量检查 ──────────────────────────────────────────
require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    log_error "缺少环境变量: ${name}"
    exit 1
  fi
}

# ── 确定镜像标签 ─────────────────────────────────────────
resolve_image_tag() {
  if [[ -n "${IMAGE_TAG:-}" ]]; then
    echo "${IMAGE_TAG}"
  elif git rev-parse --short HEAD &>/dev/null; then
    echo "$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
  else
    echo "$(date +%Y%m%d%H%M%S)"
  fi
}

# ── 构建并推送镜像 ────────────────────────────────────────
build_and_push_image() {
  local image_name="$1"
  local dockerfile="$2"
  local context="$3"

  if [[ ! -f "${dockerfile}" ]]; then
    log_error "Dockerfile 不存在: ${dockerfile}"
    exit 1
  fi
  if [[ ! -d "${context}" ]]; then
    log_error "构建上下文目录不存在: ${context}"
    exit 1
  fi

  local build_only="${BUILD_ONLY:-false}"
  local push_latest="${PUSH_LATEST:-true}"
  local target_platform="${TARGET_PLATFORM:-linux/amd64}"
  local image_tag
  image_tag="$(resolve_image_tag)"

  local local_tag="${image_name}:${image_tag}"

  echo ""
  log_info "==========================================="
  log_info " 镜像: ${image_name}"
  log_info " 标签: ${image_tag}"
  log_info " Dockerfile: ${dockerfile}"
  log_info " 上下文: ${context}"
  log_info " 平台: ${target_platform}"
  if [[ "${build_only}" != "true" ]]; then
    log_info " 仓库: ${TCR_REGISTRY}/${TCR_NAMESPACE}"
  fi
  log_info "==========================================="
  echo ""

  export DOCKER_BUILDKIT=1

  local start_time
  start_time="$(date +%s)"

  log_step "开始构建镜像..."
  if ! docker build --platform "${target_platform}" -f "${dockerfile}" -t "${local_tag}" "${context}"; then
    log_error "镜像构建失败: ${image_name}"
    exit 1
  fi

  local build_end_time
  build_end_time="$(date +%s)"
  local build_duration=$((build_end_time - start_time))
  log_info "构建完成，耗时 ${build_duration}s"

  if [[ "${build_only}" == "true" ]]; then
    log_info "BUILD_ONLY 模式，跳过推送"
    log_info "本地镜像: ${local_tag}"
    return 0
  fi

  local remote_uri="${TCR_REGISTRY}/${TCR_NAMESPACE}/${image_name}:${image_tag}"
  log_step "推送镜像: ${remote_uri}"
  docker tag "${local_tag}" "${remote_uri}"
  docker push "${remote_uri}"

  if [[ "${push_latest}" == "true" ]]; then
    local latest_uri="${TCR_REGISTRY}/${TCR_NAMESPACE}/${image_name}:latest"
    log_step "推送 latest 标签: ${latest_uri}"
    docker tag "${local_tag}" "${latest_uri}"
    docker push "${latest_uri}"
  fi

  local end_time
  end_time="$(date +%s)"
  local total_duration=$((end_time - start_time))
  log_info "全部完成，总耗时 ${total_duration}s"
  echo ""
}
