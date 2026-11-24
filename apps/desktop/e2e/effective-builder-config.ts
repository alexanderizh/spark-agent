import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Configuration } from 'electron-builder'

const requireBuilder = createRequire(require.resolve('electron-builder'))
const { getConfig } = requireBuilder('app-builder-lib/out/util/config/config') as {
  getConfig: (directory: string, file: string, options: null) => Promise<Configuration>
}
const root = join(__dirname, '..')

export function loadEffectiveBuilderConfig(file = 'electron-builder.yml'): Promise<Configuration> {
  return getConfig(root, join(root, file), null)
}

export function effectiveBuilderFileFilters(config: Configuration): string[] {
  const files = Array.isArray(config.files) ? config.files : [config.files]
  return files.flatMap((entry) => {
    if (typeof entry === 'string') return [entry]
    if (entry == null || (entry.from != null && entry.from !== '.')) return []
    if (typeof entry.filter === 'string') return [entry.filter]
    return entry.filter ?? []
  })
}
