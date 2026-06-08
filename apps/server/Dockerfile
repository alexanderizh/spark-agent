# ── Stage 1: 构建 ─────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV COREPACK_ENABLE_PROJECT_SPEC=0
ENV PATH=$PNPM_HOME:$PATH
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

# 先复制 workspace 根配置 + server 的 package.json，安装依赖
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/package.json
RUN pnpm install --filter @spark/server... --frozen-lockfile

# 复制 server 源码并构建
COPY apps/server ./apps/server
WORKDIR /app/apps/server
RUN pnpm build

# ── Stage 2: 运行 ─────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata

# 只安装生产依赖
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/package.json
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate \
    && pnpm install --filter @spark/server --prod --frozen-lockfile

# 复制构建产物
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/bootstrap.js ./apps/server/bootstrap.js

WORKDIR /app/apps/server
EXPOSE 7001
CMD ["node", "./bootstrap.js"]
