import type { CanvasPromptInputSnapshot } from '@spark/protocol'
import './canvasTaskInputSnapshotList.less'

export function CanvasTaskInputSnapshotList({
  snapshots,
}: {
  snapshots: CanvasPromptInputSnapshot[]
}) {
  if (snapshots.length === 0) return null
  return (
    <div className="canvas-task-input-snapshots">
      {[...snapshots]
        .sort((left, right) => left.order - right.order)
        .map((snapshot) => (
          <article className="canvas-task-input-snapshot" key={snapshot.blockId}>
            <SnapshotPreview snapshot={snapshot} />
            <div className="canvas-task-input-snapshot-body">
              <div className="canvas-task-input-snapshot-heading">
                <strong>{snapshot.label}</strong>
                <span>{snapshot.relation}</span>
              </div>
              <div className="canvas-task-input-snapshot-meta">
                {snapshot.kind} · {snapshot.sourceNodeId}
                {snapshot.contentHash ? ` · ${snapshot.contentHash}` : ''}
              </div>
              {snapshotContent(snapshot) && (
                <pre
                  className="canvas-task-input-snapshot-content"
                  style={{ maxHeight: 280, overflowY: 'auto' }}
                >
                  {snapshotContent(snapshot)}
                </pre>
              )}
            </div>
          </article>
        ))}
    </div>
  )
}

function SnapshotPreview({ snapshot }: { snapshot: CanvasPromptInputSnapshot }) {
  if (snapshot.previewUrl && (snapshot.kind === 'image' || snapshot.kind === 'video')) {
    return (
      <img
        className="canvas-task-input-snapshot-thumb"
        src={snapshot.previewUrl}
        alt={snapshot.label}
      />
    )
  }
  return (
    <div className="canvas-task-input-snapshot-kind" aria-hidden="true">
      {snapshot.kind === 'structured' ? '▦' : snapshot.kind.slice(0, 1).toUpperCase()}
    </div>
  )
}

function snapshotContent(snapshot: CanvasPromptInputSnapshot): string {
  if (snapshot.contentText) return snapshot.contentText
  if (snapshot.structuredData !== undefined) {
    try {
      return JSON.stringify(snapshot.structuredData, null, 2)
    } catch {
      return String(snapshot.structuredData)
    }
  }
  return ''
}
