import type { RuntimeToolDefinition } from '@spark/protocol'
import { describe, expect, it } from 'vitest'
import type { UnifiedToolCatalogEntry } from '../unified-tools/unified-tool-catalog.js'
import { buildToolchainInventory, type ToolchainMcpServerSnapshot } from './toolchain-inventory.js'

function unifiedEntry(
  sourceKind: UnifiedToolCatalogEntry['sourceKind'],
  qualifiedName: string,
  options: { risk?: 'read' | 'low-write' } = {},
): UnifiedToolCatalogEntry {
  const tool: RuntimeToolDefinition = {
    name: qualifiedName,
    title: qualifiedName,
    description: `${qualifiedName} 的描述说明`,
    inputSchema: { type: 'object', properties: {} },
    requiredCapabilities: [],
    risk: options.risk ?? 'read',
    effect: options.risk === 'low-write' ? 'update' : 'read',
    idempotency: 'safe',
  }
  return {
    sourceKind,
    sourceId: `${sourceKind}-1`,
    qualifiedName,
    tool,
    includeRuntimeControls: false,
    autoAllow: (options.risk ?? 'read') === 'read',
    invoke: async () => ({}),
    help: {},
  }
}

function mcpServer(
  overrides: Partial<ToolchainMcpServerSnapshot> = {},
): ToolchainMcpServerSnapshot {
  return {
    name: 'example',
    enabled: true,
    connected: true,
    tools: [{ name: 'do_work', description: '做点事情' }],
    configJson: '{"type":"stdio","command":"node"}',
    ...overrides,
  }
}

describe('buildToolchainInventory', () => {
  it('聚合四层工具面：SDK 内置带 spark 映射名，统一目录投影 spark_plugins 全名', () => {
    const inventory = buildToolchainInventory({
      unifiedTools: [
        unifiedEntry('custom-tool', 'custom_echo'),
        unifiedEntry('tool-package', 'pkg_fetch', { risk: 'low-write' }),
      ],
      mcpServers: [],
    })

    const sdk = inventory.groups.find((group) => group.kind === 'sdk-builtin')
    expect(sdk).toBeDefined()
    expect(sdk?.adapters).toEqual(['claude-sdk', 'spark'])
    const read = sdk?.tools.find((tool) => tool.name === 'Read')
    expect(read?.sparkEngineName).toBe('read_file')
    // NotebookEdit 无 spark 映射 → 不带 sparkEngineName 字段
    const notebook = sdk?.tools.find((tool) => tool.name === 'NotebookEdit')
    expect(notebook?.sparkEngineName).toBeUndefined()

    const custom = inventory.groups.find((group) => group.key === 'unified:custom-tool')
    expect(custom?.tools[0]?.name).toBe('mcp__spark_plugins__custom_echo')
    const pkg = inventory.groups.find((group) => group.key === 'unified:tool-package')
    expect(pkg?.tools[0]?.autoApproved).toBeUndefined()

    // spark_plugins 平台组并入统一目录计数，不重复罗列工具
    const plugins = inventory.groups.find((group) => group.key === 'platform:spark_plugins')
    expect(plugins?.toolCount).toBe(2)
    expect(plugins?.tools).toHaveLength(0)
  })

  it('MCP 扩展按传输类型标注引擎兼容性，未连接不阻塞且停用带说明', () => {
    const inventory = buildToolchainInventory({
      unifiedTools: [],
      mcpServers: [
        mcpServer(),
        // 历史字段名 transport + sse：验证归一化走 resolveMcpConfig 权威路径
        mcpServer({
          name: 'legacy-sse',
          configJson: '{"transport":"sse","url":"https://example.com/sse"}',
        }),
        mcpServer({ name: 'stopped', enabled: false, connected: false, tools: [] }),
      ],
    })

    const stdio = inventory.groups.find((group) => group.key === 'mcp:example')
    expect(stdio?.adapters).toEqual(['claude-sdk', 'codex', 'spark'])
    expect(stdio?.serverStatus).toBe('connected')
    expect(stdio?.tools[0]?.name).toBe('mcp__example__do_work')

    const sse = inventory.groups.find((group) => group.key === 'mcp:legacy-sse')
    expect(sse?.adapters).toEqual(['claude-sdk'])
    expect(sse?.adapterNote).toContain('SSE')

    const disabled = inventory.groups.find((group) => group.key === 'mcp:stopped')
    expect(disabled?.serverStatus).toBe('disabled')
    expect(disabled?.mountNote).toContain('停用')
  })

  it('平台服务器注册表覆盖条件挂载与引擎差异标注', () => {
    const inventory = buildToolchainInventory({ unifiedTools: [], mcpServers: [] })
    const keys = inventory.groups.map((group) => group.key)

    expect(keys).toContain('platform:spark_platform')
    expect(keys).toContain('platform:spark_media')
    expect(keys).toContain('platform:spark_canvas')

    const verify = inventory.groups.find((group) => group.key === 'platform:spark_verify')
    expect(verify?.adapters).toEqual(['claude-sdk'])
    expect(verify?.adapterNote).toContain('claude-sdk')

    const voice = inventory.groups.find((group) => group.key === 'platform:spark_voice')
    expect(voice?.mountNote).toContain('语音')

    const wiki = inventory.groups.find((group) => group.key === 'platform:spark_wiki')
    expect(wiki?.toolCount).toBe(12)

    // generatedAt 为 ISO 时间戳，供前端页脚展示
    expect(Number.isNaN(Date.parse(inventory.generatedAt))).toBe(false)
  })
})
