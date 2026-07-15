import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, readdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const nodeRequire = createRequire(__filename)
const emojilibJsonPath = resolve(
  dirname(nodeRequire.resolve('@lobehub/emojilib/package.json')),
  'index.json',
)

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

function copyRuntimeToolsPlugin() {
  return {
    name: 'copy-runtime-tools',
    closeBundle() {
      const srcDir = resolve(__dirname, '../../packages/agent-runtime/src/tools')
      const destDir = resolve(__dirname, 'out/main/tools')
      mkdirSync(destDir, { recursive: true })
      for (const file of readdirSync(srcDir)) {
        if (file.endsWith('.mjs')) {
          copyFileSync(resolve(srcDir, file), resolve(destDir, file))
        }
      }
    },
  }
}

/**
 * dropWoffPlugin — 从 renderer 产物中剔除 .woff（保留 .woff2）。
 * Electron(Chromium) 完整支持 woff2，woff 仅为古旧浏览器回退，纯冗余。
 * HarmonyOS Sans SC 的 woff 约 32MB。
 */
function dropWoffPlugin() {
  return {
    name: 'drop-woff',
    apply: 'build' as const,
    enforce: 'post' as const,
    generateBundle(
      _options: unknown,
      bundle: Record<string, { type: string; source?: unknown; fileName: string }>,
    ) {
      for (const [key, asset] of Object.entries(bundle)) {
        // 1. 删除 .woff 资源文件（保留 .woff2）
        if (asset.fileName.endsWith('.woff')) {
          delete bundle[key]
          continue
        }
        // 2. 从 CSS 中移除指向 .woff 的 @font-face src 片段
        if (
          asset.type === 'asset' &&
          asset.fileName.endsWith('.css') &&
          typeof asset.source === 'string'
        ) {
          asset.source = asset.source.replace(
            /url\([^)]+\.woff\)\s*format\(["']woff["']\)\s*,?\s*/g,
            '',
          )
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
      copyRuntimeToolsPlugin(),
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
          'background-maintenance-worker': resolve(
            __dirname,
            'src/main/workers/background-maintenance.worker.ts',
          ),
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
    // exceljs / mammoth 都是 CJS 包，在 renderer（浏览器上下文）动态 import 需预打包，
    // 否则首次加载会因 CJS/ESM interop 报错。仅在画布拖入富文档时懒加载，不进初始 bundle。
    optimizeDeps: {
      include: ['exceljs', 'mammoth'],
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@': resolve('src/renderer'),
        // @lobehub/emojilib 的 index.js 是 CJS shim（用 __dirname + fs.readFileSync 读 index.json），
        // 浏览器无 __dirname / fs，会抛 "ReferenceError: __dirname is not defined"。
        // alias 直接指向 JSON —— Vite 原生支持 JSON import，等价于 emojilib 想导出的对象。
        '@lobehub/emojilib': emojilibJsonPath,
      },
    },
    plugins: [react(), tailwindcss(), dropWoffPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})
