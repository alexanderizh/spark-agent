import { resolve } from 'path'
import { copyFileSync, mkdirSync, readdirSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 将 packages/storage/migrations/*.sql 复制到 out/main/migrations/
 *
 * 原因：@spark/storage 被打包进 main bundle 后，__dirname = out/main/，
 * database.ts 的 getDefaultMigrationsDir() 会在 out/main/migrations/ 查找 SQL 文件。
 * 此插件确保每次 main process 构建时 SQL 文件都已就位。
 */
function copyMigrationsPlugin() {
  return {
    name: 'copy-migrations',
    closeBundle() {
      const srcDir = resolve(__dirname, '../../packages/storage/migrations')
      const destDir = resolve(__dirname, 'out/main/migrations')
      mkdirSync(destDir, { recursive: true })
      for (const file of readdirSync(srcDir)) {
        if (file.endsWith('.sql')) {
          copyFileSync(resolve(srcDir, file), resolve(destDir, file))
        }
      }
    },
  }
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({ exclude: ['@spark/protocol', '@spark/storage', '@spark/shared', '@spark/agent-runtime'] }),
      copyMigrationsPlugin(),
    ],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
      },
    },
    build: {
      rollupOptions: {
        // 原生模块必须保持外置，不能被 Rollup 打包
        external: ['better-sqlite3', 'keytar', '@anthropic-ai/claude-agent-sdk'],
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@spark/protocol', '@spark/storage', '@spark/shared', '@spark/agent-runtime'] })],
    resolve: {
      alias: {
        '@preload': resolve('src/preload'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@': resolve('src/renderer'),
      },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})
