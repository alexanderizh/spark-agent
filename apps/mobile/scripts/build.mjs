#!/usr/bin/env node
/**
 * apps/mobile 构建脚本
 *
 * 小程序没有框架级构建器（原生 + TypeScript），本脚本负责：
 *   1. tsc 编译 src 下全部 TS → dist/（CommonJS，小程序运行时直接跑）
 *   2. 拷贝静态资产（.wxml / .wxss / .json / 图片）→ dist/
 *   3. 生成 src/config.json（服务端地址，构建期可用环境变量覆盖）：
 *        SPARK_EDUGEN_BASE_URL  默认 https://www.yiqibyte.com
 *      tsc 以 resolveJsonModule 将其静态内联，产物无运行时动态依赖。
 *
 * 用法：
 *   node scripts/build.mjs           一次性构建
 *   node scripts/build.mjs --watch   监听模式（tsc --watch + 静态资产变更拷贝）
 */

import { execSync, spawn } from 'node:child_process'
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { existsSync, watch } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')
const distDir = join(root, 'dist')

const STATIC_EXTS = new Set(['.wxml', '.wxss', '.json', '.png', '.jpg', '.jpeg', '.svg', '.gif'])

function isStaticAsset(name) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 && STATIC_EXTS.has(name.slice(dot))
}

async function walk(dir) {
  const entries = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      entries.push(...(await walk(full)))
    } else if (isStaticAsset(entry.name)) {
      entries.push(full)
    }
  }
  return entries
}

async function copyStaticAssets() {
  if (!existsSync(srcDir)) return 0
  const files = await walk(srcDir)
  for (const file of files) {
    const target = join(distDir, relative(srcDir, file))
    await mkdir(dirname(target), { recursive: true })
    await cp(file, target)
  }
  return files.length
}

/**
 * 运行时配置：服务端地址等。
 * 桌面端默认 https://www.yiqibyte.com（见 apps/desktop/src/main/index.ts），
 * 移动端保持一致；本地/测试环境可用环境变量覆盖：
 *   SPARK_EDUGEN_BASE_URL=http://192.168.x.x:7001 node scripts/build.mjs
 *
 * 写成 **TS 模块** 而不是 JSON：小程序的 require 会自动补 `.js` 后缀，
 * `require('./config.json')` 会去找 `config.json.js` 并报 module not defined。
 */
async function buildRuntimeConfig() {
  const baseUrl = (process.env.SPARK_EDUGEN_BASE_URL || 'https://www.yiqibyte.com').replace(
    /\/+$/,
    '',
  )
  const config = {
    baseUrl,
    /** 与 edu-server 的全局前缀保持一致（EduServerClient.resolveUrl） */
    apiPrefix: '/api/v1',
  }
  const content = `/**
 * 运行时配置 —— 由 scripts/build.mjs 在构建期生成，请勿手工修改。
 *
 * 为什么是 .ts 而不是 .json：
 *   小程序不支持 require('./config.json') —— 它的 require 会自动补 .js 后缀，
 *   去找 config.json.js，于是报
 *   "module 'config.json.js' is not defined, require args is './config.json'"。
 *   所以构建期把配置写成 TS 模块，编译成 require('./config.generated') 才可用。
 *
 * 覆盖方式：SPARK_EDUGEN_BASE_URL=http://192.168.x.x:7001 node scripts/build.mjs
 */

export const RUNTIME_CONFIG = ${JSON.stringify(config, null, 2)} as const
`
  await writeFile(join(srcDir, 'config.generated.ts'), content, 'utf8')
  return config
}

async function build() {
  await mkdir(distDir, { recursive: true })
  await buildRuntimeConfig()
  execSync(join(root, 'node_modules', '.bin', 'tsc') + ' -p tsconfig.json', {
    stdio: 'inherit',
    cwd: root,
  })
  const config = await buildRuntimeConfig()
  const copied = await copyStaticAssets()
  console.log(`[mobile] runtime config: baseUrl=${config.baseUrl} apiPrefix=${config.apiPrefix}`)
  console.log(`[mobile] static assets copied: ${copied}`)
  if (!existsSync(join(distDir, 'app.js'))) {
    throw new Error('dist/app.js 未生成，请检查 tsc 输出')
  }
  console.log('[mobile] build ok → dist/')
}

async function watchMode() {
  await mkdir(distDir, { recursive: true })
  await buildRuntimeConfig()
  await copyStaticAssets()
  console.log('[mobile] initial config/assets ready, starting tsc --watch')
  const tsc = spawn(join(root, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json', '--watch'], {
    stdio: 'inherit',
    cwd: root,
  })

  let timer = null
  // 注意：必须用 node:fs 的回调版 watch —— fs/promises 的 watch() 返回 AsyncIterable，
  // 不接受 listener 参数（传了也被静默忽略），资产变更将永远不会被拷贝。
  const watcher = watch(srcDir, { recursive: true }, (_event, filename) => {
    if (!filename || !isStaticAsset(filename)) return
    clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        const n = await copyStaticAssets()
        console.log(`[mobile] static assets re-copied: ${n} (last: ${filename})`)
      } catch (error) {
        console.error('[mobile] static assets copy failed:', error)
      }
    }, 120)
  })
  watcher.on('error', (error) => {
    console.error('[mobile] watcher error:', error)
  })

  process.on('SIGINT', () => {
    tsc.kill('SIGTERM')
    process.exit(0)
  })
  await new Promise(() => {})
}

if (process.argv.includes('--watch')) {
  watchMode().catch((error) => {
    console.error('[mobile] watch error:', error)
    process.exit(1)
  })
} else {
  build().catch((error) => {
    console.error('[mobile] build error:', error)
    process.exit(1)
  })
}
