import { writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { ComputerUseServices } from './ComputerUseServices.js'

const SMOKE_ARGUMENT = '--spark-verify-native-host'
const SMOKE_REPORT_ENV = 'SPARK_NATIVE_HOST_SMOKE_REPORT'

export interface ComputerUsePackagedSmokeResult {
  readonly requested: boolean
  readonly exitCode: number
}

/**
 * Release-only startup probe executed by the final Electron application, so the Native Host
 * sees the same signed parent it will trust in production. It never opens a window or dispatches
 * an action; the report contains only versions, permissions and stable diagnostics.
 */
export async function runComputerUsePackagedSmoke(options: {
  argv?: readonly string[]
  env?: NodeJS.ProcessEnv
  services: Pick<ComputerUseServices, 'backend' | 'diagnostics'>
}): Promise<ComputerUsePackagedSmokeResult> {
  if (!(options.argv ?? process.argv).includes(SMOKE_ARGUMENT)) {
    return { requested: false, exitCode: 0 }
  }
  const reportPath = (options.env ?? process.env)[SMOKE_REPORT_ENV]?.trim()
  if (reportPath == null || reportPath === '' || !isAbsolute(reportPath)) {
    return { requested: true, exitCode: 64 }
  }
  let report: Record<string, unknown>
  let exitCode = 0
  try {
    let capabilities = await options.services.backend.getCapabilities()
    const diagnostics = await options.services.diagnostics.collect()
    if (
      (!capabilities.available || capabilities.nativeHost == null) &&
      diagnostics.result.diagnosticCode === 'native_host_ready'
    ) {
      capabilities = await options.services.backend.getCapabilities()
    }
    const ready = capabilities.available && capabilities.nativeHost != null
    report = { ok: ready, capabilities, diagnostics }
    if (!ready) exitCode = 1
  } catch {
    report = {
      ok: false,
      error: 'native_host_smoke_failed',
    }
    exitCode = 1
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  })
  return { requested: true, exitCode }
}
