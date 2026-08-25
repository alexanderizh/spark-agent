import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import type { CanvasProject } from './canvas.types'
import './cinematic/welcome-home.less'

/** 相对时间展示：刚刚 / N 分钟前 / N 小时前 / N 天前 / 具体日期 */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  const d = new Date(then)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * 画布欢迎页（未选中项目时的主区内容）。
 * 扁平网格布局：标题行 + 新建入口 + 最近项目卡片墙。
 * 卡片封面用项目真实 coverUrl，无封面时回退中性占位。
 */
export function CanvasWelcomeHome({
  projects,
  onCreate,
  onSelectProject,
}: {
  /** 最近项目（调用方已排序、已截断） */
  projects: CanvasProject[]
  onCreate: () => void
  onSelectProject: (projectId: string) => void
}) {
  return (
    <div className="canvas-projects-welcome">
      <div className="canvas-welcome-head">
        <div className="canvas-welcome-title">
          <h3>无限画布</h3>
          <p>以项目为单位组织素材、节点、任务与生成血缘</p>
        </div>
        <Button size="middle" type="primary" icon={<Icons.Plus size={16} />} onClick={onCreate}>
          新建项目
        </Button>
      </div>

      {projects.length > 0 && (
        <div className="canvas-welcome-recent">
          <h4>最近项目</h4>
          <div className="canvas-welcome-recent-grid">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className="canvas-welcome-recent-card"
                onClick={() => onSelectProject(p.id)}
                title={p.title}
              >
                {p.coverUrl ? (
                  <img src={p.coverUrl} alt={p.title} draggable={false} />
                ) : (
                  <span className="canvas-welcome-recent-placeholder">
                    <Icons.Canvas size={22} />
                  </span>
                )}
                <span className="canvas-welcome-recent-name">{p.title}</span>
                <span className="canvas-welcome-recent-meta">
                  {p.pinned && (
                    <span className="canvas-welcome-recent-pin">
                      <i />
                      置顶
                    </span>
                  )}
                  <span>{formatRelativeTime(p.updatedAt)}</span>
                  <span className="canvas-welcome-recent-dot">·</span>
                  <span>{p.nodeCount} 节点</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
