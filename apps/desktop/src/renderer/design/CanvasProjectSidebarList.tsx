/**
 * CanvasProjectSidebarList — 画布模式侧栏的项目列表（与 SidebarSessionList 对称）。
 *
 * 设计意图：侧栏画布模式下，L1 主体承载项目列表（紧凑行式），
 * 让画布用户与工作台用户获得对等的「主列表在侧栏」体验。
 * 点击项目行 → 在独立窗口打开画布（与 CanvasProjectsView 网格点击行为一致）。
 *
 * 与 SidebarSessionList 的差异：
 *  - 不做分组（画布项目无「项目/会话」二级结构）
 *  - 不做搜索/筛选（项目数量级远小于会话，侧栏内不再加搜索框；完整管理在主区）
 *  - 不做拖拽；编辑等项目操作通过右键菜单复用主区能力
 */
import { memo, useCallback, useState } from 'react'
import { Dropdown } from '@lobehub/ui'
import { Empty, Modal, Spin, message } from 'antd'
import { Pin, PinOff } from 'lucide-react'
import { Icons } from './Icons'
import { useCanvasProjects } from './views/canvas/canvas.store'
import { canvasApi } from './views/canvas/canvas.api'
import { openCanvasProjectWindow } from './views/canvas/canvas-window-client'
import { useCanvasProjectSelection } from './views/canvas/CanvasProjectSelectionContext'
import { useApp } from './AppContext'
import { useI18n } from './i18n'

/** 单行最大标题字符数（视觉截断，避免长标题撑爆侧栏）。 */
const TITLE_MAX_CHARS = 22

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

function CanvasProjectSidebarListComponent() {
  const { t: tr } = useI18n()
  const { t, setTweak } = useApp()
  const { projects, loading, refresh } = useCanvasProjects()
  const { selectedProjectId, selectProject, requestProjectEdit } = useCanvasProjectSelection()
  // 正在打开的项目 id（双击/快捷打开后异步等待窗口创建，期间显示 spinner）
  const [openingId, setOpeningId] = useState<string | null>(null)

  // 点击项目：选中 + 确保切回项目详情页（从工作流库等子页点项目时回到详情）。
  const handleSelect = useCallback(
    (projectId: string) => {
      selectProject(projectId)
      if (t.view !== 'canvas') setTweak('view', 'canvas')
    },
    [selectProject, setTweak, t.view],
  )

  // 双击或 Enter：在独立窗口打开画布。单击只负责选中（由 selectProject 处理）。
  const handleOpen = useCallback(
    async (projectId: string) => {
      if (openingId) return
      setOpeningId(projectId)
      try {
        await openCanvasProjectWindow(projectId)
        await refresh()
      } catch {
        // 打开失败静默处理；主区的项目详情页有完整错误提示
      } finally {
        setOpeningId(null)
      }
    },
    [openingId, refresh],
  )

  const handleEdit = useCallback(
    (projectId: string) => {
      selectProject(projectId)
      requestProjectEdit(projectId)
      if (t.view !== 'canvas') setTweak('view', 'canvas')
    },
    [requestProjectEdit, selectProject, setTweak, t.view],
  )

  const handleTogglePin = useCallback(
    async (projectId: string, pinned: boolean) => {
      try {
        await canvasApi.setProjectPinned(projectId, !pinned)
        await refresh()
      } catch (error) {
        message.error(error instanceof Error ? error.message : '更新项目置顶状态失败')
      }
    },
    [refresh],
  )

  const handleArchive = useCallback(
    async (projectId: string, archived: boolean) => {
      try {
        await canvasApi.updateProject(projectId, { status: archived ? 'active' : 'archived' })
        await refresh()
      } catch (error) {
        message.error(error instanceof Error ? error.message : '更新项目归档状态失败')
      }
    },
    [refresh],
  )

  const handleOpenFolder = useCallback(async (projectId: string) => {
    try {
      const result = await canvasApi.openProjectFolder(projectId)
      if (!result.opened) message.error(result.error || '打开项目文件夹失败')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开项目文件夹失败')
    }
  }, [])

  const handleExport = useCallback(async (projectId: string) => {
    try {
      const result = await canvasApi.exportProjectPackage(projectId)
      if (result.exported) message.success('Canvas 项目包已导出')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出 Canvas 项目失败')
    }
  }, [])

  const handleDelete = useCallback(
    (projectId: string) => {
      Modal.confirm({
        title: '删除 Canvas 项目？',
        content: '项目会被标记为删除。',
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await canvasApi.deleteProject(projectId)
            if (selectedProjectId === projectId) selectProject(null)
            await refresh()
          } catch (error) {
            message.error(error instanceof Error ? error.message : '删除 Canvas 项目失败')
            throw error
          }
        },
      })
    },
    [refresh, selectProject, selectedProjectId],
  )

  if (loading) {
    return (
      <div
        className="canvas-sidebar-list-loading"
        role="status"
        aria-label={tr('nav.canvas.projects')}
      >
        <Spin size="small" />
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="canvas-sidebar-list-empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={tr('nav.canvas.empty')}
          imageStyle={{ height: 40 }}
        />
      </div>
    )
  }

  // 置顶优先，再按 updatedAt 降序
  const sorted = [...projects].sort((a, b) => {
    const pa = a.pinned ? 1 : 0
    const pb = b.pinned ? 1 : 0
    if (pa !== pb) return pb - pa
    return b.updatedAt.localeCompare(a.updatedAt)
  })

  return (
    <div className="canvas-sidebar-list" role="list" aria-label={tr('nav.canvas.projects')}>
      {sorted.map((project) => (
        <Dropdown
          key={project.id}
          trigger={['contextMenu']}
          placement="bottomLeft"
          menu={{
            items: [
              {
                key: 'open',
                icon: <Icons.Canvas size={14} />,
                label: '打开',
                disabled: openingId != null,
                onClick: () => void handleOpen(project.id),
              },
              {
                key: 'edit',
                icon: <Icons.Edit size={14} />,
                label: '编辑',
                onClick: () => handleEdit(project.id),
              },
              {
                key: 'pin',
                icon: project.pinned ? <PinOff size={14} /> : <Pin size={14} />,
                label: project.pinned ? '取消置顶' : '置顶',
                onClick: () => void handleTogglePin(project.id, Boolean(project.pinned)),
              },
              {
                key: 'open-folder',
                icon: <Icons.Folder size={14} />,
                label: '打开文件夹',
                onClick: () => void handleOpenFolder(project.id),
              },
              {
                key: 'export',
                icon: <Icons.Download size={14} />,
                label: '导出',
                onClick: () => void handleExport(project.id),
              },
              {
                key: 'archive',
                icon: <Icons.Archive size={14} />,
                label: project.status === 'archived' ? '恢复' : '归档',
                onClick: () => void handleArchive(project.id, project.status === 'archived'),
              },
              { type: 'divider' as const },
              {
                key: 'delete',
                icon: <Icons.Trash size={14} />,
                label: '删除',
                danger: true,
                onClick: () => handleDelete(project.id),
              },
            ],
          }}
        >
          <button
            type="button"
            className={`canvas-sidebar-item${selectedProjectId === project.id ? ' selected' : ''}`}
            onClick={() => handleSelect(project.id)}
            onDoubleClick={() => void handleOpen(project.id)}
            title={tr('nav.canvas.openProject')}
            role="listitem"
            aria-current={selectedProjectId === project.id ? 'true' : undefined}
          >
            <span className="canvas-sidebar-item-icon">
              {project.coverUrl ? (
                <img
                  src={project.coverUrl}
                  alt=""
                  aria-hidden="true"
                  className="canvas-sidebar-item-cover"
                  draggable={false}
                />
              ) : (
                <Icons.Canvas size={15} />
              )}
            </span>
            <span className="canvas-sidebar-item-body">
              <span className="canvas-sidebar-item-title">
                {truncate(project.title, TITLE_MAX_CHARS)}
                {project.pinned && <Icons.Pin size={9} className="canvas-sidebar-item-pin" />}
              </span>
              {(project.taskCount > 0 || project.nodeCount > 0) && (
                <span className="canvas-sidebar-item-meta">
                  {project.nodeCount > 0 && <span>{project.nodeCount} 节点</span>}
                  {project.taskCount > 0 && <span>{project.taskCount} 任务</span>}
                </span>
              )}
            </span>
            {openingId === project.id && (
              <Icons.Spinner size={12} className="canvas-sidebar-item-spinner" />
            )}
          </button>
        </Dropdown>
      ))}
    </div>
  )
}

export const CanvasProjectSidebarList = memo(CanvasProjectSidebarListComponent)
