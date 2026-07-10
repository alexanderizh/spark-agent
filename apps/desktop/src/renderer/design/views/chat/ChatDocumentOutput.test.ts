import { describe, expect, it } from 'vitest'
import { filterDocumentOutputFiles, isDocumentOutputReference } from './ChatDocumentOutput'

describe('ChatDocumentOutput', () => {
  it('only treats document-like file references as document outputs', () => {
    expect(isDocumentOutputReference('/tmp/report.pdf')).toBe(true)
    expect(isDocumentOutputReference('/tmp/proposal.docx')).toBe(true)
    expect(isDocumentOutputReference('/tmp/sheet.xlsx')).toBe(true)
    expect(isDocumentOutputReference('/tmp/slides.pptx')).toBe(true)
    expect(isDocumentOutputReference('/tmp/page.html')).toBe(true)
    expect(isDocumentOutputReference('/tmp/notes.md')).toBe(true)
    expect(isDocumentOutputReference('/tmp/readme.txt')).toBe(true)

    expect(isDocumentOutputReference('/tmp/ChatView.tsx')).toBe(false)
    expect(isDocumentOutputReference('/tmp/component.jsx')).toBe(false)
    expect(isDocumentOutputReference('/tmp/query.sql')).toBe(false)
    expect(isDocumentOutputReference('/tmp/styles.less')).toBe(false)
    expect(isDocumentOutputReference('/tmp/package.json')).toBe(false)
  })

  it('filters explicit presented files before rendering document cards', () => {
    const files = [
      { path: '/tmp/ChatView.tsx', title: 'Chat view' },
      { path: '/tmp/report.pdf', title: 'Report' },
      { path: '/tmp/styles.less', title: 'Styles' },
      { path: '/tmp/index.html', title: 'Preview page' },
    ]

    expect(filterDocumentOutputFiles(files)).toEqual([
      { path: '/tmp/report.pdf', title: 'Report' },
      { path: '/tmp/index.html', title: 'Preview page' },
    ])
  })
})
