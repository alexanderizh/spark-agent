# syntax=docker/dockerfile:1
# Spark Agent 官网镜像 —— 多阶段构建（自包含，任何机器 clone 后即可 build）
# 用法: docker build -t <tag> -f apps/website/Dockerfile apps/website
#
# 说明: 官网 @spark/website 是纯静态 Vite SPA，无 workspace 依赖，
#       所以 build stage 只装 website 自身依赖即可，不碰 monorepo 其它包。

# ============ Stage 1: build 静态产物 ============
FROM node:22-alpine AS builder
WORKDIR /app
ENV CI=true
# website 无 packageManager 字段，显式激活 pnpm 版本避免 corepack 交互
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# ── Build args ──────────────────────────────────────────────────────────────
# VITE_RELEASES_API_BASE：自建版本中心 API 基地址（留空则浏览器走 window.location.origin）
ARG VITE_RELEASES_API_BASE=""
ENV VITE_RELEASES_API_BASE=$VITE_RELEASES_API_BASE
ENV RELEASES_API_BASE=$VITE_RELEASES_API_BASE

# 先拷 manifest，利用 docker layer 缓存
COPY package.json ./
RUN pnpm install --no-frozen-lockfile

# 拷源码并构建（tsc --noEmit && vite build → /app/dist）
COPY . .
RUN pnpm build

# ============ Stage 2: nginx 托管静态产物 ============
FROM nginx:1.27-alpine AS runtime
LABEL org.opencontainers.image.title="spark-website" \
      org.opencontainers.image.description="Spark Agent 官网 (nginx + 静态产物)" \
      org.opencontainers.image.source="https://github.com/alexanderizh/spark-agent"

RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]
