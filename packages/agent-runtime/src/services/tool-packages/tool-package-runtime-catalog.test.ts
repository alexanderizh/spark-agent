import type { ToolPackageManifest } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ToolPackageRuntimeCatalog } from './tool-package-runtime-catalog.js'
import type { ToolPackageService } from './tool-package.service.js'

function packageManifest(packageId: string, toolName: string): ToolPackageManifest {
  return {
    schemaVersion: 1,
    id: packageId,
    version: '1.0.0',
    name: 'Runtime catalog fixture',
    description: 'Validates Tool Package catalog boundaries',
    runtime: {
      adapter: 'process',
      protocol: 'spark-tool-process-v1',
      command: 'node',
      args: ['runner.mjs'],
      lifecycle: 'persistent',
    },
    tools: [
      {
        name: toolName,
        title: 'Nested input tool',
        description: 'Accepts nested objects and integer arrays',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            options: {
              type: 'object',
              additionalProperties: false,
              properties: { retries: { type: 'integer', minimum: 0 } },
              required: ['retries'],
            },
            values: { type: 'array', items: { type: 'integer' } },
          },
          required: ['options', 'values'],
        },
        risk: 'read',
        effect: 'read',
        idempotency: 'safe',
        outputSchema: {
          type: 'object',
          properties: { accepted: { type: 'boolean' } },
        },
        guidance: {
          whenToUse: ['Nested values need validation'],
          resultSemantics: 'accepted confirms the input was processed.',
        },
      },
    ],
    environment: [],
    permissions: {
      declaredOsEffects: [],
      requiredSparkCapabilities: [],
      optionalSparkCapabilities: [],
    },
  }
}

describe('ToolPackageRuntimeCatalog', () => {
  it('emits OpenAI-compatible stable names and validates nested inputs before execution', async () => {
    const packageId = `acme.${'long-package-segment-'.repeat(4)}suite`.slice(0, 95)
    const toolName = `generate_${'long_report_'.repeat(7)}`.slice(0, 95)
    const manifest = packageManifest(packageId, toolName)
    const invokeInstalledVersion = vi.fn(async ({ input }: { input: unknown }) => input)
    const service = {
      listEnabledTools: () => [
        {
          packageId,
          version: manifest.version,
          installPath: '/tmp/tool-package',
          manifest,
          toolName,
        },
      ],
      invokeInstalledVersion,
    } as unknown as ToolPackageService
    const catalog = new ToolPackageRuntimeCatalog(service)
    const first = catalog.list()[0]
    const second = catalog.list()[0]

    expect(first?.qualifiedName).toBe(second?.qualifiedName)
    expect(first?.qualifiedName).toMatch(/^[a-z0-9_-]+$/)
    expect(first?.qualifiedName.length).toBeLessThanOrEqual(64)
    expect(first?.tool.description).toContain('Use when:')
    expect(first?.tool.outputSchema).toEqual(manifest.tools[0]?.outputSchema)
    await expect(first?.invoke({ options: { retries: 2 }, values: [1, 2, 3] })).resolves.toEqual({
      options: { retries: 2 },
      values: [1, 2, 3],
    })
    await expect(
      first?.invoke({ options: { retries: 2 }, values: [1, 'invalid'] }),
    ).rejects.toThrow(/Invalid input for Tool Package/)
    expect(invokeInstalledVersion).toHaveBeenCalledTimes(1)
  })
})
