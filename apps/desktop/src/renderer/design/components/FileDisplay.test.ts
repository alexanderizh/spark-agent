import { describe, expect, it } from 'vitest'
import { decodeFileUrl, normalizeFileReference } from './FileDisplay'

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
