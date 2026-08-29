import path from 'node:path'

export const PROMPT_LIBRARY_SETTINGS_CATEGORY = 'prompt-library'
export const PROMPT_LIBRARY_SETTINGS_KEY = 'data'

export type PersistedPromptLibraryItem = {
  id: string
  title: string
  text: string
  category: string
  tags: string[]
  coverUrl: string | null
  coverMimeType: string | null
  usageCount: number
  createdAt: string
  updatedAt: string
}

export type PersistedPromptLibraryState = {
  version: 1
  categories: string[]
  items: PersistedPromptLibraryItem[]
  legacyMigrated: boolean
}

export type CanvasPromptSnapshotAsset = {
  id: string
  title?: string | null
  contentText?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  mimeType?: string | null
  url?: string | null
  thumbnailUrl?: string | null
  storageKey?: string | null
  metadata?: Record<string, unknown>
}

export type CanvasPromptSnapshot = {
  assets?: CanvasPromptSnapshotAsset[]
}

type MaterializePromptCoverOptions = {
  readFile: (filePath: string) => Promise<Buffer>
  isAllowedPath: (filePath: string) => boolean
}

export type PreserveProjectPromptsResult = {
  state: PersistedPromptLibraryState
  changed: boolean
  migratedCount: number
}

const EMPTY_STATE: PersistedPromptLibraryState = {
  version: 1,
  categories: [],
  items: [],
  legacyMigrated: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readAttributes(asset: CanvasPromptSnapshotAsset): Record<string, unknown> {
  return isRecord(asset.metadata?.attributes) ? asset.metadata.attributes : {}
}

function readPromptText(asset: CanvasPromptSnapshotAsset): string {
  return readString(asset.contentText) ?? readString(asset.metadata?.prompt) ?? ''
}

function readPromptCategory(asset: CanvasPromptSnapshotAsset): string {
  const attributes = readAttributes(asset)
  return readString(attributes.promptCategory) ?? readString(asset.metadata?.promptCategory) ?? ''
}

function readPromptTags(asset: CanvasPromptSnapshotAsset): string[] {
  const values = Array.isArray(asset.metadata?.tags) ? asset.metadata.tags : []
  return values
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter((tag, index, list) => tag.length > 0 && list.indexOf(tag) === index)
}

function decodeSafeFileUrl(value: string): string | null {
  if (!value.startsWith('safe-file://')) return null
  try {
    const rest = value.slice('safe-file://'.length)
    const slashIndex = rest.indexOf('/')
    if (slashIndex < 0) return null
    const encoded = rest.slice(slashIndex + 1)
    if (!encoded) return null
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
    const decoded = Buffer.from(base64 + padding, 'base64').toString('utf8')
    return path.isAbsolute(decoded) ? decoded : null
  } catch {
    return null
  }
}

function inferImageMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.heic': 'image/heic',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  }
  return mimeTypes[extension] ?? 'image/png'
}

async function materializePromptCover(
  source: string,
  mimeType: string | null,
  options: MaterializePromptCoverOptions,
): Promise<{ url: string; mimeType: string }> {
  if (source.startsWith('data:')) {
    const dataMimeType = /^data:([^;,]+)/.exec(source)?.[1] ?? 'image/png'
    return { url: source, mimeType: mimeType ?? dataMimeType }
  }
  if (/^https?:\/\//i.test(source)) {
    return { url: source, mimeType: mimeType ?? 'image/png' }
  }

  const decodedPath = decodeSafeFileUrl(source) ?? (path.isAbsolute(source) ? source : null)
  if (!decodedPath) throw new Error('提示词参考图地址无法解析，已中止项目删除')
  const resolvedPath = path.resolve(decodedPath)
  if (!options.isAllowedPath(resolvedPath)) {
    throw new Error('提示词参考图不在允许读取的目录内，已中止项目删除')
  }
  let buffer: Buffer
  try {
    buffer = await options.readFile(resolvedPath)
  } catch {
    throw new Error('提示词参考图无法读取，已中止项目删除')
  }
  if (buffer.length === 0) throw new Error('提示词参考图为空，已中止项目删除')
  const resolvedMimeType = mimeType ?? inferImageMimeType(resolvedPath)
  return {
    url: `data:${resolvedMimeType};base64,${buffer.toString('base64')}`,
    mimeType: resolvedMimeType,
  }
}

function normalizeState(value: unknown): PersistedPromptLibraryState {
  if (!isRecord(value)) return { ...EMPTY_STATE, categories: [], items: [] }
  const items = Array.isArray(value.items)
    ? value.items.flatMap((item): PersistedPromptLibraryItem[] => {
        if (!isRecord(item) || typeof item.id !== 'string' || typeof item.text !== 'string')
          return []
        return [
          {
            id: item.id,
            title: readString(item.title) ?? '-',
            text: item.text.trim(),
            category: readString(item.category) ?? '',
            tags: Array.isArray(item.tags)
              ? item.tags
                  .filter((tag): tag is string => typeof tag === 'string')
                  .map((tag) => tag.trim())
                  .filter(Boolean)
              : [],
            coverUrl: typeof item.coverUrl === 'string' ? item.coverUrl : null,
            coverMimeType: typeof item.coverMimeType === 'string' ? item.coverMimeType : null,
            usageCount:
              typeof item.usageCount === 'number' && Number.isFinite(item.usageCount)
                ? item.usageCount
                : 0,
            createdAt: readString(item.createdAt) ?? new Date().toISOString(),
            updatedAt: readString(item.updatedAt) ?? new Date().toISOString(),
          },
        ]
      })
    : []
  const categories = Array.isArray(value.categories)
    ? value.categories
        .filter((category): category is string => typeof category === 'string')
        .map((category) => category.trim())
        .filter((category, index, list) => category.length > 0 && list.indexOf(category) === index)
    : []
  return {
    version: 1,
    categories,
    items,
    legacyMigrated: value.legacyMigrated === true,
  }
}

function isPromptLibraryAsset(asset: CanvasPromptSnapshotAsset): boolean {
  return (
    isRecord(asset) && asset.metadata?.kind === 'prompt_library' && readPromptText(asset).length > 0
  )
}

function readPromptCoverSource(
  asset: CanvasPromptSnapshotAsset,
  assetsById: ReadonlyMap<string, CanvasPromptSnapshotAsset>,
): { source: string; mimeType: string | null } | null {
  const attributes = readAttributes(asset)
  const coverAssetId = readString(attributes.coverAssetId)
  if (coverAssetId) {
    const coverAsset = assetsById.get(coverAssetId)
    const source =
      readString(coverAsset?.thumbnailUrl) ??
      readString(coverAsset?.url) ??
      readString(coverAsset?.storageKey)
    if (source) {
      return { source, mimeType: readString(coverAsset?.mimeType) }
    }
  }
  const source = readString(attributes.coverUrl)
  if (!source) return null
  return { source, mimeType: readString(attributes.coverMimeType) }
}

function promptItemFromAsset(
  projectId: string,
  asset: CanvasPromptSnapshotAsset,
  existing: PersistedPromptLibraryItem | undefined,
  cover: { url: string; mimeType: string } | null,
  fallbackTimestamp = new Date().toISOString(),
): PersistedPromptLibraryItem {
  return {
    id: `legacy:${projectId}:${asset.id}`,
    title: readString(asset.title) ?? '-',
    text: readPromptText(asset),
    category: readPromptCategory(asset),
    tags: readPromptTags(asset),
    coverUrl: cover?.url ?? existing?.coverUrl ?? null,
    coverMimeType: cover?.mimeType ?? existing?.coverMimeType ?? null,
    usageCount: existing?.usageCount ?? 0,
    createdAt: readString(asset.createdAt) ?? existing?.createdAt ?? fallbackTimestamp,
    updatedAt: readString(asset.updatedAt) ?? existing?.updatedAt ?? fallbackTimestamp,
  }
}

function inferPromptCoverMimeType(source: string): string {
  const dataMimeType = /^data:([^;,]+)/.exec(source)?.[1]
  if (dataMimeType) return dataMimeType
  const decodedPath = decodeSafeFileUrl(source)
  return inferImageMimeType(decodedPath ?? source)
}

/**
 * 把单个画布项目 snapshot 中的提示词资产投影为全局提示词库条目。
 *
 * 账号同步和渲染端“全部用户提示词”必须使用同一数据口径：项目提示词以
 * `legacy:<projectId>:<assetId>` 作为跨设备稳定 ID，封面只保留来源引用，后续由
 * 同步层统一压缩/安全校验。这里不读取文件，避免一个失效封面阻断文字同步。
 */
export function readCanvasProjectPromptLibraryItems(
  projectId: string,
  snapshot: CanvasPromptSnapshot,
): PersistedPromptLibraryItem[] {
  const assets = (Array.isArray(snapshot.assets) ? snapshot.assets : []).filter(
    (asset): asset is CanvasPromptSnapshotAsset => isRecord(asset) && typeof asset.id === 'string',
  )
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  return assets.filter(isPromptLibraryAsset).map((asset) => {
    const coverSource = readPromptCoverSource(asset, assetsById)
    const cover = coverSource
      ? {
          url: coverSource.source,
          mimeType: coverSource.mimeType ?? inferPromptCoverMimeType(coverSource.source),
        }
      : null
    return promptItemFromAsset(projectId, asset, undefined, cover, new Date(0).toISOString())
  })
}

export async function preserveCanvasProjectPrompts(
  projectId: string,
  snapshot: CanvasPromptSnapshot,
  existingValue: unknown,
  options: MaterializePromptCoverOptions,
): Promise<PreserveProjectPromptsResult> {
  const state = normalizeState(existingValue)
  const assets = (Array.isArray(snapshot.assets) ? snapshot.assets : []).filter(
    (asset): asset is CanvasPromptSnapshotAsset => isRecord(asset) && typeof asset.id === 'string',
  )
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const promptAssets = assets.filter(isPromptLibraryAsset)
  if (promptAssets.length === 0) return { state, changed: false, migratedCount: 0 }

  const nextItems = [...state.items]
  let changed = false
  let migratedCount = 0
  for (const asset of promptAssets) {
    const itemId = `legacy:${projectId}:${asset.id}`
    const existingIndex = nextItems.findIndex(
      (item) => item.id === itemId || item.id === `legacy:${asset.id}`,
    )
    const existing = existingIndex >= 0 ? nextItems[existingIndex] : undefined
    const coverSource = readPromptCoverSource(asset, assetsById)
    const cover = coverSource
      ? await materializePromptCover(coverSource.source, coverSource.mimeType, options)
      : existing?.coverUrl
        ? await materializePromptCover(existing.coverUrl, existing.coverMimeType, options)
        : null
    const nextItem = promptItemFromAsset(projectId, asset, existing, cover)
    if (existingIndex >= 0) nextItems[existingIndex] = nextItem
    else nextItems.push(nextItem)
    if (JSON.stringify(existing) !== JSON.stringify(nextItem)) changed = true
    migratedCount += 1
  }

  return {
    state: { ...state, items: nextItems, legacyMigrated: true },
    changed: changed || state.legacyMigrated !== true,
    migratedCount,
  }
}
