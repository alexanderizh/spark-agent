import { describe, expect, it, vi } from 'vitest'
import { pickImageFiles } from './remotePaste'

describe('pickImageFiles', () => {
  it('snapshots every image File synchronously and ignores text or unavailable items', () => {
    const first = new File(['first'], 'first.png', { type: 'image/png' })
    const second = new File(['second'], 'second.jpg', { type: 'image/jpeg' })
    const firstGet = vi.fn(() => first)
    const secondGet = vi.fn(() => second)
    const textGet = vi.fn(() => null)

    const files = pickImageFiles([
      { type: 'image/png', getAsFile: firstGet },
      { type: 'text/plain', getAsFile: textGet },
      { type: 'image/jpeg', getAsFile: secondGet },
      { type: 'image/gif', getAsFile: () => null },
    ])

    expect(files).toEqual([first, second])
    expect(firstGet).toHaveBeenCalledOnce()
    expect(secondGet).toHaveBeenCalledOnce()
    expect(textGet).not.toHaveBeenCalled()
  })

  it('returns no files when the clipboard contains only non-image items', () => {
    expect(pickImageFiles([{ type: 'text/html', getAsFile: () => null }])).toEqual([])
    expect(pickImageFiles(null)).toEqual([])
  })
})
