/**
 * IPC Handler 注册完整性测试
 *
 * 验证 IpcChannelMap 中定义的每个 channel 都在 ipc/index.ts 中有对应 handler。
 * 不依赖 Electron 运行时，直接静态分析注册代码。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const PROTOCOL_IPC = join(__dirname, '../../../../../../packages/protocol/src/ipc/index.ts')
const IPC_HANDLERS = join(__dirname, '../index.ts')

function extractChannels(src: string): string[] {
  const matches = src.match(/'[a-z]+:[a-z-]+'/g) ?? []
  return [...new Set(matches.map((m) => m.slice(1, -1)))]
}

describe('IPC handler registration completeness', () => {
  const protocolSrc = readFileSync(PROTOCOL_IPC, 'utf-8')
  const handlerSrc = readFileSync(IPC_HANDLERS, 'utf-8')

  // Extract channels defined in IpcChannelMap
  const mapBlock = protocolSrc.slice(
    protocolSrc.indexOf('export interface IpcChannelMap {'),
    protocolSrc.indexOf('\n}', protocolSrc.indexOf('export interface IpcChannelMap {')),
  )
  const definedChannels = extractChannels(mapBlock)

  // Extract channels registered via typedIpcHandle in handlers
  const registeredChannels = extractChannels(handlerSrc)

  it('IpcChannelMap has at least 19 channels', () => {
    expect(definedChannels.length).toBeGreaterThanOrEqual(19)
  })

  it('every channel in IpcChannelMap has a registered handler', () => {
    const missing = definedChannels.filter((ch) => !registeredChannels.includes(ch))
    expect(missing, `Missing handlers for: ${missing.join(', ')}`).toHaveLength(0)
  })

  it('all expected namespaces are covered', () => {
    const namespaces = [...new Set(definedChannels.map((ch) => ch.split(':')[0]))]
    expect(namespaces.sort()).toEqual(
      ['dialog', 'mcp', 'model', 'permission', 'provider', 'rules', 'session', 'skill', 'workspace'].sort(),
    )
  })
})
