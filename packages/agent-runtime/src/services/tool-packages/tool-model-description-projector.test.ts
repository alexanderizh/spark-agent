import type { ToolPackageManifest } from '@spark/protocol'
import { describe, expect, it } from 'vitest'
import {
  buildToolPackageHelp,
  projectToolModelDescription,
} from './tool-model-description-projector.js'

const manifest: ToolPackageManifest = {
  schemaVersion: 1,
  id: 'acme.guidance',
  version: '1.0.0',
  name: 'Guidance fixture',
  description: 'A package with detailed model guidance',
  runtime: {
    adapter: 'process',
    protocol: 'spark-tool-process-v1',
    command: 'node',
    args: ['runner.mjs'],
    lifecycle: 'per-call',
  },
  guidance: { prerequisites: ['A configured data source'] },
  tools: [
    {
      name: 'create_report',
      title: 'Create report',
      description: 'Creates a report.',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: { reportId: { type: 'string' } } },
      risk: 'low-write',
      effect: 'create',
      idempotency: 'keyed',
      guidance: {
        whenToUse: ['A persistent report is requested'],
        whenNotToUse: ['Only a draft explanation is needed'],
        resultSemantics: 'reportId identifies the persisted report.',
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

describe('tool model description projector', () => {
  it('projects concise guidance and keeps full metadata in on-demand help', () => {
    const tool = manifest.tools[0]!
    const description = projectToolModelDescription(manifest, tool)
    expect(description).toContain('Use when:')
    expect(description).toContain('Do not use when:')
    expect(description).toContain('Prerequisites:')
    expect(description).toContain('Result:')
    expect(buildToolPackageHelp(manifest, tool)).toMatchObject({
      package: { id: 'acme.guidance' },
      tool: { outputSchema: tool.outputSchema, guidance: tool.guidance },
    })
  })

  it('enforces a deterministic description budget', () => {
    const tool = { ...manifest.tools[0]!, description: 'x'.repeat(500) }
    const projected = projectToolModelDescription(manifest, tool, 180)
    expect(projected.length).toBeLessThanOrEqual(180)
    expect(projected).toContain('spark_tool_help')
  })
})
