/**
 * 快速创作任务右键菜单：条目构造 + 产物定位。
 *
 * 菜单分两组，中间一条分割线：
 *   - 产物组：直接对着图片 / 视频复制、去图编辑、另存为、定位文件
 *   - 任务组：查看详情、复制提示词、复用配置、重试、存入提示词库、删除任务
 *
 * 目标用「任务 id + 产物 key」描述而不是数组下标：任务刷新或产物顺序变化后
 * 仍能定位到原来那一张，不会因为下标漂移操作到别的产物。产物 key 取
 * filePath（没有则退回落显示 URL）。
 */
import type { CanvasMediaTaskAsset } from '@spark/protocol'
import { Icons } from '../../Icons'
import type { ContextMenuEntry } from '../../components/contextMenuModel'
import { copyableTaskPrompt, taskOutputUrl } from './quickCreateTaskPresentation'
import type { QuickCreateTaskRecord } from './quickCreateTaskStore'

/** 可独立查看 / 操作的产物：已解析出展示 URL 的图片或视频 */
export type QuickCreateViewableOutput = {
  asset: CanvasMediaTaskAsset
  url: string
}

export type QuickCreateMenuTarget = { taskId: string; assetRef: string | null }

/** 一条产物的稳定标识 */
export function outputKeyOf(output: QuickCreateViewableOutput): string {
  return output.asset.filePath ?? output.url
}

export function viewableOutputsOf(task: QuickCreateTaskRecord): QuickCreateViewableOutput[] {
  return task.assets
    .map((asset) => {
      const url = taskOutputUrl(asset)
      const viewable = url !== '' && (asset.type === 'image' || asset.type === 'video')
      return viewable ? { asset, url } : null
    })
    .filter((item): item is QuickCreateViewableOutput => item != null)
}

export type QuickCreateTaskMenuHandlers = {
  /** 卡片 / 列表行右键打开（或收起）详情；详情弹层内不传，该项自动隐藏 */
  onToggleDetail?: ((task: QuickCreateTaskRecord) => void) | undefined
  /** 详情当前已展开 → 文案显示为「收起详情」 */
  detailOpen?: boolean | undefined
  onViewOutput: (task: QuickCreateTaskRecord, outputIndex: number) => void
  onCopyPrompt: (text: string, doneMessage: string) => void
  onCopyImage: (url: string) => void
  /** 产物图片「去图编辑」：不传则菜单里隐藏该项（视频产物永远不显示） */
  onEditImage?: ((asset: CanvasMediaTaskAsset) => void) | undefined
  onSaveOutput: (asset: CanvasMediaTaskAsset) => void
  onRevealOutput: (asset: CanvasMediaTaskAsset) => void
  onReuse: (task: QuickCreateTaskRecord) => void
  onRetry: (task: QuickCreateTaskRecord) => void
  onSavePrompt: (task: QuickCreateTaskRecord) => void
  onDelete: (taskId: string) => void
}

/** 按任务与右键目标构造菜单条目；目标产物已不存在时只给任务动作 */
export function buildQuickCreateTaskMenuItems(
  task: QuickCreateTaskRecord,
  target: QuickCreateMenuTarget,
  handlers: QuickCreateTaskMenuHandlers,
): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = []
  const outputs = viewableOutputsOf(task)
  // 目标产物可能已被刷新替换：定位不到时只给任务动作，不误伤别的产物
  const outputIndex = target.assetRef
    ? outputs.findIndex((candidate) => outputKeyOf(candidate) === target.assetRef)
    : -1
  const output = outputIndex >= 0 ? (outputs[outputIndex] ?? null) : null

  if (output) {
    const isImage = output.asset.type !== 'video'
    items.push({
      key: 'view_output',
      label: isImage ? '查看大图' : '查看视频',
      icon: isImage ? <Icons.Maximize size={14} /> : <Icons.Play size={14} />,
      onClick: () => handlers.onViewOutput(task, outputIndex),
    })
    if (isImage) {
      items.push({
        key: 'copy_output',
        label: '复制图片',
        icon: <Icons.Copy size={14} />,
        onClick: () => handlers.onCopyImage(output.url),
      })
      if (handlers.onEditImage) {
        items.push({
          key: 'edit_image',
          label: '去图编辑',
          icon: <Icons.ImagePlus size={14} />,
          onClick: () => handlers.onEditImage?.(output.asset),
        })
      }
    }
    if (output.asset.filePath) {
      items.push({
        key: 'save_output',
        label: '另存为…',
        icon: <Icons.Download size={14} />,
        onClick: () => handlers.onSaveOutput(output.asset),
      })
      items.push({
        key: 'reveal_output',
        label: '打开所在文件夹',
        icon: <Icons.FolderOpen size={14} />,
        onClick: () => handlers.onRevealOutput(output.asset),
      })
    }
    items.push({ type: 'divider' })
  }

  if (handlers.onToggleDetail) {
    items.push({
      key: 'toggle_detail',
      label: handlers.detailOpen ? '收起详情' : '查看详情',
      icon: handlers.detailOpen ? <Icons.ChevronUp size={14} /> : <Icons.Search size={14} />,
      onClick: () => handlers.onToggleDetail?.(task),
    })
  }
  const copyTarget = copyableTaskPrompt(task)
  if (copyTarget) {
    items.push({
      key: 'copy_prompt',
      label: copyTarget.label,
      icon: <Icons.Copy size={14} />,
      onClick: () => handlers.onCopyPrompt(copyTarget.text, copyTarget.doneMessage),
    })
  }
  items.push({
    key: 'reuse',
    label: '复用配置',
    icon: <Icons.Repeat size={14} />,
    onClick: () => handlers.onReuse(task),
  })
  if (task.status !== 'running') {
    items.push({
      key: 'retry',
      label: task.status === 'succeeded' ? '重新生成' : '重试',
      icon: <Icons.RotateCcw size={14} />,
      onClick: () => handlers.onRetry(task),
    })
  }
  if (task.prompt.trim()) {
    items.push({
      key: 'save_prompt',
      label: '存入提示词库',
      icon: <Icons.Book size={14} />,
      onClick: () => handlers.onSavePrompt(task),
    })
  }
  items.push({ type: 'divider' })
  items.push({
    key: 'delete_task',
    label: '删除任务',
    icon: <Icons.Trash size={14} />,
    danger: true,
    onClick: () => handlers.onDelete(task.id),
  })
  return items
}
