import { useMemo, useState } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Input, Switch, message } from 'antd'
import { CAMERA_PROMPT_LIBRARY, getCameraPromptExampleImage } from './canvasFilmPrompts'
import { PERFORMANCE_PROMPT_LIBRARY } from './canvasFilmPerformancePrompts'
import { readAssetKind } from './canvasFilmAssets'
import type { CanvasAsset } from './canvas.types'
import {
  getPromptCategory,
  readHideSystemPrompts,
  saveHideSystemPrompts,
} from './canvasPromptLibraryCategories'
import { readPromptLibraryCover, readPromptLibraryText } from './canvasPromptLibraryData'
import {
  canvasGeneratedPromptExampleUrl,
  canvasPromptExampleUrl,
} from '../../assets/remoteAssetUrls'
import { RemoteAssetImage } from '../../components/RemoteAssetImage'
import type { GlobalPromptLibraryItem } from './canvasPromptLibraryStore'
import './canvas-prompt-library.less'

const promptExample = (fileName: string): string => canvasPromptExampleUrl(fileName)

const GROUP_EXAMPLE_IMAGE_SRC: Record<string, string> = {
  景别: promptExample('group-shot-size.png'),
  角度: promptExample('group-angle.png'),
  运镜: promptExample('group-movement.png'),
  构图: promptExample('group-composition.png'),
  镜头焦距: promptExample('group-lens.png'),
  光圈: promptExample('group-focus.png'),
  快门: promptExample('group-exposure.png'),
  ISO: promptExample('group-exposure.png'),
  白平衡: promptExample('group-color.png'),
  焦点: promptExample('group-focus.png'),
  剪辑节奏: promptExample('group-pacing.png'),
  光影: promptExample('group-lighting.png'),
  色彩: promptExample('group-color.png'),
  镜头质感: promptExample('group-texture.png'),
  曝光与纹理: promptExample('group-exposure.png'),
  美术与环境: promptExample('group-production-design.png'),
  情绪氛围: promptExample('group-atmosphere.png'),
  表情: promptExample('group-expression.png'),
  动作: promptExample('group-action.png'),
  情绪: promptExample('group-emotion.png'),
  对白状态: promptExample('group-dialogue.png'),
  反向词: promptExample('group-negative.png'),
  连贯性: promptExample('group-continuity.png'),
}

export type CanvasPromptLibraryEntry = {
  id: string
  source: 'global' | 'project' | 'camera' | 'performance'
  group: string
  category?: string | undefined
  label: string
  text: string
  assetId?: string | undefined
  coverUrl?: string | undefined
  description?: string | undefined
  exampleImageSrc?: string | undefined
  tags?: string[] | undefined
  negativePrompt?: string | undefined
}

export function isSystemPromptLibraryEntry(
  entry: Pick<CanvasPromptLibraryEntry, 'source'>,
): boolean {
  return entry.source === 'camera' || entry.source === 'performance'
}

export function filterPromptLibraryEntries(
  entries: readonly CanvasPromptLibraryEntry[],
  hideSystemPrompts: boolean,
): CanvasPromptLibraryEntry[] {
  return hideSystemPrompts
    ? entries.filter((entry) => !isSystemPromptLibraryEntry(entry))
    : [...entries]
}

type PromptLibraryCategoryKey = 'all' | 'project' | `project:${string}` | `group:${string}`

const GROUP_CATEGORY_ORDER = [
  '景别',
  '构图',
  '镜头焦距',
  '光圈',
  '类型片风格',
  '角度',
  '运镜',
  '快门',
  'ISO',
  '白平衡',
  '焦点',
  '光影',
  '色彩',
  '曝光与纹理',
  '镜头质感',
  '美术与环境',
  '情绪氛围',
  '剪辑节奏',
  '表情',
  '动作',
  '情绪',
  '对白状态',
  '反向词',
  '连贯性',
] as const

function getEntryCategoryKey(entry: CanvasPromptLibraryEntry): PromptLibraryCategoryKey {
  if (entry.source === 'project' || entry.source === 'global') {
    return `project:${entry.category ?? '未分类'}`
  }
  return `group:${entry.group}`
}

function getCategoryLabel(category: PromptLibraryCategoryKey): string {
  if (category === 'all') return '全部'
  if (category === 'project') return '项目库'
  if (category.startsWith('project:')) return category.slice('project:'.length)
  return category.slice('group:'.length)
}

function getPromptEntryExampleImage(entry: CanvasPromptLibraryEntry): string | undefined {
  return (
    entry.coverUrl || entry.exampleImageSrc || GROUP_EXAMPLE_IMAGE_SRC[entry.group] || undefined
  )
}

function getGeneratedPromptExampleImage(itemId: string): string | undefined {
  const slug = itemId.replace(/[._]/g, '-')
  return canvasGeneratedPromptExampleUrl(`prompt-${slug}.png`)
}

export function buildCanvasPromptLibraryEntries(assets: CanvasAsset[]): CanvasPromptLibraryEntry[] {
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
      }
    })
    .filter((entry) => entry.text.trim())

  const cameraEntries = CAMERA_PROMPT_LIBRARY.flatMap((group) =>
    group.items.map(
      (item): CanvasPromptLibraryEntry => ({
        id: `camera:${item.id}`,
        source: 'camera',
        group: group.label,
        label: item.label,
        text: item.promptFragment,
        description: item.description,
        exampleImageSrc:
          getCameraPromptExampleImage(item.exampleImageId) ??
          getGeneratedPromptExampleImage(item.id),
        tags: item.tags,
        negativePrompt: item.negativePrompt,
      }),
    ),
  )

  const performanceEntries = PERFORMANCE_PROMPT_LIBRARY.flatMap((group) =>
    group.items.map(
      (item): CanvasPromptLibraryEntry => ({
        id: `performance:${item.id}`,
        source: 'performance',
        group: group.label,
        label: item.label,
        text: item.promptFragment,
        exampleImageSrc: getGeneratedPromptExampleImage(item.id),
      }),
    ),
  )

  return [...projectEntries, ...cameraEntries, ...performanceEntries]
}

export function buildGlobalPromptLibraryEntries(
  items: readonly GlobalPromptLibraryItem[],
): CanvasPromptLibraryEntry[] {
  return items
    .filter((item) => !item.id.startsWith('legacy:'))
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
      }),
    )
}

export function CanvasPromptLibraryPanel({
  assets,
  globalEntries = [],
  title = '提示词库',
  subtitle = '项目库 + 电影镜头/风格/表演词',
  placeholder = '搜索提示词、镜头、动作、表情',
  limit = 72,
  className = '',
  onApply,
  getApplyLabel,
  showSystemPromptFilter = false,
}: {
  assets: CanvasAsset[]
  globalEntries?: CanvasPromptLibraryEntry[]
  title?: string
  subtitle?: string
  placeholder?: string
  limit?: number
  className?: string
  onApply: (entry: CanvasPromptLibraryEntry) => void | Promise<void>
  getApplyLabel?: (entry: CanvasPromptLibraryEntry) => string
  showSystemPromptFilter?: boolean
}) {
  const [query, setQuery] = useState('')
  const [hideSystemPrompts, setHideSystemPrompts] = useState(readHideSystemPrompts)
  const [activeCategory, setActiveCategory] = useState<PromptLibraryCategoryKey>('all')
  const entries = useMemo(
    () => [...globalEntries, ...buildCanvasPromptLibraryEntries(assets)],
    [assets, globalEntries],
  )
  const visibleEntries = useMemo(
    () => filterPromptLibraryEntries(entries, hideSystemPrompts),
    [entries, hideSystemPrompts],
  )

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: visibleEntries.length }
    for (const entry of visibleEntries) {
      const key = getEntryCategoryKey(entry)
      counts[key] = (counts[key] ?? 0) + 1
      if (entry.source === 'project') counts.project = (counts.project ?? 0) + 1
    }
    return counts
  }, [visibleEntries])

  const visibleCategories = useMemo(() => {
    const knownGroups = new Set(
      visibleEntries.filter((entry) => entry.source !== 'project').map((entry) => entry.group),
    )
    const knownProjectCategories = new Set(
      visibleEntries
        .filter((entry) => entry.source === 'project')
        .map((entry) => entry.category ?? '未分类'),
    )
    const categories: PromptLibraryCategoryKey[] = []
    if ((categoryCounts.project ?? 0) > 0) categories.push('project')
    for (const category of knownProjectCategories) categories.push(`project:${category}`)
    for (const group of GROUP_CATEGORY_ORDER) {
      if (knownGroups.has(group)) categories.push(`group:${group}`)
    }
    for (const group of knownGroups) {
      if (!GROUP_CATEGORY_ORDER.includes(group as (typeof GROUP_CATEGORY_ORDER)[number])) {
        categories.push(`group:${group}`)
      }
    }
    categories.push('all')
    return categories.filter((category, index, list) => {
      if (category !== 'all' && (categoryCounts[category] ?? 0) === 0) return false
      return list.indexOf(category) === index
    })
  }, [categoryCounts, visibleEntries])

  const filteredEntries = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase()
    const categoryEntries =
      activeCategory === 'all'
        ? visibleEntries
        : activeCategory === 'project'
          ? visibleEntries.filter((entry) => entry.source === 'project')
          : visibleEntries.filter((entry) => getEntryCategoryKey(entry) === activeCategory)
    const list = cleanQuery
      ? categoryEntries.filter((entry) => {
          const haystack =
            `${entry.group} ${entry.label} ${entry.text} ${entry.description ?? ''} ${
              entry.tags?.join(' ') ?? ''
            } ${entry.negativePrompt ?? ''}`.toLowerCase()
          return haystack.includes(cleanQuery)
        })
      : categoryEntries
    return list.slice(0, limit)
  }, [activeCategory, limit, query, visibleEntries])

  const handleSystemPromptFilterChange = (checked: boolean) => {
    setHideSystemPrompts(checked)
    saveHideSystemPrompts(checked)
    if (checked && activeCategory.startsWith('group:')) setActiveCategory('all')
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
          {showSystemPromptFilter && (
            <label className="canvas-prompt-library-system-filter">
              <span>隐藏系统提示词</span>
              <Switch
                size="small"
                checked={hideSystemPrompts}
                onChange={handleSystemPromptFilterChange}
              />
            </label>
          )}
          <span className="canvas-prompt-library-count">
            {filteredEntries.length} / {visibleEntries.length}
          </span>
        </div>
      </div>
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
      <Input
        size="middle"
        allowClear
        value={query}
        placeholder={placeholder}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="canvas-prompt-library-list">
        {filteredEntries.length === 0 ? (
          <div className="canvas-prompt-library-empty">没有匹配的提示词</div>
        ) : (
          filteredEntries.map((entry) => {
            const exampleImageSrc = getPromptEntryExampleImage(entry)
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
                    {exampleImageSrc ? (
                      <RemoteAssetImage
                        className="canvas-prompt-library-entry-preview"
                        src={exampleImageSrc}
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
                        color={
                          entry.source === 'project'
                            ? 'blue'
                            : entry.source === 'camera'
                              ? 'purple'
                              : 'orange'
                        }
                        bordered
                      >
                        {entry.group}
                      </Tag>
                      <strong title={entry.label}>{entry.label}</strong>
                    </div>
                    {entry.description && (
                      <p className="canvas-prompt-library-entry-desc" title={entry.description}>
                        {entry.description}
                      </p>
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
                    type="primary"
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
