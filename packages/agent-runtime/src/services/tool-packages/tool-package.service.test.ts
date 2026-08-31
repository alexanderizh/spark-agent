import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { zipSync } from 'fflate'
import type { ToolPackageManifest } from '@spark/protocol'
import { SparkDatabase, ToolPackageRepository } from '@spark/storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolHostCapabilityBroker } from './tool-host-capability-broker.js'
import { ToolPackageRuntimeCatalog } from './tool-package-runtime-catalog.js'
import { ToolPackageService, type ToolPackageSecretStore } from './tool-package.service.js'

const migrationsDir = fileURLToPath(new URL('../../../../storage/migrations/', import.meta.url))
const roots: string[] = []
const servers: Server[] = []
const services: ToolPackageService[] = []

interface FakeMcpServerTool {
  name: string
  description: string
  inputSchema?: unknown
}

/** 满足 ToolPackageMcpBridge 的最小 fake：记录调用并返回可编程结果。 */
class FakeMcpBridge {
  readonly existingServerIds = new Set(['srv-docs', 'srv-broken', 'srv-gone', 'srv-proxy'])
  readonly calls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }> = []
  nextResult: { content: Array<{ type: 'text'; text: string }>; isError?: boolean } = {
    content: [],
  }

  constructor(readonly tools: FakeMcpServerTool[]) {}

  serverExists(serverId: string): boolean {
    return this.existingServerIds.has(serverId)
  }

  async listServerTools(serverId: string): Promise<FakeMcpServerTool[]> {
    if (!this.serverExists(serverId)) throw new Error(`MCP server not found: ${serverId}`)
    return this.tools
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    this.calls.push({ serverId, toolName, args })
    return this.nextResult
  }
}

/** 本地帧协议服务器：接收 invoke 帧并回传 handler 构造的响应帧。 */
async function startFrameServer(
  respond: (
    frame: Record<string, unknown>,
    authorization: string | undefined,
  ) => Record<string, unknown>,
): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => {
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(body) as Record<string, unknown>
      } catch {
        res.writeHead(400).end('bad json')
        return
      }
      try {
        const payload = respond(frame, req.headers.authorization)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      } catch (error) {
        res.writeHead(500).end(error instanceof Error ? error.message : 'server error')
      }
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function manifest(
  version = '1.0.0',
  overrides: Partial<ToolPackageManifest> = {},
): ToolPackageManifest {
  return {
    schemaVersion: 1,
    id: 'acme.productivity-suite',
    version,
    name: 'Productivity Suite',
    description: 'Business-neutral Tool Package fixture',
    runtime: {
      adapter: 'process',
      protocol: 'spark-tool-process-v1',
      command: process.execPath,
      args: ['runner.mjs'],
      lifecycle: 'per-call',
    },
    tools: [
      {
        name: 'generate_report',
        title: 'Generate report',
        description: 'Generate a report',
        inputSchema: { type: 'object', properties: {} },
        risk: 'read',
        effect: 'read',
        idempotency: 'safe',
      },
    ],
    environment: [],
    permissions: {
      declaredOsEffects: [],
      requiredSparkCapabilities: [],
      optionalSparkCapabilities: [],
    },
    ...overrides,
  }
}

async function createSource(root: string, packageManifest: ToolPackageManifest): Promise<string> {
  const source = await mkdtemp(join(root, 'source-'))
  await writeFile(join(source, 'spark-tool.json'), JSON.stringify(packageManifest), 'utf8')
  await writeFile(
    join(source, 'runner.mjs'),
    `
import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
let sequence = 0
const send = (frame) => process.stdout.write(JSON.stringify({
  protocolVersion: 'spark-tool-process-v1', sequence: sequence++, ...frame,
}) + '\\n')
rl.on('line', (line) => {
  const frame = JSON.parse(line)
  if (frame.type === 'initialize') send({ type: 'ready', requestId: frame.requestId })
  if (frame.type === 'invoke') send({
    type: 'result', requestId: frame.requestId, invocationId: frame.invocationId,
    result: {
      version: ${JSON.stringify(packageManifest.version)}, input: frame.input,
      ...(frame.input?.includePid ? { pid: process.pid } : {}),
    },
  })
  if (frame.type === 'shutdown') process.exit(0)
})
`,
    'utf8',
  )
  return source
}

describe('ToolPackageService', () => {
  let root: string
  let db: SparkDatabase | undefined
  let service: ToolPackageService | undefined
  let capabilities: ToolHostCapabilityBroker

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'spark-tool-package-service-'))
    roots.push(root)
    db = new SparkDatabase(join(root, 'test.db'))
    db.runMigrations(migrationsDir)
    capabilities = new ToolHostCapabilityBroker()
    capabilities.register({ name: 'files.upload', invoke: async () => ({ ok: true }) })
    service = new ToolPackageService(db, join(root, 'installed'), capabilities)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await service?.dispose()
    await Promise.all(services.splice(0).map((extra) => extra.dispose().catch(() => undefined)))
    await Promise.all(
      servers.splice(0).map(
        (entry) =>
          new Promise<void>((resolve) => {
            if (entry.listening) entry.close(() => resolve())
            else resolve()
          }),
      ),
    )
    db?.close()
    await Promise.all(roots.splice(0).map((entry) => rm(entry, { recursive: true, force: true })))
  })

  it('blocks enablement until required configuration and permissions are ready', async () => {
    const source = await createSource(
      root,
      manifest('1.0.0', {
        environment: [
          {
            name: 'REPORT_ENDPOINT',
            title: 'Report endpoint',
            type: 'string',
            required: true,
            secret: false,
            agentConfigurable: true,
          },
        ],
        permissions: {
          declaredOsEffects: ['network'],
          requiredSparkCapabilities: ['files.upload'],
          optionalSparkCapabilities: [],
        },
      }),
    )
    await service!.installDirectory({ sourcePath: source, source: 'local-directory' })

    await expect(service!.setEnabled('acme.productivity-suite', '1.0.0')).rejects.toThrow(
      /permissions are not granted/,
    )
    service!.setPermission({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      kind: 'os-effect',
      permission: 'network',
      state: 'granted',
    })
    service!.setPermission({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      kind: 'spark-capability',
      permission: 'files.upload',
      state: 'granted',
    })
    await expect(service!.setEnabled('acme.productivity-suite', '1.0.0')).rejects.toThrow(
      /configuration is missing: REPORT_ENDPOINT/,
    )

    service!.configureValue({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      name: 'REPORT_ENDPOINT',
      value: 'https://example.invalid/reports',
      actor: 'agent',
    })
    await expect(service!.setEnabled('acme.productivity-suite', '1.0.0')).resolves.toMatchObject({
      state: 'enabled',
      enabled_version: '1.0.0',
    })
  })

  it('never accepts secret plaintext through the Agent configuration API', async () => {
    const source = await createSource(
      root,
      manifest('1.0.0', {
        environment: [
          {
            name: 'EXTERNAL_API_TOKEN',
            title: 'External API token',
            type: 'string',
            required: false,
            secret: true,
            agentConfigurable: true,
          },
        ],
      }),
    )
    await service!.installDirectory({ sourcePath: source, source: 'local-directory' })

    expect(() =>
      service!.configureValue({
        packageId: 'acme.productivity-suite',
        version: '1.0.0',
        name: 'EXTERNAL_API_TOKEN',
        value: 'must-not-enter-agent-context',
        actor: 'agent',
      }),
    ).toThrow(/requires secure input/)
    expect(await service!.getEnvironmentStatus('acme.productivity-suite', '1.0.0')).toEqual([
      expect.objectContaining({ name: 'EXTERNAL_API_TOKEN', configured: false }),
    ])
  })

  it('creates metadata-only one-time secret requests for the protected UI', async () => {
    const source = await createSource(
      root,
      manifest('1.0.0', {
        environment: [
          {
            name: 'EXTERNAL_API_TOKEN',
            title: 'External API token',
            type: 'string',
            required: false,
            secret: true,
            agentConfigurable: true,
          },
          {
            name: 'OWNER_ONLY_TOKEN',
            title: 'Owner-only token',
            type: 'string',
            required: false,
            secret: true,
            agentConfigurable: false,
          },
        ],
      }),
    )
    await service!.installDirectory({ sourcePath: source, source: 'local-directory' })

    const first = service!.requestSecretInput({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      name: 'EXTERNAL_API_TOKEN',
      actor: 'agent',
    })
    const duplicate = service!.requestSecretInput({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      name: 'EXTERNAL_API_TOKEN',
      actor: 'agent',
    })
    expect(duplicate.id).toBe(first.id)
    expect(service!.listPendingSecureRequests()).toEqual([
      expect.objectContaining({
        id: first.id,
        packageId: 'acme.productivity-suite',
        name: 'EXTERNAL_API_TOKEN',
      }),
    ])
    const stored = db!.raw
      .prepare('SELECT * FROM tool_package_secure_requests WHERE id = ?')
      .get(first.id) as Record<string, unknown>
    expect(JSON.stringify(stored)).not.toContain('must-not-enter-agent-context')
    expect(() =>
      service!.requestSecretInput({
        packageId: 'acme.productivity-suite',
        version: '1.0.0',
        name: 'OWNER_ONLY_TOKEN',
        actor: 'agent',
      }),
    ).toThrow(/does not allow Agent-initiated secure input/)

    service!.cancelSecureRequest(first.id)
    expect(service!.listPendingSecureRequests()).toEqual([])
  })

  it('reads managed project files and rejects traversal or symlink access', async () => {
    const project = await service!.createManagedProject({
      manifest: manifest(),
      files: [{ path: 'runner.mjs', content: 'process.stdin.resume()\n' }],
    })
    await service!.writeManagedProjectFile({
      packageId: project.packageId,
      path: 'src/helper.ts',
      content: 'export const answer = 42\n',
    })
    await expect(service!.listManagedProjectFiles(project.packageId)).resolves.toMatchObject({
      projectPath: project.projectPath,
      files: expect.arrayContaining([
        expect.objectContaining({ path: 'spark-tool.json' }),
        expect.objectContaining({ path: 'runner.mjs' }),
        expect.objectContaining({ path: 'src/helper.ts' }),
      ]),
    })
    await expect(
      service!.readManagedProjectFile({
        packageId: project.packageId,
        path: 'src/helper.ts',
      }),
    ).resolves.toMatchObject({ content: 'export const answer = 42\n' })
    await expect(
      service!.writeManagedProjectFile({
        packageId: '../../escaped',
        path: 'file.txt',
        content: 'unsafe',
      }),
    ).rejects.toThrow()
    await expect(
      service!.writeManagedProjectFile({
        packageId: project.packageId,
        path: '../escaped.txt',
        content: 'unsafe',
      }),
    ).rejects.toThrow(/Unsafe managed tool project path/)

    const outside = join(root, 'outside.txt')
    await writeFile(outside, 'original', 'utf8')
    await symlink(outside, join(project.projectPath, 'linked.txt'))
    await expect(
      service!.writeManagedProjectFile({
        packageId: project.packageId,
        path: 'linked.txt',
        content: 'overwritten',
      }),
    ).rejects.toThrow(/is a symlink/)
    await expect(
      service!.readManagedProjectFile({ packageId: project.packageId, path: 'linked.txt' }),
    ).rejects.toThrow(/not found/)
    await expect(service!.listManagedProjectFiles(project.packageId)).rejects.toThrow(/symlink/)
    await expect(readFile(outside, 'utf8')).resolves.toBe('original')
  })

  it('runs install/build steps against the live managed project directory', async () => {
    const project = await service!.createManagedProject({
      manifest: manifest('1.0.0', {
        development: {
          installCommand:
            "node -e \"require('fs').writeFileSync('node_modules-marker.txt', 'installed')\"",
        },
      }),
      files: [{ path: 'runner.mjs', content: 'process.stdin.resume()\n' }],
    })
    const result = await service!.runManagedProjectStep({
      packageId: project.packageId,
      step: 'install',
    })
    expect(result.exitCode).toBe(0)
    expect(result.step).toBe('install')
    expect(result.inferred).toBe(false)
    expect(result.command).toContain('node_modules-marker.txt')
    await expect(
      readFile(join(project.projectPath, 'node_modules-marker.txt'), 'utf8'),
    ).resolves.toBe('installed')

    await expect(
      service!.runManagedProjectStep({ packageId: project.packageId, step: 'build' }),
    ).rejects.toThrow(/development\.buildCommand/)

    await expect(
      service!.runManagedProjectStep({ packageId: 'missing.package', step: 'install' }),
    ).rejects.toThrow()
  })

  it('omits node_modules, .git and .DS_Store from managed project file listings', async () => {
    const project = await service!.createManagedProject({
      manifest: manifest(),
      files: [{ path: 'runner.mjs', content: 'process.stdin.resume()\n' }],
    })
    await mkdir(join(project.projectPath, 'node_modules', 'sharp'), { recursive: true })
    await mkdir(join(project.projectPath, '.git', 'objects'), { recursive: true })
    await writeFile(join(project.projectPath, '.DS_Store'), 'junk', 'utf8')
    await writeFile(join(project.projectPath, 'node_modules', 'sharp', 'index.js'), 'x', 'utf8')
    const listing = await service!.listManagedProjectFiles(project.packageId)
    expect(listing.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(['spark-tool.json', 'runner.mjs']),
    )
    expect(
      listing.files.some(
        (file) => file.path.startsWith('node_modules') || file.path === '.DS_Store',
      ),
    ).toBe(false)
  })

  it('adds and removes enabled tools from the catalog and binds calls to the exact version', async () => {
    const firstSource = await createSource(root, manifest('1.0.0'))
    const secondSource = await createSource(root, manifest('2.0.0'))
    await service!.installDirectory({ sourcePath: firstSource, source: 'local-directory' })
    await service!.installDirectory({ sourcePath: secondSource, source: 'local-directory' })
    const catalog = new ToolPackageRuntimeCatalog(service!)

    expect(catalog.list()).toEqual([])
    await service!.setEnabled('acme.productivity-suite', '1.0.0')
    const firstEntry = catalog.list()[0]
    expect(firstEntry).toMatchObject({ version: '1.0.0', toolName: 'generate_report' })
    await expect(firstEntry!.invoke({ report: 1 })).resolves.toEqual({
      version: '1.0.0',
      input: { report: 1 },
    })
    await expect(
      service!.invoke({
        packageId: 'acme.productivity-suite',
        version: '2.0.0',
        toolName: 'generate_report',
        input: {},
      }),
    ).rejects.toThrow(/version is not enabled/)

    await service!.setEnabled('acme.productivity-suite', '2.0.0')
    expect(catalog.list()[0]).toMatchObject({ version: '2.0.0' })
    await expect(firstEntry!.invoke({ report: 'snapshot' })).resolves.toEqual({
      version: '1.0.0',
      input: { report: 'snapshot' },
    })

    await service!.setEnabled('acme.productivity-suite', null)
    expect(catalog.list()).toEqual([])
  })

  it('disables an enabled package when a required permission is revoked', async () => {
    const source = await createSource(
      root,
      manifest('1.0.0', {
        permissions: {
          declaredOsEffects: [],
          requiredSparkCapabilities: ['files.upload'],
          optionalSparkCapabilities: [],
        },
      }),
    )
    await service!.installDirectory({ sourcePath: source, source: 'local-directory' })
    service!.setPermission({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      kind: 'spark-capability',
      permission: 'files.upload',
      state: 'granted',
    })
    await service!.setEnabled('acme.productivity-suite', '1.0.0')

    service!.setPermission({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      kind: 'spark-capability',
      permission: 'files.upload',
      state: 'denied',
    })

    expect(service!.listSummaries()[0]).toMatchObject({
      state: 'installed-disabled',
      enabledVersion: null,
    })
  })

  it('does not inherit incompatible ordinary environment values across versions', async () => {
    const firstSource = await createSource(
      root,
      manifest('1.0.0', {
        environment: [
          {
            name: 'REPORT_LIMIT',
            title: 'Report limit',
            type: 'string',
            required: true,
            secret: false,
            agentConfigurable: true,
          },
        ],
      }),
    )
    const secondSource = await createSource(
      root,
      manifest('2.0.0', {
        environment: [
          {
            name: 'REPORT_LIMIT',
            title: 'Report limit',
            type: 'integer',
            required: true,
            secret: false,
            agentConfigurable: true,
          },
        ],
      }),
    )
    await service!.installDirectory({ sourcePath: firstSource, source: 'local-directory' })
    service!.configureValue({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      name: 'REPORT_LIMIT',
      value: '100',
      actor: 'agent',
    })
    await service!.installDirectory({ sourcePath: secondSource, source: 'local-directory' })

    await expect(service!.setEnabled('acme.productivity-suite', '2.0.0')).rejects.toThrow(
      /configuration is missing: REPORT_LIMIT/,
    )
    await expect(
      service!.getEnvironmentStatus('acme.productivity-suite', '2.0.0'),
    ).resolves.toEqual([
      expect.objectContaining({ name: 'REPORT_LIMIT', configured: false, source: 'missing' }),
    ])
  })

  it('rejects blocked packages and runtime adapters that are not executable yet', async () => {
    const blockedSource = await createSource(root, manifest())
    await service!.installDirectory({
      sourcePath: blockedSource,
      source: 'local-directory',
      trust: 'blocked',
    })
    await expect(service!.setEnabled('acme.productivity-suite', '1.0.0')).rejects.toThrow(
      /blocked and cannot be enabled/,
    )
    await expect(
      service!.invokeInstalledVersion({
        packageId: 'acme.productivity-suite',
        version: '1.0.0',
        toolName: 'generate_report',
        input: {},
      }),
    ).rejects.toThrow(/blocked and cannot execute/)

    // remote-http / mcp-import 已在 V3 B-4 转为可执行适配器；
    // 仍拒绝启用的是 legacy-custom-tool 占位类型。
    const legacySource = await createSource(
      root,
      manifest('2.0.0', {
        id: 'acme.legacy-suite',
        runtime: {
          adapter: 'legacy-custom-tool',
          toolId: 'legacy-http-tool',
        },
      }),
    )
    await service!.installDirectory({ sourcePath: legacySource, source: 'local-directory' })
    await expect(service!.setEnabled('acme.legacy-suite', '2.0.0')).rejects.toThrow(
      /runtime adapter is not executable: legacy-custom-tool/,
    )
  })

  it('rejects enablement when a required Spark capability is not registered by the host', async () => {
    const source = await createSource(
      root,
      manifest('1.0.0', {
        permissions: {
          declaredOsEffects: [],
          requiredSparkCapabilities: ['files.missing'],
          optionalSparkCapabilities: [],
        },
      }),
    )
    await service!.installDirectory({ sourcePath: source, source: 'local-directory' })
    service!.setPermission({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      kind: 'spark-capability',
      permission: 'files.missing',
      state: 'granted',
    })

    await expect(service!.setEnabled('acme.productivity-suite', '1.0.0')).rejects.toThrow(
      /capabilities are unavailable: files.missing/,
    )
  })

  it('restores the previous secret when its database reference cannot be updated', async () => {
    const secrets = new Map<string, string>()
    const secretStore: ToolPackageSecretStore = {
      get: async (ref) => secrets.get(ref) ?? null,
      set: async (ref, value) => {
        secrets.set(ref, value)
      },
      delete: async (ref) => secrets.delete(ref),
    }
    await service!.dispose()
    service = new ToolPackageService(
      db!,
      join(root, 'installed'),
      capabilities,
      undefined,
      secretStore,
    )
    const source = await createSource(
      root,
      manifest('1.0.0', {
        environment: [
          {
            name: 'EXTERNAL_API_TOKEN',
            title: 'External API token',
            type: 'string',
            required: true,
            secret: true,
            agentConfigurable: true,
          },
        ],
      }),
    )
    await service.installDirectory({ sourcePath: source, source: 'local-directory' })
    await service.writeSecretFromSecureInput({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      name: 'EXTERNAL_API_TOKEN',
      value: 'previous-secret',
    })
    const setConfig = vi
      .spyOn(ToolPackageRepository.prototype, 'setConfig')
      .mockImplementationOnce(() => {
        throw new Error('database write failed')
      })

    await expect(
      service.writeSecretFromSecureInput({
        packageId: 'acme.productivity-suite',
        version: '1.0.0',
        name: 'EXTERNAL_API_TOKEN',
        value: 'replacement-secret',
      }),
    ).rejects.toThrow(/database write failed/)
    setConfig.mockRestore()
    expect([...secrets.values()]).toEqual(['previous-secret'])
  })

  it('does not let cancellation race with an in-flight secure Keychain write', async () => {
    const secrets = new Map<string, string>()
    let markStarted!: () => void
    let releaseWrite!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const secretStore: ToolPackageSecretStore = {
      get: async (ref) => secrets.get(ref) ?? null,
      set: async (ref, value) => {
        markStarted()
        await writeGate
        secrets.set(ref, value)
      },
      delete: async (ref) => secrets.delete(ref),
    }
    await service!.dispose()
    service = new ToolPackageService(
      db!,
      join(root, 'installed'),
      capabilities,
      undefined,
      secretStore,
    )
    const source = await createSource(
      root,
      manifest('1.0.0', {
        environment: [
          {
            name: 'EXTERNAL_API_TOKEN',
            title: 'External API token',
            type: 'string',
            required: true,
            secret: true,
            agentConfigurable: true,
          },
        ],
      }),
    )
    await service.installDirectory({ sourcePath: source, source: 'local-directory' })
    const request = service.requestSecretInput({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      name: 'EXTERNAL_API_TOKEN',
      actor: 'user',
    })

    const fulfillment = service.fulfillSecureRequest(request.id, 'secure-value')
    await started
    expect(() => service!.cancelSecureRequest(request.id)).toThrow(/currently being fulfilled/)
    releaseWrite()
    await expect(fulfillment).resolves.toBeUndefined()
    expect(service.listPendingSecureRequests()).toEqual([])
    await expect(service.getEnvironmentStatus('acme.productivity-suite', '1.0.0')).resolves.toEqual(
      [expect.objectContaining({ name: 'EXTERNAL_API_TOKEN', configured: true })],
    )
  })

  it('uninstalls a disabled package with its files, database rows and Keychain secrets', async () => {
    const secrets = new Map<string, string>()
    const secretStore: ToolPackageSecretStore = {
      get: async (ref) => secrets.get(ref) ?? null,
      set: async (ref, value) => {
        secrets.set(ref, value)
      },
      delete: async (ref) => secrets.delete(ref),
    }
    await service!.dispose()
    service = new ToolPackageService(
      db!,
      join(root, 'installed'),
      capabilities,
      undefined,
      secretStore,
    )
    const source = await createSource(
      root,
      manifest('1.0.0', {
        environment: [
          {
            name: 'EXTERNAL_API_TOKEN',
            title: 'External API token',
            type: 'string',
            required: true,
            secret: true,
            agentConfigurable: true,
          },
        ],
      }),
    )
    await service.installDirectory({ sourcePath: source, source: 'local-directory' })
    await service.writeSecretFromSecureInput({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      name: 'EXTERNAL_API_TOKEN',
      value: 'to-be-removed',
    })
    expect(secrets.size).toBe(1)
    const events: string[] = []
    service.onChange((event) => events.push(event.change))
    const installedDir = join(root, 'installed', 'acme.productivity-suite')
    expect(existsSync(installedDir)).toBe(true)

    const result = await service.uninstallPackage({ packageId: 'acme.productivity-suite' })

    expect(result).toEqual({
      packageId: 'acme.productivity-suite',
      removedVersions: ['1.0.0'],
      removedSecrets: 1,
      removedManagedProject: false,
    })
    expect(existsSync(installedDir)).toBe(false)
    expect(service.listSummaries()).toEqual([])
    expect([...secrets.entries()]).toEqual([])
    expect(events).toEqual(['uninstalled'])
    await expect(
      service.uninstallPackage({ packageId: 'acme.productivity-suite' }),
    ).rejects.toThrow(/not found/)
  })

  it('refuses to uninstall an enabled package until it is disabled', async () => {
    const source = await createSource(root, manifest('1.0.0'))
    await service!.installDirectory({ sourcePath: source, source: 'local-directory' })
    await service!.setEnabled('acme.productivity-suite', '1.0.0')

    await expect(
      service!.uninstallPackage({ packageId: 'acme.productivity-suite' }),
    ).rejects.toThrow(/must be disabled before uninstall/)
    await service!.setEnabled('acme.productivity-suite', null)
    await expect(
      service!.uninstallPackage({ packageId: 'acme.productivity-suite' }),
    ).resolves.toMatchObject({ removedVersions: ['1.0.0'], removedManagedProject: false })
  })

  it('removes the managed project directory only when uninstall explicitly requests it', async () => {
    const preserved = await service!.createManagedProject({
      manifest: manifest('1.0.0'),
      files: [{ path: 'runner.mjs', content: 'process.stdin.resume()\n' }],
    })
    await service!.installDirectory({
      sourcePath: preserved.projectPath,
      source: 'managed-project',
    })
    const preservedDir = join(root, 'tool-projects', preserved.packageId)
    expect(existsSync(preservedDir)).toBe(true)
    await service!.uninstallPackage({ packageId: preserved.packageId })
    expect(existsSync(preservedDir)).toBe(true)

    const deleted = await service!.createManagedProject({
      manifest: manifest('1.0.0', { id: 'acme.cleanup-suite' }),
      files: [{ path: 'runner.mjs', content: 'process.stdin.resume()\n' }],
    })
    await service!.installDirectory({
      sourcePath: deleted.projectPath,
      source: 'managed-project',
    })
    const deletedDir = join(root, 'tool-projects', deleted.packageId)
    expect(existsSync(deletedDir)).toBe(true)
    await service!.uninstallPackage({
      packageId: deleted.packageId,
      removeManagedProject: true,
    })
    expect(existsSync(deletedDir)).toBe(false)
  })

  it('governs immutable version deletion with enabled and last-version guards', async () => {
    const firstSource = await createSource(root, manifest('1.0.0'))
    const secondSource = await createSource(root, manifest('2.0.0'))
    await service!.installDirectory({ sourcePath: firstSource, source: 'local-directory' })
    await service!.installDirectory({ sourcePath: secondSource, source: 'local-directory' })
    await service!.setEnabled('acme.productivity-suite', '2.0.0')

    await expect(
      service!.deleteVersion({ packageId: 'acme.productivity-suite', version: '2.0.0' }),
    ).rejects.toThrow(/must be disabled first/)
    await expect(
      service!.deleteVersion({ packageId: 'acme.productivity-suite', version: '9.9.9' }),
    ).rejects.toThrow(/not found/)

    const events: string[] = []
    service!.onChange((event) => events.push(event.change))
    const removed = await service!.deleteVersion({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
    })
    expect(removed).toEqual({ removed: true, version: '1.0.0' })
    expect(existsSync(join(root, 'installed', 'acme.productivity-suite', '1.0.0'))).toBe(false)
    expect(existsSync(join(root, 'installed', 'acme.productivity-suite', '2.0.0'))).toBe(true)
    expect(service!.listSummaries()[0]).toMatchObject({ enabledVersion: '2.0.0' })
    expect(events).toEqual(['version-removed'])

    await expect(
      service!.deleteVersion({ packageId: 'acme.productivity-suite', version: '2.0.0' }),
    ).rejects.toThrow(/must be disabled first/)
    await service!.setEnabled('acme.productivity-suite', null)
    await expect(
      service!.deleteVersion({ packageId: 'acme.productivity-suite', version: '2.0.0' }),
    ).rejects.toThrow(/single version/)
  })

  it('invalidates a persistent process when its permission state changes', async () => {
    const source = await createSource(
      root,
      manifest('1.0.0', {
        runtime: {
          adapter: 'process',
          protocol: 'spark-tool-process-v1',
          command: process.execPath,
          args: ['runner.mjs'],
          lifecycle: 'persistent',
        },
        permissions: {
          declaredOsEffects: [],
          requiredSparkCapabilities: [],
          optionalSparkCapabilities: ['files.upload'],
        },
      }),
    )
    await service!.installDirectory({ sourcePath: source, source: 'local-directory' })
    await service!.setEnabled('acme.productivity-suite', '1.0.0')
    const first = (await service!.invoke({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      toolName: 'generate_report',
      input: { includePid: true },
    })) as { pid: number }

    service!.setPermission({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      kind: 'spark-capability',
      permission: 'files.upload',
      state: 'granted',
    })
    const second = (await service!.invoke({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
      toolName: 'generate_report',
      input: { includePid: true },
    })) as { pid: number }

    expect(second.pid).not.toBe(first.pid)
  })

  it('installs a zip archive as an immutable local-archive version and cleans up staging', async () => {
    const archiveDir = await mkdtemp(join(root, 'archive-'))
    const archivePath = join(archiveDir, 'suite.zip')
    const archive = zipSync({
      'spark-tool.json': [
        new TextEncoder().encode(JSON.stringify(manifest('1.0.0'))),
        {
          level: 0,
        },
      ],
      'runner.mjs': [new TextEncoder().encode('process.stdin.resume()\n'), { level: 0 }],
    })
    await writeFile(archivePath, archive)

    const installed = await service!.installArchive({ archivePath })

    expect(installed.package.id).toBe('acme.productivity-suite')
    expect(installed.package.source).toBe('local-archive')
    expect(installed.version).toBe('1.0.0')
    expect(
      existsSync(join(root, 'installed', 'acme.productivity-suite', '1.0.0', 'runner.mjs')),
    ).toBe(true)

    const detail = await service!.getDetail('acme.productivity-suite', '1.0.0')
    expect(detail.sourceUrl).toBeNull()
    expect(detail.sourceRef).toBeNull()
    expect(detail.sourceSubdirectory).toBeNull()

    const importStaging = join(root, 'tool-imports')
    const leftovers = existsSync(importStaging) ? await readdir(importStaging) : []
    expect(leftovers.filter((entry) => entry.startsWith('archive-'))).toEqual([])
  })

  it('installs a git repository with provenance and subdirectory support', async () => {
    const originDir = await mkdtemp(join(root, 'git-origin-'))
    const suiteDir = join(originDir, 'packages', 'suite')
    await mkdir(suiteDir, { recursive: true })
    await writeFile(join(suiteDir, 'spark-tool.json'), JSON.stringify(manifest('1.0.0')), 'utf8')
    await writeFile(join(suiteDir, 'runner.mjs'), 'process.stdin.resume()\n', 'utf8')
    const execFileAsync = promisify(execFile)
    const git = async (...args: string[]): Promise<void> => {
      await execFileAsync('git', args, { cwd: originDir })
    }
    await git('init', '--initial-branch=main')
    await git('add', '.')
    await execFileAsync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'],
      { cwd: originDir },
    )

    const installed = await service!.installGitRepository({
      url: originDir,
      subdirectory: 'packages/suite',
    })

    expect(installed.package.source).toBe('registry')
    expect(installed.version).toBe('1.0.0')
    expect(
      existsSync(join(root, 'installed', 'acme.productivity-suite', '1.0.0', 'runner.mjs')),
    ).toBe(true)

    const detail = await service!.getDetail('acme.productivity-suite', '1.0.0')
    expect(detail.sourceUrl).toBe(originDir)
    expect(detail.sourceRef).toBeNull()
    expect(detail.sourceSubdirectory).toBe('packages/suite')

    const importStaging = join(root, 'tool-imports')
    const leftovers = existsSync(importStaging) ? await readdir(importStaging) : []
    expect(leftovers.filter((entry) => entry.startsWith('git-'))).toEqual([])
  })

  it('rejects a git archive provenance mismatch when reinstalling the same version', async () => {
    const originDir = await mkdtemp(join(root, 'git-origin-'))
    const suiteDir = join(originDir, 'packages', 'suite')
    await mkdir(suiteDir, { recursive: true })
    await writeFile(join(suiteDir, 'spark-tool.json'), JSON.stringify(manifest('1.0.0')), 'utf8')
    await writeFile(join(suiteDir, 'runner.mjs'), 'process.stdin.resume()\n', 'utf8')
    const execFileAsync = promisify(execFile)
    await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: originDir })
    await execFileAsync('git', ['add', '.'], { cwd: originDir })
    await execFileAsync(
      'git',
      ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'],
      { cwd: originDir },
    )

    await service!.installGitRepository({ url: originDir, subdirectory: 'packages/suite' })
    // 同一版本重新导入必须幂等命中同一记录，而不是报不可变冲突。
    const again = await service!.installGitRepository({
      url: originDir,
      subdirectory: 'packages/suite',
    })
    expect(again.version).toBe('1.0.0')
  })

  it('installs a remote-http manifest as a manifest-only immutable version', async () => {
    const remote = manifest('2.0.0', {
      runtime: {
        adapter: 'remote-http',
        protocol: 'spark-tool-process-v1',
        baseUrl: 'https://tools.acme.example/v1/invoke',
      },
    })
    const installed = await service!.installRemoteManifest({ manifest: remote })

    expect(installed.package.source).toBe('remote')
    expect(installed.version).toBe('2.0.0')
    const versionDir = join(root, 'installed', 'acme.productivity-suite', '2.0.0')
    expect(existsSync(join(versionDir, 'spark-tool.json'))).toBe(true)
    const snapshotFiles = await readdir(versionDir)
    expect(snapshotFiles).toEqual(['spark-tool.json'])

    const detail = await service!.getDetail('acme.productivity-suite', '2.0.0')
    expect(detail.sourceUrl).toBe('https://tools.acme.example/v1/invoke')

    // 非 remote-http manifest 不能走远端安装入口。
    await expect(service!.installRemoteManifest({ manifest: manifest('3.0.0') })).rejects.toThrow(
      /only accepts remote-http manifests/,
    )
  })

  it('dispatches enabled remote-http tools through the frame protocol', async () => {
    let lastAuth: string | undefined
    let lastBody: Record<string, unknown> = {}
    const server = await startFrameServer((frame, authorization) => {
      lastAuth = authorization
      lastBody = frame
      return {
        type: 'result',
        protocolVersion: 'spark-tool-process-v1',
        requestId: frame.requestId,
        sequence: 0,
        invocationId: frame.invocationId,
        result: { ok: true, sku: (frame.input as { sku?: string }).sku },
      }
    })

    const remote = manifest('2.0.0', {
      runtime: {
        adapter: 'remote-http',
        protocol: 'spark-tool-process-v1',
        baseUrl: server.baseUrl,
        headers: { Authorization: 'Bearer ${ACME_API_TOKEN}' },
        timeoutMs: 5_000,
      },
      environment: [
        {
          name: 'ACME_API_TOKEN',
          title: 'Acme API token',
          type: 'string',
          required: true,
          secret: true,
          agentConfigurable: false,
        },
      ],
    })
    await service!.installRemoteManifest({ manifest: remote })
    await service!.writeSecretFromSecureInput({
      packageId: 'acme.productivity-suite',
      name: 'ACME_API_TOKEN',
      value: 'frame-token',
    })
    await service!.setEnabled('acme.productivity-suite', '2.0.0')

    const catalog = new ToolPackageRuntimeCatalog(service!)
    const entry = catalog.list()[0]
    const result = await entry!.invoke({ sku: 'A-7' })

    expect(result).toMatchObject({ ok: true, sku: 'A-7' })
    expect(lastBody).toMatchObject({ type: 'invoke', toolName: 'generate_report' })
    expect(lastAuth).toBe('Bearer frame-token')
    await server.close()
  })

  it('imports MCP server tools with conservative defaults and name normalization', async () => {
    const bridge = new FakeMcpBridge([
      {
        name: 'searchDocs',
        description: 'Search docs',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'docs.search',
        description: 'Dot tool',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'fetch-page',
        description: 'Fetch a page',
        inputSchema: { type: 'object', properties: {} },
      },
    ])
    const withBridge = new ToolPackageService(
      db!,
      join(root, 'installed-mcp'),
      capabilities,
      undefined,
      undefined,
      bridge,
    )
    services.push(withBridge)

    const result = await withBridge.installMcpImport({ serverId: 'srv-docs' })

    expect(result.importedTools.sort()).toEqual(['docs-search', 'fetch-page', 'searchdocs'])
    expect(result.skippedTools).toEqual([])

    const manifestJson = await readFile(
      join(root, 'installed-mcp', result.package.id, '1.0.0', 'spark-tool.json'),
      'utf8',
    )
    const installed = JSON.parse(manifestJson) as ToolPackageManifest
    expect(installed.runtime).toMatchObject({ adapter: 'mcp-import', serverId: 'srv-docs' })
    if (installed.runtime.adapter !== 'mcp-import') throw new Error('expected mcp-import runtime')
    expect(installed.runtime.toolNameOverrides).toEqual({
      'docs-search': 'docs.search',
      searchdocs: 'searchDocs',
    })
    for (const tool of installed.tools) {
      expect(tool.risk).toBe('low-write')
      expect(tool.effect).toBe('update')
      expect(tool.idempotency).toBe('unsafe')
    }

    // 指定不存在的工具名必须整体失败并列出缺失项。
    await expect(
      withBridge.installMcpImport({
        serverId: 'srv-docs',
        version: '1.1.0',
        tools: ['searchDocs', 'nope'],
      }),
    ).rejects.toThrow(/does not expose tools: nope/)
  })

  it('skips unimportable MCP tools with explicit reasons and rejects empty imports', async () => {
    const bridge = new FakeMcpBridge([
      // 归一化后只剩空串 → 不可导入。
      { name: '...', description: 'Dots only', inputSchema: { type: 'object', properties: {} } },
      // 超大 schema → 不可导入。
      {
        name: 'huge-tool',
        description: 'Huge',
        inputSchema: {
          type: 'object',
          properties: { blob: { type: 'string', description: 'x'.repeat(110_000) } },
        },
      },
    ])
    const withBridge = new ToolPackageService(
      db!,
      join(root, 'installed-mcp2'),
      capabilities,
      undefined,
      undefined,
      bridge,
    )
    services.push(withBridge)

    await expect(withBridge.installMcpImport({ serverId: 'srv-broken' })).rejects.toThrow(
      /exposes no importable tools/,
    )

    const partial = new FakeMcpBridge([
      { name: 'good.tool', description: 'Good', inputSchema: { type: 'object', properties: {} } },
      ...bridge.tools,
    ])
    const partialService = new ToolPackageService(
      db!,
      join(root, 'installed-mcp3'),
      capabilities,
      undefined,
      undefined,
      partial,
    )
    services.push(partialService)
    const result = await partialService.installMcpImport({ serverId: 'srv-broken' })
    expect(result.importedTools).toEqual(['good-tool'])
    expect(result.skippedTools.map((skip) => skip.name)).toEqual(['...', 'huge-tool'])
  })

  it('gates mcp-import enablement on the bridge and the configured server', async () => {
    // 无 bridge 的服务实例：导入必须明确失败。
    await expect(service!.installMcpImport({ serverId: 'srv-1' })).rejects.toThrow(/MCP bridge/)

    const goneServer = new FakeMcpBridge([
      { name: 'a-tool', description: 'A', inputSchema: { type: 'object', properties: {} } },
    ])
    const bridgeService = new ToolPackageService(
      db!,
      join(root, 'installed-gate'),
      capabilities,
      undefined,
      undefined,
      goneServer,
    )
    services.push(bridgeService)
    const installed = await bridgeService.installMcpImport({ serverId: 'srv-gone' })
    goneServer.existingServerIds.clear()
    await expect(bridgeService.setEnabled(installed.package.id, '1.0.0')).rejects.toThrow(
      /missing MCP server/,
    )
  })

  it('proxies mcp-import invocations through the bridge with overridden tool names', async () => {
    const bridge = new FakeMcpBridge([
      {
        name: 'searchDocs',
        description: 'Search docs',
        inputSchema: { type: 'object', properties: {} },
      },
    ])
    bridge.nextResult = { content: [{ type: 'text', text: '3 hits' }] }
    const bridgeService = new ToolPackageService(
      db!,
      join(root, 'installed-proxy'),
      capabilities,
      undefined,
      undefined,
      bridge,
    )
    services.push(bridgeService)
    const installed = await bridgeService.installMcpImport({ serverId: 'srv-proxy' })
    await bridgeService.setEnabled(installed.package.id, '1.0.0')

    const result = await bridgeService.invokeInstalledVersion({
      packageId: installed.package.id,
      version: '1.0.0',
      toolName: 'searchdocs',
      input: {},
    })
    expect(result).toEqual({ content: [{ type: 'text', text: '3 hits' }] })
    expect(bridge.calls).toEqual([{ serverId: 'srv-proxy', toolName: 'searchDocs', args: {} }])

    bridge.nextResult = { content: [{ type: 'text', text: 'index down' }], isError: true }
    await expect(
      bridgeService.invokeInstalledVersion({
        packageId: installed.package.id,
        version: '1.0.0',
        toolName: 'searchdocs',
        input: {},
      }),
    ).rejects.toThrow(/searchDocs failed: index down/)
  })
})
