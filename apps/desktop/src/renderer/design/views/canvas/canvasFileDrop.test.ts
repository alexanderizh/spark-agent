import { describe, expect, it } from 'vitest'
import {
  classifyDroppedFile,
  extractDroppedFiles,
  layoutDroppedImages,
  layoutDroppedFiles,
  shouldGroupCanvasImages,
  textFormatFromFileName,
} from './canvasFileDrop'

function makeFile(name: string, type = '', size = 100): File {
  return new File(['dummy'], name, { type, lastModified: 1700000000000 + size })
}

describe('classifyDroppedFile', () => {
  it('classifies by mime when present', () => {
    expect(classifyDroppedFile(makeFile('photo', 'image/png'))).toBe('image')
    expect(classifyDroppedFile(makeFile('clip', 'video/mp4'))).toBe('video')
    expect(classifyDroppedFile(makeFile('song', 'audio/mpeg'))).toBe('audio')
    expect(classifyDroppedFile(makeFile('note', 'text/plain'))).toBe('text')
  })

  it('falls back to extension when mime is empty (Electron disk drops)', () => {
    expect(classifyDroppedFile(makeFile('photo.jpg'))).toBe('image')
    expect(classifyDroppedFile(makeFile('clip.webm'))).toBe('video')
    expect(classifyDroppedFile(makeFile('song.flac'))).toBe('audio')
    expect(classifyDroppedFile(makeFile('script.ts'))).toBe('text')
    expect(classifyDroppedFile(makeFile('data.json'))).toBe('text')
  })

  it('treats text/html and other text/* mime as text', () => {
    expect(classifyDroppedFile(makeFile('page.html', 'text/html'))).toBe('text')
    expect(classifyDroppedFile(makeFile('data', 'application/json'))).toBe('text')
  })

  it('classifies genuinely unsupported files as unsupported', () => {
    // PDF 按需求暂不支持直接拖入解析；未知扩展名同样不支持。
    expect(classifyDroppedFile(makeFile('report.pdf', 'application/pdf'))).toBe('unsupported')
    expect(classifyDroppedFile(makeFile('unknown.xyz'))).toBe('unsupported')
    expect(classifyDroppedFile(makeFile('setup.exe'))).toBe('unsupported')
  })

  it('classifies office / rich documents as document', () => {
    // 扩展名兜底（Electron 拖入磁盘文件时 MIME 常为空）
    expect(classifyDroppedFile(makeFile('report.docx'))).toBe('document')
    expect(classifyDroppedFile(makeFile('sheet.xlsx'))).toBe('document')
    expect(classifyDroppedFile(makeFile('deck.pptx'))).toBe('document')
    expect(classifyDroppedFile(makeFile('old.doc'))).toBe('document')
    expect(classifyDroppedFile(makeFile('legacy.xls'))).toBe('document')
    expect(classifyDroppedFile(makeFile('note.odt'))).toBe('document')
    expect(classifyDroppedFile(makeFile('rich.rtf'))).toBe('document')
  })

  it('classifies office documents by mime when present', () => {
    expect(
      classifyDroppedFile(
        makeFile('report', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ),
    ).toBe('document')
    expect(
      classifyDroppedFile(
        makeFile('sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      ),
    ).toBe('document')
  })
})

describe('textFormatFromFileName', () => {
  it('returns markdown for markdown-family extensions', () => {
    expect(textFormatFromFileName('readme.md')).toBe('markdown')
    expect(textFormatFromFileName('notes.markdown')).toBe('markdown')
    expect(textFormatFromFileName('doc.mdx')).toBe('markdown')
  })

  it('returns plain for other text/code extensions', () => {
    expect(textFormatFromFileName('notes.txt')).toBe('plain')
    expect(textFormatFromFileName('data.json')).toBe('plain')
    expect(textFormatFromFileName('app.tsx')).toBe('plain')
    expect(textFormatFromFileName('query.sql')).toBe('plain')
  })
})

describe('extractDroppedFiles', () => {
  it('returns empty for null/empty transfer', () => {
    expect(extractDroppedFiles(null)).toEqual([])
  })

  it('reads files from dataTransfer.files', () => {
    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.txt', 'text/plain')
    const dt = { files: [a, b], items: [] } as unknown as DataTransfer
    expect(extractDroppedFiles(dt)).toHaveLength(2)
  })

  it('reads files from dataTransfer.items', () => {
    const a = makeFile('a.png', 'image/png')
    const dt = {
      items: [{ kind: 'file', getAsFile: () => a }],
      files: [],
    } as unknown as DataTransfer
    expect(extractDroppedFiles(dt)).toEqual([a])
  })

  it('dedupes the same file appearing in both items and files', () => {
    const a = makeFile('dup.png', 'image/png')
    const dt = {
      items: [{ kind: 'file', getAsFile: () => a }],
      files: [a],
    } as unknown as DataTransfer
    expect(extractDroppedFiles(dt)).toEqual([a])
  })

  it('skips non-file items', () => {
    const dt = {
      items: [{ kind: 'string' }],
      files: [],
    } as unknown as DataTransfer
    expect(extractDroppedFiles(dt)).toEqual([])
  })
})

describe('layoutDroppedFiles', () => {
  it('returns origin for a single file', () => {
    const points = layoutDroppedFiles(1, { x: 100, y: 200 }, { width: 500, height: 240 })
    expect(points).toEqual([{ x: 100, y: 200 }])
  })

  it('lays out multiple files in rows of 3 by default', () => {
    const points = layoutDroppedFiles(4, { x: 0, y: 0 }, { width: 500, height: 240 })
    expect(points).toHaveLength(4)
    expect(points[1]).toEqual({ x: 540, y: 0 }) // +width+spacing
    expect(points[3]).toEqual({ x: 0, y: 280 }) // second row
  })

  it('returns empty for zero count', () => {
    expect(layoutDroppedFiles(0, { x: 0, y: 0 }, { width: 100, height: 100 })).toEqual([])
  })
})

describe('external multi-image drops', () => {
  it('does not group multiple images when grouping is disabled for external drops', () => {
    expect(shouldGroupCanvasImages(2, false)).toBe(false)
    expect(shouldGroupCanvasImages(2, true)).toBe(true)
    expect(shouldGroupCanvasImages(1, true)).toBe(false)
  })

  it('lays out image nodes independently from the drop origin', () => {
    const placed = layoutDroppedImages(
      [
        { id: 'a', width: 200, height: 100 },
        { id: 'b', width: 120, height: 150 },
        { id: 'c', width: 180, height: 80 },
        { id: 'd', width: 160, height: 90 },
      ],
      { x: 100, y: 200 },
      { spacing: 24 },
    )

    expect(placed.map(({ id, x, y }) => ({ id, x, y }))).toEqual([
      { id: 'a', x: 100, y: 200 },
      { id: 'b', x: 324, y: 200 },
      { id: 'c', x: 468, y: 200 },
      { id: 'd', x: 100, y: 374 },
    ])
  })
})
