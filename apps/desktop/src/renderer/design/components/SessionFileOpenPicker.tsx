import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PreviewFileType } from './FileDisplay'
import { getFileTypeBadge, getPreviewFileType } from './FileDisplay'
import { Icons } from '../Icons'
import { ToolIcon } from './ToolIcon'
import { useToast } from './Toast'
import type { ExternalToolInfo } from '@spark/protocol'
import './SessionFileOpenPicker.less'

type Props = {
  filePath: string
  onPreview?: (filePath: string, fileType: PreviewFileType) => void
  className?: string
  compact?: boolean
}

let sharedToolsCache: ExternalToolInfo[] | null = null
let sharedToolsPromise: Promise<ExternalToolInfo[]> | null = null

const MENU_WIDTH = 236
const MENU_GAP = 6
const MENU_MARGIN = 8
const MENU_MAX_HEIGHT = 420
const MENU_MIN_HEIGHT = 120

type MenuPosition = {
  top: number
  left: number
  maxHeight: number
  placement: 'top' | 'bottom'
}

function getSessionFileMenuPosition(triggerRect: DOMRect, measuredHeight?: number): MenuPosition {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const left = Math.max(
    MENU_MARGIN,
    Math.min(triggerRect.right - MENU_WIDTH, viewportWidth - MENU_WIDTH - MENU_MARGIN),
  )
  const aboveSpace = Math.max(0, triggerRect.top - MENU_GAP - MENU_MARGIN)
  const belowSpace = Math.max(0, viewportHeight - triggerRect.bottom - MENU_GAP - MENU_MARGIN)
  const preferredHeight = Math.min(measuredHeight ?? 360, MENU_MAX_HEIGHT)
  const shouldOpenUp = belowSpace < preferredHeight && aboveSpace > belowSpace
  const availableSpace = shouldOpenUp ? aboveSpace : belowSpace
  const maxHeight = Math.max(
    80,
    Math.min(MENU_MAX_HEIGHT, Math.max(MENU_MIN_HEIGHT, availableSpace)),
  )
  const visibleHeight = Math.min(measuredHeight ?? preferredHeight, maxHeight)
  const unclampedTop = shouldOpenUp
    ? triggerRect.top - MENU_GAP - visibleHeight
    : triggerRect.bottom + MENU_GAP
  const top = Math.max(
    MENU_MARGIN,
    Math.min(unclampedTop, viewportHeight - visibleHeight - MENU_MARGIN),
  )

  return {
    top,
    left,
    maxHeight,
    placement: shouldOpenUp ? 'top' : 'bottom',
  }
}

function detectSessionFileTools(): Promise<ExternalToolInfo[]> {
  if (sharedToolsCache != null) return Promise.resolve(sharedToolsCache)
  if (sharedToolsPromise != null) return sharedToolsPromise
  sharedToolsPromise = window.spark
    .invoke('tool:detect', {})
    .then((res) => {
      sharedToolsCache = Array.isArray(res.tools) ? res.tools : []
      return sharedToolsCache
    })
    .catch(() => {
      sharedToolsCache = []
      return sharedToolsCache
    })
    .finally(() => {
      sharedToolsPromise = null
    })
  return sharedToolsPromise
}

function invalidateSessionFileTools() {
  sharedToolsCache = null
  sharedToolsPromise = null
}

function useSessionFileTools() {
  const [tools, setTools] = useState<ExternalToolInfo[]>(sharedToolsCache ?? [])
  const [loading, setLoading] = useState(sharedToolsCache == null)

  useEffect(() => {
    let cancelled = false
    detectSessionFileTools()
      .then((list) => {
        if (!cancelled) setTools(list)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const redetect = useCallback(() => {
    invalidateSessionFileTools()
    setLoading(true)
    detectSessionFileTools()
      .then((list) => setTools(list))
      .finally(() => setLoading(false))
  }, [])

  return { tools: tools.filter((tool) => tool.available), loading, redetect }
}

async function resolveAbsolutePath(filePath: string): Promise<string> {
  if (/^[\\/]/.test(filePath) || /^[A-Za-z]:[\\/]/.test(filePath)) return filePath
  const wsRes = await window.spark.invoke('workspace:get-current', {})
  const root = wsRes?.workspace?.rootPath
  if (!root) return filePath
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${filePath.replace(/^[\\/]+/, '')}`
}

function documentToolMatches(tool: ExternalToolInfo, documentKind: string | undefined): boolean {
  if (tool.kind !== 'document') return false
  if (tool.id === 'wps-office') return true
  if (tool.id === 'microsoft-office') return true
  if (documentKind === 'word') return tool.id === 'microsoft-word'
  if (documentKind === 'excel') return tool.id === 'microsoft-excel'
  if (documentKind === 'powerpoint') return tool.id === 'microsoft-powerpoint'
  return false
}

function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="session-file-open-menu-title">{title}</div>
      {children}
    </>
  )
}

export function SessionFileOpenPicker({ filePath, onPreview, className, compact = false }: Props) {
  const { toast } = useToast()
  const { tools, loading, redetect } = useSessionFileTools()
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const previewType = useMemo(() => getPreviewFileType(filePath), [filePath])
  const fileType = useMemo(() => getFileTypeBadge(filePath), [filePath])
  const canPreview = previewType != null && onPreview != null
  const documentTools = tools.filter((tool) => documentToolMatches(tool, fileType.documentKind))
  const ideTools = tools.filter((tool) => tool.kind === 'ide')
  const terminalTools = tools.filter((tool) => tool.kind === 'terminal')

  const runWithPath = useCallback(
    async (handler: (absolutePath: string) => Promise<void>) => {
      try {
        const abs = await resolveAbsolutePath(filePath)
        await handler(abs)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '打开文件失败')
      }
    },
    [filePath, toast],
  )

  const closeMenu = useCallback(() => setOpen(false), [])

  const handlePreview = useCallback(() => {
    if (previewType == null || onPreview == null) return
    void runWithPath(async (abs) => {
      onPreview(abs, previewType)
    })
  }, [onPreview, previewType, runWithPath])

  const handleDefaultOpen = useCallback(() => {
    closeMenu()
    void runWithPath(async (abs) => {
      const res = await window.spark.invoke('file:open', { filePath: abs })
      if (!res.opened) throw new Error(res.error ?? '无法打开文件')
    })
  }, [closeMenu, runWithPath])

  const handleReveal = useCallback(() => {
    closeMenu()
    void runWithPath(async (abs) => {
      const res = await window.spark.invoke('file:reveal', { filePath: abs })
      if (!res.revealed) throw new Error(res.error ?? '无法定位文件')
    })
  }, [closeMenu, runWithPath])

  const handleToolOpen = useCallback(
    (tool: ExternalToolInfo) => {
      closeMenu()
      void runWithPath(async (abs) => {
        const res = await window.spark.invoke('tool:open-project', {
          toolId: tool.id,
          rootPath: abs,
        })
        if (!res.opened) throw new Error(`无法用 ${tool.name} 打开文件`)
      })
    },
    [closeMenu, runWithPath],
  )

  const updateMenuPosition = useCallback((measuredHeight?: number) => {
    const el = toggleRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      setMenuPos(getSessionFileMenuPosition(rect, measuredHeight))
    }
  }, [])

  const openMenu = useCallback(() => {
    updateMenuPosition()
    setOpen(true)
  }, [updateMenuPosition])

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return
    updateMenuPosition(menuRef.current.scrollHeight)
  }, [
    documentTools.length,
    ideTools.length,
    loading,
    open,
    terminalTools.length,
    updateMenuPosition,
  ])

  useEffect(() => {
    if (!open) return
    const reposition = () => updateMenuPosition(menuRef.current?.scrollHeight)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, updateMenuPosition])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        (toggleRef.current && toggleRef.current.contains(target)) ||
        (menuRef.current && menuRef.current.contains(target))
      ) {
        return
      }
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const toolButton = (tool: ExternalToolInfo) => (
    <button
      key={tool.id}
      type="button"
      className="session-file-open-menu-item"
      onClick={() => handleToolOpen(tool)}
    >
      <span className="session-file-open-menu-icon">
        <ToolIcon iconHint={tool.iconHint} kind={tool.kind} size={15} />
      </span>
      <span>{tool.name}</span>
    </button>
  )

  return (
    <span className={`session-file-open ${compact ? 'is-compact' : ''} ${className ?? ''}`}>
      <button
        type="button"
        className="session-file-open-main"
        onClick={canPreview ? handlePreview : handleDefaultOpen}
        title={canPreview ? '在应用内预览' : '用默认应用打开'}
      >
        {canPreview ? <Icons.Eye size={12} /> : <Icons.ExternalLink size={12} />}
        <span>{canPreview ? '预览' : '打开'}</span>
      </button>
      <button
        ref={toggleRef}
        type="button"
        className={`session-file-open-toggle ${open ? 'active' : ''}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        title="选择打开方式"
        aria-label="选择打开方式"
      >
        <Icons.ChevronDown size={10} />
      </button>
      {open &&
        menuPos != null &&
        createPortal(
          <div
            ref={menuRef}
            className={`session-file-open-menu is-${menuPos.placement}`}
            style={{ top: menuPos.top, left: menuPos.left, maxHeight: menuPos.maxHeight }}
          >
            <button
              type="button"
              className="session-file-open-menu-item"
              onClick={handleDefaultOpen}
            >
              <span className="session-file-open-menu-icon">
                <Icons.ExternalLink size={14} />
              </span>
              <span>用默认应用打开</span>
            </button>
            <button type="button" className="session-file-open-menu-item" onClick={handleReveal}>
              <span className="session-file-open-menu-icon">
                <Icons.FolderOpen size={14} />
              </span>
              <span>在文件夹中显示</span>
            </button>
            {loading && (
              <div className="session-file-open-menu-state">
                <Icons.Spinner size={12} /> 检测中...
              </div>
            )}
            {!loading && documentTools.length > 0 && (
              <MenuSection title="文档应用">{documentTools.map(toolButton)}</MenuSection>
            )}
            {!loading && ideTools.length > 0 && (
              <MenuSection title="编辑器">{ideTools.map(toolButton)}</MenuSection>
            )}
            {!loading && terminalTools.length > 0 && (
              <MenuSection title="终端">{terminalTools.map(toolButton)}</MenuSection>
            )}
            {!loading &&
              documentTools.length === 0 &&
              ideTools.length === 0 &&
              terminalTools.length === 0 && (
                <div className="session-file-open-menu-state">未检测到可用应用</div>
              )}
            <button
              type="button"
              className="session-file-open-menu-item is-refresh"
              onClick={redetect}
            >
              <Icons.Refresh size={12} />
              <span>重新检测</span>
            </button>
          </div>,
          document.body,
        )}
    </span>
  )
}
