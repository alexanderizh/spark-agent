/**
 * config-normalize — MCP 配置归一化 & 校验回归测试
 *
 * 锁定曾经的 bug：读取端只认 `type === 'sse'`，把 http(Streamable HTTP) 远程 MCP
 * 静默降级成坏的 stdio(`npx`)，导致 agent 永远拿不到工具。
 */
import { describe, it, expect } from 'vitest'
import { resolveMcpConfig, validateMcpConfigJson } from '../../mcp/index.js'

describe('resolveMcpConfig', () => {
  it('识别 transport:http + url（UI/openrouter 写法）', () => {
    expect(resolveMcpConfig({ transport: 'http', url: 'https://mcp.openrouter.ai/mcp', tools: [] })).toEqual({
      type: 'http',
      url: 'https://mcp.openrouter.ai/mcp',
    })
  })

  it('识别 type:http + url（apimart 写法）', () => {
    expect(resolveMcpConfig({ type: 'http', url: 'https://docs.apimart.ai/mcp' })).toEqual({
      type: 'http',
      url: 'https://docs.apimart.ai/mcp',
    })
  })

  it('识别 sse 并保留 headers', () => {
    expect(resolveMcpConfig({ transport: 'sse', url: 'https://x/sse', headers: { Authorization: 'Bearer t' } })).toEqual({
      type: 'sse',
      url: 'https://x/sse',
      headers: { Authorization: 'Bearer t' },
    })
  })

  it('识别 stdio + command/args/env', () => {
    expect(
      resolveMcpConfig({ type: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: { A: '1' } }),
    ).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: { A: '1' } })
  })

  it('自愈：声明 stdio 但缺 command 却带 url → 按 http 处理', () => {
    expect(resolveMcpConfig({ transport: 'stdio', url: 'https://docs.apimart.ai/mcp' })).toEqual({
      type: 'http',
      url: 'https://docs.apimart.ai/mcp',
    })
  })

  it('无 transport/type：只有 url 时推断为 http', () => {
    expect(resolveMcpConfig({ url: 'https://x/mcp' })).toEqual({ type: 'http', url: 'https://x/mcp' })
  })

  it('无 transport/type：只有 command 时推断为 stdio', () => {
    expect(resolveMcpConfig({ command: 'node', args: ['x.js'] })).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['x.js'],
    })
  })

  it('http 缺 url → null（调用方应跳过而非降级成坏 stdio）', () => {
    expect(resolveMcpConfig({ transport: 'http' })).toBeNull()
  })

  it('空配置 → null', () => {
    expect(resolveMcpConfig({})).toBeNull()
  })
})

describe('validateMcpConfigJson', () => {
  it('合法 http 配置通过', () => {
    expect(validateMcpConfigJson(JSON.stringify({ transport: 'http', url: 'https://x/mcp' }))).toBeNull()
  })

  it('合法 stdio 配置通过', () => {
    expect(validateMcpConfigJson(JSON.stringify({ transport: 'stdio', command: 'npx' }))).toBeNull()
  })

  it('http 缺 url 报错', () => {
    expect(validateMcpConfigJson(JSON.stringify({ transport: 'http' }))).toMatch(/url/)
  })

  it('stdio 缺 command 且无 url 报错', () => {
    expect(validateMcpConfigJson(JSON.stringify({ transport: 'stdio' }))).toMatch(/command/)
  })

  it('矛盾但可自愈：stdio + url 视为 http，不报错', () => {
    expect(validateMcpConfigJson(JSON.stringify({ transport: 'stdio', url: 'https://x/mcp' }))).toBeNull()
  })

  it('url 协议非法报错', () => {
    expect(validateMcpConfigJson(JSON.stringify({ transport: 'http', url: 'ftp://x/mcp' }))).toMatch(/协议/)
  })

  it('非法 JSON 报错', () => {
    expect(validateMcpConfigJson('{not json')).toMatch(/JSON/)
  })

  it('既无 url 也无 command 报错', () => {
    expect(validateMcpConfigJson(JSON.stringify({ tools: [] }))).toMatch(/传输/)
  })
})
