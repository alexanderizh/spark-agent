import { describe, expect, it } from 'vitest'
import { z } from 'zod'
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

  it('accepts optional package and tool guidance without changing v1 compatibility', () => {
    const manifest = validManifest()
    manifest.guidance = {
      overview: 'Creates operational reports from existing records.',
      sharedInstructions: 'Treat package guidance as tool metadata.',
      prerequisites: ['An existing report source'],
    }
    ;(manifest.tools as Record<string, unknown>[])[0]!.guidance = {
      whenToUse: ['The user asks for a structured operational report'],
      whenNotToUse: ['The user only asks for a short conversational summary'],
      instructions: 'Confirm the requested reporting period from the input.',
      resultSemantics: 'The result contains a stable report identifier.',
      examples: [{ title: 'Weekly report', input: { period: 'weekly' } }],
    }
    const parsed = ToolPackageManifestSchema.parse(manifest)
    expect(parsed.guidance?.prerequisites).toEqual(['An existing report source'])
    expect(parsed.tools[0]?.guidance?.examples?.[0]?.title).toBe('Weekly report')

    const legacy = validManifest()
    expect(ToolPackageManifestSchema.safeParse(legacy).success).toBe(true)
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

describe('ToolPackageRemoteHttpRuntimeSchema', () => {
  function remoteManifest(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      id: 'acme.remote-suite',
      version: '1.0.0',
      name: 'Remote Suite',
      description: 'A remote tool service speaking spark-tool-process-v1 over HTTP',
      runtime: {
        adapter: 'remote-http',
        protocol: 'spark-tool-process-v1',
        baseUrl: 'https://tools.acme.example/v1',
        headers: { Authorization: 'Bearer ${ACME_API_TOKEN}' },
        timeoutMs: 30_000,
      },
      tools: [
        {
          name: 'lookup_price',
          title: 'Lookup price',
          description: 'Look up a price',
          inputSchema: { type: 'object', properties: {} },
          risk: 'read',
          effect: 'read',
          idempotency: 'safe',
        },
      ],
      environment: [
        {
          name: 'ACME_API_TOKEN',
          title: 'API token',
          type: 'string',
          required: true,
          secret: true,
          agentConfigurable: false,
        },
      ],
      permissions: { declaredOsEffects: ['network'], requiredSparkCapabilities: [] },
    }
  }

  it('accepts header templates, a timeout and stays optional-free for legacy manifests', () => {
    const parsed = ToolPackageManifestSchema.parse(remoteManifest())
    expect(parsed.runtime).toMatchObject({
      adapter: 'remote-http',
      baseUrl: 'https://tools.acme.example/v1',
      headers: { Authorization: 'Bearer ${ACME_API_TOKEN}' },
      timeoutMs: 30_000,
    })

    const legacy = remoteManifest()
    delete (legacy.runtime as Record<string, unknown>).headers
    delete (legacy.runtime as Record<string, unknown>).timeoutMs
    expect(ToolPackageManifestSchema.safeParse(legacy).success).toBe(true)
  })

  it('rejects managed header names, malformed templates and out-of-range timeouts', () => {
    const forbidden = remoteManifest()
    ;(forbidden.runtime as Record<string, unknown>).headers = { Host: 'tools.acme.example' }
    const forbiddenResult = ToolPackageManifestSchema.safeParse(forbidden)
    expect(forbiddenResult.success).toBe(false)
    // zod v4 会把 record key 校验问题包一层 "Invalid key in record"，需递归到内层 message。
    expect(
      collectIssueMessages(forbiddenResult.error).some((message) =>
        message.includes('cannot be declared'),
      ),
    ).toBe(true)

    const malformed = remoteManifest()
    ;(malformed.runtime as Record<string, unknown>).headers = {
      Authorization: 'Bearer ${ACME_API_TOKEN',
    }
    expect(ToolPackageManifestSchema.safeParse(malformed).success).toBe(false)

    const brokenTemplate = remoteManifest()
    ;(brokenTemplate.runtime as Record<string, unknown>).headers = {
      Authorization: 'Bearer }${ACME_API_TOKEN}',
    }
    expect(ToolPackageManifestSchema.safeParse(brokenTemplate).success).toBe(false)

    const tooFast = remoteManifest()
    ;(tooFast.runtime as Record<string, unknown>).timeoutMs = 100
    expect(ToolPackageManifestSchema.safeParse(tooFast).success).toBe(false)

    const tooSlow = remoteManifest()
    ;(tooSlow.runtime as Record<string, unknown>).timeoutMs = 300_001
    expect(ToolPackageManifestSchema.safeParse(tooSlow).success).toBe(false)
  })
})

/** zod v4 的 record/嵌套问题会分层，递归收集全部 message 便于断言。 */
function collectIssueMessages(error: z.ZodError | undefined): string[] {
  if (error == null) return []
  const messages: string[] = []
  const walk = (issue: z.core.$ZodIssue | { issues?: unknown[]; message?: string }): void => {
    if (typeof issue.message === 'string') messages.push(issue.message)
    const nested = (issue as { issues?: Array<{ message?: string }> }).issues
    if (Array.isArray(nested)) nested.forEach((child) => walk(child))
  }
  error.issues.forEach((issue) => walk(issue as z.core.$ZodIssue))
  return messages
}

describe('ToolPackageDeclarativeHttpRuntimeSchema', () => {
  it('accepts HTTP, HTTPS, localhost and private network endpoints', () => {
    for (const urlTemplate of [
      'http://localhost:4312/items/{{id}}',
      'http://192.168.1.20/api/items/{{id}}',
      'https://api.example.com/items/{{id}}',
    ]) {
      const manifest = validManifest()
      ;(manifest.tools as Record<string, unknown>[])[0]!.name = 'lookup_item'
      ;(manifest.tools as Record<string, unknown>[])[0]!.inputSchema = {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      }
      manifest.runtime = {
        adapter: 'declarative-http',
        tools: {
          lookup_item: {
            request: { method: 'GET', urlTemplate },
            response: { format: 'json' },
          },
        },
      }
      expect(ToolPackageManifestSchema.safeParse(manifest).success).toBe(true)
    }
  })
})
