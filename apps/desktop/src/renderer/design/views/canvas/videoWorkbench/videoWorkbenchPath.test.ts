import { describe, expect, it } from 'vitest'

import { encodeToSafeFileUrl } from '../canvas-safe-file'
import { resolveVideoWorkbenchDiskPath } from './videoWorkbenchPath'

describe('resolveVideoWorkbenchDiskPath', () => {
  it('decodes Unicode safe-file paths with the canonical canvas decoder', () => {
    const path = 'C:/视频项目/素材/片段.mp4'

    expect(resolveVideoWorkbenchDiskPath(encodeToSafeFileUrl(path))).toBe(path)
  })

  it('keeps non-safe-file URLs unchanged', () => {
    expect(resolveVideoWorkbenchDiskPath('https://example.com/video.mp4')).toBe(
      'https://example.com/video.mp4',
    )
  })
})
