import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ToolPackageManifest } from '@spark/protocol'
import { SparkDatabase, ToolPackageRepository } from '@spark/storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolHostCapabilityBroker } from './tool-host-capability-broker.js'
import { ToolPackageRuntimeCatalog } from './tool-package-runtime-catalog.js'
import { ToolPackageService, type ToolPackageSecretStore } from './tool-package.service.js'

const migrationsDir = fileURLToPath(new URL('../../../../storage/migrations/', import.meta.url))
const roots: string[] = []

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

    const remoteSource = await createSource(
      root,
      manifest('2.0.0', {
        id: 'acme.remote-suite',
        runtime: {
          adapter: 'remote-http',
          protocol: 'spark-tool-process-v1',
          baseUrl: 'https://example.invalid/tools',
        },
      }),
    )
    await service!.installDirectory({ sourcePath: remoteSource, source: 'local-directory' })
    await expect(service!.setEnabled('acme.remote-suite', '2.0.0')).rejects.toThrow(
      /runtime adapter is not executable yet: remote-http/,
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
})
