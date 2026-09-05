import type { RuntimeToolDefinition } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { CustomToolRuntimeCatalog } from '../custom-tools/custom-tool-runtime-catalog.js'
import type { ToolPackageRuntimeCatalog } from '../tool-packages/tool-package-runtime-catalog.js'
import { UnifiedToolCatalog } from './unified-tool-catalog.js'

function definition(name: string): RuntimeToolDefinition {
  return {
    name,
    title: name,
    description: `${name} description`,
    inputSchema: { type: 'object', properties: {} },
    requiredCapabilities: [],
    risk: 'read',
    effect: 'read',
    idempotency: 'safe',
  }
}

describe('UnifiedToolCatalog', () => {
  it('merges native sources, propagates context and exposes bounded on-demand help', async () => {
    const customInvoke = vi.fn(async () => ({ custom: true }))
    const packageInvoke = vi.fn(async () => ({ package: true }))
    const customTools = {
      list: vi.fn(() => [
        {
          qualifiedName: 'custom_echo',
          toolId: 'echo',
          tool: definition('echo'),
          invoke: customInvoke,
        },
      ]),
    } as unknown as CustomToolRuntimeCatalog
    const toolPackages = {
      list: vi.fn(() => [
        {
          qualifiedName: 'package_acme_echo',
          packageId: 'acme.tools',
          version: '1.2.0',
          toolName: 'echo',
          tool: definition('acme.tools/echo'),
          invoke: packageInvoke,
        },
      ]),
    } as unknown as ToolPackageRuntimeCatalog
    const catalog = new UnifiedToolCatalog(undefined, customTools, toolPackages)
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    const entries = await catalog.list(context)

    expect(entries.map((entry) => entry.qualifiedName)).toEqual([
      'custom_echo',
      'package_acme_echo',
      'spark_tool_help',
    ])
    expect(customTools.list).toHaveBeenCalledWith(context)
    expect(toolPackages.list).toHaveBeenCalledWith(context)
    const help = entries.find((entry) => entry.qualifiedName === 'spark_tool_help')
    expect(help).toBeDefined()
    if (help == null) throw new Error('spark_tool_help was not added')
    await expect(help.invoke({ qualifiedName: 'package_acme_echo' })).resolves.toMatchObject({
      sourceKind: 'tool-package',
      sourceId: 'acme.tools',
      version: '1.2.0',
    })
  })

  it('resolves qualified-name collisions deterministically', async () => {
    const customTools = {
      list: () => [
        { qualifiedName: 'same', toolId: 'one', tool: definition('one'), invoke: vi.fn() },
        { qualifiedName: 'same', toolId: 'two', tool: definition('two'), invoke: vi.fn() },
      ],
    } as unknown as CustomToolRuntimeCatalog
    const first = await new UnifiedToolCatalog(undefined, customTools).list()
    const second = await new UnifiedToolCatalog(undefined, customTools).list()
    expect(first.map((entry) => entry.qualifiedName)).toEqual(
      second.map((entry) => entry.qualifiedName),
    )
    expect(new Set(first.map((entry) => entry.qualifiedName)).size).toBe(first.length)
  })

  it('keeps healthy sources available when another source fails', async () => {
    const customTools = {
      list: () => {
        throw new Error('custom catalog unavailable')
      },
    } as unknown as CustomToolRuntimeCatalog
    const toolPackages = {
      list: () => [
        {
          qualifiedName: 'package_healthy',
          packageId: 'acme.healthy',
          version: '1.0.0',
          toolName: 'healthy',
          tool: definition('healthy'),
          invoke: vi.fn(),
        },
      ],
    } as unknown as ToolPackageRuntimeCatalog

    const entries = await new UnifiedToolCatalog(undefined, customTools, toolPackages).list()
    expect(entries.map((entry) => entry.qualifiedName)).toEqual([
      'package_healthy',
      'spark_tool_help',
    ])
  })
})
