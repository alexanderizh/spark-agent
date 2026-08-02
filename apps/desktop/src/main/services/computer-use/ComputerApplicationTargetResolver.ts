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
  ): Promise<NativeWindowDescriptor | null> {
    const requested = normalizeApplicationName(application)
    const existing = findApplicationWindow(await inventory.listWindows(), requested)
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
      const target = findApplicationWindow(await inventory.listWindows(), requested)
      if (target != null) return target
      await this.wait(this.pollIntervalMs)
    } while (this.now() < deadline)
    return null
  }
}

export function findApplicationWindow(
  windows: NativeWindowDescriptor[],
  requestedApplication: string,
): NativeWindowDescriptor | null {
  const requested = requestedApplication.trim().toLocaleLowerCase()
  const matches = windows.filter((candidate) => {
    if (candidate.minimized) return false
    return [candidate.app.name, candidate.app.bundleId, candidate.app.id]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.trim().toLocaleLowerCase() === requested)
  })
  if (matches.length === 0) return null
  return [...matches].sort((left, right) => {
    if (left.focused !== right.focused) return left.focused ? -1 : 1
    return (
      right.window.bounds.width * right.window.bounds.height -
      left.window.bounds.width * left.window.bounds.height
    )
  })[0] as NativeWindowDescriptor
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
