import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Input, message, type InputRef } from 'antd'
import './CanvasInlineNodeTitleEditor.less'

function normalizeNodeTitle(title: string | null | undefined): string | null {
  return title?.trim() || null
}

export function CanvasInlineNodeTitleEditor({
  nodeId,
  title,
  fallbackTitle,
  onRename,
}: {
  nodeId: string
  title: string | null | undefined
  fallbackTitle: string
  onRename(title: string | null): Promise<void> | void
}) {
  const normalizedTitle = normalizeNodeTitle(title)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(normalizedTitle ?? '')
  const [savedTitle, setSavedTitle] = useState(normalizedTitle)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<InputRef>(null)
  const editingRef = useRef(false)
  const savingRef = useRef(false)
  const skipBlurRef = useRef(false)
  const mountedRef = useRef(true)
  const currentNodeIdRef = useRef(nodeId)
  const saveGenerationRef = useRef(0)

  useEffect(
    () => () => {
      mountedRef.current = false
      saveGenerationRef.current += 1
    },
    [],
  )

  useEffect(() => {
    if (currentNodeIdRef.current !== nodeId) {
      currentNodeIdRef.current = nodeId
      saveGenerationRef.current += 1
      editingRef.current = false
      savingRef.current = false
      skipBlurRef.current = false
      setEditing(false)
      setSaving(false)
      setSavedTitle(normalizedTitle)
      setDraft(normalizedTitle ?? '')
      return
    }
    if (!editingRef.current) {
      setSavedTitle(normalizedTitle)
      setDraft(normalizedTitle ?? '')
    }
  }, [nodeId, normalizedTitle])

  useLayoutEffect(() => {
    if (!editing) return
    const input = inputRef.current?.input
    input?.focus()
    input?.select()
  }, [editing])

  const finishEditing = useCallback((nextTitle: string | null) => {
    editingRef.current = false
    setSavedTitle(nextTitle)
    setDraft(nextTitle ?? '')
    setEditing(false)
  }, [])

  const commit = useCallback(async () => {
    if (savingRef.current) return
    if (skipBlurRef.current) {
      skipBlurRef.current = false
      return
    }
    const nextTitle = normalizeNodeTitle(draft)
    if (nextTitle === savedTitle) {
      finishEditing(nextTitle)
      return
    }

    const saveGeneration = saveGenerationRef.current + 1
    saveGenerationRef.current = saveGeneration
    savingRef.current = true
    setSaving(true)
    try {
      await onRename(nextTitle)
      if (
        mountedRef.current &&
        currentNodeIdRef.current === nodeId &&
        saveGenerationRef.current === saveGeneration
      ) {
        finishEditing(nextTitle)
      }
    } catch (error) {
      if (
        mountedRef.current &&
        currentNodeIdRef.current === nodeId &&
        saveGenerationRef.current === saveGeneration
      ) {
        message.error(error instanceof Error ? error.message : '保存节点名称失败')
      }
    } finally {
      if (mountedRef.current && saveGenerationRef.current === saveGeneration) {
        savingRef.current = false
        setSaving(false)
      }
    }
  }, [draft, finishEditing, nodeId, onRename, savedTitle])

  if (!editing) {
    return (
      <button
        type="button"
        className="canvas-inline-node-title-trigger"
        aria-label="重命名节点"
        title="点击修改节点名称"
        onClick={() => {
          setDraft(savedTitle ?? '')
          editingRef.current = true
          skipBlurRef.current = false
          setEditing(true)
        }}
      >
        {savedTitle ?? fallbackTitle}
      </button>
    )
  }

  return (
    <Input
      ref={inputRef}
      className="canvas-inline-node-title-input"
      aria-label="节点名称"
      value={draft}
      disabled={saving}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void commit()
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          skipBlurRef.current = true
          editingRef.current = false
          setDraft(savedTitle ?? '')
          setEditing(false)
        }
      }}
    />
  )
}
