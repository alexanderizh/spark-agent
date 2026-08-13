import { useState } from 'react'
import { Icons } from '../../Icons'
import type { SessionLineage } from '@spark/protocol'
import './SessionLineageBar.less'

interface SessionLineageBarProps {
  sourceTitle?: string
  sourceAvailable?: boolean
  hasParent?: boolean
  onOpenSource?: () => void
  childLineages?: SessionLineage[]
  onOpenChild?: (childLineage: SessionLineage) => void
}

export function SessionLineageBar({
  sourceTitle,
  sourceAvailable = false,
  hasParent = true,
  onOpenSource,
  childLineages = [],
  onOpenChild,
}: SessionLineageBarProps) {
  const [showChildren, setShowChildren] = useState(false)
  return (
    <div className="session-lineage-bar" role="status">
      <span className="session-lineage-bar-icon" aria-hidden="true">
        <Icons.GitBranch size={14} />
      </span>
      {hasParent ? (
        <>
          <span className="session-lineage-bar-label">分支自</span>
          {sourceAvailable && onOpenSource ? (
            <button type="button" className="session-lineage-bar-source" onClick={onOpenSource}>
              《{sourceTitle || '未命名会话'}》
            </button>
          ) : (
            <span className="session-lineage-bar-source is-unavailable">《来源会话已删除》</span>
          )}
          <span className="session-lineage-bar-detail">· 已完成轮次快照，独立继续</span>
        </>
      ) : (
        <>
          <span className="session-lineage-bar-label">分支关系</span>
          <span className="session-lineage-bar-detail">· 此会话已创建独立协作分支</span>
        </>
      )}
      {childLineages.length > 0 && (
        <button
          type="button"
          className="session-lineage-bar-children-toggle"
          onClick={() => setShowChildren((value) => !value)}
        >
          <Icons.GitBranch size={12} />
          {showChildren ? '收起分支' : `查看分支 ${childLineages.length}`}
        </button>
      )}
      {showChildren && childLineages.length > 0 && (
        <div className="session-lineage-bar-children" role="list" aria-label="子分支会话">
          {childLineages.map((childLineage) => (
            <button
              type="button"
              className="session-lineage-bar-child"
              key={childLineage.childSessionId}
              onClick={() => onOpenChild?.(childLineage)}
            >
              <Icons.MessageSquare size={12} />
              <span>{childLineage.childTitle || '未命名分支会话'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
