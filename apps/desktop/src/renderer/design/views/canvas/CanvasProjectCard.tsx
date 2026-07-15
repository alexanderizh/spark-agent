import { Button, Dropdown, Tag, Tooltip } from '@lobehub/ui'
import { Icons } from '../../Icons'
import type { CanvasProject } from './canvas.types'

export type CanvasProjectCardProps = {
  project: CanvasProject
  opening: boolean
  busy: boolean
  onOpen: (projectId: string) => void
  onTogglePin: (projectId: string) => void
  onEdit: (projectId: string) => void
  onOpenFolder: (projectId: string) => void
  onExport: (projectId: string) => void
  onArchive: (projectId: string) => void
  onDelete: (projectId: string) => void
}

export function CanvasProjectCard({
  project,
  opening,
  busy,
  onOpen,
  onTogglePin,
  onEdit,
  onOpenFolder,
  onExport,
  onArchive,
  onDelete,
}: CanvasProjectCardProps) {
  const openProject = () => {
    if (!opening) onOpen(project.id)
  }

  return (
    <article
      className={`canvas-project-card${project.pinned ? ' canvas-project-card-pinned' : ''}${opening ? ' is-opening' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`打开画布项目：${project.title}`}
      onClick={openProject}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openProject()
        }
      }}
    >
      <div className="canvas-project-cover">
        {project.coverUrl ? (
          <img
            className="canvas-project-cover-image"
            src={project.coverUrl}
            alt={project.title}
            draggable={false}
          />
        ) : (
          <>
            <div className="canvas-project-cover-grid" />
            <div className="canvas-project-cover-empty">
              <Icons.Canvas size={30} />
              <strong>暂无封面预览</strong>
              <span>进入项目开始创作</span>
            </div>
          </>
        )}
        {project.pinned && (
          <span className="canvas-project-pin-badge" title="已置顶">
            <Icons.Pin size={13} />
          </span>
        )}
      </div>
      <div className="canvas-project-card-body">
        <div className="canvas-project-card-top">
          <h3>{project.title}</h3>
          <Tag color={project.status === 'archived' ? 'default' : 'green'}>
            {project.status === 'archived' ? '已归档' : '进行中'}
          </Tag>
        </div>
        <p>{project.description || '暂无描述'}</p>
        <div className="canvas-project-card-meta">
          <span>{project.nodeCount} 节点</span>
          <span>{project.assetCount} 资产</span>
          <span>{project.taskCount} 任务</span>
        </div>
        <div className="canvas-project-card-foot">
          <span>更新 {new Date(project.updatedAt).toLocaleString()}</span>
          <div className="canvas-project-actions" onClick={(event) => event.stopPropagation()}>
            <Dropdown
              trigger={['click']}
              placement="bottom"
              menu={{
                items: [
                  {
                    key: 'pin',
                    label: project.pinned ? '取消置顶' : '置顶',
                    onClick: () => onTogglePin(project.id),
                  },
                  {
                    key: 'rename',
                    label: '基础信息',
                    onClick: () => onEdit(project.id),
                  },
                  {
                    key: 'open-folder',
                    label: '打开文件夹',
                    onClick: () => onOpenFolder(project.id),
                  },
                  {
                    key: 'export',
                    label: '导出',
                    onClick: () => onExport(project.id),
                  },
                  {
                    key: 'archive',
                    label: project.status === 'archived' ? '恢复' : '归档',
                    onClick: () => onArchive(project.id),
                  },
                  {
                    key: 'delete',
                    label: '删除',
                    onClick: () => onDelete(project.id),
                  },
                ],
              }}
            >
              <Tooltip title="更多项目操作">
                <Button
                  size="middle"
                  type="text"
                  loading={busy}
                  aria-label={`项目操作：${project.title}`}
                  icon={<Icons.More size={13} />}
                />
              </Tooltip>
            </Dropdown>
            <Tooltip title={opening ? '正在打开项目' : '打开项目'}>
              <Button
                size="middle"
                type="text"
                loading={opening}
                disabled={opening}
                aria-label={
                  opening ? `正在打开项目：${project.title}` : `打开项目：${project.title}`
                }
                icon={<Icons.ChevronRight size={13} />}
                onClick={(event) => {
                  event.stopPropagation()
                  openProject()
                }}
              >
                {opening ? '打开中' : '打开'}
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>
    </article>
  )
}
