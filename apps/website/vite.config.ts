import { extname } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function prerenderPreviewRoutes(): Plugin {
  return {
    name: 'spark-prerender-preview-routes',
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        const requestUrl = new URL(request.url ?? '/', 'http://localhost')
        const { pathname, search } = requestUrl
        if (pathname === '/404') {
          request.url = `/404.html${search}`
        } else if (pathname !== '/' && !pathname.endsWith('/') && !extname(pathname)) {
          request.url = `${pathname}/index.html${search}`
        }
        next()
      })
    },
  }
}

export default defineConfig(({ isPreview }) => ({
  // 生产预览必须直接读取各路由的 index.html，不能以首页做 SPA fallback；
  // 日常 dev 仍保留 SPA 模式，支持源码态深链刷新。
  appType: isPreview ? 'mpa' : 'spa',
  plugins: [react(), prerenderPreviewRoutes()],
  build: { sourcemap: true },
  // 预渲染 bundle 需把图标包一并编译，避免 Node ESM 直接解析其目录导入。
  ssr: { noExternal: true },
  server: {
    proxy: {
      '/api/v1': {
        target: 'https://spark.yiqibyte.com',
        changeOrigin: true,
      },
    },
  },
}))
