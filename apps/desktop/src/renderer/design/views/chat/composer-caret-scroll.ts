export type ComputeCaretViewportPosition = (
  textarea: HTMLTextAreaElement,
  charIndex: number,
) => { left: number; top: number }

/**
 * Keep the textarea caret inside its visible area after a controlled value or
 * height update. The caller supplies the existing caret measurement so this
 * utility stays independent from the composer's mention/highlight logic.
 */
export function scrollTextareaCaretIntoView(
  textarea: HTMLTextAreaElement,
  computeCaretViewportPosition: ComputeCaretViewportPosition,
): void {
  if (textarea.clientHeight <= 0 || textarea.scrollHeight <= textarea.clientHeight) return

  const charIndex = textarea.selectionStart ?? textarea.value.length
  const textareaRect = textarea.getBoundingClientRect()
  const style = window.getComputedStyle(textarea)
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0
  const caret = computeCaretViewportPosition(textarea, charIndex)
  const visibleTop = textareaRect.top + paddingTop
  const visibleBottom = textareaRect.top + textarea.clientHeight - paddingBottom

  let nextScrollTop = textarea.scrollTop
  if (caret.top > visibleBottom) {
    nextScrollTop += caret.top - visibleBottom
  } else if (caret.top < visibleTop) {
    nextScrollTop -= visibleTop - caret.top
  }

  const maxScrollTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight)
  const clampedScrollTop = Math.min(maxScrollTop, Math.max(0, nextScrollTop))
  if (clampedScrollTop === textarea.scrollTop) return

  textarea.scrollTop = clampedScrollTop
  const highlightLayer = textarea.previousElementSibling
  if (
    highlightLayer instanceof HTMLElement &&
    highlightLayer.classList.contains('composer-input-highlights')
  ) {
    highlightLayer.scrollTop = clampedScrollTop
    highlightLayer.scrollLeft = textarea.scrollLeft
  }
}
