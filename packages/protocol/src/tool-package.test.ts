import { describe, expect, it } from 'vitest'
import { ToolPackageManifestSchema, ToolPackagesIpcSchemaRegistry } from './tool-package.js'

function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'acme.productivity-suite',
    version: '1.0.0',
    name: 'Productivity Suite',
    description: 'A neutral multi-tool package',
    runtime: {
      adapter: 'process',
      protocol: 'spark-tool-process-v1',
      command: 'node',
      args: ['dist/main.js'],
      lifecycle: 'persistent',
    },
    tools: [
      {
        name: 'generate_report',
        title: 'Generate report',
        description: 'Generate a report from structured input',
        inputSchema: { type: 'object', properties: {} },
        risk: 'read',
        effect: 'read',
        idempotency: 'safe',
      },
    ],
    environment: [
      {
        name: 'REPORT_MAX_ROWS',
        title: 'Maximum rows',
        type: 'integer',
        required: false,
        secret: false,
        default: 2_000,
        agentConfigurable: true,
      },
      {
        name: 'EXTERNAL_API_TOKEN',
        title: 'External API token',
        type: 'string',
        required: true,
        secret: true,
        agentConfigurable: true,
      },
    ],
    permissions: {
      declaredOsEffects: ['network'],
      requiredSparkCapabilities: ['files.read'],
      optionalSparkCapabilities: ['models.invoke'],
    },
  }
}

describe('ToolPackageManifestSchema', () => {
  it('accepts a business-neutral process package with environment and capabilities', () => {
    const parsed = ToolPackageManifestSchema.parse(validManifest())
    expect(parsed.id).toBe('acme.productivity-suite')
    expect(parsed.tools[0]?.name).toBe('generate_report')
    expect(parsed.environment[1]?.secret).toBe(true)
  })

  it('rejects duplicate tools and environment names', () => {
    const manifest = validManifest()
    manifest.tools = [
      ...(manifest.tools as unknown[]),
      { ...(manifest.tools as Record<string, unknown>[])[0] },
    ]
    manifest.environment = [
      ...(manifest.environment as unknown[]),
      { ...(manifest.environment as Record<string, unknown>[])[0] },
    ]
    const result = ToolPackageManifestSchema.safeParse(manifest)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'Duplicate tool name: generate_report',
        'Duplicate environment variable: REPORT_MAX_ROWS',
      ]),
    )
  })

  it('rejects secret defaults and overlapping required/optional capabilities', () => {
    const manifest = validManifest()
    ;(manifest.environment as Record<string, unknown>[])[1]!.default = 'must-not-persist'
    ;(manifest.permissions as Record<string, unknown>).optionalSparkCapabilities = ['files.read']
    const result = ToolPackageManifestSchema.safeParse(manifest)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'Secret environment variables cannot declare defaults',
        'Spark capability cannot be both required and optional: files.read',
      ]),
    )
  })

  it('restricts secret environment values to strings for protected input', () => {
    const manifest = validManifest()
    ;(manifest.environment as Record<string, unknown>[])[1]!.type = 'json'
    const result = ToolPackageManifestSchema.safeParse(manifest)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'Secret environment variables must use string type',
    )
  })

  it('validates environment defaults against the declared type', () => {
    const manifest = validManifest()
    ;(manifest.environment as Record<string, unknown>[])[0]!.default = '2000'
    const result = ToolPackageManifestSchema.safeParse(manifest)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'REPORT_MAX_ROWS must be integer',
    )
  })

  it('keeps runtime adapters business-neutral', () => {
    const manifest = validManifest()
    ;(manifest.runtime as Record<string, unknown>).adapter = 'provider-vision'
    expect(ToolPackageManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('accepts nested JSON Schema inputs and rejects non-object tool arguments', () => {
    const manifest = validManifest()
    ;(manifest.tools as Record<string, unknown>[])[0]!.inputSchema = {
      type: 'object',
      required: ['request'],
      properties: {
        request: {
          type: 'object',
          required: ['items'],
          properties: {
            items: { type: 'array', items: { type: 'integer' } },
          },
        },
      },
    }
    expect(ToolPackageManifestSchema.safeParse(manifest).success).toBe(true)
    ;(manifest.tools as Record<string, unknown>[])[0]!.inputSchema = {
      type: 'array',
      items: { type: 'string' },
    }
    const result = ToolPackageManifestSchema.safeParse(manifest)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'Tool inputSchema must describe a JSON object',
    )
  })
})

describe('ToolPackageDevelopmentSchema', () => {
  it('accepts declared install and build commands on a manifest', () => {
    const manifest = validManifest()
    manifest.development = {
      installCommand: 'pnpm install --frozen-lockfile',
      buildCommand: 'pnpm build',
    }
    const parsed = ToolPackageManifestSchema.parse(manifest)
    expect(parsed.development?.installCommand).toBe('pnpm install --frozen-lockfile')
    expect(parsed.development?.buildCommand).toBe('pnpm build')
  })

  it('rejects empty commands and unknown development keys', () => {
    const manifest = validManifest()
    manifest.development = { installCommand: '' }
    expect(ToolPackageManifestSchema.safeParse(manifest).success).toBe(false)

    const strict = validManifest()
    strict.development = { deployCommand: 'pnpm deploy' } as unknown as Record<string, never>
    expect(ToolPackageManifestSchema.safeParse(strict).success).toBe(false)
  })

  it('parses project step results and validates run-project-step requests', () => {
    const registry = ToolPackagesIpcSchemaRegistry['tool-packages:run-project-step']
    expect(
      registry.safeParse({ packageId: 'acme.productivity-suite', step: 'install' }).success,
    ).toBe(true)
    expect(
      registry.safeParse({ packageId: 'acme.productivity-suite', step: 'deploy' }).success,
    ).toBe(false)
  })
})
