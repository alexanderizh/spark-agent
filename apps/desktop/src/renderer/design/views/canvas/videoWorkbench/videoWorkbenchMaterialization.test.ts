import { describe, expect, it } from 'vitest'
import { resolveWorkbenchMaterializationMedia } from './videoWorkbenchMaterialization'

describe('videoWorkbenchMaterialization', () => {
  it('treats GIF outputs as image assets', () => {
    expect(resolveWorkbenchMaterializationMedia('C:/workbench/result.gif')).toEqual({
      kind: 'image',
      mimeType: 'image/gif',
    })
  })

  it('preserves the MIME type for common video outputs', () => {
    expect(resolveWorkbenchMaterializationMedia('/tmp/result.webm')).toEqual({
      kind: 'video',
      mimeType: 'video/webm',
    })
    expect(resolveWorkbenchMaterializationMedia('/tmp/result.mov')).toEqual({
      kind: 'video',
      mimeType: 'video/quicktime',
    })
  })

  it('falls back to MP4 for an extensionless video artifact', () => {
    expect(resolveWorkbenchMaterializationMedia('/tmp/result')).toEqual({
      kind: 'video',
      mimeType: 'video/mp4',
    })
  })
})
