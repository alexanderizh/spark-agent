import { describe, expect, it } from 'vitest'
import { isBrowserWindowMode, readBrowserWindowInitialUrl } from '../browserWindowParams'
import {
  BROWSER_VIEWPORT_PRESETS,
  DEFAULT_BROWSER_URL,
  MAX_BROWSER_TABS,
  normalizeBrowserUrl,
  tabDisplayLabel,
  VIEWPORT_FIT_ID,
} from '../design/components/browser/browserChromeShared'

describe('browser window params', () => {
  it('从 hash 读取独立窗口模式和初始网址', () => {
    const hash = '#window=browser&url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1'

    expect(isBrowserWindowMode('', hash)).toBe(true)
    expect(readBrowserWindowInitialUrl('', hash)).toBe('https://example.com/a?b=1')
  })

  it('继续兼容旧 query 参数', () => {
    const search = '?window=browser&url=https%3A%2F%2Fexample.com%2Fold'

    expect(isBrowserWindowMode(search, '')).toBe(true)
    expect(readBrowserWindowInitialUrl(search, '')).toBe('https://example.com/old')
  })

  it('普通主窗口不进入浏览器独立窗口模式', () => {
    expect(isBrowserWindowMode('', '')).toBe(false)
    expect(readBrowserWindowInitialUrl('', '')).toBeUndefined()
  })
})

describe('normalizeBrowserUrl', () => {
  it('空串回退默认首页', () => {
    expect(normalizeBrowserUrl('')).toBe(DEFAULT_BROWSER_URL)
    expect(normalizeBrowserUrl('   ')).toBe(DEFAULT_BROWSER_URL)
  })

  it('带协议的地址原样保留', () => {
    expect(normalizeBrowserUrl('https://example.com')).toBe('https://example.com')
    expect(normalizeBrowserUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x')
  })

  it('裸域名补 https', () => {
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com')
    expect(normalizeBrowserUrl('spark.yiqibyte.com/a?b=1')).toBe('https://spark.yiqibyte.com/a?b=1')
  })
})

describe('tabDisplayLabel', () => {
  it('标题优先', () => {
    expect(tabDisplayLabel({ title: '页面标题', url: 'https://a.com' })).toBe('页面标题')
  })

  it('无标题时回退主机名并去掉 www', () => {
    expect(tabDisplayLabel({ title: null, url: 'https://www.example.com/x' })).toBe('example.com')
  })

  it('空白页显示「新标签页」', () => {
    expect(tabDisplayLabel({ title: null, url: 'about:blank' })).toBe('新标签页')
    expect(tabDisplayLabel({ title: null, url: null })).toBe('新标签页')
  })
})

describe('BROWSER_VIEWPORT_PRESETS', () => {
  it('首个预设是适应窗口且无固定尺寸', () => {
    const fit = BROWSER_VIEWPORT_PRESETS.find((preset) => preset.id === VIEWPORT_FIT_ID)
    expect(fit).toBeDefined()
    expect(fit?.width).toBeUndefined()
    expect(fit?.height).toBeUndefined()
  })

  it('其余预设均带尺寸', () => {
    for (const preset of BROWSER_VIEWPORT_PRESETS) {
      if (preset.id === VIEWPORT_FIT_ID) continue
      expect(preset.width).toBeGreaterThan(0)
      expect(preset.height).toBeGreaterThan(0)
    }
  })
})

describe('MAX_BROWSER_TABS', () => {
  it('上限为正整数', () => {
    expect(Number.isInteger(MAX_BROWSER_TABS)).toBe(true)
    expect(MAX_BROWSER_TABS).toBeGreaterThan(0)
  })
})
