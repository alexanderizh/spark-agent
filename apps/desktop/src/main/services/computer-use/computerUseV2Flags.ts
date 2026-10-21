export const COMPUTER_USE_V2_FLAGS = [
  'hostSupervisor',
  'installedArtifactDiagnostics',
  'persistentCapture',
  'incrementalTree',
  'actionBatch',
  'backgroundSemanticLane',
  'activityTimeline',
  'visibleControlIndicator',
  'windowHighlightIndicator',
  'statusBanner',
  'actionSkyshot',
  'pipPanel',
] as const

export type ComputerUseV2FlagName = (typeof COMPUTER_USE_V2_FLAGS)[number]

export interface ComputerUseV2FlagSnapshot {
  readonly name: ComputerUseV2FlagName
  readonly enabled: boolean
  readonly source: 'default' | 'environment' | 'runtime_rollback'
  readonly rollbackReason?: string
}

const ENVIRONMENT_KEYS: Record<ComputerUseV2FlagName, string> = {
  hostSupervisor: 'SPARK_COMPUTER_USE_V2_HOST_SUPERVISOR',
  installedArtifactDiagnostics: 'SPARK_COMPUTER_USE_V2_INSTALLED_ARTIFACT_DIAGNOSTICS',
  persistentCapture: 'SPARK_COMPUTER_USE_V2_PERSISTENT_CAPTURE',
  incrementalTree: 'SPARK_COMPUTER_USE_V2_INCREMENTAL_TREE',
  actionBatch: 'SPARK_COMPUTER_USE_V2_ACTION_BATCH',
  backgroundSemanticLane: 'SPARK_COMPUTER_USE_V2_BACKGROUND_SEMANTIC_LANE',
  activityTimeline: 'SPARK_COMPUTER_USE_V2_ACTIVITY_TIMELINE',
  visibleControlIndicator: 'SPARK_COMPUTER_USE_V2_VISIBLE_CONTROL_INDICATOR',
  windowHighlightIndicator: 'SPARK_COMPUTER_USE_V2_WINDOW_HIGHLIGHT',
  statusBanner: 'SPARK_COMPUTER_USE_V2_STATUS_BANNER',
  actionSkyshot: 'SPARK_COMPUTER_USE_V2_ACTION_SKYSHOT',
  pipPanel: 'SPARK_COMPUTER_USE_V2_PIP_PANEL',
}

// V2 is the shipped product path. Every optimization can still be disabled explicitly
// through its environment key or independently rolled back for the current process.
const DEFAULTS: Record<ComputerUseV2FlagName, boolean> = {
  hostSupervisor: true,
  installedArtifactDiagnostics: true,
  persistentCapture: true,
  incrementalTree: true,
  actionBatch: true,
  backgroundSemanticLane: true,
  activityTimeline: true,
  visibleControlIndicator: false,
  windowHighlightIndicator: true,
  statusBanner: true,
  actionSkyshot: true,
  pipPanel: true,
}

export class ComputerUseV2FlagStore {
  private readonly env: NodeJS.ProcessEnv
  private readonly runtimeRollbacks = new Map<ComputerUseV2FlagName, string>()
  /**
   * User-preference overrides (settings page toggles), layered ABOVE env and
   * defaults but BELOW automatic rollbacks: a user toggle must never resurrect
   * a capability the runtime disabled for its own safety, and a rollback must
   * still win over a stale "enabled" preference.
   */
  private readonly userOverrides = new Map<ComputerUseV2FlagName, boolean>()

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env
  }

  isEnabled(name: ComputerUseV2FlagName): boolean {
    if (this.runtimeRollbacks.has(name)) return false
    const userOverride = this.userOverrides.get(name)
    if (userOverride != null) return userOverride
    return resolveConfiguredFlag(name, this.env).enabled
  }

  disableForRuntime(name: ComputerUseV2FlagName, reason: string): boolean {
    if (!this.isEnabled(name)) return false
    this.runtimeRollbacks.set(name, reason.trim().slice(0, 500) || 'automatic_rollback')
    return true
  }

  setUserOverride(name: ComputerUseV2FlagName, enabled: boolean | null): void {
    if (enabled == null) this.userOverrides.delete(name)
    else this.userOverrides.set(name, enabled)
  }

  snapshot(): ComputerUseV2FlagSnapshot[] {
    return COMPUTER_USE_V2_FLAGS.map((name) => {
      const rollbackReason = this.runtimeRollbacks.get(name)
      if (rollbackReason != null) {
        return { name, enabled: false, source: 'runtime_rollback', rollbackReason }
      }
      const userOverride = this.userOverrides.get(name)
      if (userOverride != null) {
        return { name, enabled: userOverride, source: 'default' }
      }
      const configured = resolveConfiguredFlag(name, this.env)
      return { name, enabled: configured.enabled, source: configured.source }
    })
  }
}

const defaultFlagStore = new ComputerUseV2FlagStore()

export function getComputerUseV2FlagStore(): ComputerUseV2FlagStore {
  return defaultFlagStore
}

export function isHostSupervisorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return enabledFor('hostSupervisor', env)
}

export function isIncrementalTreeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return enabledFor('incrementalTree', env)
}

export function isActionBatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return enabledFor('actionBatch', env)
}

export function isInstalledArtifactDiagnosticsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return enabledFor('installedArtifactDiagnostics', env)
}

export function isPersistentCaptureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return enabledFor('persistentCapture', env)
}

export function isBackgroundSemanticLaneEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return enabledFor('backgroundSemanticLane', env)
}

export function isActivityTimelineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return enabledFor('activityTimeline', env)
}

export function isVisibleControlIndicatorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return enabledFor('visibleControlIndicator', env)
}

export function isWindowHighlightIndicatorEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return enabledFor('windowHighlightIndicator', env)
}

export function isStatusBannerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return enabledFor('statusBanner', env)
}

function enabledFor(name: ComputerUseV2FlagName, env: NodeJS.ProcessEnv): boolean {
  return env === process.env
    ? defaultFlagStore.isEnabled(name)
    : resolveConfiguredFlag(name, env).enabled
}

function resolveConfiguredFlag(
  name: ComputerUseV2FlagName,
  env: NodeJS.ProcessEnv,
): { enabled: boolean; source: 'default' | 'environment' } {
  const raw = env[ENVIRONMENT_KEYS[name]]
  if (raw == null || raw.trim() === '') return { enabled: DEFAULTS[name], source: 'default' }
  return { enabled: parseBooleanFlag(raw), source: 'environment' }
}

function parseBooleanFlag(raw: string): boolean {
  const value = raw.trim().toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'no' && value !== 'off'
}
