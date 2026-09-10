/**
 * 「文件」面板：常驻项目文件浏览器（统一侧边面板 tab）。
 *
 * 与「代码」tab 内嵌的文件树不同：这里可在左侧项目列表的任意项目间切换，
 * 选中项目与各项目展开目录跨会话持久化（见 projectFilesPanelStore）。
 * 文件打开复用会话级统一路由（宿主传入，绝对路径可透传 resolveAbsCodePath）：
 * 普通点击按 fileOpenRouting 分流（代码/文本 → 代码 tab，富预览 → 预览 tab）；
 * 「添加到对话」仅对当前会话绑定的项目开放——会话附件按会话项目根解析路径，
 * 跨项目文件加入对话会产生错误引用，故隐藏该菜单项。
 */

import { useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import type { WorkspaceInfo } from '@spark/protocol'
import { Icons } from '../../Icons'
// FileExplorerPanel 的 fe-* 样式定义在 code-viewer/index.less（--cv-* 令牌作用域
// 原为 .code-viewer-panel）；本面板在其外渲染，需自带样式入口与令牌映射（见 less）。
import '../code-viewer/index.less'
import { FileExplorerPanel } from '../code-viewer/file-explorer/FileExplorerPanel'
import {
  setSelectedProjectFilesWorkspaceId,
  setProjectFilesExpandedDirs,
  useProjectFilesExpandedDirs,
  useSelectedProjectFilesWorkspaceId,
} from './projectFilesPanelStore'
import './ProjectFilesPanel.less'

export interface ProjectFilesPanelProps {
  /** 项目列表（来自 SessionSidebarContext.workspaces），含 id/name/rootPath */
  workspaces: WorkspaceInfo[]
  /** 当前会话绑定的项目 id：作为默认选中回退，并决定「添加到对话」是否开放 */
  sessionWorkspaceId: string | null
  /** 普通点击：按 fileOpenRouting 分流（代码/文本 → 代码 tab，富预览 → 预览 tab） */
  onOpenFile: (absPath: string) => void
  /** 右键菜单显式「预览」 */
  onPreviewFile: (absPath: string) => void
  /** 右键菜单显式「编辑」 */
  onEditFile: (absPath: string) => void
  /** 右键菜单「添加到对话」（仅会话绑定项目开放，见组件说明） */
  onAddToChat: (absPath: string) => void
}

function workspaceDisplayName(workspace: WorkspaceInfo): string {
  if (workspace.name != null && workspace.name.length > 0) return workspace.name
  const segments = workspace.rootPath.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? workspace.rootPath
}

export function ProjectFilesPanel({
  workspaces,
  sessionWorkspaceId,
  onOpenFile,
  onPreviewFile,
  onEditFile,
  onAddToChat,
}: ProjectFilesPanelProps): ReactNode {
  const storedSelectedId = useSelectedProjectFilesWorkspaceId()

  // 选中项目：持久化值优先（已失效则忽略）→ 会话绑定项目 → 第一个项目。
  // 回退值不写回 store：只有用户显式选择（下拉/项目菜单桥）才持久化。
  const selected = useMemo(() => {
    if (workspaces.length === 0) return null
    const findById = (id: string | null): WorkspaceInfo | null =>
      id != null ? (workspaces.find((workspace) => workspace.id === id) ?? null) : null
    return findById(storedSelectedId) ?? findById(sessionWorkspaceId) ?? workspaces[0]
  }, [workspaces, storedSelectedId, sessionWorkspaceId])

  const workspaceId = selected?.id ?? null
  const expandedDirs = useProjectFilesExpandedDirs(workspaceId)

  const handleExpandedChange = useCallback(
    (next: Set<string>) => {
      setProjectFilesExpandedDirs(workspaceId, next)
    },
    [workspaceId],
  )

  const projectMenuItems: MenuProps['items'] = useMemo(
    () =>
      workspaces.map((workspace) => ({
        key: workspace.id,
        label: workspaceDisplayName(workspace),
      })),
    [workspaces],
  )

  // 文件树回调返回相对选中项目根的 posix 相对路径；宿主路由按绝对路径解析，
  // resolveAbsCodePath 对绝对路径透传，任意项目的文件都能正确打开。
  const joinAbs = useCallback(
    (relPath: string): string => {
      const root = selected?.rootPath
      if (root == null || root.length === 0) return relPath
      if (relPath === '') return root
      const sep = root.includes('\\') ? '\\' : '/'
      return root + sep + relPath.split('/').join(sep)
    },
    [selected],
  )

  if (selected == null) {
    return (
      <div className="pf-panel">
        <div className="pf-state">暂无项目，请先在左侧添加项目文件夹</div>
      </div>
    )
  }

  return (
    <div className="pf-panel">
      <div className="pf-header">
        <Icons.ProjectFolder size={14} className="pf-header-icon" />
        <Dropdown
          trigger={['click']}
          menu={{
            items: projectMenuItems,
            selectable: true,
            selectedKeys: [selected.id],
            onClick: ({ key }) => setSelectedProjectFilesWorkspaceId(key),
          }}
        >
          <button
            type="button"
            className="pf-project-btn"
            title={selected.rootPath}
            aria-label="切换项目"
          >
            <span className="pf-project-name">{workspaceDisplayName(selected)}</span>
            <Icons.ChevronDown size={12} />
          </button>
        </Dropdown>
      </div>
      <div className="pf-explorer">
        <FileExplorerPanel
          workspaceId={selected.id}
          workspaceRootPath={selected.rootPath}
          expandedDirs={expandedDirs}
          onExpandedChange={handleExpandedChange}
          onOpenFile={(relPath) => onOpenFile(joinAbs(relPath))}
          onPreviewFile={(relPath) => onPreviewFile(joinAbs(relPath))}
          onEditFile={(relPath) => onEditFile(joinAbs(relPath))}
          onAddToChat={
            selected.id === sessionWorkspaceId
              ? (relPath) => onAddToChat(joinAbs(relPath))
              : undefined
          }
        />
      </div>
    </div>
  )
}
