import { useCallback, useRef, useState } from 'react'
import { Input } from 'antd'

export function CanvasOperationNodeSettings({
  nodeId,
  title,
  disabled = false,
  onRename,
}: {
  nodeId: string
  title: string | null
  disabled?: boolean
  onRename(title: string | null): Promise<void> | void
}) {
  const [draft, setDraft] = useState(title ?? '')
  const [savedTitle, setSavedTitle] = useState(title)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const commit = useCallback(async () => {
    if (savingRef.current) return
    const normalized = draft.trim() || null
    if (normalized === savedTitle) {
      setDraft(normalized ?? '')
      return
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await onRename(normalized)
      setSavedTitle(normalized)
      setDraft(normalized ?? '')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存节点名称失败')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [draft, onRename, savedTitle])

  return (
    <div className="canvas-operation-node-settings" aria-label="节点设置">
      <div className="canvas-operation-node-settings-card">
        <label htmlFor={`canvas-operation-node-title-${nodeId}`}>节点名称</label>
        <Input
          id={`canvas-operation-node-title-${nodeId}`}
          aria-label="节点名称"
          value={draft}
          placeholder="输入便于识别的节点名称"
          disabled={disabled || saving}
          {...(error ? { status: 'error' as const } : {})}
          onChange={(event) => {
            setDraft(event.target.value)
            if (error) setError(null)
          }}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void commit()
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(savedTitle ?? '')
              setError(null)
            }
          }}
        />
        <div className={`canvas-operation-node-settings-hint${error ? ' is-error' : ''}`}>
          {error ?? (saving ? '正在保存…' : '按 Enter 或移开焦点自动保存')}
        </div>
      </div>
    </div>
  )
}
