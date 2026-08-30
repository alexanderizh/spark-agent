import { describe, expect, it } from 'vitest'
import { PluginManifestSchema } from './plugin.js'
import {
  PluginRuntimeContributionSchema,
  RuntimeExecutionSchema,
  RuntimeToolDefinitionSchema,
} from './plugin-runtime.js'

describe('plugin runtime protocol v2', () => {
  it('keeps v1 manifests readable while accepting v2 runtime contributions', () => {
    expect(
      PluginManifestSchema.parse({
        schemaVersion: 1,
        id: 'acme.v1',
        version: '1.0.0',
        displayName: 'V1',
        description: 'legacy',
        author: { name: 'Acme' },
        permissions: { required: [], optional: [] },
        activation: 'manual',
        contributions: { skills: [], mcpServers: [], connectors: [] },
      }).schemaVersion,
    ).toBe(1)

    expect(
      PluginRuntimeContributionSchema.parse({
        id: 'acme-tasks',
        kind: 'connector',
        provider: 'acme',
        execution: {
          type: 'worker',
          entrypoint: 'runtime/index.js',
          packageSha256: 'a'.repeat(64),
        },
        toolNamespace: 'acme',
        accountMode: 'multiple',
        activation: 'on-demand',
      }),
    ).toMatchObject({ id: 'acme-tasks', execution: { type: 'worker' } })
  })

  it('rejects unsigned or malformed worker references and invalid tool metadata', () => {
    expect(
      RuntimeExecutionSchema.safeParse({
        type: 'worker',
        entrypoint: '../runtime.js',
        packageSha256: 'not-a-sha',
      }).success,
    ).toBe(false)
    expect(
      RuntimeToolDefinitionSchema.safeParse({
        name: 'delete',
        title: 'Delete',
        description: 'Delete',
        inputSchema: {},
        requiredCapabilities: [],
        risk: 'destructive',
        effect: 'delete',
        idempotency: 'unsafe',
      }).success,
    ).toBe(true)
  })
})
