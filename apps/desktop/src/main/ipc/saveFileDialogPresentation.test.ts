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

  it('识别类型与过滤器清单同源：产物自身扩展名必然出现在对应过滤器里', () => {
    // 只要 saveDialogKindOf 把某扩展名归到某个产物类型，该类型的过滤器就必须包含它，
    // 否则系统保存对话框会改掉/追加扩展名（heic/avif/tiff 曾如此）。
    for (const path of [
      '/tmp/a.PNG',
      '/tmp/scan.heic',
      '/tmp/pic.avif',
      '/tmp/raw.tiff',
      '/tmp/clip.MP4',
      '/tmp/voice.mp3',
      '/tmp/sound.aiff',
    ]) {
      const presentation = saveDialogPresentation(path)
      const extension = path.split('.').pop()?.toLowerCase() ?? ''
      expect(presentation.kind).not.toBe('file')
      expect(presentation.filters[0]?.extensions).toContain(extension)
    }
  })
})
