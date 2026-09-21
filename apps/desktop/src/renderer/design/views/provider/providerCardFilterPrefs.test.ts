// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_PROVIDER_CARD_FILTERS,
  PROVIDER_CARD_FILTERS_STORAGE_KEY,
  PROVIDER_CARD_SEARCH_MAX_LENGTH,
  normalizeProviderCardFilters,
  readProviderCardFilters,
  writeProviderCardFilters,
} from './providerCardFilterPrefs'

beforeEach(() => {
  window.localStorage.clear()
})

describe('normalizeProviderCardFilters', () => {
  it('空值 / 非对象输入回落默认筛选', () => {
    expect(normalizeProviderCardFilters(undefined)).toEqual(DEFAULT_PROVIDER_CARD_FILTERS)
    expect(normalizeProviderCardFilters(null)).toEqual(DEFAULT_PROVIDER_CARD_FILTERS)
    expect(normalizeProviderCardFilters('bad')).toEqual(DEFAULT_PROVIDER_CARD_FILTERS)
    expect(normalizeProviderCardFilters(42)).toEqual(DEFAULT_PROVIDER_CARD_FILTERS)
  })

  it('合法值原样保留（搜索关键字不 trim，保留空格与大小写）', () => {
    expect(
      normalizeProviderCardFilters({
        search: ' Volc ',
        kind: 'image',
        enabled: 'disabled',
        sortBy: 'nameDesc',
      }),
    ).toEqual({ search: ' Volc ', kind: 'image', enabled: 'disabled', sortBy: 'nameDesc' })
  })

  it('非法枚举值逐字段回落默认值，不影响其他字段', () => {
    expect(
      normalizeProviderCardFilters({ search: 'kimi', kind: 'nope', enabled: 'yes', sortBy: 'x' }),
    ).toEqual({ ...DEFAULT_PROVIDER_CARD_FILTERS, search: 'kimi' })
  })

  it('非字符串搜索关键字回落空串', () => {
    expect(normalizeProviderCardFilters({ search: 123 }).search).toBe('')
    expect(normalizeProviderCardFilters({ search: null }).search).toBe('')
  })

  it('超长搜索关键字被截断，避免脏数据写爆 localStorage', () => {
    const long = 'a'.repeat(PROVIDER_CARD_SEARCH_MAX_LENGTH + 50)
    expect(normalizeProviderCardFilters({ search: long }).search).toHaveLength(
      PROVIDER_CARD_SEARCH_MAX_LENGTH,
    )
  })

  it('历史缓存中残留的 router 类别回落全部类型（旧路由卡已下线）', () => {
    expect(normalizeProviderCardFilters({ kind: 'router' }).kind).toBe('all')
  })
})

describe('provider 卡片筛选缓存读写', () => {
  const filters = { search: 'gemini', kind: 'text', enabled: 'enabled', sortBy: 'nameAsc' } as const

  it('无缓存时返回默认值', () => {
    expect(readProviderCardFilters()).toEqual(DEFAULT_PROVIDER_CARD_FILTERS)
  })

  it('写入后可原样读回', () => {
    writeProviderCardFilters({ ...filters })
    expect(
      JSON.parse(window.localStorage.getItem(PROVIDER_CARD_FILTERS_STORAGE_KEY) ?? ''),
    ).toEqual(filters)
    expect(readProviderCardFilters()).toEqual(filters)
  })

  it('历史缓存缺字段时按字段回落默认值', () => {
    window.localStorage.setItem(
      PROVIDER_CARD_FILTERS_STORAGE_KEY,
      JSON.stringify({ search: 'kimi' }),
    )
    expect(readProviderCardFilters()).toEqual({ ...DEFAULT_PROVIDER_CARD_FILTERS, search: 'kimi' })
  })

  it('缓存损坏（非法 JSON / 非对象）时回落默认值且不抛错', () => {
    window.localStorage.setItem(PROVIDER_CARD_FILTERS_STORAGE_KEY, '{not-json')
    expect(readProviderCardFilters()).toEqual(DEFAULT_PROVIDER_CARD_FILTERS)

    window.localStorage.setItem(PROVIDER_CARD_FILTERS_STORAGE_KEY, '"plain-string"')
    expect(readProviderCardFilters()).toEqual(DEFAULT_PROVIDER_CARD_FILTERS)
  })

  it('localStorage 抛错时读取回落默认值、写入静默忽略', () => {
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(readProviderCardFilters()).toEqual(DEFAULT_PROVIDER_CARD_FILTERS)
    getItem.mockRestore()

    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => writeProviderCardFilters({ ...filters })).not.toThrow()
    setItem.mockRestore()
  })
})
