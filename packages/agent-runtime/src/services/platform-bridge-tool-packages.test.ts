import type {
  ToolPackageDetail,
  ToolPackageProjectStepResult,
  ToolPackageUninstallResult,
} from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  handleToolPackageBridgeMethod,
  type ToolPackageBridgeMethod,
} from './platform-bridge-tool-packages.js'
import type { ToolPackageService } from './tool-packages/tool-package.service.js'

function detail(): ToolPackageDetail {
  return {
    package: {
      id: 'acme.productivity-suite',
      name: 'Productivity Suite',
      description: 'Fixture package',
      source: 'local-directory',
      trust: 'trusted-local',
      state: 'installed-disabled',
      enabledVersion: null,
      versions: ['1.0.0'],
      updatedAt: '2026-08-31T00:00:00.000Z',
    },
    version: '1.0.0',
    manifest: {
      schemaVersion: 1,
      id: 'acme.productivity-suite',
      version: '1.0.0',
      name: 'Productivity Suite',
      description: 'Fixture package',
      runtime: {
        adapter: 'process',
        protocol: 'spark-tool-process-v1',
        command: 'node',
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
      environment: [
        {
          name: 'REPORT_LIMIT',
          title: 'Report limit',
          description: 'Maximum rows',
          type: 'integer',
          required: true,
          secret: false,
          agentConfigurable: true,
          default: 100,
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
        declaredOsEffects: [],
        requiredSparkCapabilities: [],
        optionalSparkCapabilities: [],
      },
    },
    environment: [
      {
        name: 'REPORT_LIMIT',
        secret: false,
        required: true,
        agentConfigurable: true,
        configured: false,
        source: 'default',
      },
      {
        name: 'EXTERNAL_API_TOKEN',
        secret: true,
        required: true,
        agentConfigurable: true,
        configured: true,
        source: 'configured',
      },
    ],
    permissions: [],
  }
}

function service(overrides: Partial<ToolPackageService> = {}): ToolPackageService {
  return {
    listSummaries: vi.fn(() => [detail().package]),
    getDetail: vi.fn(async () => detail()),
    ...overrides,
  } as unknown as ToolPackageService
}

function call(
  target: ToolPackageService,
  method: ToolPackageBridgeMethod,
  params: Record<string, unknown> = {},
) {
  return handleToolPackageBridgeMethod(target, method, params)
}

describe('Tool Package platform bridge', () => {
  it('returns stable summaries and full installed package details', async () => {
    const target = service()
    await expect(call(target, 'tool_packages.list')).resolves.toEqual({
      packages: [detail().package],
    })
    await expect(
      call(target, 'tool_packages.get', {
        packageId: 'acme.productivity-suite',
        version: '1.0.0',
      }),
    ).resolves.toEqual({ detail: detail() })
    expect(target.getDetail).toHaveBeenCalledWith('acme.productivity-suite', '1.0.0')
  })

  it('returns environment declarations together with redacted configuration status', async () => {
    const response = (await call(service(), 'tool_packages.environment_status', {
      packageId: 'acme.productivity-suite',
    })) as { environment: Array<Record<string, unknown>> }

    expect(response.environment).toEqual([
      expect.objectContaining({
        name: 'REPORT_LIMIT',
        title: 'Report limit',
        type: 'integer',
        default: 100,
        configured: false,
        source: 'default',
      }),
      expect.objectContaining({
        name: 'EXTERNAL_API_TOKEN',
        title: 'External API token',
        secret: true,
        configured: true,
        source: 'configured',
      }),
    ])
    expect(JSON.stringify(response)).not.toContain('secret-value')
  })

  it('lists and reads managed project files through explicit read-only methods', async () => {
    const listManagedProjectFiles = vi.fn(async () => ({
      projectPath: '/managed/acme.productivity-suite',
      files: [{ path: 'src/index.ts', size: 24 }],
    }))
    const readManagedProjectFile = vi.fn(async () => ({
      projectPath: '/managed/acme.productivity-suite',
      path: 'src/index.ts',
      content: 'export const ready = true',
    }))
    const target = service({ listManagedProjectFiles, readManagedProjectFile })

    await expect(
      call(target, 'tool_packages.list_project_files', {
        packageId: 'acme.productivity-suite',
      }),
    ).resolves.toMatchObject({ files: [{ path: 'src/index.ts', size: 24 }] })
    await expect(
      call(target, 'tool_packages.read_project_file', {
        packageId: 'acme.productivity-suite',
        path: 'src/index.ts',
      }),
    ).resolves.toMatchObject({ content: 'export const ready = true' })
    expect(listManagedProjectFiles).toHaveBeenCalledWith('acme.productivity-suite')
    expect(readManagedProjectFile).toHaveBeenCalledWith({
      packageId: 'acme.productivity-suite',
      path: 'src/index.ts',
    })
  })

  it('rejects malformed source, enabled and file content values instead of coercing them', async () => {
    const target = service({
      installDirectory: vi.fn(),
      setEnabled: vi.fn(),
      createManagedProject: vi.fn(),
      writeManagedProjectFile: vi.fn(),
    } as Partial<ToolPackageService>)
    await expect(
      call(target, 'tool_packages.install_directory', {
        sourcePath: '/tmp/package',
        source: 'registry',
        confirmInstall: true,
      }),
    ).rejects.toThrow(/source must be managed-project or local-directory/)
    await expect(
      call(target, 'tool_packages.set_enabled', {
        packageId: 'acme.productivity-suite',
        enabled: 'false',
      }),
    ).rejects.toThrow(/enabled must be a boolean/)
    await expect(
      call(target, 'tool_packages.create_project', {
        manifest: detail().manifest,
        files: [{ path: 'src/index.ts', content: 42 }],
      }),
    ).rejects.toThrow(/content must be a string/)
    await expect(
      call(target, 'tool_packages.write_project_file', {
        packageId: 'acme.productivity-suite',
        path: 'src/index.ts',
        content: null,
      }),
    ).rejects.toThrow(/content must be a string/)
    expect(target.installDirectory).not.toHaveBeenCalled()
    expect(target.setEnabled).not.toHaveBeenCalled()
    expect(target.createManagedProject).not.toHaveBeenCalled()
    expect(target.writeManagedProjectFile).not.toHaveBeenCalled()
  })

  it('returns stable package summaries after install and lifecycle changes', async () => {
    const rawRow: Awaited<ReturnType<ToolPackageService['installDirectory']>> = {
      id: 'acme.productivity-suite',
      display_name: 'raw database name',
      description: 'raw database description',
      source: 'local-directory',
      trust: 'trusted-local',
      state: 'installed-disabled',
      enabled_version: null,
      created_at: '2026-08-31T00:00:00.000Z',
      updated_at: '2026-08-31T00:00:00.000Z',
    }
    const installDirectory = vi.fn(async () => rawRow)
    const setEnabled = vi.fn(async () => rawRow)
    const target = service({ installDirectory, setEnabled })

    await expect(
      call(target, 'tool_packages.install_directory', {
        sourcePath: '/tmp/package',
        source: 'local-directory',
        confirmInstall: true,
      }),
    ).resolves.toEqual({ package: detail().package })
    await expect(
      call(target, 'tool_packages.set_enabled', {
        packageId: 'acme.productivity-suite',
        version: '1.0.0',
        enabled: true,
        confirmEnable: true,
      }),
    ).resolves.toEqual({ package: detail().package })
  })

  it('gates project development steps behind confirmExecute and validates step', async () => {
    const runManagedProjectStep = vi.fn(
      async (): Promise<ToolPackageProjectStepResult> => ({
        packageId: 'acme.productivity-suite',
        step: 'install',
        command: 'npm install',
        inferred: true,
        exitCode: 0,
        timedOut: false,
        durationMs: 12,
        stdout: '',
        stderr: '',
        truncated: false,
      }),
    )
    const target = service({ runManagedProjectStep })

    await expect(
      call(target, 'tool_packages.run_project_step', {
        packageId: 'acme.productivity-suite',
        step: 'install',
      }),
    ).rejects.toThrow(/confirmExecute/)
    await expect(
      call(target, 'tool_packages.run_project_step', {
        packageId: 'acme.productivity-suite',
        step: 'deploy',
        confirmExecute: true,
      }),
    ).rejects.toThrow(/step must be install or build/)
    await expect(
      call(target, 'tool_packages.run_project_step', {
        packageId: 'acme.productivity-suite',
        step: 'install',
        confirmExecute: true,
      }),
    ).resolves.toEqual({
      result: expect.objectContaining({ step: 'install', exitCode: 0 }),
    })
    expect(runManagedProjectStep).toHaveBeenCalledWith({
      packageId: 'acme.productivity-suite',
      step: 'install',
    })
  })

  it('gates uninstall behind confirmUninstall and forwards the managed-project option', async () => {
    const uninstallResult: ToolPackageUninstallResult = {
      packageId: 'acme.productivity-suite',
      removedVersions: ['1.0.0'],
      removedSecrets: 1,
      removedManagedProject: false,
    }
    const uninstallPackage = vi.fn(async () => uninstallResult)
    const target = service({ uninstallPackage } as Partial<ToolPackageService>)

    await expect(
      call(target, 'tool_packages.uninstall', {
        packageId: 'acme.productivity-suite',
      }),
    ).rejects.toThrow(/confirmUninstall/)
    await expect(
      call(target, 'tool_packages.uninstall', {
        packageId: 'acme.productivity-suite',
        confirmUninstall: 'true',
      }),
    ).rejects.toThrow(/confirmUninstall/)
    expect(uninstallPackage).not.toHaveBeenCalled()

    await expect(
      call(target, 'tool_packages.uninstall', {
        packageId: 'acme.productivity-suite',
        confirmUninstall: true,
      }),
    ).resolves.toEqual({ result: uninstallResult })
    expect(uninstallPackage).toHaveBeenCalledWith({ packageId: 'acme.productivity-suite' })

    await call(target, 'tool_packages.uninstall', {
      packageId: 'acme.productivity-suite',
      confirmUninstall: true,
      removeManagedProject: true,
    })
    expect(uninstallPackage).toHaveBeenLastCalledWith({
      packageId: 'acme.productivity-suite',
      removeManagedProject: true,
    })
    await call(target, 'tool_packages.uninstall', {
      packageId: 'acme.productivity-suite',
      confirmUninstall: true,
      removeManagedProject: false,
    })
    expect(uninstallPackage).toHaveBeenLastCalledWith({ packageId: 'acme.productivity-suite' })
  })

  it('gates version deletion behind confirmUninstall and validates identifiers', async () => {
    const deleteVersion = vi.fn(async () => ({ removed: true as const, version: '1.0.0' }))
    const target = service({ deleteVersion } as Partial<ToolPackageService>)

    await expect(
      call(target, 'tool_packages.delete_version', {
        packageId: 'acme.productivity-suite',
        version: '1.0.0',
      }),
    ).rejects.toThrow(/confirmUninstall/)
    await expect(
      call(target, 'tool_packages.delete_version', {
        packageId: 'acme.productivity-suite',
        version: '1.0.0',
        confirmUninstall: true,
      }),
    ).resolves.toEqual({ removed: true, version: '1.0.0' })
    expect(deleteVersion).toHaveBeenCalledWith({
      packageId: 'acme.productivity-suite',
      version: '1.0.0',
    })
    await expect(
      call(target, 'tool_packages.delete_version', {
        version: '1.0.0',
        confirmUninstall: true,
      }),
    ).rejects.toThrow(/packageId is required/)
    await expect(
      call(target, 'tool_packages.delete_version', {
        packageId: 'acme.productivity-suite',
        confirmUninstall: true,
      }),
    ).rejects.toThrow(/version is required/)
  })
})
