// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isVoiceInputShortcut, useVoiceInputShortcut } from './useVoiceInputShortcut'

let root: Root | null = null
let container: HTMLDivElement | null = null

function Harness({ disabled, onToggle }: { disabled: boolean; onToggle: () => void }): null {
  useVoiceInputShortcut({ disabled, onToggle })
  return null
}

function pressVoiceShortcut(extra: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'd',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...extra,
  }))
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  document.querySelector('.modal-backdrop')?.remove()
  root = null
  container = null
})

describe('voice input shortcut', () => {
  it('matches only Control+Shift+D', () => {
    expect(isVoiceInputShortcut({
      key: 'D', ctrlKey: true, shiftKey: true, metaKey: false, altKey: false, repeat: false,
    })).toBe(true)
    expect(isVoiceInputShortcut({
      key: 'd', ctrlKey: false, shiftKey: true, metaKey: true, altKey: false, repeat: false,
    })).toBe(false)
  })

  it('toggles from editable content but skips disabled and modal states', () => {
    const onToggle = vi.fn()
    act(() => root?.render(<Harness disabled={false} onToggle={onToggle} />))
    act(() => pressVoiceShortcut())
    expect(onToggle).toHaveBeenCalledTimes(1)

    const modal = document.createElement('div')
    modal.className = 'modal-backdrop'
    document.body.appendChild(modal)
    act(() => pressVoiceShortcut())
    expect(onToggle).toHaveBeenCalledTimes(1)

    modal.remove()
    act(() => root?.render(<Harness disabled onToggle={onToggle} />))
    act(() => pressVoiceShortcut())
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
