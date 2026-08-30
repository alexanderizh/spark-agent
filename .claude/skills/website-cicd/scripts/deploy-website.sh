#!/usr/bin/env bash
#==============================================================
# Spark Agent 官网 CICD 部署脚本（在 WSL/Linux 内执行）
# 配套技能: website-cicd
#
# 用法:
#   export WSLENV="workspace/u:docker_id/u:docker_pwd/u:server_ip/u:server_id/u:server_pwd/u"
#   bash deploy-website.sh <stage>
#
#   stage:
#     clone-build  克隆 develop + 拷资产 + 多阶段 docker build
#     push         登录腾讯云 + 推送 :<tag> 与 :latest
#     deploy       SSH 拉取镜像并启动/替换 spark-website 容器
#     firewall     服务器 ufw 放行端口（腾讯云安全组仍需用户控制台操作）
#     verify       外网 curl 探活
#     all          依次执行上述全部
#
# 注意: 本脚本由技能提供，如在 WSL 执行报 "\r" 相关错误，
#       先运行 `sed -i 's/\r$//' deploy-website.sh` 去掉 CRLF。
#==============================================================
set -uo pipefail

# ---- 可配置参数（环境变量覆盖）----
REGISTRY="${REGISTRY:-ccr.ccs.tencentyun.com}"
NAMESPACE="${workspace:-spark_ai}"          # 腾讯云镜像仓库命名空间
REPO="${REPO:-spark-website}"
HOST_PORT="${HOST_PORT:-38090}"             # 宿主机端口 -> 容器 80
CONTAINER="${CONTAINER:-spark-website}"
BRANCH="${BRANCH:-develop}"
GIT_URL="${GIT_URL:-https://github.com/alexanderizh/spark-agent.git}"
SRC_DIR="${SRC_DIR:-$HOME/spark-agent-deploy}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSETS_DIR="${ASSETS_DIR:-$SCRIPT_DIR/../assets}"

# 自建版本中心 API 基地址（vite build 时烘进 bundle；运行时浏览器读同名变量）。
# 留空 = 浏览器走 window.location.origin（需要官网 nginx 已把 /api/v1/* 反代到 edu-server）。
# 跨域部署可填完整 URL，如 https://spark.yiqibyte.com 或 http://1.14.159.152:37002
VITE_RELEASES_API_BASE="${VITE_RELEASES_API_BASE:-}"

IMAGE="${REGISTRY}/${NAMESPACE}/${REPO}"
TAG_FILE="/tmp/website-cicd-tag.txt"

log(){ printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
die(){ printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

require_env(){
  local missing=()
  for v in "$@"; do
    [ -z "${!v:-}" ] && missing+=("$v")
  done
  [ ${#missing[@]} -gt 0 ] && die "缺少环境变量: ${missing[*]}（请用 WSLENV 注入）"
}

# ---- 1. 克隆 + 多阶段构建 ----
do_clone_build(){
  log "克隆 ${BRANCH} 分支到 ${SRC_DIR}"
  rm -rf "$SRC_DIR"
  git clone --branch "$BRANCH" --single-branch "$GIT_URL" "$SRC_DIR" || die "克隆失败"
  cd "$SRC_DIR" || die "进入目录失败"
  local commit; commit=$(git rev-parse --short HEAD)
  log "commit=${commit}"

  [ -f "$ASSETS_DIR/Dockerfile" ] || die "找不到资产目录: $ASSETS_DIR"
  log "拷贝 Docker 资产到 apps/website"
  cp "$ASSETS_DIR/Dockerfile"   apps/website/Dockerfile
  cp "$ASSETS_DIR/nginx.conf"   apps/website/nginx.conf
  cp "$ASSETS_DIR/.dockerignore" apps/website/.dockerignore

  local tag; tag="$(date +%Y%m%d)-${commit}"
  log "多阶段构建 ${IMAGE}:${tag}（VITE_RELEASES_API_BASE='${VITE_RELEASES_API_BASE}'）"
  docker build -f apps/website/Dockerfile \
    --build-arg "VITE_RELEASES_API_BASE=${VITE_RELEASES_API_BASE}" \
    -t "${IMAGE}:${tag}" -t "${IMAGE}:latest" apps/website || die "构建失败"
  docker images | grep "${REPO}"
  echo "$tag" > "$TAG_FILE"
}

# ---- 2. 登录腾讯云 + 推送 ----
do_push(){
  require_env docker_id docker_pwd
  local tag; tag="$(cat "$TAG_FILE" 2>/dev/null || echo latest)"
  log "登录 ${REGISTRY}"
  echo "$docker_pwd" | docker login "$REGISTRY" -u "$docker_id" --password-stdin || die "登录失败"
  log "推送 ${IMAGE}:${tag} 与 :latest"
  docker push "${IMAGE}:${tag}"    || die "推送 tag 失败"
  docker push "${IMAGE}:latest"    || die "推送 latest 失败"
}

# ---- 3. SSH 部署（pull + run + 探活）----
do_deploy(){
  require_env server_ip server_id server_pwd
  log "SSH 部署到 ${server_ip}（端口 ${HOST_PORT} -> 80）"
  sshpass -p "$server_pwd" ssh -o StrictHostKeyChecking=no \
    "${server_id}@${server_ip}" \
    "IMAGE='${IMAGE}:latest' PORT='${HOST_PORT}' NAME='${CONTAINER}' bash -s" <<'REMOTE'
set -e
echo "拉取镜像..."
sudo docker pull "$IMAGE" || { echo "PULL 失败，服务器可能未 login 腾讯云"; exit 1; }
echo "替换旧容器（只动 $NAME）..."
sudo docker rm -f "$NAME" 2>/dev/null || true
sudo docker run -d --name "$NAME" --restart unless-stopped -p "${PORT}:80" "$IMAGE"
sleep 4
echo "状态:"
sudo docker ps --filter name="$NAME" --format "{{.Names}} | {{.Status}} | {{.Ports}}"
echo "health: $(sudo docker inspect --format '{{.State.Health.Status}}' "$NAME")"
echo "内网探活:"
curl -sI "http://127.0.0.1:${PORT}/" | head -4
curl -s "http://127.0.0.1:${PORT}/" | grep -oE '<title>[^<]*</title>' | head -1
REMOTE
}

# ---- 4. 服务器 ufw 放行（腾讯云安全组仍需用户控制台操作）----
do_open_firewall(){
  require_env server_ip server_id server_pwd
  log "服务器 ufw 放行 ${HOST_PORT}/tcp"
  sshpass -p "$server_pwd" ssh -o StrictHostKeyChecking=no \
    "${server_id}@${server_ip}" \
    "sudo ufw allow ${HOST_PORT}/tcp comment 'spark-website' && sudo ufw status | grep ${HOST_PORT}"
  log "⚠️ 还需在【腾讯云控制台 → 安全组 → 入站规则】放行 TCP ${HOST_PORT}（Agent 无 API 凭据，需用户操作）"
}

# ---- 5. 外网验证 ----
do_verify(){
  require_env server_ip
  log "外网验证 http://${server_ip}:${HOST_PORT}/"
  curl -sI --connect-timeout 8 "http://${server_ip}:${HOST_PORT}/" | head -6 \
    || die "外网访问失败：确认 ufw + 腾讯云安全组均已放行 ${HOST_PORT}"
}

case "${1:-all}" in
  clone-build|build) do_clone_build ;;
  push)              do_push ;;
  deploy)            do_deploy ;;
  firewall)          do_open_firewall ;;
  verify)            do_verify ;;
  all)               do_clone_build && do_push && do_deploy && do_open_firewall && do_verify ;;
  *) echo "用法: bash $0 <clone-build|push|deploy|firewall|verify|all>"; exit 1 ;;
esac
log "阶段 [$1] 完成"
