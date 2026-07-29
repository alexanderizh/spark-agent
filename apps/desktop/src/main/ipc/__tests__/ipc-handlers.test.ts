/**
 * IPC Handler 注册完整性测试
 *
 * 验证 IpcChannelMap 中定义的每个 channel 都在 main 进程某处有对应 handler。
 * 不依赖 Electron 运行时，直接静态分析注册代码。
 *
 * 扫描范围：main/ipc/ + main/services/，排除 __tests__ 子目录和 *.test.ts。
 * 这样 registerTerminalIpc.ts / registerAuthIpc.ts 这类拆分出来的注册文件都能被覆盖到。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const PROTOCOL_DIR = join(__dirname, '../../../../../../packages/protocol/src')
const MAIN_IPC_DIR = join(__dirname, '..')
const MAIN_SERVICES_DIR = join(__dirname, '../../services')

function readAllTsUnder(dir: string): string {
  let out = ''
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out += readAllTsUnder(full)
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out += readFileSync(full, 'utf-8') + '\n'
    }
  }
  return out
}

function extractIpcMapChannels(src: string): string[] {
  const matches = src.matchAll(/^\s*'([a-z][a-z-]*(?::[a-z][a-z-]*)+)'\s*:\s*\[/gm)
  return [...new Set([...matches].flatMap((match) => (match[1] === undefined ? [] : [match[1]])))]
}

function extractRegisteredChannels(src: string): string[] {
  const matches = src.match(/'[a-z][a-z-]*(?::[a-z][a-z-]*)+'/g) ?? []
  return [...new Set(matches.map((match) => match.slice(1, -1)))]
}

describe('IPC handler registration completeness', () => {
  const protocolSrc = readAllTsUnder(PROTOCOL_DIR)
  // 拼接：main/ipc 与 main/services（很多 register*.ts 在 services 目录下）
  const handlerSrc = readAllTsUnder(MAIN_IPC_DIR) + '\n' + readAllTsUnder(MAIN_SERVICES_DIR)

  // IPC map interfaces are split across protocol modules and joined via declaration merging.
  const definedChannels = extractIpcMapChannels(protocolSrc)

  // Extract channels registered via typedIpcHandle in handlers
  const registeredChannels = extractRegisteredChannels(handlerSrc)

  it('IpcChannelMap has at least 27 channels', () => {
    expect(definedChannels.length).toBeGreaterThanOrEqual(27)
  })

  it('every channel in IpcChannelMap has a registered handler', () => {
    const missing = definedChannels.filter((ch) => !registeredChannels.includes(ch))
    expect(missing, `Missing handlers for: ${missing.join(', ')}`).toHaveLength(0)
  })

  it('all expected namespaces are covered', () => {
    const namespaces = [...new Set(definedChannels.map((ch) => ch.split(':')[0]))]
    expect(namespaces.sort()).toEqual(
      [
        'agent',
        'app',
        'app-snapshot',
        'auth',
        'binary',
        'board',
        'browser',
        'canvas',
        'clipboard',
        'command',
        'computer-use',
        'context',
        'dialog',
        'env',
        'env-config',
        'ffmpeg',
        'file',
        'font-assets',
        'github-connector',
        'history-import',
        'hook',
        'log',
        'mcp',
        'memory',
        'model',
        'permission',
        'platform-model',
        'playwright',
        'prompt-config',
        'provider',
        'remote',
        'rules',
        'scheduled-task',
        'sdk',
        'session',
        'settings',
        'sidebar-order',
        'skill',
        'skill-config',
        'skill-registry',
        'task-execution',
        'team',
        'terminal',
        'tool',
        'update',
        'usage',
        'video',
        'voice',
        'window',
        'workflow',
        'workspace',
      ].sort(),
    )
  })
})
