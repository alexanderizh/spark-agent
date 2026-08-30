import { useEffect, useState } from 'react'
import { message } from 'antd'
import {
  buildGlobalPromptLibraryEntries,
  CanvasPromptLibraryPanel,
  type CanvasPromptLibraryEntry,
} from './CanvasPromptLibraryPanel'
import type { FilmCenterHandlers } from './CanvasFilmAssetCenter'
import type { CanvasSnapshot } from './canvas.types'
import { readGlobalPromptLibrary, type GlobalPromptLibraryState } from './canvasPromptLibraryStore'

export function CanvasFilmPromptLibraryTab({
  snapshot,
  handlers,
}: {
  snapshot: CanvasSnapshot
  handlers: FilmCenterHandlers
}) {
  const [library, setLibrary] = useState<GlobalPromptLibraryState | null>(null)

  useEffect(() => {
    let cancelled = false
    void readGlobalPromptLibrary().then((next) => {
      if (!cancelled) setLibrary(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleApply = async (entry: CanvasPromptLibraryEntry) => {
    if (handlers.onApplyPromptEntryToCanvas) {
      const applied = await handlers.onApplyPromptEntryToCanvas(entry)
      if (applied) return
    }

    if (entry.source === 'global') {
      await navigator.clipboard.writeText(entry.text)
      message.success(`已复制提示词：${entry.label}`)
      return
    }

    if (entry.assetId) {
      handlers.onInsertAssetToCanvas(entry.assetId)
      message.success('已插入提示词到画布')
    }
  }

  return (
    <CanvasPromptLibraryPanel
      assets={snapshot.assets}
      globalEntries={library ? buildGlobalPromptLibraryEntries(library.items) : []}
      className="canvas-film-prompt-library"
      title="提示词库"
      subtitle="全局 + 项目提示词"
      onApply={handleApply}
      getApplyLabel={(entry) =>
        handlers.hasPromptCanvasTarget?.()
          ? '应用到画布'
          : entry.source === 'global'
            ? '复制提示词'
            : '插入画布'
      }
    />
  )
}
