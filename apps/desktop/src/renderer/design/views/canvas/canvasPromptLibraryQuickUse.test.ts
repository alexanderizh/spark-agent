import { describe, expect, it } from 'vitest'
import {
  isPromptLibraryCreateShortcut,
  isPromptLibraryShortcut,
  resolvePromptQuickUseAction,
} from './canvasPromptLibraryQuickUse'

describe('canvas prompt library quick use', () => {
  it('recognizes Cmd/Ctrl+T without treating modified variants as the shortcut', () => {
    expect(
      isPromptLibraryShortcut({
        key: 't',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true)
    expect(
      isPromptLibraryShortcut({
        key: 'T',
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true)
    expect(
      isPromptLibraryShortcut({
        key: 't',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBe(false)
    expect(
      isPromptLibraryShortcut({
        key: 't',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(false)
  })

  it('uses the selected node as the insertion target when one exists', () => {
    expect(resolvePromptQuickUseAction(2)).toBe('apply-to-selection')
    expect(resolvePromptQuickUseAction(0)).toBe('create-at-viewport')
  })

  it('recognizes Cmd/Ctrl+E as the create shortcut without treating modified variants as it', () => {
    expect(
      isPromptLibraryCreateShortcut({
        key: 'e',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true)
    expect(
      isPromptLibraryCreateShortcut({
        key: 'E',
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe(true)
    expect(
      isPromptLibraryCreateShortcut({
        key: 'e',
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      }),
    ).toBe(false)
  })
})
