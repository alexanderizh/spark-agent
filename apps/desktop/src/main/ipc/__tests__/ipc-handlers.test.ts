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

const PROTOCOL_IPC = join(__dirname, '../../../../../../packages/protocol/src/ipc/index.ts')
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

function extractChannels(src: string): string[] {
  const matches = src.match(/'[a-z]+:[a-z-]+'/g) ?? []
  return [...new Set(matches.map((m) => m.slice(1, -1)))]
}

describe('IPC handler registration completeness', () => {
  const protocolSrc = readFileSync(PROTOCOL_IPC, 'utf-8')
  // 拼接：main/ipc 与 main/services（很多 register*.ts 在 services 目录下）
  const handlerSrc = readAllTsUnder(MAIN_IPC_DIR) + '\n' + readAllTsUnder(MAIN_SERVICES_DIR)

  // Extract channels defined in IpcChannelMap
  const mapBlock = protocolSrc.slice(
    protocolSrc.indexOf('export interface IpcChannelMap {'),
    protocolSrc.indexOf('\n}', protocolSrc.indexOf('export interface IpcChannelMap {')),
  )
  const definedChannels = extractChannels(mapBlock)

  // Extract channels registered via typedIpcHandle in handlers
  const registeredChannels = extractChannels(handlerSrc)

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
        'auth',
        'board',
        'browser',
        'canvas',
        'clipboard',
        'command',
        'context',
        'dialog',
        'env',
        'file',
        'hook',
        'log',
        'mcp',
        'memory',
        'model',
        'permission',
        'playwright',
        'provider',
        'remote',
        'rules',
        'sdk',
        'session',
        'settings',
        'skill',
        'team',
        'terminal',
        'tool',
        'update',
        'usage',
        'window',
        'workflow',
        'workspace',
      ].sort(),
    )
  })
})
