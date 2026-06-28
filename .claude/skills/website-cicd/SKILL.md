---
name: website-cicd
description: 官网(spark-agent apps/website, Vite+React 静态 SPA)的完整 CICD 流程。在 WSL/Linux 克隆代码→装依赖→vite build→多阶段 Docker 构建→推送腾讯云镜像仓库(ccr.ccs.tencentyun.com)→SSH 部署到云服务器→验证。当用户说"打包官网/部署官网/发布官网/更新线上官网/重新部署官网/推腾讯云镜像/cicd 发布/官网发版"时，务必使用本技能。assets/ 含已验证的 Dockerfile 与 nginx.conf，scripts/ 含参数化部署脚本。
---

# 官网 CICD：打包 → 推腾讯云 → 部署云服务器

把 `spark-agent` 仓库的官网 (`apps/website`，纯静态 Vite SPA) 打包成 Docker 镜像，推到腾讯云镜像仓库，再 SSH 部署到云服务器。本技能是 2026-06-28 实跑验证过的流程，配套资产在 `assets/` 与 `scripts/`。

## 为什么用这套流程（关键背景，避免踩坑）

1. **官网 `@spark/website` 无任何 `workspace:*` 依赖**（只依赖 react/vite/typescript/lucide-react）。所以**不要全量 `pnpm install` 整个 monorepo**——那会触发 desktop 的 electron/better-sqlite3/node-pty 原生依赖地雷。只在 `apps/website` 单独装即可。
2. **官网无 react-router**，App.tsx 是手写 `pathname → 组件` 路由表。因此 nginx **必须配 SPA fallback** (`try_files $uri $uri/ /index.html`)，否则刷新 `/features` 等子路径会 404。
3. **架构必须 linux/amd64**（云服务器是 x86）。本机若是 Windows，用 WSL 内的 docker（Docker Desktop 开启 WSL 集成后，WSL 里 `docker` 即 linux/amd64），不要用 Windows 容器。
4. **跨平台 native binding 坑**：Windows 装的 `node_modules` 含 win32 的 rollup/esbuild binding，直接拿到 WSL 跑 vite build 会报缺 `@rollup/rollup-linux-x64-gnu`。解法是**在 WSL 里全新 clone 一份代码并装依赖**（Linux 原生 binding），或在 Docker 多阶段构建的容器内 build。本技能用多阶段 Docker 构建（自包含，不依赖宿主）。

## 前置条件（凭据来自注入环境变量，绝不打印明文）

| 变量 | 用途 |
|------|------|
| `workspace` | 腾讯云镜像仓库命名空间 |
| `docker_id` / `docker_pwd` | 腾讯云镜像仓库账号/密码 |
| `server_ip` / `server_id` / `server_pwd` | 目标云服务器 |

本机要求：WSL(Ubuntu) + Docker Desktop(开启 WSL 集成) + `sshpass`（`sudo apt install -y sshpass`）。

## 关键约定

- **镜像**：`ccr.ccs.tencentyun.com/<workspace>/spark-website:<YYYYMMDD>-<commit短哈希>`，同时打 `:latest`
- **容器名**：`spark-website`（只动它，绝不碰 `prod-edu-*` 等其他业务容器）
- **端口**：宿主 `38090` → 容器 `80`（服务器 80 被 1Panel openresty 占用）
- **仓库域名**：`ccr.ccs.tencentyun.com`（腾讯云个人版）

## 凭据透传技巧（复用，避免明文进命令行）

Git Bash 里 `export WSLENV` 把变量透传进 WSL 子进程；`docker login` 用 `--password-stdin` 从 stdin 读密码：

```bash
export WSLENV="workspace/u:docker_id/u:docker_pwd/u:server_ip/u:server_id/u:server_pwd/u"
wsl bash -s <<'WEOF'
# 这里的 $workspace $docker_id 等由 WSLENV 注入
echo "$docker_pwd" | docker login ccr.ccs.tencentyun.com -u "$docker_id" --password-stdin
WEOF
```

> 注意：`wsl bash -lc '多行命令'` 的单引号多行脚本在 Git Bash→wsl.exe 传递时变量会丢失（实测 `$D`、`$workspace` 全空）。**一律用 `wsl bash -s <<'WEOF'` heredoc 从 stdin 喂脚本**。

## 完整流程

### 步骤 1：WSL 内克隆 + 确认可构建（可选，验证源码）

```bash
wsl bash -s <<'WEOF'
cd ~ && rm -rf spark-agent-deploy
git clone --branch develop --single-branch https://github.com/alexanderizh/spark-agent.git spark-agent-deploy
cd spark-agent-deploy/apps/website
pnpm install --ignore-workspace   # 只装 website 自身依赖，避开 monorepo 地雷
pnpm build                         # tsc --noEmit && vite build → dist/
ls -la dist/ && du -sh dist/
WEOF
```

> 仅验证源码可构建。真正进镜像的构建由步骤 2 的多阶段 Docker 完成，不依赖这里的 dist。

### 步骤 2：拷入 Docker 资产 + 多阶段构建

把 `assets/Dockerfile`、`assets/nginx.conf`、`assets/.dockerignore` 拷到 `apps/website/`，然后构建：

```bash
export WSLENV="workspace/u"
wsl bash -s <<'WEOF'
NS="${workspace:-}"
D=~/spark-agent-deploy/apps/website
# 拷资产（assets 来自本技能目录，路径按实际技能安装位置调整）
cp <skill-path>/assets/Dockerfile "$D/Dockerfile"
cp <skill-path>/assets/nginx.conf "$D/nginx.conf"
cp <skill-path>/assets/.dockerignore "$D/.dockerignore"
cd ~/spark-agent-deploy
COMMIT=$(git rev-parse --short HEAD)
TAG="$(date +%Y%m%d)-${COMMIT}"
IMAGE="ccr.ccs.tencentyun.com/${NS}/spark-website"
docker build -f apps/website/Dockerfile -t "${IMAGE}:${TAG}" -t "${IMAGE}:latest" apps/website
docker images | grep spark-website
WEOF
```

`assets/Dockerfile` 是多阶段：`node:22-alpine` 阶段 `corepack prepare pnpm@10.32.1` + install + `pnpm build`；`nginx:1.27-alpine` 阶段托管 `dist/` + 自带 healthcheck。

### 步骤 3：登录腾讯云 + 推送

```bash
export WSLENV="workspace/u:docker_id/u:docker_pwd/u"
wsl bash -s <<'WEOF'
REG="ccr.ccs.tencentyun.com"; NS="${workspace}"
echo "$docker_pwd" | docker login "$REG" -u "$docker_id" --password-stdin
cd ~/spark-agent-deploy
COMMIT=$(git rev-parse --short HEAD); TAG="$(date +%Y%m%d)-${COMMIT}"
IMAGE="${REG}/${NS}/spark-website"
docker push "${IMAGE}:${TAG}"
docker push "${IMAGE}:latest"
WEOF
```

### 步骤 4：SSH 部署到云服务器

```bash
export WSLENV="server_ip/u:server_id/u:server_pwd/u"
wsl bash -s <<'OUTER'
sshpass -p "$server_pwd" ssh -o StrictHostKeyChecking=no "$server_id@$server_ip" 'bash -s' <<'REMOTE'
IMAGE="ccr.ccs.tencentyun.com/spark_ai/spark-website:latest"  # namespace 按实际 workspace
# 拉取（服务器通常已 docker login 过腾讯云，root config 有 credentials）
sudo docker pull "$IMAGE"
# 替换旧容器（防御性，只动 spark-website）
sudo docker rm -f spark-website 2>/dev/null || true
sudo docker run -d --name spark-website --restart unless-stopped -p 38090:80 "$IMAGE"
sleep 4
sudo docker ps --filter name=spark-website --format "{{.Names}} | {{.Status}} | {{.Ports}}"
sudo docker inspect --format '{{.State.Health.Status}}' spark-website
curl -sI http://127.0.0.1:38090/ | head -4
curl -s http://127.0.0.1:38090/ | grep -oE '<title>[^<]*</title>' | head -1
REMOTE
OUTER
```

> 若服务器 pull 报未授权，需先在服务器 `docker login`（凭据同样用 `--password-stdin`）。

### 步骤 5：放行外网（两层都要，否则外网访问不了）

容器 healthy + 内网 200 后，外网仍可能不通——云服务器有**两层防火墙**：

1. **服务器 ufw**（本技能可改）：`sudo ufw allow 38090/tcp comment "spark-website"`。不动 22，可回滚 `sudo ufw delete allow 38090/tcp`。
2. **腾讯云安全组**（云网络层，**Agent 无 API 凭据改不了，必须让用户去控制台操作**）：腾讯云控制台 → 云服务器 → 实例 → 安全组 → 入站规则 → 加 `TCP:38090` 来源 `0.0.0.0/0` 允许。

验证：`curl -sI http://<server_ip>:38090/` 应返回 `200 OK`。

## 安全红线（运维助手通用纪律）

- **凭据**：一律 WSLENV 透传 + `--password-stdin`，绝不写进命令行 argv 或回复正文。
- **写操作确认**：`docker run`/`ufw allow`/`docker rm` 执行前向用户说明影响范围与回滚方式。
- **只动 spark-website 容器**：绝不 `docker rm`/stop `prod-edu-*`、`1panel-*`、`mysql`、`redis` 等其他业务容器。
- **改防火墙**：`ufw allow` 是开新端口、不影响 SSH、可回滚，属部署收尾可直接做；但若涉及 `iptables -F`/改 sshd，必须先开备用会话 + 留备份。

## 回滚

| 场景 | 操作 |
|------|------|
| 新版本有问题 | `docker run` 旧 tag 替换（腾讯云仓库保留历史 tag） |
| 容器异常 | `sudo docker logs spark-website` 排查 |
| 不想暴露端口 | `sudo ufw delete allow 38090/tcp` |
| 完全清理 | `sudo docker rm -f spark-website`（镜像保留在腾讯云仓库） |

## 一键脚本

`scripts/deploy-website.sh` 封装了步骤 2-5（接受 namespace/端口/tag 参数）。可直接 `wsl bash deploy-website.sh` 调用，或作为参考按步骤手动执行（推荐手动，便于每步确认）。
