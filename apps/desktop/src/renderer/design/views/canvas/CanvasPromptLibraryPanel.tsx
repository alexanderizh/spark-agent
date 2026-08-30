import { useMemo, useState } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Input, Select, message } from 'antd'
import { readAssetKind } from './canvasFilmAssets'
import type { CanvasAsset } from './canvas.types'
import { getPromptCategory } from './canvasPromptLibraryCategories'
import { readPromptLibraryCover, readPromptLibraryText } from './canvasPromptLibraryData'
import { RemoteAssetImage } from '../../components/RemoteAssetImage'
import type { GlobalPromptLibraryItem } from './canvasPromptLibraryStore'
import './canvas-prompt-library.less'

export type CanvasPromptLibraryEntry = {
  id: string
  source: 'global' | 'project'
  group: string
  category?: string | undefined
  label: string
  text: string
  assetId?: string | undefined
  coverUrl?: string | undefined
  tags?: string[] | undefined
  negativePrompt?: string | undefined
  createdAt?: string | undefined
  originProjectId?: string | undefined
  originProjectName?: string | undefined
  originAssetId?: string | undefined
}

export type PromptLibrarySortOrder = 'newest' | 'oldest'
export type PromptLibrarySource = 'all' | 'global' | 'project'

type PromptLibraryCategoryKey =
  | 'all'
  | 'global'
  | 'project'
  | `global:${string}`
  | `project:${string}`

function getEntryCategoryKey(entry: CanvasPromptLibraryEntry): PromptLibraryCategoryKey {
  if (entry.source === 'global') return `global:${entry.category ?? '未分类'}`
  return `project:${entry.category ?? '未分类'}`
}

function getCategoryLabel(category: PromptLibraryCategoryKey): string {
  if (category === 'all') return '全部'
  if (category === 'global') return '全局库'
  if (category === 'project') return '项目库'
  if (category.startsWith('global:')) return category.slice('global:'.length)
  return category.slice('project:'.length)
}

export function buildCanvasPromptLibraryEntries(
  assets: CanvasAsset[],
  projectNames?: ReadonlyMap<string, string>,
): CanvasPromptLibraryEntry[] {
  const projectEntries = assets
    .filter((asset) => readAssetKind(asset) === 'prompt_library')
    .map((asset): CanvasPromptLibraryEntry => {
      const category = getPromptCategory(asset) ?? '未分类'
      const cover = readPromptLibraryCover(asset, assets)
      return {
        id: `project:${asset.id}`,
        source: 'project',
        group: category,
        category,
        label: asset.title ?? '未命名提示词',
        text: readPromptLibraryText(asset),
        assetId: asset.id,
        coverUrl: cover.url ?? undefined,
        createdAt: asset.createdAt,
        originProjectId: asset.projectId,
        originProjectName: projectNames?.get(asset.projectId),
        originAssetId: asset.id,
      }
    })
    .filter((entry) => entry.text.trim())

  return projectEntries
}

/**
 * 快捷弹窗的“全局”视图需要把所有画布项目保存的提示词汇总到一起。
 * 这里仅改变展示来源，不改变项目资产本身的归属信息。
 */
export function buildAllProjectPromptLibraryGlobalEntries(
  assets: CanvasAsset[],
  projectNames?: ReadonlyMap<string, string>,
): CanvasPromptLibraryEntry[] {
  return buildCanvasPromptLibraryEntries(assets, projectNames)
    .filter((entry) => entry.source === 'project')
    .map((entry) => ({
      ...entry,
      id: `global:project:${entry.originProjectId ?? 'unknown'}:${entry.originAssetId ?? entry.id}`,
      source: 'global' as const,
    }))
}

export function buildGlobalPromptLibraryEntries(
  items: readonly GlobalPromptLibraryItem[],
  projectNames?: ReadonlyMap<string, string>,
): CanvasPromptLibraryEntry[] {
  return items
    .filter((item) => item.text.trim())
    .map(
      (item): CanvasPromptLibraryEntry => ({
        id: `global:${item.id}`,
        source: 'global',
        group: item.category || '未分类',
        category: item.category || '未分类',
        label: item.title || '-',
        text: item.text,
        coverUrl: item.coverUrl ?? undefined,
        tags: item.tags,
        createdAt: item.createdAt,
        ...(item.id.startsWith('legacy:')
          ? (() => {
              const [, projectId, ...assetIdParts] = item.id.split(':')
              if (assetIdParts.length > 0 && projectId) {
                return {
                  originProjectId: projectId,
                  originProjectName: projectNames?.get(projectId),
                  originAssetId: assetIdParts.join(':'),
                }
              }
              return projectId
                ? {
                    originProjectName: projectNames?.get(projectId),
                    originAssetId: projectId,
                  }
                : {}
            })()
          : {}),
      }),
    )
}

export function buildQuickUseGlobalPromptLibraryEntries(
  items: readonly GlobalPromptLibraryItem[],
  projectAssets: CanvasAsset[],
  projectNames?: ReadonlyMap<string, string>,
): CanvasPromptLibraryEntry[] {
  const persistedEntries = buildGlobalPromptLibraryEntries(items, projectNames)
  const persistedProjectKeys = new Set(
    persistedEntries
      .filter((entry) => entry.originProjectId && entry.originAssetId)
      .map((entry) => `${entry.originProjectId}:${entry.originAssetId}`),
  )
  const projectEntries = buildAllProjectPromptLibraryGlobalEntries(
    projectAssets,
    projectNames,
  ).filter((entry) => !persistedProjectKeys.has(`${entry.originProjectId}:${entry.originAssetId}`))
  return [...persistedEntries, ...projectEntries]
}

export function sortPromptLibraryEntries(
  entries: readonly CanvasPromptLibraryEntry[],
  order: PromptLibrarySortOrder,
): CanvasPromptLibraryEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, timestamp: Date.parse(entry.createdAt ?? '') }))
    .sort((left, right) => {
      const leftValid = Number.isFinite(left.timestamp)
      const rightValid = Number.isFinite(right.timestamp)
      if (!leftValid || !rightValid) {
        if (leftValid !== rightValid) return leftValid ? -1 : 1
        return left.index - right.index
      }
      if (left.timestamp !== right.timestamp) {
        return order === 'newest'
          ? right.timestamp - left.timestamp
          : left.timestamp - right.timestamp
      }
      return left.index - right.index
    })
    .map(({ entry }) => entry)
}

export function CanvasPromptLibraryPanel({
  assets,
  globalEntries = [],
  projectNames,
  title = '提示词库',
  subtitle = '全局 + 项目提示词',
  placeholder = '搜索提示词',
  limit = 72,
  className = '',
  onApply,
  getApplyLabel,
  showSourceFilter = false,
  showCategoryFilter = true,
  showSort = false,
  deduplicateProjectEntriesAgainstGlobal = true,
}: {
  assets: CanvasAsset[]
  globalEntries?: CanvasPromptLibraryEntry[]
  projectNames?: ReadonlyMap<string, string>
  title?: string
  subtitle?: string
  placeholder?: string
  limit?: number | null
  className?: string
  onApply: (entry: CanvasPromptLibraryEntry) => void | Promise<void>
  getApplyLabel?: (entry: CanvasPromptLibraryEntry) => string
  showSourceFilter?: boolean
  showCategoryFilter?: boolean
  showSort?: boolean
  deduplicateProjectEntriesAgainstGlobal?: boolean
}) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<PromptLibraryCategoryKey>('all')
  const [activeSource, setActiveSource] = useState<PromptLibrarySource>(
    showSourceFilter ? 'global' : 'all',
  )
  const [sortOrder, setSortOrder] = useState<PromptLibrarySortOrder>('newest')
  const entries = useMemo(() => {
    const globalAssetKeys = new Set(
      globalEntries
        .filter(
          (entry) => entry.source === 'global' && entry.originProjectId && entry.originAssetId,
        )
        .map((entry) => `${entry.originProjectId}:${entry.originAssetId}`),
    )
    const globalAssetIds = new Set(
      globalEntries
        .filter(
          (entry) => entry.source === 'global' && !entry.originProjectId && entry.originAssetId,
        )
        .map((entry) => entry.originAssetId),
    )
    const projectEntries = buildCanvasPromptLibraryEntries(assets, projectNames).filter((entry) => {
      if (entry.source !== 'project' || !deduplicateProjectEntriesAgainstGlobal) return true
      return (
        !globalAssetKeys.has(`${entry.originProjectId}:${entry.originAssetId}`) &&
        !globalAssetIds.has(entry.originAssetId)
      )
    })
    return [...globalEntries, ...projectEntries]
  }, [assets, deduplicateProjectEntriesAgainstGlobal, globalEntries, projectNames])
  const sourceEntries = useMemo(() => {
    if (activeSource === 'all') return entries
    return entries.filter((entry) => entry.source === activeSource)
  }, [activeSource, entries])

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: sourceEntries.length }
    for (const entry of sourceEntries) {
      const key = getEntryCategoryKey(entry)
      counts[key] = (counts[key] ?? 0) + 1
      if (entry.source === 'global') counts.global = (counts.global ?? 0) + 1
      if (entry.source === 'project') counts.project = (counts.project ?? 0) + 1
    }
    return counts
  }, [sourceEntries])

  const visibleCategories = useMemo(() => {
    const knownGlobalCategories = new Set(
      sourceEntries
        .filter((entry) => entry.source === 'global')
        .map((entry) => entry.category ?? '未分类'),
    )
    const knownProjectCategories = new Set(
      sourceEntries
        .filter((entry) => entry.source === 'project')
        .map((entry) => entry.category ?? '未分类'),
    )
    const categories: PromptLibraryCategoryKey[] = []
    if (sourceEntries.some((entry) => entry.source === 'global')) categories.push('global')
    if ((categoryCounts.project ?? 0) > 0) categories.push('project')
    for (const category of knownGlobalCategories) categories.push(`global:${category}`)
    for (const category of knownProjectCategories) categories.push(`project:${category}`)
    categories.push('all')
    return categories.filter((category, index, list) => {
      if (category !== 'all' && (categoryCounts[category] ?? 0) === 0) return false
      return list.indexOf(category) === index
    })
  }, [categoryCounts, sourceEntries])

  const filteredEntries = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase()
    const categoryEntries =
      activeCategory === 'all'
        ? sourceEntries
        : activeCategory === 'global'
          ? sourceEntries.filter((entry) => entry.source === 'global')
          : activeCategory === 'project'
            ? sourceEntries.filter((entry) => entry.source === 'project')
            : sourceEntries.filter((entry) => getEntryCategoryKey(entry) === activeCategory)
    const list = cleanQuery
      ? categoryEntries.filter((entry) => {
          const haystack =
            `${entry.group} ${entry.label} ${entry.text} ${entry.tags?.join(' ') ?? ''} ${entry.originProjectName ?? ''}`.toLowerCase()
          return haystack.includes(cleanQuery)
        })
      : categoryEntries
    const sorted = sortPromptLibraryEntries(list, sortOrder)
    return typeof limit === 'number' ? sorted.slice(0, limit) : sorted
  }, [activeCategory, limit, query, sortOrder, sourceEntries])

  const handleSourceChange = (source: PromptLibrarySource) => {
    setActiveSource(source)
    setActiveCategory('all')
  }

  const handleCopy = async (entry: CanvasPromptLibraryEntry) => {
    try {
      await navigator.clipboard.writeText(entry.text)
      message.success(`已复制提示词：${entry.label}`)
    } catch {
      message.error('复制失败，请稍后重试')
    }
  }

  return (
    <div className={`canvas-prompt-library-panel ${className}`.trim()}>
      <div className="canvas-prompt-library-head">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <div className="canvas-prompt-library-head-actions">
          <span className="canvas-prompt-library-count">
            {filteredEntries.length} / {sourceEntries.length}
          </span>
        </div>
      </div>
      {showSourceFilter && (
        <div className="canvas-prompt-library-filter-row">
          <div
            className="canvas-prompt-library-source-filter"
            role="tablist"
            aria-label="提示词来源"
          >
            {(
              [
                ['global', '全局'],
                ['project', '项目'],
              ] as const
            ).map(([source, label]) => (
              <button
                key={source}
                type="button"
                className={activeSource === source ? 'active' : ''}
                onClick={() => handleSourceChange(source)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="canvas-prompt-library-filter-tools">
            <Input
              size="middle"
              allowClear
              className="canvas-prompt-library-quick-search"
              value={query}
              placeholder={placeholder}
              onChange={(event) => setQuery(event.target.value)}
            />
            {showSort && (
              <Select
                size="small"
                className="canvas-prompt-library-sort"
                aria-label="添加时间排序"
                value={sortOrder}
                options={[
                  { label: '最新添加', value: 'newest' },
                  { label: '最早添加', value: 'oldest' },
                ]}
                onChange={(value: PromptLibrarySortOrder) => setSortOrder(value)}
              />
            )}
          </div>
        </div>
      )}
      {showCategoryFilter && (
        <div className="canvas-prompt-library-categories" role="tablist" aria-label="提示词分类">
          {visibleCategories.map((category) => (
            <button
              key={category}
              type="button"
              className={`canvas-prompt-library-category${activeCategory === category ? ' active' : ''}`}
              onClick={() => setActiveCategory(category)}
            >
              <span>{getCategoryLabel(category)}</span>
              <small>{categoryCounts[category] ?? 0}</small>
            </button>
          ))}
        </div>
      )}
      {!showSourceFilter && (
        <>
          {showSort && (
            <Select
              size="small"
              value={sortOrder}
              options={[
                { label: '最新添加', value: 'newest' },
                { label: '最早添加', value: 'oldest' },
              ]}
              onChange={(value: PromptLibrarySortOrder) => setSortOrder(value)}
            />
          )}
          <Input
            size="middle"
            allowClear
            value={query}
            placeholder={placeholder}
            onChange={(event) => setQuery(event.target.value)}
          />
        </>
      )}
      <div className="canvas-prompt-library-list">
        {filteredEntries.length === 0 ? (
          <div className="canvas-prompt-library-empty">没有匹配的提示词</div>
        ) : (
          filteredEntries.map((entry) => {
            const coverUrl = entry.coverUrl
            const applyLabel = getApplyLabel?.(entry) ?? '应用'

            return (
              <article key={entry.id} className="canvas-prompt-library-entry">
                <div
                  className="canvas-prompt-library-entry-preview-button"
                  role="button"
                  tabIndex={0}
                  onClick={() => void onApply(entry)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      void onApply(entry)
                    }
                  }}
                >
                  <div className="canvas-prompt-library-entry-media">
                    {coverUrl ? (
                      <RemoteAssetImage
                        className="canvas-prompt-library-entry-preview"
                        src={coverUrl}
                        alt=""
                      />
                    ) : (
                      <div className="canvas-prompt-library-entry-fallback">
                        <span>{entry.group}</span>
                        <strong>{entry.label.slice(0, 6)}</strong>
                      </div>
                    )}
                  </div>
                  <div className="canvas-prompt-library-entry-body">
                    <div className="canvas-prompt-library-entry-title-row">
                      <Tag
                        className="canvas-prompt-library-entry-group"
                        color={entry.source === 'project' ? 'blue' : 'orange'}
                        bordered
                      >
                        {entry.group}
                      </Tag>
                      <strong title={entry.label}>{entry.label}</strong>
                    </div>
                    {entry.originProjectName &&
                      (entry.source === 'project' || entry.originProjectId) && (
                        <span className="canvas-prompt-library-entry-project">
                          {entry.originProjectName}
                        </span>
                      )}
                    <div className="canvas-prompt-library-entry-prompt-preview">
                      <span>提示词预览</span>
                      <p className="canvas-prompt-library-entry-text" title={entry.text}>
                        {entry.text}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="canvas-prompt-library-entry-actions">
                  <Button
                    size="small"
                    type="text"
                    className="canvas-prompt-library-entry-apply"
                    onClick={() => void onApply(entry)}
                  >
                    {applyLabel}
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    className="canvas-prompt-library-entry-copy"
                    aria-label="复制提示词"
                    onClick={() => void handleCopy(entry)}
                  >
                    复制
                  </Button>
                </div>
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}
