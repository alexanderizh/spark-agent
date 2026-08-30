import { describe, expect, it } from 'vitest'
import {
  extractHttpLinks,
  extractLocalImagePath,
  getRichImageDisplay,
  getRichSourceLinks,
  getScreenshotDataUrl,
} from './rich-output-parsing'
import { isScreenshotToolCall, isWebSearchToolCall } from './tool-log-metadata'

describe('extractHttpLinks', () => {
  it('extracts markdown links with their titles first, then bare urls', () => {
    const output = [
      '搜索结果：',
      '- [Claude 官网](https://claude.ai/intro)',
      '- 备注见 https://example.com/a?x=1',
    ].join('\n')
    expect(extractHttpLinks(output)).toEqual([
      { title: 'Claude 官网', url: 'https://claude.ai/intro' },
      { title: 'https://example.com/a?x=1', url: 'https://example.com/a?x=1' },
    ])
  })

  it('does not duplicate a url that also appears inside a markdown link', () => {
    const output = '[标题](https://example.com/page) 其它文本 https://example.com/page 结束'
    expect(extractHttpLinks(output)).toEqual([{ title: '标题', url: 'https://example.com/page' }])
  })

  it('keeps order stable and dedupes by url', () => {
    const output = 'https://a.com 再次 https://a.com 然后 [b](https://b.com)'
    expect(extractHttpLinks(output).map((link) => link.url)).toEqual([
      'https://a.com',
      'https://b.com',
    ])
  })

  it('stops bare urls at CJK punctuation', () => {
    const output = '链接 https://example.com/x。结束'
    expect(extractHttpLinks(output)).toEqual([
      { title: 'https://example.com/x', url: 'https://example.com/x' },
    ])
  })

  it('falls back to the url as title when markdown title is blank', () => {
    expect(extractHttpLinks('[](https://example.com)')).toEqual([
      { title: 'https://example.com', url: 'https://example.com' },
    ])
  })

  it('returns empty for empty/absent output or no links', () => {
    expect(extractHttpLinks(undefined)).toEqual([])
    expect(extractHttpLinks('')).toEqual([])
    expect(extractHttpLinks('没有链接的普通输出')).toEqual([])
  })
})

describe('isScreenshotToolCall / isWebSearchToolCall', () => {
  it('matches playwright, spark_browser and plain screenshot names', () => {
    expect(isScreenshotToolCall('browser_screenshot')).toBe(true)
    expect(isScreenshotToolCall('mcp__playwright__browser_screenshot')).toBe(true)
    expect(isScreenshotToolCall('mcp__spark_browser__screenshot')).toBe(true)
    expect(isScreenshotToolCall('browser_click')).toBe(false)
  })

  it('matches search tools but not fetch tools', () => {
    expect(isWebSearchToolCall('WebSearch')).toBe(true)
    expect(isWebSearchToolCall('mcp__spark_search__web_search')).toBe(true)
    expect(isWebSearchToolCall('web_fetch')).toBe(false)
    expect(isWebSearchToolCall('mcp__spark_search__fetch_url')).toBe(false)
  })
})

describe('extractLocalImagePath', () => {
  it('extracts unix and windows absolute image paths from text', () => {
    expect(extractLocalImagePath('Screenshot saved to: /tmp/shot-1234.png')).toBe(
      '/tmp/shot-1234.png',
    )
    expect(extractLocalImagePath('保存于 C:\\Users\\foo\\shot.jpeg 结束')).toBe(
      'C:\\Users\\foo\\shot.jpeg',
    )
  })

  it('rejects relative paths and non-image extensions', () => {
    expect(extractLocalImagePath('relative/path/shot.png')).toBeNull()
    expect(extractLocalImagePath('/tmp/shot.txt')).toBeNull()
    expect(extractLocalImagePath(undefined)).toBeNull()
  })
})

describe('getScreenshotDataUrl', () => {
  it('picks the longest base64 data url and ignores short fragments', () => {
    const short = 'data:image/png;base64,' + 'A'.repeat(100)
    const long = 'data:image/png;base64,' + 'B'.repeat(2048)
    expect(getScreenshotDataUrl(`头 ${short} 尾 ${long}`)).toBe(long)
  })

  it('returns null for plain text output', () => {
    expect(getScreenshotDataUrl('截图成功，但无数据')).toBeNull()
    expect(getScreenshotDataUrl(undefined)).toBeNull()
  })
})

describe('getRichImageDisplay', () => {
  it('uses structured toolInput path for image reads', () => {
    expect(getRichImageDisplay('Read', { file_path: '/tmp/图.PNG' }, '图片描述文本')).toEqual({
      src: '/tmp/图.PNG',
      filePath: '/tmp/图.PNG',
    })
  })

  it('prefers dataUrl then local path for screenshot tools', () => {
    const dataUrl = 'data:image/png;base64,' + 'C'.repeat(512)
    expect(getRichImageDisplay('mcp__spark_browser__screenshot', {}, `截图 ${dataUrl}`)).toEqual({
      src: dataUrl,
      filePath: null,
    })
    expect(
      getRichImageDisplay('browser_screenshot', {}, 'Screenshot saved to: /tmp/s.png'),
    ).toEqual({ src: '/tmp/s.png', filePath: '/tmp/s.png' })
  })

  it('returns null for non-image tools or missing sources', () => {
    expect(getRichImageDisplay('Read', { file_path: '/tmp/a.ts' }, undefined)).toBeNull()
    expect(getRichImageDisplay('Grep', { pattern: 'x' }, '匹配 3 行')).toBeNull()
    expect(getRichImageDisplay('browser_screenshot', {}, undefined)).toBeNull()
  })
})

describe('getRichSourceLinks', () => {
  it('returns links for search tools only', () => {
    const output = '[a](https://a.com) [b](https://b.com)'
    expect(getRichSourceLinks('web_search', output)).toHaveLength(2)
    expect(getRichSourceLinks('mcp__spark_search__web_search', output)).toHaveLength(2)
    // 抓取类与其它工具不富展示
    expect(getRichSourceLinks('web_fetch', output)).toBeNull()
    expect(getRichSourceLinks('Read', output)).toBeNull()
  })

  it('returns null when the search output has no extractable links', () => {
    expect(getRichSourceLinks('web_search', 'done')).toBeNull()
    expect(getRichSourceLinks('web_search', undefined)).toBeNull()
  })
})
