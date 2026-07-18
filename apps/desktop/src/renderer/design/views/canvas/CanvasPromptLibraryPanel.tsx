import { useMemo, useState } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Input, message } from 'antd'
import { CAMERA_PROMPT_LIBRARY, getCameraPromptExampleImage } from './canvasFilmPrompts'
import { PERFORMANCE_PROMPT_LIBRARY } from './canvasFilmPerformancePrompts'
import { readAssetKind } from './canvasFilmAssets'
import type { CanvasAsset } from './canvas.types'
import {
  canvasGeneratedPromptExampleUrl,
  canvasPromptExampleUrl,
} from '../../assets/remoteAssetUrls'
import { RemoteAssetImage } from '../../components/RemoteAssetImage'

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
  source: 'project' | 'camera' | 'performance'
  group: string
  label: string
  text: string
  assetId?: string | undefined
  description?: string | undefined
  exampleImageSrc?: string | undefined
  tags?: string[] | undefined
  negativePrompt?: string | undefined
}

type PromptLibraryCategoryKey = 'all' | 'project' | `group:${string}`

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
  if (entry.source === 'project') return 'project'
  return `group:${entry.group}`
}

function getCategoryLabel(category: PromptLibraryCategoryKey): string {
  if (category === 'all') return '全部'
  if (category === 'project') return '项目库'
  return category.slice('group:'.length)
}

function getPromptEntryExampleImage(entry: CanvasPromptLibraryEntry): string | undefined {
  return entry.exampleImageSrc || GROUP_EXAMPLE_IMAGE_SRC[entry.group] || undefined
}

function getGeneratedPromptExampleImage(itemId: string): string | undefined {
  const slug = itemId.replace(/[._]/g, '-')
  return canvasGeneratedPromptExampleUrl(`prompt-${slug}.png`)
}

export function buildCanvasPromptLibraryEntries(assets: CanvasAsset[]): CanvasPromptLibraryEntry[] {
  const projectEntries = assets
    .filter((asset) => readAssetKind(asset) === 'prompt_library')
    .map((asset): CanvasPromptLibraryEntry => {
      const assetPrompt = typeof asset.metadata?.prompt === 'string' ? asset.metadata.prompt : ''
      return {
        id: `project:${asset.id}`,
        source: 'project',
        group: '项目提示词库',
        label: asset.title ?? '未命名提示词',
        text: asset.contentText ?? assetPrompt,
        assetId: asset.id,
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
          getCameraPromptExampleImage(item.exampleImageId) ?? getGeneratedPromptExampleImage(item.id),
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

export function CanvasPromptLibraryPanel({
  assets,
  title = '提示词库',
  subtitle = '项目库 + 电影镜头/风格/表演词',
  placeholder = '搜索提示词、镜头、动作、表情',
  limit = 72,
  className = '',
  onApply,
  getApplyLabel,
}: {
  assets: CanvasAsset[]
  title?: string
  subtitle?: string
  placeholder?: string
  limit?: number
  className?: string
  onApply: (entry: CanvasPromptLibraryEntry) => void | Promise<void>
  getApplyLabel?: (entry: CanvasPromptLibraryEntry) => string
}) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<PromptLibraryCategoryKey>('group:景别')
  const entries = useMemo(() => buildCanvasPromptLibraryEntries(assets), [assets])

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length }
    for (const entry of entries) {
      const key = getEntryCategoryKey(entry)
      counts[key] = (counts[key] ?? 0) + 1
    }
    return counts
  }, [entries])

  const visibleCategories = useMemo(() => {
    const knownGroups = new Set(entries.map((entry) => entry.group))
    const categories: PromptLibraryCategoryKey[] = []
    if ((categoryCounts.project ?? 0) > 0) categories.push('project')
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
  }, [categoryCounts, entries])

  const filteredEntries = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase()
    const categoryEntries =
      activeCategory === 'all'
        ? entries
        : entries.filter((entry) => getEntryCategoryKey(entry) === activeCategory)
    const list = cleanQuery
      ? categoryEntries.filter((entry) => {
          const haystack = `${entry.group} ${entry.label} ${entry.text} ${entry.description ?? ''} ${
            entry.tags?.join(' ') ?? ''
          } ${entry.negativePrompt ?? ''}`.toLowerCase()
          return haystack.includes(cleanQuery)
        })
      : categoryEntries
    return list.slice(0, limit)
  }, [activeCategory, entries, limit, query])

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
        <span className="canvas-prompt-library-count">{filteredEntries.length} / {entries.length}</span>
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
                    <p className="canvas-prompt-library-entry-text" title={entry.text}>
                      {entry.text}
                    </p>
                  </div>
                </div>
                <div className="canvas-prompt-library-entry-actions">
                  <Button
                    size="small"
                    type="text"
                    className="canvas-prompt-library-entry-copy"
                    onClick={() => void handleCopy(entry)}
                  >
                    复制提示词
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    className="canvas-prompt-library-entry-apply"
                    onClick={() => void onApply(entry)}
                  >
                    {applyLabel}
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
