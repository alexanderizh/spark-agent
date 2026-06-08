FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY dist/ ./dist/

EXPOSE 7001

CMD ["node", "dist/index.js"]
