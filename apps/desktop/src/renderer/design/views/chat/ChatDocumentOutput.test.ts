import { describe, expect, it } from 'vitest'
import {
  collectDocumentOutputKeys,
  filterDocumentOutputFiles,
  isDocumentOutputReference,
  isPathShapedFileReference,
  renderDocumentOutputParagraph,
} from './ChatDocumentOutput'

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

  it('collects only paragraphs made entirely from document references', () => {
    expect(collectDocumentOutputKeys('[报告](/tmp/report.pdf)\n`/tmp/slides.pptx`')).toEqual([
      '/tmp/report.pdf',
      '/tmp/slides.pptx',
    ])
    expect(collectDocumentOutputKeys('生成结果：\n/tmp/report.pdf')).toEqual([])
  })

  it('accepts path-shaped references for bare-path detection', () => {
    expect(isPathShapedFileReference('G:\\spark\\reports\\周报.md')).toBe(true)
    expect(isPathShapedFileReference('G:/spark/reports/report.md')).toBe(true)
    expect(isPathShapedFileReference('/G:/spark/reports/report.md')).toBe(true)
    expect(isPathShapedFileReference('/tmp/report.pdf')).toBe(true)
    expect(isPathShapedFileReference('~/.spark-agent/notes.md')).toBe(true)
    expect(isPathShapedFileReference('./.spark-agent/task-state-inbox.md')).toBe(true)
    expect(isPathShapedFileReference('../reports/report.md')).toBe(true)
    expect(isPathShapedFileReference('.spark-agent/task-state-inbox.md')).toBe(true)
    expect(isPathShapedFileReference('\\\\server\\share\\report.docx')).toBe(true)
    expect(isPathShapedFileReference('file:///G:/spark/reports/report.md')).toBe(true)
  })

  it('rejects prose lines from bare-path detection', () => {
    // 事故原文：整句散文含空格与 markdown 链接，不应折叠成文档卡片
    expect(
      isPathShapedFileReference(
        '本轮诊断记录已更新到 [.spark-agent/task-state-inbox.md](/G:/spark/spark-agent/.spark-agent/task-state-inbox.md)。',
      ),
    ).toBe(false)
    expect(isPathShapedFileReference('请见 README.md 文档')).toBe(false)
    expect(isPathShapedFileReference('如 report.pdf 所示')).toBe(false)
    expect(isPathShapedFileReference('README.md')).toBe(false)
    expect(isPathShapedFileReference('')).toBe(false)
    expect(isPathShapedFileReference('已更新到 report.md')).toBe(false)
  })

  it('keeps prose with embedded document links as regular markdown text', () => {
    const incident =
      '本轮诊断记录已更新到 [.spark-agent/task-state-inbox.md](/G:/spark/spark-agent/.spark-agent/task-state-inbox.md)。'
    expect(collectDocumentOutputKeys(incident)).toEqual([])
    expect(
      renderDocumentOutputParagraph(incident, new Set(), undefined, 'test'),
    ).toBeNull()
    // 合法裸路径行仍折叠成卡片
    expect(collectDocumentOutputKeys('G:\\spark\\reports\\周报.md')).toEqual([
      'g:/spark/reports/周报.md',
    ])
    // 整行 markdown 链接（href 显式给路径）仍折叠成卡片
    expect(collectDocumentOutputKeys('[报告](/tmp/report.pdf)')).toEqual(['/tmp/report.pdf'])
  })
})
