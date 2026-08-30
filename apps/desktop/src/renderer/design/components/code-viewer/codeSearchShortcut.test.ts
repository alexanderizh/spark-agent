import { describe, expect, it } from 'vitest'
import { resolveCodeSearchShortcut } from './codeSearchShortcut'

describe('resolveCodeSearchShortcut', () => {
  it('routes Ctrl/Cmd+F to content and Ctrl/Cmd+P to files', () => {
    expect(
      resolveCodeSearchShortcut({
        key: 'f',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe('content')
    expect(
      resolveCodeSearchShortcut({
        key: 'P',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
      }),
    ).toBe('files')
  })

  it('does not steal modified or unrelated shortcuts', () => {
    expect(
      resolveCodeSearchShortcut({
        key: 'f',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
      }),
    ).toBeNull()
    expect(
      resolveCodeSearchShortcut({
        key: 'k',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBeNull()
  })
})
