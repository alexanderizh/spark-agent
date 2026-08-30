/**
 * 全局提示词库的文件夹包导入导出（渲染进程侧）。
 *
 * 职责：
 *   - 导出：把选中的提示词（含封面 data URL）打成 spark.prompt-library 包 JSON，
 *     经 prompt-library:export-package 写入用户选择的文件夹（封面拆成 covers/ 文件）。
 *   - 导入：经 prompt-library:read-package 读取文件夹包（封面重新内联为 data URL），
 *     再与当前全局库合并（内容去重、id 冲突换新 id、分类并集）。
 *
 * 纯函数（构建 / 解析 / 合并）与 window.spark 交互分离，便于单测。
 */

import { filmUid } from './canvasFilmAssets'
import type { GlobalPromptLibraryItem, GlobalPromptLibraryState } from './canvasPromptLibraryStore'

export const PROMPT_LIBRARY_PACKAGE_KIND = 'spark.prompt-library'
export const PROMPT_LIBRARY_PACKAGE_VERSION = 1

export type PromptLibraryPackagePayload = {
  kind: typeof PROMPT_LIBRARY_PACKAGE_KIND
  version: number
  exportedAt: string
  app: string
  categories: string[]
  items: GlobalPromptLibraryItem[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function buildPromptLibraryExportPayload(input: {
  categories: readonly string[]
  items: readonly GlobalPromptLibraryItem[]
  exportedAt?: string
}): PromptLibraryPackagePayload {
  return {
    kind: PROMPT_LIBRARY_PACKAGE_KIND,
    version: PROMPT_LIBRARY_PACKAGE_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    app: 'Spark-Agent',
    categories: [...input.categories],
    items: input.items.map((item) => ({ ...item, tags: [...item.tags] })),
  }
}

/** 解析导入包 JSON；kind / items 不合法时返回 null，条目字段逐项归一化。 */
export function parsePromptLibraryPackage(json: string): PromptLibraryPackagePayload | null {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!isRecord(raw) || raw.kind !== PROMPT_LIBRARY_PACKAGE_KIND || !Array.isArray(raw.items)) {
    return null
  }
  const now = new Date().toISOString()
  const items = raw.items
    .map((value): GlobalPromptLibraryItem | null => {
      if (!isRecord(value) || typeof value.id !== 'string' || typeof value.text !== 'string') {
        return null
      }
      return {
        id: value.id,
        title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '-',
        text: value.text.trim(),
        category: typeof value.category === 'string' ? value.category.trim() : '',
        tags: Array.isArray(value.tags)
          ? value.tags
              .filter((tag): tag is string => typeof tag === 'string')
              .map((tag) => tag.trim())
              .filter(Boolean)
          : [],
        coverUrl: typeof value.coverUrl === 'string' && value.coverUrl ? value.coverUrl : null,
        coverMimeType:
          typeof value.coverMimeType === 'string' && /^image\//i.test(value.coverMimeType)
            ? value.coverMimeType
            : null,
        usageCount:
          typeof value.usageCount === 'number' && Number.isFinite(value.usageCount)
            ? value.usageCount
            : 0,
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
      }
    })
    .filter((item): item is GlobalPromptLibraryItem => item !== null && item.text.length > 0)
  if (items.length === 0) return null
  const categories = Array.isArray(raw.categories)
    ? raw.categories
        .filter((category): category is string => typeof category === 'string')
        .map((category) => category.trim())
        .filter(Boolean)
    : []
  return {
    kind: PROMPT_LIBRARY_PACKAGE_KIND,
    version: typeof raw.version === 'number' ? raw.version : PROMPT_LIBRARY_PACKAGE_VERSION,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : now,
    app: 'Spark-Agent',
    categories,
    items,
  }
}

function promptContentKey(
  item: Pick<GlobalPromptLibraryItem, 'title' | 'text' | 'category' | 'tags'>,
): string {
  return JSON.stringify([item.title, item.text, item.category, [...item.tags].sort()])
}

/**
 * 把导入包合并进当前全局库：
 *   - 与现有条目「标题 + 文案 + 分类 + 标签」完全一致的跳过（重复）；
 *   - 其余导入；id 与现有冲突时生成新 id，避免覆盖既有数据；
 *   - 分类取并集去重。
 */
export function mergeImportedPromptLibrary(
  current: GlobalPromptLibraryState,
  payload: PromptLibraryPackagePayload,
): { next: GlobalPromptLibraryState; importedCount: number; skippedCount: number } {
  const existingKeys = new Set(current.items.map(promptContentKey))
  const existingIds = new Set(current.items.map((item) => item.id))
  const added: GlobalPromptLibraryItem[] = []
  let skippedCount = 0
  for (const item of payload.items) {
    if (existingKeys.has(promptContentKey(item))) {
      skippedCount += 1
      continue
    }
    // 刚加入的条目也要参与去重（包内自身重复）
    existingKeys.add(promptContentKey(item))
    const imported: GlobalPromptLibraryItem = {
      ...item,
      id: existingIds.has(item.id) ? filmUid('prompt') : item.id,
    }
    existingIds.add(imported.id)
    added.push(imported)
  }
  const categories = [...current.categories]
  for (const category of payload.categories) {
    const trimmed = category.trim()
    if (trimmed && !categories.includes(trimmed)) categories.push(trimmed)
  }
  for (const item of added) {
    const category = item.category.trim()
    if (category && !categories.includes(category)) categories.push(category)
  }
  return {
    next: { ...current, categories, items: [...current.items, ...added] },
    importedCount: added.length,
    skippedCount,
  }
}

/** data:image URL 原样保留；safe-file:// 读成本地 data URL；其余（http 等）返回 null。 */
export async function promptCoverUrlToDataUrl(
  url: string | null | undefined,
): Promise<string | null> {
  if (!url) return null
  if (url.startsWith('data:image/')) return url
  if (!url.startsWith('safe-file://')) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) return null
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read cover'))
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/** 弹目录选择框后导出；用户取消时返回 { exported: false }。 */
export async function exportPromptLibraryPackage(input: {
  categories: readonly string[]
  items: readonly GlobalPromptLibraryItem[]
  packageName?: string
}): Promise<{ exported: boolean; directoryPath?: string; exportedCount?: number; error?: string }> {
  const selected = await window.spark?.invoke('dialog:open-directory', {
    title: '选择提示词库导出位置',
  })
  if (!selected || selected.canceled || !selected.filePath) return { exported: false }
  const payload = buildPromptLibraryExportPayload(input)
  return window.spark?.invoke('prompt-library:export-package', {
    targetParentDirectory: selected.filePath,
    ...(input.packageName ? { packageName: input.packageName } : {}),
    packageJson: JSON.stringify(payload),
  })
}

/** 弹目录选择框后读取导入包；用户取消时返回 null，包无效时抛错。 */
export async function importPromptLibraryPackage(): Promise<PromptLibraryPackagePayload | null> {
  const selected = await window.spark?.invoke('dialog:open-directory', {
    title: '选择要导入的提示词库文件夹',
  })
  if (!selected || selected.canceled || !selected.filePath) return null
  const response = await window.spark?.invoke('prompt-library:read-package', {
    directory: selected.filePath,
  })
  if (!response || !response.found || !response.packageJson) {
    throw new Error(response?.error ?? '所选文件夹不是有效的提示词库导出包')
  }
  const payload = parsePromptLibraryPackage(response.packageJson)
  if (!payload) throw new Error('提示词库导入包格式不正确')
  return payload
}
