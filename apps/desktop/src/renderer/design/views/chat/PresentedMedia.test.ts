import { describe, expect, it } from 'vitest'
import {
  classifyPresentedFile,
  encodeToSafeFileUrl,
  filterMediaPresentedFiles,
} from './PresentedMedia'

/**
 * 还原 encodeToSafeFileUrl 的 base64url 编码，验证可逆（与主进程 SafeFileProtocol 解码一致）。
 */
function decodeSafeFileUrl(url: string): string {
  const encoded = url.slice('safe-file://x/'.length)
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
  return decodeURIComponent(escape(atob(base64 + padding)))
}

describe('PresentedMedia', () => {
  describe('classifyPresentedFile', () => {
    it('识别图片扩展名（含大小写）', () => {
      expect(classifyPresentedFile('/tmp/cat.png')).toBe('image')
      expect(classifyPresentedFile('/tmp/cat.JPG')).toBe('image')
      expect(classifyPresentedFile('/tmp/a.webp')).toBe('image')
      expect(classifyPresentedFile('/tmp/a.gif')).toBe('image')
      expect(classifyPresentedFile('/tmp/a.svg')).toBe('image')
      expect(classifyPresentedFile('/tmp/a.avif')).toBe('image')
    })

    it('识别音频扩展名', () => {
      expect(classifyPresentedFile('/tmp/voice.mp3')).toBe('audio')
      expect(classifyPresentedFile('/tmp/voice.WAV')).toBe('audio')
      expect(classifyPresentedFile('/tmp/voice.m4a')).toBe('audio')
      expect(classifyPresentedFile('/tmp/voice.opus')).toBe('audio')
    })

    it('识别视频扩展名', () => {
      expect(classifyPresentedFile('/tmp/clip.mp4')).toBe('video')
      expect(classifyPresentedFile('/tmp/clip.MOV')).toBe('video')
      expect(classifyPresentedFile('/tmp/clip.webm')).toBe('video')
      expect(classifyPresentedFile('/tmp/clip.mkv')).toBe('video')
    })

    it('忽略文档/代码/未知/无扩展名', () => {
      expect(classifyPresentedFile('/tmp/report.pdf')).toBeNull()
      expect(classifyPresentedFile('/tmp/notes.md')).toBeNull()
      expect(classifyPresentedFile('/tmp/ChatView.tsx')).toBeNull()
      expect(classifyPresentedFile('/tmp/unknown.xyz')).toBeNull()
      expect(classifyPresentedFile('/tmp/no-extension')).toBeNull()
      expect(classifyPresentedFile('')).toBeNull()
    })

    it('先剥离 query/hash 再判断扩展名', () => {
      expect(classifyPresentedFile('/tmp/cat.png?token=abc')).toBe('image')
      expect(classifyPresentedFile('/tmp/cat.png#anchor')).toBe('image')
      expect(classifyPresentedFile('/tmp/clip.mp4?t=1')).toBe('video')
    })
  })

  describe('filterMediaPresentedFiles', () => {
    it('只保留媒体文件，丢弃文档与代码', () => {
      const files = [
        { path: '/tmp/report.pdf', title: 'Report' },
        { path: '/tmp/cat.png', title: 'Cat' },
        { path: '/tmp/ChatView.tsx' },
        { path: '/tmp/voice.mp3' },
        { path: '/tmp/clip.mp4', title: 'Clip' },
      ]
      expect(filterMediaPresentedFiles(files)).toEqual([
        { path: '/tmp/cat.png', title: 'Cat' },
        { path: '/tmp/voice.mp3' },
        { path: '/tmp/clip.mp4', title: 'Clip' },
      ])
    })

    it('全是非媒体时返回空数组', () => {
      expect(filterMediaPresentedFiles([{ path: '/tmp/a.md' }, { path: '/tmp/b.pdf' }])).toEqual([])
    })
  })

  describe('encodeToSafeFileUrl', () => {
    it('生成 safe-file://x/ 前缀的 URL', () => {
      expect(encodeToSafeFileUrl('/tmp/cat.png').startsWith('safe-file://x/')).toBe(true)
    })

    it('可逆：解码回原路径', () => {
      const original =
        '/Users/zhangyang/spark_ai_project/Spark-Agent/.spark-artifacts/media/cat.png'
      expect(decodeSafeFileUrl(encodeToSafeFileUrl(original))).toBe(original)
    })

    it('支持中文路径可逆', () => {
      const original = '/tmp/小猫.png'
      expect(decodeSafeFileUrl(encodeToSafeFileUrl(original))).toBe(original)
    })
  })
})
