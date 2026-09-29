import { describe, expect, it } from 'vitest'
import { saveDialogKindOf, saveDialogPresentation } from './saveFileDialogPresentation'

describe('saveDialogPresentation', () => {
  it('图片产物保持既有「保存图片」文案与过滤器', () => {
    const presentation = saveDialogPresentation('/tmp/output/image-1.png')
    expect(presentation.kind).toBe('image')
    expect(presentation.title).toBe('保存图片')
    expect(presentation.filters[0]?.name).toBe('图片')
  })

  it('音频产物给出「保存音频」与音频过滤器', () => {
    const presentation = saveDialogPresentation('/tmp/output/audio/voice-1.mp3')
    expect(presentation.kind).toBe('audio')
    expect(presentation.title).toBe('保存音频')
    expect(presentation.filters[0]?.extensions).toContain('wav')
    expect(presentation.filters.at(-1)?.extensions).toEqual(['*'])
  })

  it('视频产物给出「保存视频」与视频过滤器', () => {
    const presentation = saveDialogPresentation('/tmp/output/video/clip.mov')
    expect(presentation.kind).toBe('video')
    expect(presentation.title).toBe('保存视频')
    expect(presentation.filters[0]?.name).toBe('视频')
  })

  it('未知扩展名与无扩展名归为通用文件，只给「所有文件」', () => {
    for (const path of ['/tmp/output/note.txt', '/tmp/output/README']) {
      const presentation = saveDialogPresentation(path)
      expect(presentation.kind).toBe('file')
      expect(presentation.title).toBe('保存文件')
      expect(presentation.filters).toEqual([{ name: '所有文件', extensions: ['*'] }])
    }
  })

  it('大小写与前后空白不影响识别', () => {
    expect(saveDialogKindOf('  /tmp/A/Clip.MP4 ')).toBe('video')
    expect(saveDialogKindOf('/tmp/A/Voice.FLAC')).toBe('audio')
  })
})
