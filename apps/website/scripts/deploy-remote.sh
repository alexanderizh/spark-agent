#!/usr/bin/env bash
#==============================================================
# Spark Agent 官网：SSH 拉取镜像并替换 spark-website 容器
# 供 GitHub Actions 或本地 CI 调用。
#
# 必需环境变量:
#   WEBSITE_SERVER_HOST / WEBSITE_SERVER_USER
#   WEBSITE_SERVER_PASSWORD  或  WEBSITE_SSH_KEY（私钥 PEM 内容）
#
# 可选:
#   REGISTRY                 默认 ccr.ccs.tencentyun.com
#   WEBSITE_DOCKER_NAMESPACE 默认 spark_ai
#   REPO                     默认 spark-website
#   WEBSITE_HOST_PORT        默认 38090
#   CONTAINER                默认 spark-website
#   IMAGE_TAG                默认 latest
#==============================================================
set -euo pipefail

REGISTRY="${REGISTRY:-ccr.ccs.tencentyun.com}"
NAMESPACE="${WEBSITE_DOCKER_NAMESPACE:-spark_ai}"
REPO="${REPO:-spark-website}"
HOST_PORT="${WEBSITE_HOST_PORT:-38090}"
CONTAINER="${CONTAINER:-spark-website}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE="${REGISTRY}/${NAMESPACE}/${REPO}:${IMAGE_TAG}"

log(){ printf '[deploy-remote] %s\n' "$*"; }
die(){ printf '[deploy-remote][ERROR] %s\n' "$*" >&2; exit 1; }

[ -n "${WEBSITE_SERVER_HOST:-}" ] || die "缺少 WEBSITE_SERVER_HOST"
[ -n "${WEBSITE_SERVER_USER:-}" ] || die "缺少 WEBSITE_SERVER_USER"
[ -n "${WEBSITE_SERVER_PASSWORD:-}${WEBSITE_SSH_KEY:-}" ] || die "缺少 WEBSITE_SERVER_PASSWORD 或 WEBSITE_SSH_KEY"

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
REMOTE_SCRIPT="$(cat <<'REMOTE'
set -e
echo "拉取镜像: ${IMAGE}"
sudo docker pull "${IMAGE}" || { echo "PULL 失败，服务器可能未 login 腾讯云"; exit 1; }
echo "替换旧容器（只动 ${CONTAINER}）..."
sudo docker rm -f "${CONTAINER}" 2>/dev/null || true
sudo docker run -d --name "${CONTAINER}" --restart unless-stopped -p "${HOST_PORT}:80" "${IMAGE}"
sleep 4
sudo docker ps --filter "name=${CONTAINER}" --format "{{.Names}} | {{.Status}} | {{.Ports}}"
echo "health: $(sudo docker inspect --format '{{.State.Health.Status}}' "${CONTAINER}")"
curl -sI "http://127.0.0.1:${HOST_PORT}/" | head -4
curl -s "http://127.0.0.1:${HOST_PORT}/" | grep -oE '<title>[^<]*</title>' | head -1
REMOTE
)"

run_ssh(){
  if [ -n "${WEBSITE_SSH_KEY:-}" ]; then
    local key_file
    key_file="$(mktemp)"
    trap 'rm -f "$key_file"' EXIT
    printf '%s\n' "$WEBSITE_SSH_KEY" > "$key_file"
    chmod 600 "$key_file"
    ssh "${SSH_OPTS[@]}" -i "$key_file" "${WEBSITE_SERVER_USER}@${WEBSITE_SERVER_HOST}" "$@"
  else
    if ! command -v sshpass >/dev/null 2>&1; then
      die "未设置 WEBSITE_SSH_KEY 且本机无 sshpass，无法使用密码登录"
    fi
    SSHPASS="$WEBSITE_SERVER_PASSWORD" sshpass -e ssh "${SSH_OPTS[@]}" \
      "${WEBSITE_SERVER_USER}@${WEBSITE_SERVER_HOST}" "$@"
  fi
}

log "部署 ${IMAGE} 到 ${WEBSITE_SERVER_USER}@${WEBSITE_SERVER_HOST}:${HOST_PORT}"
run_ssh "IMAGE='${IMAGE}' HOST_PORT='${HOST_PORT}' CONTAINER='${CONTAINER}' bash -s" <<< "$REMOTE_SCRIPT"
log "部署完成"
