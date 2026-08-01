import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { runComputerUsePackagedSmoke } from './ComputerUsePackagedSmoke.js'

describe('runComputerUsePackagedSmoke', () => {
  it('runs only when explicitly requested and writes a content-free readiness report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-native-smoke-'))
    const reportPath = join(root, 'report.json')
    try {
      const result = await runComputerUsePackagedSmoke({
        argv: ['SparkWork', '--spark-verify-native-host'],
        env: { SPARK_NATIVE_HOST_SMOKE_REPORT: reportPath },
        services: {
          backend: {
            getCapabilities: async () => ({
              available: true,
              platform: 'macos',
              nativeHost: { protocolVersion: 1, hostVersion: '0.1.0' },
            }),
          } as never,
          diagnostics: { collect: async () => ({ result: { stage: 'handshake' } }) } as never,
        },
      })

      expect(result).toEqual({ requested: true, exitCode: 0 })
      await expect(readFile(reportPath, 'utf8').then(JSON.parse)).resolves.toMatchObject({
        ok: true,
        capabilities: { available: true },
        diagnostics: { result: { stage: 'handshake' } },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reconciles a cold trust-probe timeout after diagnostics prove the Host is ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-native-smoke-'))
    const reportPath = join(root, 'report.json')
    let capabilityCalls = 0
    try {
      const result = await runComputerUsePackagedSmoke({
        argv: ['SparkWork', '--spark-verify-native-host'],
        env: { SPARK_NATIVE_HOST_SMOKE_REPORT: reportPath },
        services: {
          backend: {
            getCapabilities: async () => {
              capabilityCalls += 1
              return capabilityCalls === 1
                ? { available: false, platform: 'windows', nativeHost: null }
                : {
                    available: true,
                    platform: 'windows',
                    nativeHost: { protocolVersion: 1, hostVersion: '0.1.0' },
                  }
            },
          } as never,
          diagnostics: {
            collect: async () => ({ result: { diagnosticCode: 'native_host_ready' } }),
          } as never,
        },
      })

      expect(result).toEqual({ requested: true, exitCode: 0 })
      expect(capabilityCalls).toBe(2)
      await expect(readFile(reportPath, 'utf8').then(JSON.parse)).resolves.toMatchObject({
        ok: true,
        capabilities: { available: true },
        diagnostics: { result: { diagnosticCode: 'native_host_ready' } },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does nothing without the release verifier argument', async () => {
    await expect(
      runComputerUsePackagedSmoke({ argv: ['SparkWork'], services: {} as never }),
    ).resolves.toEqual({ requested: false, exitCode: 0 })
  })

  it('fails closed when the report destination is missing or relative', async () => {
    await expect(
      runComputerUsePackagedSmoke({
        argv: ['SparkWork', '--spark-verify-native-host'],
        env: { SPARK_NATIVE_HOST_SMOKE_REPORT: 'report.json' },
        services: {} as never,
      }),
    ).resolves.toEqual({ requested: true, exitCode: 64 })
  })

  it('writes a bounded failure report when the Native Host probe throws', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-native-smoke-'))
    const reportPath = join(root, 'report.json')
    try {
      const result = await runComputerUsePackagedSmoke({
        argv: ['SparkWork', '--spark-verify-native-host'],
        env: { SPARK_NATIVE_HOST_SMOKE_REPORT: reportPath },
        services: {
          backend: {
            getCapabilities: async () => {
              throw new Error('handshake failed')
            },
          } as never,
          diagnostics: {} as never,
        },
      })

      expect(result).toEqual({ requested: true, exitCode: 1 })
      await expect(readFile(reportPath, 'utf8').then(JSON.parse)).resolves.toEqual({
        ok: false,
        error: 'native_host_smoke_failed',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('never overwrites an existing report destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-native-smoke-'))
    const reportPath = join(root, 'report.json')
    try {
      await writeFile(reportPath, 'do-not-overwrite')
      await expect(
        runComputerUsePackagedSmoke({
          argv: ['SparkWork', '--spark-verify-native-host'],
          env: { SPARK_NATIVE_HOST_SMOKE_REPORT: reportPath },
          services: {
            backend: { getCapabilities: async () => ({ available: false }) } as never,
            diagnostics: { collect: async () => ({}) } as never,
          },
        }),
      ).rejects.toMatchObject({ code: 'EEXIST' })
      await expect(readFile(reportPath, 'utf8')).resolves.toBe('do-not-overwrite')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
