import { describe, expect, it } from 'vitest'
import {
  classifyDroppedFile,
  extractDroppedFiles,
  layoutDroppedFiles,
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

  it('classifies binary docs as unsupported', () => {
    expect(classifyDroppedFile(makeFile('report.pdf', 'application/pdf'))).toBe('unsupported')
    expect(classifyDroppedFile(makeFile('doc.docx'))).toBe('unsupported')
    expect(classifyDroppedFile(makeFile('unknown.xyz'))).toBe('unsupported')
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
