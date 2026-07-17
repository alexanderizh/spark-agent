export type TurnFileChangeCollectionSource =
  | 'agent'
  | 'checkpoint'
  | 'workspace_snapshot'
  | 'git_fallback'

export interface TurnFileSummaryGeneratedGroup {
  directory: string
  fileCount: number
  additions: number
  deletions: number
  reason: 'generated-path' | 'large-batch'
  examples: string[]
}

type TurnFileCandidate = {
  path: string
  adds: number
  dels: number
  collectionSource?: TurnFileChangeCollectionSource
  diff?: string
}

export type TurnFileGitStats = {
  path: string
  additions: number
  deletions: number
}

type PreparedTurnFileSummary<T extends TurnFileCandidate> = {
  files: T[]
  generatedGroups: TurnFileSummaryGeneratedGroup[]
}

const LOW_CONFIDENCE_SOURCES = new Set<TurnFileChangeCollectionSource>([
  'checkpoint',
  'workspace_snapshot',
  'git_fallback',
])

const GENERATED_DIRECTORY_NAMES = new Set([
  '.cache',
  '.gitnexus',
  '.git',
  '.next',
  '.nuxt',
  '.parcel-cache',
  '.playwright',
  '.spark-artifacts',
  '.spark-cache',
  '.turbo',
  '.venv',
  '.vite',
  '__pycache__',
  'build',
  'bin',
  'coverage',
  'dist',
  'node_modules',
  'obj',
  'out',
  'release',
  'target',
  'vendor',
])

const GENERATED_FILE_SUFFIXES = ['.map', '.pyc', '.tsbuildinfo']
const LARGE_BATCH_THRESHOLD = 20
const EXAMPLE_LIMIT = 3

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+$/, '')
}

function matchesGitPath(filePath: string, gitPath: string): boolean {
  const normalizedFilePath = normalizePath(filePath)
  const normalizedGitPath = normalizePath(gitPath).replace(/^\/+/, '')
  if (normalizedFilePath === normalizedGitPath) return true
  return normalizedFilePath.endsWith(`/${normalizedGitPath}`)
}

/**
 * 用工作区 Git 状态补齐没有 unified diff 的文件事件（例如 Codex file_change 事件）。
 * 只补齐当前仍为 0 的条目，已有 diff 统计始终保持原值。
 */
export function hydrateTurnFileStats<T extends TurnFileCandidate>(
  files: T[],
  gitStats: readonly TurnFileGitStats[],
): T[] {
  if (files.length === 0 || gitStats.length === 0) return files

  let changed = false
  const hydrated = files.map((file) => {
    if (file.adds !== 0 || file.dels !== 0) return file
    const stats = gitStats.find((item) => matchesGitPath(file.path, item.path))
    if (stats == null || (stats.additions === 0 && stats.deletions === 0)) return file
    changed = true
    return { ...file, adds: stats.additions, dels: stats.deletions }
  })
  return changed ? hydrated : files
}

function parentDirectory(filePath: string): string {
  const normalized = normalizePath(filePath)
  const slash = normalized.lastIndexOf('/')
  return slash > 0 ? normalized.slice(0, slash) : '.'
}

function generatedDirectory(filePath: string): string | null {
  const normalized = normalizePath(filePath)
  const segments = normalized.split('/').filter(Boolean)
  const generatedIndex = segments.findIndex((segment) => GENERATED_DIRECTORY_NAMES.has(segment))
  if (generatedIndex >= 0) {
    const prefix = normalized.startsWith('/') ? '/' : ''
    return `${prefix}${segments.slice(0, generatedIndex + 1).join('/')}`
  }

  const lower = normalized.toLowerCase()
  if (GENERATED_FILE_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return parentDirectory(normalized)
  }
  return null
}

function addToGroup<T extends TurnFileCandidate>(
  groups: Map<string, { files: T[]; reason: TurnFileSummaryGeneratedGroup['reason'] }>,
  directory: string,
  file: T,
  reason: TurnFileSummaryGeneratedGroup['reason'],
): void {
  const existing = groups.get(directory)
  if (existing == null) {
    groups.set(directory, { files: [file], reason })
  } else {
    existing.files.push(file)
    if (existing.reason === 'large-batch' && reason === 'generated-path') {
      existing.reason = reason
    }
  }
}

/**
 * 将本轮文件变更整理成适合 UI 展示的两层结果。
 *
 * 直接编辑事件默认保留；快照、checkpoint、Git 兜底事件只有在命中生成目录/生成文件
 * 或形成大批量同目录变更时才聚合隐藏。这样非 Git 项目的少量 shell 生成文件仍能显示，
 * 而 build/cache 产生的上千文件不会淹没主卡片。
 */
export function prepareTurnFileSummary<T extends TurnFileCandidate>(
  files: T[],
): PreparedTurnFileSummary<T> {
  const visible: T[] = []
  const groups = new Map<string, { files: T[]; reason: TurnFileSummaryGeneratedGroup['reason'] }>()
  const lowConfidenceByDirectory = new Map<string, T[]>()

  for (const file of files) {
    const source = file.collectionSource ?? 'agent'
    const isLegacyGeneratedCandidate =
      source === 'agent' && file.diff == null && file.adds === 0 && file.dels === 0
    if (!LOW_CONFIDENCE_SOURCES.has(source) && !isLegacyGeneratedCandidate) {
      visible.push(file)
      continue
    }

    const generatedDir = generatedDirectory(file.path)
    if (generatedDir != null) {
      addToGroup(groups, generatedDir, file, 'generated-path')
      continue
    }

    const directory = parentDirectory(file.path)
    const batch = lowConfidenceByDirectory.get(directory) ?? []
    batch.push(file)
    lowConfidenceByDirectory.set(directory, batch)
  }

  for (const [directory, batch] of lowConfidenceByDirectory) {
    if (batch.length >= LARGE_BATCH_THRESHOLD) {
      for (const file of batch) addToGroup(groups, directory, file, 'large-batch')
    } else {
      visible.push(...batch)
    }
  }

  const generatedGroups = [...groups].map(([directory, group]) => ({
    directory,
    fileCount: group.files.length,
    additions: group.files.reduce((sum, file) => sum + file.adds, 0),
    deletions: group.files.reduce((sum, file) => sum + file.dels, 0),
    reason: group.reason,
    examples: group.files.slice(0, EXAMPLE_LIMIT).map((file) => file.path),
  }))

  return { files: visible, generatedGroups }
}
