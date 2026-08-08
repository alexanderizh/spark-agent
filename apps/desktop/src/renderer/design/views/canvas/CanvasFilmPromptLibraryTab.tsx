import { useEffect, useState } from 'react'
import { message } from 'antd'
import {
  buildGlobalPromptLibraryEntries,
  CanvasPromptLibraryPanel,
  type CanvasPromptLibraryEntry,
} from './CanvasPromptLibraryPanel'
import type { FilmCenterHandlers } from './CanvasFilmAssetCenter'
import {
  readGlobalPromptLibrary,
  type GlobalPromptLibraryState,
} from './canvasPromptLibraryStore'

export function CanvasFilmPromptLibraryTab({
  handlers,
}: {
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

    if (entry.source === 'project' && entry.assetId) {
      handlers.onInsertAssetToCanvas(entry.assetId)
      message.success('已插入提示词到画布')
      return
    }
    await handlers.createFilmAsset({
      kind: 'prompt_library',
      name: entry.label,
      text: entry.text,
      prompt: entry.text,
      tags: [entry.group, ...(entry.tags ?? [])],
    })
    message.success(`已加入项目提示词库：${entry.label}`)
  }

  return (
      <CanvasPromptLibraryPanel
        assets={[]}
        globalEntries={library ? buildGlobalPromptLibraryEntries(library.items) : []}
        className="canvas-film-prompt-library"
        title="提示词库"
        subtitle="通用提示词 + 内置电影镜头/风格/表演词"
      showSystemPromptFilter
      onApply={handleApply}
      getApplyLabel={(entry) =>
        handlers.hasPromptCanvasTarget?.()
          ? '应用到画布'
          : entry.source === 'global'
            ? '复制提示词'
            : entry.source === 'project'
            ? '插入画布'
            : '加入项目库'
      }
    />
  )
}
