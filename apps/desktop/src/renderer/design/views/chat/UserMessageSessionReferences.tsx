import React from 'react'
import { Tooltip } from '@lobehub/ui'
import { Icons } from '../../Icons'
import './UserMessageSessionReferences.less'

export interface UserMessageSessionReferenceDisplay {
  sourceSessionId: string
  title: string
}

export function UserMessageSessionReferences({
  references,
}: {
  references: UserMessageSessionReferenceDisplay[]
}) {
  if (references.length === 0) return null

  return (
    <div className="msg-user-session-references" aria-label="参考会话">
      {references.map((reference) => {
        const title = reference.title || '未命名会话'
        return (
          <Tooltip
            key={reference.sourceSessionId}
            title={title}
            placement="top"
            mouseEnterDelay={0.05}
          >
            <div className="msg-user-session-reference-chip">
              <Icons.MessageSquare size={13} aria-hidden="true" />
              <span>{title}</span>
            </div>
          </Tooltip>
        )
      })}
    </div>
  )
}
