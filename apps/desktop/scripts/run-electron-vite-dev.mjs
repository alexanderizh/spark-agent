/**
 * 启动 electron-vite dev，同时清除可能阻碍 Electron 正常启动的环境变量。
 *
 * 某些开发环境全局设置了 ELECTRON_RUN_AS_NODE=1（例如供 Playwright MCP /
 * Claude Agent SDK 等工具复用 Electron 的可执行文件作为 Node.js 运行时）。
 * 若该变量在 Electron 主进程启动时仍然存在，Electron 将退化为纯 Node.js
 * 进程，导致 require('electron') 返回 MODULE_NOT_FOUND。
 *
 * 此脚本在 spawn electron-vite 前主动移除该变量，确保开发模式正常启动。
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'

const require = createRequire(import.meta.url)
// electron-vite 不导出 bin/ 子路径，通过解析包主入口再拼接 bin 路径
const electronVitePkg = dirname(require.resolve('electron-vite/package.json'))
const electronViteCli = join(electronVitePkg, 'bin', 'electron-vite.js')

const CLEAR_VARS = [
  'ELECTRON_RUN_AS_NODE',
  'NODE_OPTIONS',
]

const env = { ...process.env }

let cleared = 0
for (const key of CLEAR_VARS) {
  if (key in env) {
    delete env[key]
    cleared++
  }
}

if (cleared > 0) {
  console.log(
    `[dev] 已清除 ${cleared} 个会干扰 Electron 的环境变量 (${CLEAR_VARS.filter((k) => !(k in env)).join(', ')})`,
  )
}

const child = spawn(process.execPath, [electronViteCli, 'dev'], {
  stdio: 'inherit',
  env,
})

child.on('exit', (code, signal) => {
  if (signal != null) {
    console.error(`[dev] electron-vite 被信号终止: ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
