/**
 * 远程文档预览（Office / PDF）。
 *
 * 目标电脑上的 .docx/.xlsx/.pptx/.pdf 本机读不到，流程是：
 *   remote-agent:attachment:fetch 取回 → 落到 userData 缓存 → 交给桌面端
 *   FilePreviewPanel 渲染（Flyfish Viewer，与本地产物同一套渲染器）。
 *
 * 为什么不用内联预览：Office/PDF 靠 iframe + 渲染器进程，塞进消息流里会把
 * 气泡撑爆，也不方便缩放翻页。这里用右侧抽屉（可 Esc 关闭），与桌面端
 * 文件预览的视觉层级一致。
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from '../../Icons'
import { FilePreviewPanel } from '../../components/FilePreviewPanel'
import { getPreviewFileType } from '../../components/FileDisplay'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useRemoteFile } from './remoteFileCache'
import { fileNameOf } from './remoteRichContent'

export interface RemoteDocPreviewProps {
  deviceId: string
  /** 目标电脑上的绝对路径 */
  remotePath: string
  /** 展示名（事件里可能带了标题） */
  name?: string
  onClose: () => void
}

/**
 * 浮层要挂在哪里：**不能挂在消息列表里**（会被 .rc-chat-scroll 裁剪，遮罩与按钮
 * 都点不到），也不能一律挂到 body —— 主题 token 定义在 `.app.theme-*` 上，
 * 挂到 body 后深色模式会掉回浅色。优先挂到带主题类的应用根节点。
 */
function resolveOverlayHost(): Element {
  return document.querySelector('.app.theme-light, .app.theme-dark') ?? document.body
}

export function RemoteDocPreview({ deviceId, remotePath, name, onClose }: RemoteDocPreviewProps) {
  const file = useRemoteFile(deviceId, remotePath, true)
  const { invoke: openLocalFile } = useIpcInvoke('file:open')
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const handleOpenExternal = useCallback(async () => {
    if (file.localPath == null) return
    setOpening(true)
    setOpenError(null)
    try {
      const result = await openLocalFile({ filePath: file.localPath })
      if (!result.opened) setOpenError(result.error ?? '无法用系统应用打开')
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setOpening(false)
    }
  }, [file.localPath, openLocalFile])

  const title = name ?? fileNameOf(remotePath)
  // 缓存文件名保持了原扩展名，所以按本地路径判定类型即可（pdf/docx/... → universal）
  const fileType = getPreviewFileType(file.localPath ?? remotePath) ?? 'universal'

  /**
   * 组件是从「产物卡片」里挂出来的，而产物卡片在消息滚动区内部：
   * 直接在原地渲染会被 .rc-chat-scroll 裁剪，位置与命中区都不对。
   * 浮层交给带主题类的应用根节点（见 resolveOverlayHost）。
   */
  return createPortal(
    <div className="rc-doc-layer" role="dialog" aria-modal="true" aria-label={`预览 ${title}`}>
      <button
        type="button"
        className="rc-doc-scrim"
        aria-label="关闭预览"
        tabIndex={-1}
        onClick={onClose}
      />
      <section className="rc-doc-drawer">
        <header className="rc-doc-head">
          <Icons.File size={14} />
          <span className="rc-doc-name" title={remotePath}>
            {title}
          </span>
          {openError != null && <span className="rc-doc-error">{openError}</span>}
          <div className="rc-doc-actions">
            <button
              type="button"
              className="rc-doc-action"
              onClick={() => void handleOpenExternal()}
              disabled={file.localPath == null || opening}
              title="用系统默认应用打开"
              aria-label="用系统默认应用打开"
            >
              {opening ? (
                <Icons.Spinner size={13} className="spin" />
              ) : (
                <Icons.ExternalLink size={13} />
              )}
            </button>
            <button
              type="button"
              className="rc-doc-action"
              onClick={onClose}
              title="关闭"
              aria-label="关闭预览"
            >
              <Icons.X size={13} />
            </button>
          </div>
        </header>
        <div className="rc-doc-body">
          {file.loading && <div className="rc-doc-hint">正在从目标电脑取回文档…</div>}
          {file.error != null && <div className="rc-doc-hint is-error">{file.error}</div>}
          {file.localPath != null && (
            <FilePreviewPanel
              filePath={file.localPath}
              fileType={fileType}
              variant="embedded"
              onClose={onClose}
            />
          )}
        </div>
      </section>
    </div>,
    resolveOverlayHost(),
  )
}
