import type { ComputerUseCapabilitySummary } from '@spark/protocol'
import { describe, expect, it } from 'vitest'
import { ComputerUseMetricsCollector } from './ComputerUseMetricsCollector.js'
import { ComputerUseNativeHostDiagnostics } from './ComputerUseNativeHostDiagnostics.js'

const UNAVAILABLE: ComputerUseCapabilitySummary = {
  available: false,
  platform: 'macos',
  nativeHost: null,
  permissions: { screen: 'unsupported', accessibility: 'unsupported', input: 'unsupported' },
  unavailableReason: 'native_host_untrusted',
}

describe('ComputerUseNativeHostDiagnostics', () => {
  it('returns a stable, content-free diagnostic report without developer tools', async () => {
    const metrics = new ComputerUseMetricsCollector()
    metrics.record(
      'native_host_capability_ms',
      42,
      {
        platform: 'macos',
        architecture: 'arm64',
        appVersion: '0.8.14',
        hostVersion: 'unknown',
        trustMode: 'signed',
      },
      false,
    )
    metrics.recordExecutionOutcome('background_ax', true)
    metrics.recordExecutionOutcome('foreground_cg', false)
    const diagnostics = new ComputerUseNativeHostDiagnostics({
      backend: {
        getCapabilities: async () => UNAVAILABLE,
        listWindows: async () => [],
        diagnoseNativeHost: async () => ({
          capabilities: UNAVAILABLE,
          diagnostic: {
            diagnosticCode: 'artifact_digest_mismatch',
            stage: 'verify',
            repairAction: 'reinstall',
          },
          errorCode: 'native_host_untrusted',
          message: 'Native Host digest mismatch',
        }),
      },
      metrics,
      appVersion: () => '0.8.14',
      isPackaged: () => true,
      platform: () => 'macos',
      architecture: () => 'arm64',
      osRelease: () => '25.0.0',
      now: () => new Date('2026-07-31T00:00:00.000Z'),
      createId: () => 'diagnostic-1',
    })

    await expect(diagnostics.collect()).resolves.toEqual({
      generatedAt: '2026-07-31T00:00:00.000Z',
      correlationId: 'diagnostic-1',
      app: { version: '0.8.14', packaged: true },
      runtime: { platform: 'macos', architecture: 'arm64', osRelease: '25.0.0' },
      host: {
        available: false,
        version: null,
        protocolVersion: null,
        platform: null,
        architecture: null,
        permissions: UNAVAILABLE.permissions,
      },
      result: {
        diagnosticCode: 'artifact_digest_mismatch',
        stage: 'verify',
        repairAction: 'reinstall',
        errorCode: 'native_host_untrusted',
        message: 'Native Host digest mismatch',
      },
      metrics: [
        {
          name: 'native_host_capability_ms',
          count: 1,
          failures: 1,
          averageMs: 42,
          p95Ms: 42,
          p99Ms: 42,
        },
      ],
      executionChannels: {
        total: 2,
        backgroundShare: 0.5,
        channels: [
          { channel: 'background_ax', count: 1, failures: 0, successRate: 1, share: 0.5 },
          { channel: 'foreground_cg', count: 1, failures: 1, successRate: 0, share: 0.5 },
        ],
      },
    })
  })
})
