import { useState } from 'react'
import { Button } from '@lobehub/ui'
import { Icons } from '../Icons'
import { MarkdownText } from './chat/ChatMarkdown'

type UpdateReleaseNotesCardProps = {
  version: string
  releaseDate?: string | null
  releaseNotes?: string | null
}

const COLLAPSE_THRESHOLD = 1_200

function formatReleaseDate(releaseDate: string | null | undefined): string | null {
  if (releaseDate == null) return null
  const date = new Date(releaseDate)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('zh-CN')
}

export function UpdateReleaseNotesCard({
  version,
  releaseDate,
  releaseNotes,
}: UpdateReleaseNotesCardProps) {
  const [expanded, setExpanded] = useState(false)
  const content = releaseNotes?.trim() ?? ''
  if (content.length === 0) return null

  const collapsible = content.length > COLLAPSE_THRESHOLD
  const dateLabel = formatReleaseDate(releaseDate)

  return (
    <section className="card update-release-notes-card" aria-label={`版本 ${version} 的更新内容`}>
      <div className="update-release-notes-heading">
        <div>
          <div className="strong">更新内容</div>
          <div className="muted update-release-notes-meta">
            v{version}{dateLabel == null ? '' : ` · 发布于 ${dateLabel}`}
          </div>
        </div>
        <Icons.Sparkles size={18} aria-hidden="true" />
      </div>
      <div className={`update-release-notes-body${expanded ? ' is-expanded' : ''}`}>
        <MarkdownText content={content} detectDocumentOutput={false} />
      </div>
      {collapsible && (
        <Button
          className="update-release-notes-toggle"
          size="small"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起更新内容' : '展开完整更新内容'}
        </Button>
      )}
    </section>
  )
}
