import { useCallback, useEffect, useRef, useState } from 'react'

export const PINNED_CANVAS_ITEMS_CATEGORY = 'canvas-agent-picker'

export type CanvasPinnedItemKind = 'agents' | 'skills'

export type PinnedCanvasItemsController = {
  pinned: string[]
  isPinned: (id: string) => boolean
  togglePinned: (id: string) => void
}

export function parsePinnedCanvasItemIds(raw: unknown): string[] {
  const source = typeof raw === 'string' ? parseJson(raw) : raw
  if (!Array.isArray(source)) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const value of source) {
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

export function togglePinnedCanvasItem(pinned: readonly string[], id: string): string[] {
  if (pinned.includes(id)) return pinned.filter((item) => item !== id)
  return [id, ...pinned]
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function usePinnedCanvasItems(kind: CanvasPinnedItemKind): PinnedCanvasItemsController {
  const [pinned, setPinned] = useState<string[]>([])
  const loadedRef = useRef(false)
  const key = `pinned-${kind}`

  const persist = useCallback(
    async (ids: string[]) => {
      try {
        await window.spark.invoke('settings:set', {
          category: PINNED_CANVAS_ITEMS_CATEGORY,
          key,
          value: JSON.stringify(ids),
        })
      } catch {
        // 置顶是增强体验，持久化失败不阻塞当前选择器。
      }
    },
    [key],
  )

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void (async () => {
      try {
        const res = await window.spark.invoke('settings:get', {
          category: PINNED_CANVAS_ITEMS_CATEGORY,
          key,
        })
        const loaded = parsePinnedCanvasItemIds(res?.value)
        setPinned((current) => {
          const merged = [...current]
          for (const id of loaded) {
            if (!merged.includes(id)) merged.push(id)
          }
          return merged
        })
      } catch {
        // 没有历史置顶或读取失败时使用空列表。
      }
    })()
  }, [key])

  const isPinned = useCallback((id: string) => pinned.includes(id), [pinned])
  const togglePinned = useCallback(
    (id: string) => {
      setPinned((current) => {
        const next = togglePinnedCanvasItem(current, id)
        void persist(next)
        return next
      })
    },
    [persist],
  )

  return { pinned, isPinned, togglePinned }
}
