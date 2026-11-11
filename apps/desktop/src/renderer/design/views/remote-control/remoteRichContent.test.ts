import { describe, expect, it } from 'vitest'
import {
  MAX_INLINE_HTML_CHARS,
  canPreviewRemoteFile,
  classifyRemoteFile,
  describeFileCount,
  extractHtmlDocument,
  fileNameOf,
} from './remoteRichContent'

describe('extractHtmlDocument', () => {
  it('整体是一个 html 代码围栏时取出正文', () => {
    const html = extractHtmlDocument('```html\n<!doctype html><h1>hi</h1>\n```')
    expect(html).toBe('<!doctype html><h1>hi</h1>')
  })

  it('htm 围栏同样识别，且容忍首尾空白', () => {
    expect(extractHtmlDocument('\n  ```htm\n<p>a</p>\n```\n  ')).toBe('<p>a</p>')
  })

  it('裸文档（doctype / <html>）直接返回原文', () => {
    expect(extractHtmlDocument('<!DOCTYPE html><body>x</body>')).toBe(
      '<!DOCTYPE html><body>x</body>',
    )
    expect(extractHtmlDocument('<html lang="zh"><body>x</body></html>')).toBe(
      '<html lang="zh"><body>x</body></html>',
    )
  })

  it('讲解文字里夹的 html 片段不当作整页文档', () => {
    const text = '先看这段：\n\n```html\n<div>片段</div>\n```\n\n然后再解释一下。'
    expect(extractHtmlDocument(text)).toBeNull()
  })

  it('普通 markdown 回答不受影响', () => {
    expect(extractHtmlDocument('## 标题\n\n- 要点')).toBeNull()
    expect(extractHtmlDocument('')).toBeNull()
  })

  it('超过预览上限的文档不内联，避免渲染进程被拖死', () => {
    const huge = `<!doctype html>${'<p>x</p>'.repeat(MAX_INLINE_HTML_CHARS)}`
    expect(extractHtmlDocument(huge)).toBeNull()
  })
})

describe('classifyRemoteFile', () => {
  it('按扩展名分类（含 Windows 反斜杠路径）', () => {
    expect(classifyRemoteFile('C:\\work\\page.html')).toBe('html')
    expect(classifyRemoteFile('/tmp/a.PNG')).toBe('image')
    expect(classifyRemoteFile('/tmp/notes.md')).toBe('markdown')
    expect(classifyRemoteFile('/tmp/data.json')).toBe('text')
    expect(classifyRemoteFile('/tmp/main.ts')).toBe('code')
    expect(classifyRemoteFile('/tmp/archive.zip')).toBe('other')
    expect(classifyRemoteFile('/tmp/noext')).toBe('other')
  })

  it('只有可读内容才给就地预览入口', () => {
    expect(canPreviewRemoteFile('/a.html')).toBe(true)
    expect(canPreviewRemoteFile('/a.png')).toBe(true)
    expect(canPreviewRemoteFile('/a.md')).toBe(true)
    expect(canPreviewRemoteFile('/a.zip')).toBe(false)
  })

  it('隐藏文件不被误判成有扩展名', () => {
    expect(classifyRemoteFile('/tmp/.env')).toBe('other')
  })
})

describe('fileNameOf / describeFileCount', () => {
  it('取最后一段文件名', () => {
    expect(fileNameOf('C:\\work\\a.html')).toBe('a.html')
    expect(fileNameOf('/tmp/b/c.md')).toBe('c.md')
  })

  it('只给数量，避免与标题「产物」重复', () => {
    expect(describeFileCount(1)).toBe('1 个')
    expect(describeFileCount(3)).toBe('3 个')
  })
})
