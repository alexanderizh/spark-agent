import { useCallback, useEffect, useRef } from 'react'
import type { ComposerLexicalInputHandle } from './ComposerLexicalInput'

type ComposerInputRef = {
  current: ComposerLexicalInputHandle | null
}

type UseComposerInputAutoSizeOptions = {
  inputRef: ComposerInputRef
  draftBucketKey: string
  manualExpanded: boolean
  value: string
}

function getHeightBounds(manualExpanded: boolean): { minHeight: number; maxHeight: number } {
  return manualExpanded ? { minHeight: 240, maxHeight: 520 } : { minHeight: 100, maxHeight: 280 }
}

/**
 * Keeps the Lexical composer height in sync with its content.
 *
 * The immediate measurement keeps normal typing responsive. The deferred
 * measurement handles external Lexical updates, which commit after React's
 * effect and can otherwise leave the previous session's height on the reused
 * contenteditable element.
 */
export function useComposerInputAutoSize({
  inputRef,
  draftBucketKey,
  manualExpanded,
  value,
}: UseComposerInputAutoSizeOptions): void {
  const transitionFrameRef = useRef<number | null>(null)

  const measure = useCallback(() => {
    const element = inputRef.current?.getElement()
    if (element == null) return

    if (transitionFrameRef.current != null) {
      cancelAnimationFrame(transitionFrameRef.current)
      transitionFrameRef.current = null
    }

    const { minHeight, maxHeight } = getHeightBounds(manualExpanded)
    const previousHeight = element.style.height
    const previousTransition = element.style.transition
    element.style.transition = 'none'
    element.style.height = 'auto'
    // Force layout so scrollHeight reflects the temporary auto height.
    void element.offsetHeight
    const nextHeight = Math.max(minHeight, Math.min(element.scrollHeight, maxHeight))
    element.style.height = `${nextHeight}px`

    transitionFrameRef.current = requestAnimationFrame(() => {
      transitionFrameRef.current = null
      if (inputRef.current?.getElement() !== element) return
      element.style.transition = previousTransition || ''
      // Defensive fallback: height should never remain empty or auto.
      if (element.style.height === 'auto' || element.style.height === '') {
        element.style.height = previousHeight || `${minHeight}px`
      }
    })
  }, [inputRef, manualExpanded])

  useEffect(() => {
    measure()
    // External ComposerLexicalInput value sync updates the DOM after the
    // current effect, so measure once more after that update has committed.
    const deferredMeasureFrame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(deferredMeasureFrame)
  }, [draftBucketKey, measure, value])

  useEffect(
    () => () => {
      if (transitionFrameRef.current != null) {
        cancelAnimationFrame(transitionFrameRef.current)
      }
    },
    [],
  )
}
