import { execFile } from 'node:child_process'
import type { NativeWindowDescriptor } from '@spark/protocol'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'

const DEFAULT_LAUNCH_TIMEOUT_MS = 8_000
const DEFAULT_POLL_INTERVAL_MS = 100

export interface ComputerWindowInventory {
  listWindows(): Promise<NativeWindowDescriptor[]>
}

export class ComputerApplicationTargetResolver {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly launch: (application: string) => Promise<void> = (application) =>
      launchApplication(platform, application),
    private readonly wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly timeoutMs = DEFAULT_LAUNCH_TIMEOUT_MS,
    private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(
    application: string,
    inventory: ComputerWindowInventory,
    preference?: ApplicationTargetPreference,
  ): Promise<NativeWindowDescriptor | null> {
    const requested = normalizeApplicationName(application)
    const existing = findApplicationWindow(await inventory.listWindows(), requested, preference)
    if (this.platform !== 'darwin') return existing

    try {
      // `open` also raises an already-running application. This mirrors get_app_state(app)
      // semantics and avoids binding an unfocused Electron window.
      await this.launch(requested)
    } catch {
      return existing
    }
    const deadline = this.now() + this.timeoutMs
    do {
      const target = findApplicationWindow(await inventory.listWindows(), requested, preference)
      if (target != null) return target
      await this.wait(this.pollIntervalMs)
    } while (this.now() < deadline)
    return null
  }
}

const MIN_USABLE_WINDOW_SIDE = 120

export interface ApplicationTargetPreference {
  /**
   * Application id the session is already bound to. When several applications
   * share the requested display name, a candidate matching this id wins
   * outright — this is how a task aimed at the dev build keeps resolving to the
   * dev build even while the packaged install sits next to it.
   */
  preferredAppId?: string
}

export function findApplicationWindow(
  windows: NativeWindowDescriptor[],
  requestedApplication: string,
  preference?: ApplicationTargetPreference,
): NativeWindowDescriptor | null {
  const requested = requestedApplication.trim().toLocaleLowerCase()
  const matches = windows.filter((candidate) => {
    if (candidate.minimized) return false
    return [candidate.app.name, candidate.app.bundleId, candidate.app.id]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.trim().toLocaleLowerCase() === requested)
  })
  if (matches.length === 0) return null
  // Same display name owned by SEVERAL applications (packaged SparkWork vs the
  // dev Electron build, two browsers): resolving by "whoever is focused" is how
  // a task bound for one build ended up driving the other while focus bounced.
  // Prefer the session's bound application when it is among the candidates;
  // otherwise surface the ambiguity with the concrete ids instead of guessing —
  // the caller re-specifies by bundle id or window id.
  const candidateAppIds = [...new Set(matches.map((candidate) => candidate.app.id))]
  if (candidateAppIds.length > 1) {
    const preferred = preference?.preferredAppId
    const preferredMatches =
      preferred == null ? [] : matches.filter((candidate) => candidate.app.id === preferred)
    if (preferredMatches.length > 0) return pickWindowWithinApp(preferredMatches)
    throw ambiguousApplication(requestedApplication, matches)
  }
  return pickWindowWithinApp(matches)
}

function pickWindowWithinApp(
  matches: NativeWindowDescriptor[],
): NativeWindowDescriptor {
  // Electron apps (e.g. Bilibili) frequently own a tiny tray/status/widget
  // window that the system reports as focused. Binding to that 66x20 window
  // ruins the task. Prefer real main windows; only fall back to a sub-min
  // candidate when it is the sole match so single-window apps still resolve.
  const usable = matches.filter(isUsableMainWindow)
  const pool = usable.length > 0 ? usable : matches
  return [...pool].sort((left, right) => {
    if (left.focused !== right.focused) return left.focused ? -1 : 1
    return (
      right.window.bounds.width * right.window.bounds.height -
      left.window.bounds.width * left.window.bounds.height
    )
  })[0] as NativeWindowDescriptor
}

function ambiguousApplication(
  requestedApplication: string,
  matches: NativeWindowDescriptor[],
): ComputerUseBrokerError {
  const seen = new Set<string>()
  const candidates = matches
    .filter((candidate) => {
      const key = candidate.app.id
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(
      (candidate) =>
        `${candidate.app.name} (appId=${candidate.app.id}` +
        `${candidate.app.bundleId == null ? '' : `, bundleId=${candidate.app.bundleId}`})`,
    )
  return new ComputerUseBrokerError(
    'focus_mismatch',
    `Application "${requestedApplication}" matches ${candidates.length} different applications: ` +
      `${candidates.join(' ; ')}. Specify the exact bundle id / appId, or a window id.`,
    undefined,
    { retryable: true },
  )
}

function isUsableMainWindow(window: NativeWindowDescriptor): boolean {
  return (
    window.window.bounds.width >= MIN_USABLE_WINDOW_SIDE &&
    window.window.bounds.height >= MIN_USABLE_WINDOW_SIDE
  )
}

function normalizeApplicationName(value: string): string {
  const normalized = value.trim()
  const hasControlCharacter = Array.from(normalized).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
  if (normalized.length < 1 || normalized.length > 200 || hasControlCharacter) {
    throw new ComputerUseBrokerError('action_not_allowed', 'Target application name is invalid')
  }
  return normalized
}

function launchApplication(platform: NodeJS.Platform, application: string): Promise<void> {
  if (platform !== 'darwin') return Promise.resolve()
  const looksLikeBundleIdentifier = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+){2,}$/u.test(application)
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/open',
      [looksLikeBundleIdentifier ? '-b' : '-a', application],
      { timeout: 5_000 },
      (error) => {
        if (error == null) {
          resolve()
          return
        }
        reject(
          new ComputerUseBrokerError(
            'environment_unavailable',
            `The requested application could not be opened: ${application}`,
            undefined,
            { retryable: true },
          ),
        )
      },
    )
  })
}
