import type { SessionLineage } from '@spark/protocol'
import { Icons } from '../../Icons'
import './SessionLineageBar.less'

export interface SessionCollaborationDetailsProps {
  lineage: SessionLineage | null
  sourceTitle?: string | null
  sourceAvailable?: boolean
  childLineages?: SessionLineage[]
  currentBranch: string | null
  onOpenSource?: () => void
  onOpenChild?: (childLineage: SessionLineage) => void
}

export function SessionCollaborationDetails({
  lineage,
  sourceTitle,
  sourceAvailable = false,
  childLineages = [],
  currentBranch,
  onOpenSource,
  onOpenChild,
}: SessionCollaborationDetailsProps) {
  const hasParent = lineage != null
  const collaborationSummary = hasParent
    ? '与来源会话独立，消息和任务互不影响。'
    : '从此会话创建的副本会独立运行。'
  const displayedSourceTitle = sourceTitle?.trim() || lineage?.sourceTitleSnapshot || '未命名会话'

  return (
    <div className="session-collaboration-details">
      <div className="session-collaboration-summary">
        <div>
          <strong>{hasParent ? '独立会话' : '协作起点'}</strong>
          <p>{collaborationSummary}</p>
        </div>
      </div>

      <section
        className="session-collaboration-section"
        aria-labelledby="session-collaboration-relation"
      >
        <div className="session-collaboration-section-title" id="session-collaboration-relation">
          会话关系
        </div>
        {hasParent ? (
          <div className="session-collaboration-value-row">
            <span className="session-collaboration-value-label">来源会话</span>
            {sourceAvailable && onOpenSource ? (
              <button
                type="button"
                className="session-collaboration-source"
                title={`打开来源会话：${displayedSourceTitle}`}
                onClick={onOpenSource}
              >
                <span>{displayedSourceTitle}</span>
                <Icons.ChevronRight size={13} />
              </button>
            ) : (
              <span className="session-collaboration-unavailable">来源不可用</span>
            )}
          </div>
        ) : (
          <div className="session-collaboration-value-row">
            <span className="session-collaboration-value-label">当前会话</span>
            <span className="session-collaboration-value">协作起点</span>
          </div>
        )}
        {childLineages.length > 0 && (
          <div className="session-collaboration-value-row">
            <span className="session-collaboration-value-label">副本</span>
            <span className="session-collaboration-value">{childLineages.length} 个会话</span>
          </div>
        )}
      </section>

      <section
        className="session-collaboration-section"
        aria-labelledby="session-collaboration-git"
      >
        <div className="session-collaboration-section-title" id="session-collaboration-git">
          Git 分支
        </div>
        <div className="session-collaboration-git-row">
          <span className="session-collaboration-git-icon" aria-hidden="true">
            <Icons.GitBranch size={14} />
          </span>
          <span className="session-collaboration-git-name">
            {currentBranch ?? '未检测到 Git 分支'}
          </span>
        </div>
        <div className="session-collaboration-helper">代码使用当前分支。</div>
      </section>

      {childLineages.length > 0 && (
        <section
          className="session-collaboration-section"
          aria-labelledby="session-collaboration-children"
        >
          <div className="session-collaboration-section-title" id="session-collaboration-children">
            协作副本
          </div>
          <div className="session-collaboration-children" role="list">
            {childLineages.map((childLineage) => (
              <button
                type="button"
                className="session-collaboration-child"
                key={childLineage.childSessionId}
                onClick={() => onOpenChild?.(childLineage)}
              >
                <Icons.MessageSquare size={13} />
                <span>{childLineage.childTitle || '未命名副本'}</span>
                <Icons.ChevronRight size={13} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
