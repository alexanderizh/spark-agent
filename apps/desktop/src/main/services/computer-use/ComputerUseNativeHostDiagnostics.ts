import { randomUUID } from 'node:crypto'
import { release } from 'node:os'
import type {
  ComputerUseCapabilitySummary,
  ComputerUseNativeHostDiagnosticReport,
  NativeHostPlatform,
} from '@spark/protocol'
import type { ComputerHostBackend, NativeHostDiagnosticProbe } from './ComputerUseBackend.js'
import type { ComputerUseMetricsCollector } from './ComputerUseMetricsCollector.js'

export class ComputerUseNativeHostDiagnostics {
  constructor(
    private readonly options: {
      backend: ComputerHostBackend
      metrics: ComputerUseMetricsCollector
      appVersion: () => string
      isPackaged: () => boolean
      platform?: () => NativeHostPlatform
      architecture?: () => string
      osRelease?: () => string
      now?: () => Date
      createId?: () => string
    },
  ) {}

  async collect(): Promise<ComputerUseNativeHostDiagnosticReport> {
    const probe = await collectProbe(this.options.backend)
    const manifest = probe.capabilities.nativeHost
    return {
      generatedAt: (this.options.now ?? (() => new Date()))().toISOString(),
      correlationId: (this.options.createId ?? randomUUID)(),
      app: {
        version: this.options.appVersion(),
        packaged: this.options.isPackaged(),
      },
      runtime: {
        platform: (this.options.platform ?? currentPlatform)(),
        architecture: (this.options.architecture ?? (() => process.arch))(),
        osRelease: (this.options.osRelease ?? release)(),
      },
      host: {
        available: probe.capabilities.available,
        version: manifest?.hostVersion ?? null,
        protocolVersion: manifest?.protocolVersion ?? null,
        platform: manifest?.platform ?? null,
        architecture: manifest?.architecture ?? null,
        permissions: probe.capabilities.permissions,
      },
      result: {
        diagnosticCode: probe.diagnostic.diagnosticCode,
        stage: probe.diagnostic.stage,
        repairAction: probe.diagnostic.repairAction ?? null,
        errorCode: probe.errorCode,
        message: probe.message,
      },
      metrics: this.options.metrics.snapshot().map((metric) => ({
        name: metric.name,
        count: metric.count,
        failures: metric.failures,
        averageMs: metric.averageMs,
        p95Ms: metric.p95Ms,
        p99Ms: metric.p99Ms,
      })),
      executionChannels: this.options.metrics.executionChannelSnapshot(),
    }
  }
}

async function collectProbe(backend: ComputerHostBackend): Promise<NativeHostDiagnosticProbe> {
  if (backend.diagnoseNativeHost != null) return backend.diagnoseNativeHost()
  const capabilities = await backend.getCapabilities()
  return fallbackProbe(capabilities)
}

function fallbackProbe(capabilities: ComputerUseCapabilitySummary): NativeHostDiagnosticProbe {
  if (capabilities.available) {
    return {
      capabilities,
      diagnostic: { diagnosticCode: 'native_host_ready', stage: 'handshake' },
      errorCode: null,
      message: 'Trusted Native Host verification and handshake succeeded',
    }
  }
  const errorCode = capabilities.unavailableReason ?? 'native_host_incompatible'
  const missing = errorCode === 'native_host_missing' || errorCode === 'trusted_native_host_missing'
  return {
    capabilities,
    diagnostic: {
      diagnosticCode: missing ? 'native_host_missing' : 'host_handshake_failed',
      stage: missing ? 'discover' : 'handshake',
      repairAction: missing ? 'reinstall' : 'restart_app',
    },
    errorCode,
    message: missing
      ? 'A trusted Computer Use native backend is not installed'
      : 'Trusted Native Host verification or handshake failed',
  }
}

function currentPlatform(): NativeHostPlatform {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}
