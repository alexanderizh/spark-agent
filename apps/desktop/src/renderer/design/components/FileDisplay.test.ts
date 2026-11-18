import { describe, expect, it } from 'vitest'
import { decodeFileUrl, normalizeFileReference, resolveFileReferencePath } from './FileDisplay'

describe('file URL normalization', () => {
  it('removes the URL pathname slash before a Windows drive letter', () => {
    expect(decodeFileUrl('file:///C:/Users/netease/report.docx')).toBe(
      'C:/Users/netease/report.docx',
    )
  })

  it('keeps POSIX file URL paths absolute and decodes escaped characters', () => {
    expect(normalizeFileReference('file:///Users/test/My%20Report.xlsx')).toBe(
      '/Users/test/My Report.xlsx',
    )
  })
})

describe('resolveFileReferencePath', () => {
  it('keeps absolute POSIX paths as-is', () => {
    expect(resolveFileReferencePath('/Users/zhang/report.html', null)).toBe(
      '/Users/zhang/report.html',
    )
    expect(resolveFileReferencePath('/Users/zhang/report.html', 'D:\\workspace')).toBe(
      '/Users/zhang/report.html',
    )
  })

  it('keeps absolute Windows paths as-is', () => {
    expect(resolveFileReferencePath('C:\\Users\\netease\\report.docx', null)).toBe(
      'C:\\Users\\netease\\report.docx',
    )
  })

  it('resolves relative paths against a POSIX workspace root', () => {
    expect(resolveFileReferencePath('reports/quant/index.html', '/Users/zhang/grok-bian')).toBe(
      '/Users/zhang/grok-bian/reports/quant/index.html',
    )
    expect(resolveFileReferencePath('./a/../b/c.md', '/ws')).toBe('/ws/b/c.md')
  })

  it('resolves relative paths against a Windows workspace root with backslash separators', () => {
    expect(resolveFileReferencePath('src/app.ts', 'D:\\spark\\workspace')).toBe(
      'D:\\spark\\workspace\\src\\app.ts',
    )
  })

  it('returns null when a relative path has no workspace root', () => {
    expect(resolveFileReferencePath('src/app.ts', null)).toBeNull()
    expect(resolveFileReferencePath('src/app.ts', '   ')).toBeNull()
  })

  it('returns null when .. escapes the workspace root', () => {
    expect(resolveFileReferencePath('../outside.txt', '/ws')).toBeNull()
  })
})
