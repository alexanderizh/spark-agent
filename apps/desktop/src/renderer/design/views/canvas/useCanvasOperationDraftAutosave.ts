import { useCallback, useEffect, useRef, useState } from 'react'

export type CanvasOperationDraftSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

type CanvasOperationDraftAutosaveOptions<TDraft> = {
  draft: TDraft
  revision: number
  onSave: (draft: TDraft) => Promise<void> | void
  debounceMs?: number
}

/**
 * Debounces operation draft persistence and flushes the latest dirty value when
 * the panel unmounts (for example, when the user selects another canvas node).
 */
export function useCanvasOperationDraftAutosave<TDraft>({
  draft,
  revision,
  onSave,
  debounceMs = 800,
}: CanvasOperationDraftAutosaveOptions<TDraft>) {
  const draftRef = useRef(draft)
  const onSaveRef = useRef(onSave)
  const dirtyRef = useRef(false)
  const mountedRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [state, setState] = useState<CanvasOperationDraftSaveState>('idle')

  draftRef.current = draft
  onSaveRef.current = onSave

  const clearTimer = useCallback(() => {
    if (timerRef.current == null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const enqueueSave = useCallback((snapshot: TDraft): Promise<void> => {
    const request = saveQueueRef.current.then(() => onSaveRef.current(snapshot))
    saveQueueRef.current = request.then(
      () => undefined,
      () => undefined,
    )
    return request
  }, [])

  const saveNow = useCallback(
    async (force = false): Promise<boolean> => {
      clearTimer()
      if (!force && !dirtyRef.current) {
        await saveQueueRef.current
        return false
      }

      dirtyRef.current = false
      if (mountedRef.current) setState('saving')
      const snapshot = draftRef.current
      try {
        await enqueueSave(snapshot)
        if (mountedRef.current) setState(dirtyRef.current ? 'dirty' : 'saved')
        return true
      } catch (error) {
        dirtyRef.current = true
        if (mountedRef.current) setState('error')
        throw error
      }
    },
    [clearTimer, enqueueSave],
  )

  useEffect(() => {
    if (revision <= 0) return
    dirtyRef.current = true
    setState('dirty')
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void saveNow().catch((error) => {
        console.error('[CanvasOperationPanel] Failed to autosave operation draft:', error)
      })
    }, debounceMs)
  }, [clearTimer, debounceMs, revision, saveNow])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimer()
      if (!dirtyRef.current) return
      dirtyRef.current = false
      const snapshot = draftRef.current
      void enqueueSave(snapshot).catch((error) => {
        console.error('[CanvasOperationPanel] Failed to flush operation draft:', error)
      })
    }
  }, [clearTimer, enqueueSave])

  return {
    state,
    saving: state === 'saving',
    saveNow,
    tooltip:
      state === 'error'
        ? '自动保存失败，请点击重试'
        : state === 'dirty' || state === 'saving'
          ? '正在自动保存配置'
          : '配置已自动保存；点击可立即保存',
  }
}
