import { message } from 'antd'
import { CanvasPromptLibraryPanel, type CanvasPromptLibraryEntry } from './CanvasPromptLibraryPanel'
import type { CanvasSnapshot } from './canvas.types'
import type { FilmCenterHandlers } from './CanvasFilmAssetCenter'

export function CanvasFilmPromptLibraryTab({
  snapshot,
  handlers,
}: {
  snapshot: CanvasSnapshot
  handlers: FilmCenterHandlers
}) {
  const handleApply = async (entry: CanvasPromptLibraryEntry) => {
    if (handlers.onApplyPromptEntryToCanvas) {
      const applied = await handlers.onApplyPromptEntryToCanvas(entry)
      if (applied) return
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
      assets={snapshot.assets}
      className="canvas-film-prompt-library"
      title="提示词库"
      subtitle="项目提示词 + 内置电影镜头/风格/表演词"
      onApply={handleApply}
      getApplyLabel={(entry) =>
        handlers.hasPromptCanvasTarget?.()
          ? '应用到画布'
          : entry.source === 'project'
            ? '插入画布'
            : '加入项目库'
      }
    />
  )
}
