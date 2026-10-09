/**
 * @module session-mcp-tooling.test
 *
 * 聚焦单测：SessionMcpTooling.buildMcpServersForSDK 的 allowedServerIds 白名单。
 *
 * 该参数是 Agent 级 MCP 按需挂载（agent-mcp-policy）的落地面，历史上仅由
 * workflow 成员路径消费、无任何单测覆盖（计划文档「补零覆盖」项）。
 */

import { describe, expect, it } from 'vitest'
import type { SparkDatabase } from '@spark/storage'
import { SessionMcpTooling } from './session-mcp-tooling.js'

interface FakeServer {
  id: string
  name: string
  scope: string
  configJson: string
  enabled: boolean
}

function makeTooling(servers: FakeServer[]): SessionMcpTooling {
  return new SessionMcpTooling({} as SparkDatabase, {
    getMcpService: () => ({ listServers: () => servers }),
    getMcpOAuthProvider: () => undefined,
  } as unknown as ConstructorParameters<typeof SessionMcpTooling>[1])
}

const stdioServer = (id: string, name: string, enabled = true): FakeServer => ({
  id,
  name,
  scope: 'user',
  configJson: JSON.stringify({
    type: 'stdio',
    command: '/bin/echo',
    args: [name],
  }),
  enabled,
})

describe('buildMcpServersForSDK allowedServerIds 白名单', () => {
  it('undefined → 全部启用 server 挂载（与历史裸调等价）', async () => {
    const tooling = makeTooling([
      stdioServer('srv-a', 'alpha'),
      stdioServer('srv-b', 'beta'),
      stdioServer('srv-c', 'gamma', false),
    ])
    const servers = await tooling.buildMcpServersForSDK()
    expect(Object.keys(servers).sort()).toEqual(['alpha', 'beta'])
  })

  it('Set → 仅挂载集合内 id 的 server（按 DB 行 id 过滤，键为 name）', async () => {
    const tooling = makeTooling([stdioServer('srv-a', 'alpha'), stdioServer('srv-b', 'beta')])
    const servers = await tooling.buildMcpServersForSDK(new Set(['srv-b']))
    expect(Object.keys(servers)).toEqual(['beta'])
  })

  it('空 Set → 挂载空集（显式空集语义：用户 server 全摘）', async () => {
    const tooling = makeTooling([stdioServer('srv-a', 'alpha')])
    const servers = await tooling.buildMcpServersForSDK(new Set())
    expect(Object.keys(servers)).toEqual([])
  })

  it('白名单含不存在 id / 内置合成 id → 不命中即跳过，无害', async () => {
    const tooling = makeTooling([stdioServer('srv-a', 'alpha')])
    const servers = await tooling.buildMcpServersForSDK(
      new Set(['srv-a', 'ghost', 'builtin:spark_platform']),
    )
    expect(Object.keys(servers)).toEqual(['alpha'])
  })

  it('disabled server 即便在白名单内也不挂载', async () => {
    const tooling = makeTooling([stdioServer('srv-a', 'alpha', false)])
    const servers = await tooling.buildMcpServersForSDK(new Set(['srv-a']))
    expect(Object.keys(servers)).toEqual([])
  })

  it('非法 configJson 的 server 被跳过（既有行为回归）', async () => {
    const tooling = makeTooling([
      stdioServer('srv-a', 'alpha'),
      { id: 'srv-b', name: 'broken', scope: 'user', configJson: '{not-json', enabled: true },
    ])
    const servers = await tooling.buildMcpServersForSDK()
    expect(Object.keys(servers)).toEqual(['alpha'])
  })
})
