import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { Tooltip } from '@lobehub/ui'
import type { LucideIcon } from 'lucide-react'
import type { ExternalToolInfo } from '@spark/protocol'
import { Icons } from '../../Icons'
import { ToolIcon } from '../../components/ToolIcon'

export const TabbarIcon = ({ icon: IconComponent }: { icon: LucideIcon }) => (
  <IconComponent size={12} strokeWidth={1.5} />
)

export const ActivityLogSummaryIcon = ({
  icon: IconComponent,
  className = '',
}: {
  icon: LucideIcon
  className?: string
}) => (
  <span className={`activity-log-summary-icon ${className}`}>
    <IconComponent size={13} strokeWidth={1.6} />
  </span>
)

const PROJECT_OPEN_PREF_KEY = 'spark:project-open-preference'

type ProjectOpenPreference = { type: 'folder' } | { type: 'tool'; toolId: string }

/**
 * 检测本机已安装的外部工具（IDE / 终端）。结果在模块级别缓存共享，
 * 避免每个文件卡片都重复触发 tool:detect IPC。
 */
let sharedToolsCache: ExternalToolInfo[] | null = null
let sharedToolsPromise: Promise<ExternalToolInfo[]> | null = null

function detectTools(): Promise<ExternalToolInfo[]> {
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

function invalidateToolsCache() {
  sharedToolsCache = null
  sharedToolsPromise = null
}

/**
 * 共享 hook：检测工具 + 维护「打开方式」偏好。
 * 项目根目录与单文件卡片共用同一份偏好，行为一致。
 */
function useOpenWithPicker() {
  const [tools, setTools] = useState<ExternalToolInfo[]>(sharedToolsCache ?? [])
  const [loading, setLoading] = useState(sharedToolsCache == null)
  const [preference, setPreferenceState] = useState<ProjectOpenPreference>(() =>
    loadProjectOpenPreference(),
  )

  useEffect(() => {
    let cancelled = false
    if (sharedToolsCache != null) return
    detectTools()
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

  const availableTools = tools.filter((t) => t.available)
  const ideTools = availableTools.filter((t) => t.kind === 'ide')
  const terminalTools = availableTools.filter((t) => t.kind === 'terminal')
  const preferredTool =
    preference.type === 'tool' ? availableTools.find((t) => t.id === preference.toolId) : undefined

  const redetect = useCallback(() => {
    invalidateToolsCache()
    setLoading(true)
    detectTools()
      .then((list) => setTools(list))
      .finally(() => setLoading(false))
  }, [])

  const setPreference = useCallback((pref: ProjectOpenPreference) => {
    saveProjectOpenPreference(pref)
    setPreferenceState(pref)
  }, [])

  return {
    tools: availableTools,
    ideTools,
    terminalTools,
    loading,
    preference,
    preferredTool,
    setPreference,
    redetect,
  }
}

/**
 * 用当前偏好打开一个路径。
 * - target='project'：folder 用 tool:open-folder，工具用 tool:open-project
 * - target='file'：folder 改用 file:reveal（在 Finder 里定位文件），工具用 tool:open-project（IDE 打开该文件）
 */
async function openWithPath(
  preference: ProjectOpenPreference,
  preferredTool: ExternalToolInfo | undefined,
  targetPath: string,
  target: 'project' | 'file',
): Promise<void> {
  if (preference.type === 'folder') {
    if (target === 'file') {
      await window.spark.invoke('file:reveal', { filePath: targetPath })
    } else {
      await window.spark.invoke('tool:open-folder', { rootPath: targetPath })
    }
    return
  }
  const tool = preferredTool
  if (tool != null) {
    await window.spark.invoke('tool:open-project', {
      toolId: tool.id,
      rootPath: targetPath,
    })
    return
  }
  if (target === 'file') {
    await window.spark.invoke('file:reveal', { filePath: targetPath })
  } else {
    await window.spark.invoke('tool:open-folder', { rootPath: targetPath })
  }
}

function loadProjectOpenPreference(): ProjectOpenPreference {
  try {
    const raw = localStorage.getItem(PROJECT_OPEN_PREF_KEY)
    if (!raw) return { type: 'folder' }
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as ProjectOpenPreference).type === 'folder'
    ) {
      return { type: 'folder' }
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as ProjectOpenPreference).type === 'tool' &&
      typeof (parsed as { toolId?: unknown }).toolId === 'string'
    ) {
      return { type: 'tool', toolId: (parsed as { toolId: string }).toolId }
    }
  } catch {
    /* ignore corrupt preference */
  }
  return { type: 'folder' }
}

function saveProjectOpenPreference(pref: ProjectOpenPreference) {
  localStorage.setItem(PROJECT_OPEN_PREF_KEY, JSON.stringify(pref))
}

function getToolIcon(
  iconHint?: string,
  kind?: ExternalToolInfo['kind'],
  size: number = 18,
): JSX.Element {
  return <ToolIcon iconHint={iconHint} kind={kind} size={size} />
}

export function TabbarTooltipButton({
  title,
  className,
  disabled,
  onClick,
  ariaLabel,
  children,
}: {
  title: string
  className?: string
  disabled?: boolean
  onClick?: () => void
  ariaLabel?: string
  children: ReactNode
}) {
  const button = (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel ?? title}
    >
      {children}
    </button>
  )

  return (
    <Tooltip title={title} placement="bottom" mouseEnterDelay={0}>
      {disabled ? <span className="tabbar-tooltip-wrap">{button}</span> : button}
    </Tooltip>
  )
}

export function ProjectOpenDropdown({ rootPath }: { rootPath: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { ideTools, terminalTools, loading, preference, preferredTool, setPreference, redetect } =
    useOpenWithPicker()

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const handleDefaultAction = async () => {
    try {
      await openWithPath(preference, preferredTool, rootPath, 'project')
    } catch (err) {
      console.error('Failed to open project:', err)
    }
  }

  const handleSelectFolder = () => {
    setOpen(false)
    setPreference({ type: 'folder' })
    void openWithPath({ type: 'folder' }, undefined, rootPath, 'project').catch((err) =>
      console.error('Failed to open folder:', err),
    )
  }

  const handleSelectTool = (tool: ExternalToolInfo) => {
    setOpen(false)
    setPreference({ type: 'tool', toolId: tool.id })
    void openWithPath({ type: 'tool', toolId: tool.id }, tool, rootPath, 'project').catch((err) =>
      console.error(`Failed to open in ${tool.name}:`, err),
    )
  }

  const triggerTitle =
    preference.type === 'folder'
      ? '在文件夹中打开'
      : preferredTool
        ? `在 ${preferredTool.name} 中打开`
        : '在文件夹中打开'

  const renderToolItem = (tool: ExternalToolInfo) => (
    <button
      key={tool.id}
      type="button"
      className="tool-dropdown-item"
      onClick={() => handleSelectTool(tool)}
    >
      <span className="tool-dropdown-item-icon">{getToolIcon(tool.iconHint, tool.kind)}</span>
      <span className="tool-dropdown-item-name">{tool.name}</span>
    </button>
  )

  return (
    <div className="tool-dropdown-wrap" ref={ref}>
      <div className={`tool-dropdown-split${open ? ' open' : ''}`}>
        <TabbarTooltipButton
          title={triggerTitle}
          className="icon-btn tool-dropdown-main"
          onClick={() => void handleDefaultAction()}
        >
          {preferredTool ? (
            <span className="tool-dropdown-trigger-icon">
              {getToolIcon(preferredTool.iconHint, preferredTool.kind)}
            </span>
          ) : (
            <Icons.FolderOpen size={18} />
          )}
        </TabbarTooltipButton>
        <TabbarTooltipButton
          title="选择打开方式"
          className={`icon-btn tool-dropdown-toggle${open ? ' active' : ''}`}
          ariaLabel="选择打开方式"
          onClick={() => setOpen((prev) => !prev)}
        >
          <Icons.ChevronDown size={10} />
        </TabbarTooltipButton>
      </div>
      {open && (
        <div className="tool-dropdown">
          <button type="button" className="tool-dropdown-item" onClick={handleSelectFolder}>
            <span className="tool-dropdown-item-icon">
              <Icons.FolderOpen size={14} />
            </span>
            <span className="tool-dropdown-item-name">在文件夹中打开</span>
          </button>
          {loading && (
            <div className="tool-dropdown-loading">
              <Icons.Spinner size={12} /> 检测中...
            </div>
          )}
          {!loading && ideTools.length === 0 && terminalTools.length === 0 && (
            <div className="tool-dropdown-empty">未检测到已安装的编辑器或终端</div>
          )}
          {!loading && ideTools.length > 0 && (
            <>
              <div className="tool-dropdown-divider" role="separator" />
              {ideTools.map(renderToolItem)}
            </>
          )}
          {!loading && terminalTools.length > 0 && (
            <>
              <div className="tool-dropdown-divider" role="separator" />
              {terminalTools.map(renderToolItem)}
            </>
          )}
          {!loading && (ideTools.length > 0 || terminalTools.length > 0) && (
            <button
              type="button"
              className="tool-dropdown-item tool-dropdown-refresh"
              onClick={redetect}
            >
              <Icons.Refresh size={12} />
              <span>重新检测</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
