import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'

const DEFAULT_CACHE_TTL_MS = 5 * 60_000
const MAX_APPLICATIONS = 2_000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

export interface InstalledComputerApplication {
  app: { id: string; name: string }
  running: false
  focused: false
  windowCount: 0
  windows: []
}

export class ComputerApplicationCatalog {
  private cache: { expiresAt: number; apps: InstalledComputerApplication[] } | null = null

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly discover: () => Promise<string[]> = discoverMacApplications,
    private readonly now: () => number = Date.now,
    private readonly cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  ) {}

  async listInstalled(): Promise<InstalledComputerApplication[]> {
    if (this.platform !== 'darwin') return []
    const cached = this.cache
    if (cached != null && cached.expiresAt > this.now()) return cached.apps
    const paths = await this.discover()
    const seenNames = new Set<string>()
    const apps: InstalledComputerApplication[] = []
    for (const path of paths) {
      if (apps.length >= MAX_APPLICATIONS || !isTopLevelApplicationBundle(path)) continue
      const name = basename(path, '.app').trim()
      const normalized = name.toLocaleLowerCase()
      if (name.length < 1 || name.length > 300 || seenNames.has(normalized)) continue
      seenNames.add(normalized)
      apps.push({
        app: { id: `installed-${shortDigest(path)}`, name },
        running: false,
        focused: false,
        windowCount: 0,
        windows: [],
      })
    }
    apps.sort((left, right) => left.app.name.localeCompare(right.app.name))
    this.cache = { expiresAt: this.now() + this.cacheTtlMs, apps }
    return apps
  }
}

function discoverMacApplications(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/mdfind',
      ['kMDItemContentType == "com.apple.application-bundle"c'],
      { timeout: 5_000, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' },
      (error, stdout) => {
        if (error != null) {
          reject(error)
          return
        }
        resolve(stdout.split('\n').map((value) => value.trim()).filter(Boolean))
      },
    )
  })
}

function isTopLevelApplicationBundle(path: string): boolean {
  if (!path.endsWith('.app')) return false
  const firstBundle = path.toLocaleLowerCase().indexOf('.app/')
  return firstBundle < 0
}

function shortDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}
