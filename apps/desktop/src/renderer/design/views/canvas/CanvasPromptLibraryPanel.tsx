import { useMemo, useState } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Input, message } from 'antd'
import { CAMERA_PROMPT_LIBRARY, getCameraPromptExampleImage } from './canvasFilmPrompts'
import { PERFORMANCE_PROMPT_LIBRARY } from './canvasFilmPerformancePrompts'
import { readAssetKind } from './canvasFilmAssets'
import type { CanvasAsset } from './canvas.types'

const promptExampleModules = import.meta.glob('../../../assets/canvas-prompt-examples/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const GROUP_EXAMPLE_IMAGE_SRC: Record<string, string> = {
  景别: promptExampleModules['../../../assets/canvas-prompt-examples/group-shot-size.png'] ?? '',
  角度: promptExampleModules['../../../assets/canvas-prompt-examples/group-angle.png'] ?? '',
  运镜: promptExampleModules['../../../assets/canvas-prompt-examples/group-movement.png'] ?? '',
  构图: promptExampleModules['../../../assets/canvas-prompt-examples/group-composition.png'] ?? '',
  镜头焦距: promptExampleModules['../../../assets/canvas-prompt-examples/group-lens.png'] ?? '',
  光圈: promptExampleModules['../../../assets/canvas-prompt-examples/group-focus.png'] ?? '',
  快门: promptExampleModules['../../../assets/canvas-prompt-examples/group-exposure.png'] ?? '',
  ISO: promptExampleModules['../../../assets/canvas-prompt-examples/group-exposure.png'] ?? '',
  白平衡: promptExampleModules['../../../assets/canvas-prompt-examples/group-color.png'] ?? '',
  焦点: promptExampleModules['../../../assets/canvas-prompt-examples/group-focus.png'] ?? '',
  剪辑节奏: promptExampleModules['../../../assets/canvas-prompt-examples/group-pacing.png'] ?? '',
  光影: promptExampleModules['../../../assets/canvas-prompt-examples/group-lighting.png'] ?? '',
  色彩: promptExampleModules['../../../assets/canvas-prompt-examples/group-color.png'] ?? '',
  镜头质感: promptExampleModules['../../../assets/canvas-prompt-examples/group-texture.png'] ?? '',
  曝光与纹理: promptExampleModules['../../../assets/canvas-prompt-examples/group-exposure.png'] ?? '',
  美术与环境:
    promptExampleModules['../../../assets/canvas-prompt-examples/group-production-design.png'] ?? '',
  情绪氛围: promptExampleModules['../../../assets/canvas-prompt-examples/group-atmosphere.png'] ?? '',
  表情: promptExampleModules['../../../assets/canvas-prompt-examples/group-expression.png'] ?? '',
  动作: promptExampleModules['../../../assets/canvas-prompt-examples/group-action.png'] ?? '',
  情绪: promptExampleModules['../../../assets/canvas-prompt-examples/group-emotion.png'] ?? '',
  对白状态: promptExampleModules['../../../assets/canvas-prompt-examples/group-dialogue.png'] ?? '',
  反向词: promptExampleModules['../../../assets/canvas-prompt-examples/group-negative.png'] ?? '',
  连贯性: promptExampleModules['../../../assets/canvas-prompt-examples/group-continuity.png'] ?? '',
}

const GENERATED_PREVIEW_GROUPS = new Set(['景别', '构图', '镜头焦距', '光圈'])

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
  '类型片风格',
  '景别',
  '构图',
  '镜头焦距',
  '光圈',
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

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function hashSeed(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

function extractPreviewKeywords(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^shot at /i.test(part))
    .slice(0, 3)
}

function buildGeneratedPromptPreview(entry: Pick<CanvasPromptLibraryEntry, 'id' | 'group' | 'label' | 'text'>): string | undefined {
  const baseImageSrc = GROUP_EXAMPLE_IMAGE_SRC[entry.group]
  if (!baseImageSrc || !GENERATED_PREVIEW_GROUPS.has(entry.group)) return undefined

  const seed = hashSeed(entry.id)
  const hue = seed % 360
  const zoom = 1.08 + (seed % 5) * 0.04
  const offsetX = -24 - (seed % 36)
  const offsetY = -18 - ((seed >> 3) % 28)
  const keywords = extractPreviewKeywords(entry.text)
  const chipLines = keywords
    .map((keyword, index) => {
      const y = 262 + index * 28
      return [
        `<rect x="28" y="${y}" width="300" height="20" rx="10" fill="rgba(10,18,28,0.44)" />`,
        `<text x="42" y="${y + 14}" fill="rgba(255,255,255,0.92)" font-size="11" font-family="SF Pro Display, PingFang SC, sans-serif">${escapeSvgText(keyword)}</text>`,
      ].join('')
    })
    .join('')

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <defs>
        <linearGradient id="overlay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgb(5, 12, 20)" stop-opacity="0.10" />
          <stop offset="55%" stop-color="rgb(5, 12, 20)" stop-opacity="0.24" />
          <stop offset="100%" stop-color="rgb(5, 12, 20)" stop-opacity="0.86" />
        </linearGradient>
        <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="hsl(${hue}, 92%, 74%)" stop-opacity="0.96" />
          <stop offset="100%" stop-color="hsl(${(hue + 52) % 360}, 88%, 62%)" stop-opacity="0.86" />
        </linearGradient>
      </defs>
      <image href="${escapeSvgText(baseImageSrc)}" x="${offsetX}" y="${offsetY}" width="${Math.round(640 * zoom)}" height="${Math.round(360 * zoom)}" preserveAspectRatio="xMidYMid slice" />
      <rect width="640" height="360" fill="url(#overlay)" />
      <rect x="24" y="24" width="96" height="28" rx="14" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.20)" />
      <text x="72" y="42" fill="white" font-size="13" text-anchor="middle" font-family="SF Pro Display, PingFang SC, sans-serif">${escapeSvgText(entry.group)}</text>
      <rect x="24" y="212" width="592" height="124" rx="20" fill="rgba(7,12,19,0.48)" stroke="rgba(255,255,255,0.16)" />
      <rect x="28" y="216" width="5" height="116" rx="2.5" fill="url(#accent)" />
      <text x="48" y="252" fill="white" font-size="26" font-weight="700" font-family="SF Pro Display, PingFang SC, sans-serif">${escapeSvgText(entry.label)}</text>
      ${chipLines}
    </svg>
  `

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
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
          getCameraPromptExampleImage(item.exampleImageId) ??
          buildGeneratedPromptPreview({
            id: `camera:${item.id}`,
            group: group.label,
            label: item.label,
            text: item.promptFragment,
          }),
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
  const [activeCategory, setActiveCategory] = useState<PromptLibraryCategoryKey>('group:类型片风格')
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
    categories.push('group:类型片风格')
    if ((categoryCounts.project ?? 0) > 0) categories.push('project')
    for (const group of GROUP_CATEGORY_ORDER) {
      if (group === '类型片风格') continue
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
        size="small"
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
                      <img
                        className="canvas-prompt-library-entry-preview"
                        src={exampleImageSrc}
                        alt=""
                        loading="lazy"
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
                    type="default"
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
