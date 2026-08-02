import {
  NativeWindowDescriptorSchema,
  type ComputerAppIdentity,
  type ComputerDisplayGeometry,
  type ComputerObservation,
  type ComputerWindowIdentity,
  type NativeWindowDescriptor,
} from '@spark/protocol'
import {
  ComputerApplicationTargetResolver,
  findApplicationWindow,
} from './ComputerApplicationTargetResolver.js'
import {
  ComputerApplicationCatalog,
  type InstalledComputerApplication,
} from './ComputerApplicationCatalog.js'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'

export interface DesktopWindowInventory {
  listWindows(): Promise<NativeWindowDescriptor[]>
  inspectWindow?(input: {
    appId: string
    windowId: string
    fullTree: boolean
    signal?: AbortSignal
  }): Promise<ComputerObservation>
}

export interface DesktopApplicationState {
  app: ComputerAppIdentity
  running: true
  focused: boolean
  windowCount: number
  windows: Array<{
    window: ComputerWindowIdentity
    display: ComputerDisplayGeometry
    focused: boolean
    minimized: boolean
  }>
}

export type ComputerApplicationState = DesktopApplicationState | InstalledComputerApplication

export class ComputerDesktopStateService {
  constructor(
    private readonly inventory: DesktopWindowInventory,
    private readonly targetResolver: Pick<
      ComputerApplicationTargetResolver,
      'resolve'
    > = new ComputerApplicationTargetResolver(),
    private readonly now: () => Date = () => new Date(),
    private readonly applicationCatalog: Pick<ComputerApplicationCatalog, 'listInstalled'> =
      new ComputerApplicationCatalog(),
  ) {}

  async listWindows(
    input: {
      app?: string
      includeMinimized?: boolean
    } = {},
  ): Promise<NativeWindowDescriptor[]> {
    const windows = await this.readWindows()
    return windows.filter(
      (candidate) =>
        (input.includeMinimized === true || !candidate.minimized) &&
        (input.app == null || appMatches(candidate, input.app)),
    )
  }

  async listApps(
    input: {
      includeWindows?: boolean
      scope?: 'running' | 'installed' | 'all'
    } = {},
  ): Promise<ComputerApplicationState[]> {
    const scope = input.scope ?? 'all'
    if (scope === 'installed') return this.readInstalledApps()
    if (scope === 'running') {
      return aggregateApps(await this.readWindows(), input.includeWindows !== false)
    }
    const [running, installed] = await Promise.all([
      this.readWindows()
        .then((windows) => aggregateApps(windows, input.includeWindows !== false))
        .catch(() => [] as DesktopApplicationState[]),
      this.readInstalledApps(),
    ])
    return mergeApplicationStates(installed, running)
  }

  async getScreenState(input: { includeWindows?: boolean } = {}): Promise<{
    capturedAt: string
    foreground: NativeWindowDescriptor | null
    displays: ComputerDisplayGeometry[]
    appCount: number
    windowCount: number
    apps: DesktopApplicationState[]
  }> {
    const windows = await this.readWindows()
    const visible = windows.filter((candidate) => !candidate.minimized)
    const foreground = largestWindow(visible.filter((candidate) => candidate.focused))
    const displays = dedupeBy(
      windows.map((candidate) => candidate.display),
      (display) => display.id,
    )
    const apps = aggregateApps(windows, input.includeWindows !== false)
    return {
      capturedAt: this.now().toISOString(),
      foreground,
      displays,
      appCount: apps.length,
      windowCount: windows.length,
      apps,
    }
  }

  async getAppState(input: {
    app?: string
    windowId?: string
    launchIfNeeded?: boolean
    includeObservation?: boolean
  }): Promise<{
    target: NativeWindowDescriptor
    state: DesktopApplicationState
    observation: ComputerObservation | null
  }> {
    const target = await this.resolveTarget(input)
    const windows = await this.readWindows()
    const appWindows = windows.filter((candidate) => candidate.app.id === target.app.id)
    const state = aggregateApps(appWindows, true)[0]
    if (state == null) throw targetUnavailable()
    const observation =
      input.includeObservation === false || this.inventory.inspectWindow == null
        ? null
        : await this.inventory.inspectWindow({
            appId: target.app.id,
            windowId: target.window.id,
            fullTree: true,
          })
    return { target, state, observation }
  }

  async openApp(app: string): Promise<{
    target: NativeWindowDescriptor
    state: DesktopApplicationState
    observation: ComputerObservation | null
  }> {
    return this.getAppState({ app, launchIfNeeded: true, includeObservation: false })
  }

  private async resolveTarget(input: {
    app?: string
    windowId?: string
    launchIfNeeded?: boolean
  }): Promise<NativeWindowDescriptor> {
    if ((input.app == null) === (input.windowId == null)) {
      throw new ComputerUseBrokerError(
        'action_not_allowed',
        'Provide exactly one of app or windowId',
      )
    }
    if (input.windowId != null) {
      const target = (await this.readWindows()).find(
        (candidate) => candidate.window.id === input.windowId && !candidate.minimized,
      )
      if (target == null) throw targetUnavailable()
      return target
    }
    const app = input.app as string
    if (input.launchIfNeeded !== false) {
      const target = await this.targetResolver.resolve(app, this.inventory)
      if (target != null) return target
    }
    const target = findApplicationWindow(await this.readWindows(), app)
    if (target == null) throw targetUnavailable()
    return target
  }

  private async readWindows(): Promise<NativeWindowDescriptor[]> {
    const parsed = NativeWindowDescriptorSchema.array()
      .max(10_000)
      .safeParse(await this.inventory.listWindows())
    if (!parsed.success) {
      throw new ComputerUseBrokerError(
        'native_host_incompatible',
        'Native Host returned an invalid window inventory',
      )
    }
    return parsed.data
  }

  private async readInstalledApps(): Promise<InstalledComputerApplication[]> {
    try {
      return await this.applicationCatalog.listInstalled()
    } catch {
      return []
    }
  }
}

function mergeApplicationStates(
  installed: InstalledComputerApplication[],
  running: DesktopApplicationState[],
): ComputerApplicationState[] {
  const merged = new Map<string, ComputerApplicationState>()
  for (const app of installed) merged.set(normalizeAppName(app.app.name), app)
  for (const app of running) merged.set(normalizeAppName(app.app.name), app)
  return [...merged.values()].sort(
    (left, right) =>
      Number(right.focused) - Number(left.focused) ||
      Number(right.running) - Number(left.running) ||
      left.app.name.localeCompare(right.app.name),
  )
}

function normalizeAppName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function aggregateApps(
  windows: NativeWindowDescriptor[],
  includeWindows: boolean,
): DesktopApplicationState[] {
  const grouped = new Map<string, NativeWindowDescriptor[]>()
  for (const window of windows) {
    const current = grouped.get(window.app.id) ?? []
    current.push(window)
    grouped.set(window.app.id, current)
  }
  return [...grouped.values()]
    .map((appWindows): DesktopApplicationState => {
      const representative =
        appWindows.find((candidate) => candidate.focused) ??
        (appWindows[0] as NativeWindowDescriptor)
      return {
        app: representative.app,
        running: true,
        focused: appWindows.some((candidate) => candidate.focused),
        windowCount: appWindows.length,
        windows: includeWindows
          ? appWindows.map((candidate) => ({
              window: candidate.window,
              display: candidate.display,
              focused: candidate.focused,
              minimized: candidate.minimized,
            }))
          : [],
      }
    })
    .sort(
      (left, right) =>
        Number(right.focused) - Number(left.focused) || left.app.name.localeCompare(right.app.name),
    )
}

function appMatches(candidate: NativeWindowDescriptor, selector: string): boolean {
  const expected = selector.trim().toLocaleLowerCase()
  return [candidate.app.id, candidate.app.name, candidate.app.bundleId]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.trim().toLocaleLowerCase() === expected)
}

function largestWindow(windows: NativeWindowDescriptor[]): NativeWindowDescriptor | null {
  return (
    [...windows].sort(
      (left, right) =>
        right.window.bounds.width * right.window.bounds.height -
        left.window.bounds.width * left.window.bounds.height,
    )[0] ?? null
  )
}

function dedupeBy<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()]
}

function targetUnavailable(): ComputerUseBrokerError {
  return new ComputerUseBrokerError(
    'focus_mismatch',
    'The requested application or window is unavailable',
    undefined,
    { retryable: true },
  )
}
