import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolPackageManifest } from '@spark/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SparkDatabase } from '../database.js'
import { ToolPackageRepository } from './tool-package.repository.js'

function manifest(): ToolPackageManifest {
  return {
    schemaVersion: 1,
    id: 'acme.productivity-suite',
    version: '1.0.0',
    name: 'Productivity Suite',
    description: 'Neutral multi-tool package',
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
        description: 'Generate a report',
        inputSchema: { type: 'object', properties: {} },
        risk: 'read',
        effect: 'read',
        idempotency: 'safe',
      },
      {
        name: 'sync_record',
        title: 'Sync record',
        description: 'Synchronize one record',
        inputSchema: { type: 'object', properties: {} },
        risk: 'low-write',
        effect: 'update',
        idempotency: 'keyed',
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

describe('ToolPackageRepository', () => {
  let db: SparkDatabase
  let repository: ToolPackageRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-test-tool-package-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    repository = new ToolPackageRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('installs an immutable version disabled with tools and pending permissions', () => {
    const version = repository.installVersion({
      manifest: manifest(),
      source: 'local-directory',
      trust: 'trusted-local',
      installPath: '/managed/acme.productivity-suite/1.0.0',
      sourcePath: '/user/project',
      integritySha256: 'a'.repeat(64),
    })
    expect(version.status).toBe('installed')
    expect(repository.get('acme.productivity-suite')).toMatchObject({
      state: 'installed-disabled',
      enabled_version: null,
    })
    expect(repository.listTools('acme.productivity-suite', '1.0.0')).toEqual([
      expect.objectContaining({ tool_name: 'generate_report', enabled: 1 }),
      expect.objectContaining({ tool_name: 'sync_record', enabled: 1 }),
    ])
    expect(repository.listPermissions('acme.productivity-suite', '1.0.0')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'os-effect', permission: 'network', state: 'pending' }),
        expect.objectContaining({
          kind: 'spark-capability',
          permission: 'files.read',
          required: 1,
          state: 'pending',
        }),
        expect.objectContaining({
          kind: 'spark-capability',
          permission: 'models.invoke',
          required: 0,
          state: 'pending',
        }),
      ]),
    )
  })

  it('stores ordinary values separately from Keychain references', () => {
    repository.installVersion({
      manifest: manifest(),
      source: 'managed-project',
      trust: 'trusted-local',
      installPath: '/managed/acme.productivity-suite/1.0.0',
      integritySha256: 'b'.repeat(64),
    })
    repository.setConfig({
      packageId: 'acme.productivity-suite',
      scope: 'package',
      name: 'REPORT_MAX_ROWS',
      value: 5_000,
    })
    repository.setConfig({
      packageId: 'acme.productivity-suite',
      scope: 'package',
      name: 'EXTERNAL_API_TOKEN',
      keystoreRef: 'tool-package:acme.productivity-suite:package:EXTERNAL_API_TOKEN',
    })
    const rows = repository.listConfig('acme.productivity-suite')
    expect(rows).toEqual([
      expect.objectContaining({
        name: 'EXTERNAL_API_TOKEN',
        is_secret: 1,
        value_json: null,
      }),
      expect.objectContaining({
        name: 'REPORT_MAX_ROWS',
        is_secret: 0,
        value_json: '5000',
        keystore_ref: null,
      }),
    ])
  })

  it('switches the enabled version without mutating immutable version rows', () => {
    repository.installVersion({
      manifest: manifest(),
      source: 'local-directory',
      trust: 'trusted-local',
      installPath: '/managed/acme.productivity-suite/1.0.0',
      integritySha256: 'c'.repeat(64),
    })
    expect(repository.setEnabledVersion('acme.productivity-suite', '1.0.0')).toMatchObject({
      state: 'enabled',
      enabled_version: '1.0.0',
    })
    expect(repository.getVersion('acme.productivity-suite', '1.0.0')).toMatchObject({
      status: 'installed',
      integrity_sha256: 'c'.repeat(64),
    })
    expect(repository.setEnabledVersion('acme.productivity-suite', null)).toMatchObject({
      state: 'installed-disabled',
      enabled_version: null,
    })
  })

  it('rejects conflicting content for an immutable package version', () => {
    repository.installVersion({
      manifest: manifest(),
      source: 'local-directory',
      trust: 'trusted-local',
      installPath: '/managed/acme.productivity-suite/1.0.0',
      integritySha256: 'd'.repeat(64),
    })

    expect(() =>
      repository.installVersion({
        manifest: { ...manifest(), description: 'Mutated immutable version' },
        source: 'local-directory',
        trust: 'trusted-local',
        installPath: '/managed/acme.productivity-suite/1.0.0',
        integritySha256: 'e'.repeat(64),
      }),
    ).toThrow(/version is immutable/)
    expect(repository.getVersion('acme.productivity-suite', '1.0.0')).toMatchObject({
      integrity_sha256: 'd'.repeat(64),
    })
  })

  it('keeps a blocked package blocked when a new version is installed', () => {
    repository.installVersion({
      manifest: manifest(),
      source: 'local-directory',
      trust: 'blocked',
      installPath: '/managed/acme.productivity-suite/1.0.0',
      integritySha256: 'f'.repeat(64),
    })
    repository.installVersion({
      manifest: { ...manifest(), version: '2.0.0' },
      source: 'local-directory',
      trust: 'trusted-local',
      installPath: '/managed/acme.productivity-suite/2.0.0',
      integritySha256: '1'.repeat(64),
    })

    expect(repository.get('acme.productivity-suite')).toMatchObject({ trust: 'blocked' })
  })

  it('cannot enable a version row that is missing or not installed', () => {
    repository.installVersion({
      manifest: manifest(),
      source: 'local-directory',
      trust: 'trusted-local',
      installPath: '/managed/acme.productivity-suite/1.0.0',
      integritySha256: '2'.repeat(64),
    })

    expect(() => repository.setEnabledVersion('acme.productivity-suite', '9.9.9')).toThrow(
      /version is not installed/,
    )
    expect(repository.get('acme.productivity-suite')).toMatchObject({
      state: 'installed-disabled',
      enabled_version: null,
    })
  })
})
