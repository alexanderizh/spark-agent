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
    expect(collectDocumentOutputKeys('[报告](./docs/report.md)')).toEqual([
      './docs/report.md',
    ])
    expect(collectDocumentOutputKeys('[报告](report.md)')).toEqual(['report.md'])
  })

  it('rejects markdown links whose target is prose ending in a document extension', () => {
    const malformedLink =
      '[binance-futures-backtest.md](本机已有 Python 环境，文件内容可参考 report.md)'

    expect(collectDocumentOutputKeys(malformedLink)).toEqual([])
    expect(renderDocumentOutputParagraph(malformedLink, new Set(), undefined, 'test')).toBeNull()
  })

  it('accepts link targets containing plain spaces (explicit file intent)', () => {
    // 含空格文件名的合法链接目标：整行链接结构是明确的指路意图
    expect(collectDocumentOutputKeys('[报告](my report.md)')).toEqual(['my report.md'])
    expect(collectDocumentOutputKeys('[报告](docs/my file.md)')).toEqual(['docs/my file.md'])
    expect(collectDocumentOutputKeys('[报告](G:\\spark\\my report.md)')).toEqual([
      'g:/spark/my report.md',
    ])
    // CommonMark 尖括号形式：显式字面目标，剥壳后校验与返回
    expect(collectDocumentOutputKeys('[报告](<my report.md>)')).toEqual(['my report.md'])
    expect(collectDocumentOutputKeys('[报告](<docs/a, b.md>)')).toEqual(['docs/a, b.md'])
  })

  it('still rejects prose-shaped spaced targets and control whitespace', () => {
    // 裸空格目标拒绝句读标点（散文 target 几乎必含，真文件名罕见）
    expect(
      collectDocumentOutputKeys(
        '[binance-futures-backtest.md](本机已有 Python 环境，文件内容可参考 report.md)',
      ),
    ).toEqual([])
    expect(collectDocumentOutputKeys('[报告](请见 docs; 说明.md)')).toEqual([])
    // 控制空白（tab/换行）任何形式都拒绝
    expect(collectDocumentOutputKeys('[报告](my\treport.md)')).toEqual([])
    // 非链接的裸行含空格仍拒绝（散文防线不动）
    expect(collectDocumentOutputKeys('my report.md')).toEqual([])
    expect(collectDocumentOutputKeys('请见 my report.md 文档')).toEqual([])
  })

  it('allowSpaces option only permits plain in-segment spaces with path shape', () => {
    // 默认拒绝一切空白
    expect(isPathShapedFileReference('G:\\spark\\my report.md')).toBe(false)
    // allowSpaces 放行段内普通空格（仍要求路径形状：分隔符/盘符等）
    expect(isPathShapedFileReference('G:\\spark\\my report.md', { allowSpaces: true })).toBe(
      true,
    )
    expect(isPathShapedFileReference('docs/my file.md', { allowSpaces: true })).toBe(true)
    // 无路径分隔符的纯文件名即便 allowSpaces 也不是 path-shaped（由链接分支
    // 的 simple-file-name 兜底承接）
    expect(isPathShapedFileReference('my report.md', { allowSpaces: true })).toBe(false)
    // 控制空白即使 allowSpaces 也拒绝
    expect(isPathShapedFileReference('docs/my\tfile.md', { allowSpaces: true })).toBe(false)
    expect(isPathShapedFileReference('docs/my\nfile.md', { allowSpaces: true })).toBe(false)
  })
})
