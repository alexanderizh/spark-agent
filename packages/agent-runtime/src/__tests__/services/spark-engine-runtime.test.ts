import { describe, expect, it } from 'vitest'

import { buildSparkEngineMcpRuntime } from '../../services/session/spark-engine-runtime.js'

describe('buildSparkEngineMcpRuntime', () => {
  it('keeps stdio and Streamable HTTP servers while skipping unsupported transports', () => {
    const runtime = buildSparkEngineMcpRuntime({
      customServers: {
        local: { type: 'stdio', command: 'node' },
        remote: { type: 'http', url: 'http://127.0.0.1:3000/mcp' },
        legacy: { type: 'sse', url: 'http://127.0.0.1:3001/sse' },
        inProcess: { type: 'sdk', name: 'local', instance: {} },
        'invalid name': { type: 'stdio', command: 'node' },
        spark_search: { type: 'stdio', command: 'node' },
      },
      searchServer: { type: 'stdio', command: 'node' },
      pluginServer: { type: 'sdk', name: 'plugin', instance: {} },
      pluginToolNames: ['mcp__spark_plugins__run'],
    })

    expect(Object.keys(runtime.servers)).toEqual(['local', 'remote', 'spark_search'])
    expect(runtime.allowedTools).toContain('mcp__spark_search__web_search')
    expect(runtime.allowedTools).not.toContain('mcp__spark_plugins__run')
  })

  it('adds allowed names only for built-in servers that were actually accepted', () => {
    const runtime = buildSparkEngineMcpRuntime({
      customServers: {},
      computerServer: { type: 'http', url: 'http://127.0.0.1:3000/mcp' },
      computerToolNames: ['mcp__spark_computer__start_task'],
      filesServer: { type: 'sdk', name: 'files', instance: {} },
    })

    expect(runtime.servers).toHaveProperty('spark_computer')
    expect(runtime.servers).not.toHaveProperty('spark_files')
    expect(runtime.allowedTools).toEqual(['mcp__spark_computer__start_task'])
  })
})
