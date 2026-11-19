import type { IpcRequest } from '@spark/protocol'
import { Icons } from '../Icons'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuEntry } from './contextMenuModel'
import { canOpenInEditor, canOpenPreview, type FileOpenMode } from './fileOpenRouting'
import { decodeSafeFileUrl } from './filePreviewSource'
import { useToast } from './Toast'

export function FilePathContextMenu({
  filePath,
  x,
  y,
  onClose,
  onOpenWithMode,
}: {
  filePath: string
  x: number
  y: number
  onClose: () => void
  onOpenWithMode?: (mode: FileOpenMode) => void
}) {
  const { toast } = useToast()
  const platform = window.spark?.platform
  const candidate = decodeSafeFileUrl(filePath) ?? filePath
  const localPath = /^(?:\/(?!\/)|[a-z]:[\\/]|\\\\)/i.test(candidate) ? candidate : null
  const canEdit = canOpenInEditor(candidate)
  const run = (fallback: string, operation: () => Promise<void>) => () => {
    void operation().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : fallback)
    })
  }

  const items: ContextMenuEntry[] = []
  if (onOpenWithMode && canOpenPreview(candidate)) {
    items.push({
      key: 'preview',
      label: '预览',
      icon: <Icons.Eye size={14} />,
      onClick: () => onOpenWithMode('preview'),
    })
  }
  if (onOpenWithMode && canEdit) {
    items.push({
      key: 'edit',
      label: '编辑',
      icon: <Icons.Edit size={14} />,
      onClick: () => onOpenWithMode('edit'),
    })
  }
  if (localPath != null) {
    const fileAction = (action: IpcRequest<'file:chat-action'>['action'], success?: string) =>
      run('文件操作失败', async () => {
        const result = await window.spark.invoke('file:chat-action', {
          filePath: localPath,
          action,
        })
        if (result.status === 'error') throw new Error(result.error)
        if (result.status === 'done' && success) toast.success(success)
      })

    items.push({
      key: 'open',
      label: '打开文件',
      icon: <Icons.ExternalLink size={14} />,
      onClick: run('打开文件失败', async () => {
        const result = await window.spark.invoke('file:open', { filePath: localPath })
        if (!result.opened) throw new Error(result.error ?? '无法打开文件')
      }),
    })
    if (platform === 'darwin' || platform === 'win32') {
      items.push({
        key: 'open-with',
        label: '打开方式…',
        icon: <Icons.File size={14} />,
        onClick: fileAction('open-with'),
      })
    }
    if (platform === 'darwin' || platform === 'win32' || platform === 'linux') {
      items.push({
        key: 'terminal',
        label: '在终端打开所在目录',
        icon: <Icons.Terminal size={14} />,
        onClick: fileAction('open-terminal'),
      })
    }
    items.push(
      { type: 'divider' },
      {
        key: 'save-as',
        label: '另存为…',
        icon: <Icons.Download size={14} />,
        onClick: fileAction('save-as', '已另存为副本'),
      },
    )
    if (canEdit) {
      items.push({
        key: 'copy-content',
        label: '复制文件内容',
        icon: <Icons.Clipboard size={14} />,
        onClick: fileAction('copy-content', '已复制文件内容'),
      })
    }
  }
  items.push({
    key: 'copy-path',
    label: '复制路径',
    icon: <Icons.Copy size={14} />,
    onClick: run('复制路径失败', async () => {
      const result = await window.spark.invoke('clipboard:write-text', { text: candidate })
      if (!result.success) throw new Error('复制路径失败')
      toast.success('已复制路径')
    }),
  })
  if (localPath != null) {
    items.push({
      key: 'reveal',
      label:
        platform === 'darwin'
          ? '在 Finder 中显示'
          : platform === 'win32'
            ? '在资源管理器中显示'
            : '在文件管理器中显示',
      icon: <Icons.FolderOpen size={14} />,
      onClick: run('定位文件失败', async () => {
        const { kind } = await window.spark.invoke('file:stat-kind', { path: localPath })
        if (kind !== 'file') throw new Error('文件不存在或已被移动')
        const result = await window.spark.invoke('file:reveal', { filePath: localPath })
        if (!result.revealed) throw new Error(result.error ?? '无法定位文件')
      }),
    })
  }

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} ariaLabel="文件操作" />
}
