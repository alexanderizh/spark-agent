import { describe, expect, it } from 'vitest'
import type { SDKMcpServerConfig } from '../sdk/index.js'
import { governMcpServers, TOOL_RESULT_READER_SERVER_NAME } from './tool-result-mcp-governance.js'

describe('governMcpServers', () => {
  const reader: SDKMcpServerConfig = {
    type: 'stdio',
    command: '/runtime/node',
    args: ['/tools/tool-result-reader-mcp-server.mjs'],
  }

  it('wraps stdio servers without changing their namespace and adds the reader', () => {
    const result = governMcpServers(
      {
        custom_tools: {
          type: 'stdio',
          command: '/usr/bin/custom-mcp',
          args: ['--serve'],
          cwd: '/original-cwd',
          env: { CUSTOM_TOKEN: 'secret' },
        },
      },
      {
        workspaceRootPath: '/workspace',
        nodeExecutable: '/runtime/node',
        proxyServerPath: '/tools/tool-result-governance-mcp-proxy.mjs',
        readerServer: reader,
      },
    )

    expect(Object.keys(result)).toEqual(['custom_tools', TOOL_RESULT_READER_SERVER_NAME])
    expect(result.custom_tools).toMatchObject({
      type: 'stdio',
      command: '/runtime/node',
      args: ['/tools/tool-result-governance-mcp-proxy.mjs'],
      cwd: '/original-cwd',
    })
    const encoded = result.custom_tools?.env?.SPARK_TOOL_RESULT_UPSTREAM_CONFIG
    if (encoded == null) throw new Error('expected encoded upstream MCP config')
    expect(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))).toEqual({
      type: 'stdio',
      command: '/usr/bin/custom-mcp',
      args: ['--serve'],
      env: { CUSTOM_TOKEN: 'secret' },
      cwd: '/original-cwd',
    })
    expect(result[TOOL_RESULT_READER_SERVER_NAME]).toBe(reader)
  })

  it('does not inject a workspace cwd when the upstream server omitted one', () => {
    const result = governMcpServers(
      {
        custom_tools: {
          type: 'stdio',
          command: '/usr/bin/custom-mcp',
        },
      },
      {
        workspaceRootPath: '/workspace',
        nodeExecutable: '/runtime/node',
        proxyServerPath: '/tools/tool-result-governance-mcp-proxy.mjs',
        readerServer: null,
      },
    )

    expect(result.custom_tools).not.toHaveProperty('cwd')
    const encoded = result.custom_tools?.env?.SPARK_TOOL_RESULT_UPSTREAM_CONFIG
    if (encoded == null) throw new Error('expected encoded upstream MCP config')
    expect(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))).not.toHaveProperty('cwd')
  })

  it('leaves SDK and remote transports untouched and does not nest an existing proxy', () => {
    const sdk = { type: 'sdk' as const, name: 'in-process', instance: {} }
    const http = { type: 'http' as const, url: 'https://mcp.example.test' }
    const proxied = {
      type: 'stdio' as const,
      command: '/runtime/node',
      env: { SPARK_TOOL_RESULT_PROXY_VERSION: '1' },
    }
    const result = governMcpServers(
      { sdk, http, already_governed: proxied },
      {
        workspaceRootPath: '/workspace',
        nodeExecutable: '/runtime/node',
        proxyServerPath: '/tools/proxy.mjs',
        readerServer: null,
      },
    )

    expect(result.sdk).toBe(sdk)
    expect(result.http).toBe(http)
    expect(result.already_governed).toBe(proxied)
    expect(result[TOOL_RESULT_READER_SERVER_NAME]).toBeUndefined()
  })

  it('still attaches the reader when the proxy Node runtime is unavailable', () => {
    const stdio = { type: 'stdio' as const, command: '/usr/bin/custom-mcp' }
    const result = governMcpServers(
      { stdio },
      {
        workspaceRootPath: '/workspace',
        nodeExecutable: null,
        proxyServerPath: '/tools/proxy.mjs',
        readerServer: reader,
      },
    )

    expect(result.stdio).toBe(stdio)
    expect(result[TOOL_RESULT_READER_SERVER_NAME]).toBe(reader)
  })
})
