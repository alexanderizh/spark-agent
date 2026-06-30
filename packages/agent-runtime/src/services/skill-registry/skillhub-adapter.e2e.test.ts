/**
 * SkillHubAdapter 端到端测试（无需启动 Electron）
 *
 * 覆盖：
 *   - featured(limit, 'recommended') 命中 /api/v1/showcase/recommended
 *   - featured(limit, 'hot_downloads') 命中 /api/skills?sortBy=downloads&order=desc
 *   - featured() 不传 section 时默认走 recommended
 *   - 网络错误时返回 []，不抛
 *   - categories() 返回 12 项 + '全部' 头
 *   - categories() 网络错误时返回 ['全部']
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillHubAdapter } from './skillhub-adapter.js'
import type { SkillHubShowcaseSection } from '@spark/protocol'

const ADAPTER_CONFIG = {
  registryId: 'skillhub',
  apiBaseUrl: 'https://api.skillhub.cn',
  configJson: '{}',
}

const SKILL_FIXTURE = {
  slug: 'sample-skill',
  name: 'Sample Skill',
  description: 'desc',
  version: '1.0.0',
  ownerName: 'tester',
  score: 10,
  category: 'dev-programming',
  subCategories: [{ key: 'dev-code-gen', name: '代码生成' }],
  iconUrl: 'https://example.com/icon.png',
  downloads: 100,
  stars: 5,
}

function makeShowcaseResponse(section: string) {
  return {
    section,
    skills: [
      { ...SKILL_FIXTURE, slug: `${section}-a`, name: `${section} A` },
      { ...SKILL_FIXTURE, slug: `${section}-b`, name: `${section} B` },
    ],
  }
}

const CATEGORIES_FIXTURE = {
  count: 12,
  items: [
    { key: 'office-efficiency', name: '办公效率', nameEn: 'Office Efficiency' },
    { key: 'content-creation', name: '内容创作', nameEn: 'Content Creation' },
    { key: 'dev-programming', name: '开发编程', nameEn: 'Development' },
    { key: 'data-analysis', name: '数据分析', nameEn: 'Data Analysis' },
    { key: 'design-media', name: '设计多媒体', nameEn: 'Design & Media' },
    { key: 'ai-agent', name: 'AI Agent', nameEn: 'AI Agent' },
    { key: 'knowledge-management', name: '知识管理', nameEn: 'Knowledge Management' },
    { key: 'business-ops', name: '商业运营', nameEn: 'Business Operations' },
    { key: 'education', name: '教育学习', nameEn: 'Education' },
    { key: 'professional', name: '行业专业', nameEn: 'Professional' },
    { key: 'it-ops-security', name: 'IT 运维与安全', nameEn: 'IT Ops & Security' },
    { key: 'life-service', name: '生活服务', nameEn: 'Life Service' },
  ],
}

let adapter: SkillHubAdapter

beforeEach(() => {
  adapter = new SkillHubAdapter(ADAPTER_CONFIG)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => handler(url)),
  )
}

describe('SkillHubAdapter.featured — 2 个 sub-section 路由', () => {
  it('section=recommended 命中 /api/v1/showcase/recommended', async () => {
    const seen: string[] = []
    mockFetch((url) => {
      seen.push(url)
      if (url.includes('/api/v1/showcase/recommended')) {
        return new Response(JSON.stringify(makeShowcaseResponse('recommended')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    const skills = await adapter.featured(10, 'recommended')
    expect(seen.some((u) => u.includes('/api/v1/showcase/recommended'))).toBe(true)
    expect(skills).toHaveLength(2)
    expect(skills[0]!.name).toBe('recommended A')
    expect(skills[0]!.registryId).toBe('skillhub')
  })

  it('section=hot_downloads 命中 /api/skills?sortBy=downloads&order=desc', async () => {
    const seen: string[] = []
    mockFetch((url) => {
      seen.push(url)
      if (url.includes('/api/skills') && url.includes('sortBy=downloads') && url.includes('order=desc')) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              skills: [
                { ...SKILL_FIXTURE, slug: 'hot-a', name: 'hot A' },
                { ...SKILL_FIXTURE, slug: 'hot-b', name: 'hot B' },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })
    const skills = await adapter.featured(10, 'hot_downloads')
    expect(seen.some((u) => u.includes('/api/skills') && u.includes('sortBy=downloads'))).toBe(true)
    // pageSize 应等于调用方传的 limit=10
    expect(seen.some((u) => u.includes('pageSize=10'))).toBe(true)
    expect(skills).toHaveLength(2)
    expect(skills[0]!.name).toBe('hot A')
  })

  it('不传 section 时默认走 recommended', async () => {
    const seen: string[] = []
    mockFetch((url) => {
      seen.push(url)
      if (url.includes('/api/v1/showcase/recommended')) {
        return new Response(JSON.stringify(makeShowcaseResponse('recommended')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    await adapter.featured()
    expect(seen.some((u) => u.includes('/api/v1/showcase/recommended'))).toBe(true)
  })

  it('网络失败时返回 [] 而不抛', async () => {
    mockFetch(() => {
      throw new Error('network down')
    })
    const skills = await adapter.featured(10, 'hot_downloads' as SkillHubShowcaseSection)
    expect(skills).toEqual([])
  })

  it('HTTP 5xx 时返回 [] 而不抛', async () => {
    mockFetch(() => new Response('server error', { status: 500 }))
    const skills = await adapter.featured(10, 'hot_downloads')
    expect(skills).toEqual([])
  })
})

describe('SkillHubAdapter.categories', () => {
  it('返回 12 项 + "全部" 头（每项含 key/name）', async () => {
    mockFetch((url) => {
      if (url.includes('/api/v1/categories')) {
        return new Response(JSON.stringify(CATEGORIES_FIXTURE), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    const categories = await adapter.categories()
    expect(categories[0]).toEqual({ key: 'all', name: '全部' })
    expect(categories).toHaveLength(13)
    expect(categories.map((c) => c.key)).toContain('office-efficiency')
    expect(categories.map((c) => c.key)).toContain('dev-programming')
    expect(categories.map((c) => c.key)).toContain('ai-agent')
    expect(categories.find((c) => c.key === 'office-efficiency')?.name).toBe('办公效率')
  })

  it('网络失败时返回 [{all, 全部}]', async () => {
    mockFetch(() => {
      throw new Error('offline')
    })
    const categories = await adapter.categories()
    expect(categories).toEqual([{ key: 'all', name: '全部' }])
  })
})

describe('SkillHubAdapter — category 透传到后端', () => {
  it('featured recommended 带 category 走 /api/skills?sortBy=score（showcase 接口忽略 category）', async () => {
    let capturedUrl = ''
    mockFetch((url) => {
      capturedUrl = url
      return new Response(JSON.stringify({ data: { skills: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    await adapter.featured(10, 'recommended', 'office-efficiency')
    expect(capturedUrl).toContain('/api/skills')
    expect(capturedUrl).toContain('sortBy=score')
    expect(capturedUrl).toContain('category=office-efficiency')
    // 不应再打 showcase 接口
    expect(capturedUrl).not.toContain('/api/v1/showcase/recommended')
  })

  it('featured hot_downloads 把 category 拼到 query', async () => {
    let capturedUrl = ''
    mockFetch((url) => {
      capturedUrl = url
      return new Response(JSON.stringify({ data: { skills: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    await adapter.featured(10, 'hot_downloads', 'content-creation')
    expect(capturedUrl).toContain('/api/skills')
    expect(capturedUrl).toContain('sortBy=downloads')
    expect(capturedUrl).toContain('category=content-creation')
  })

  it('featured 不传 category 时不应包含 category 参数', async () => {
    let capturedUrl = ''
    mockFetch((url) => {
      capturedUrl = url
      return new Response(JSON.stringify({ section: 'recommended', skills: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    await adapter.featured(10, 'recommended')
    expect(capturedUrl).not.toContain('category=')
  })

  it('search 关键词 + category 都打到 /api/v1/search', async () => {
    let capturedUrl = ''
    mockFetch((url) => {
      capturedUrl = url
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    await adapter.search('excel', { category: 'office-efficiency', limit: 10 })
    expect(capturedUrl).toContain('/api/v1/search')
    expect(capturedUrl).toContain('q=excel')
    expect(capturedUrl).toContain('category=office-efficiency')
  })

  it('search 无关键词 + category 走 /api/skills 并带 category', async () => {
    let capturedUrl = ''
    mockFetch((url) => {
      capturedUrl = url
      return new Response(JSON.stringify({ data: { skills: [], total: 0 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    await adapter.search('', { category: 'dev-programming', limit: 10 })
    expect(capturedUrl).toContain('/api/skills')
    expect(capturedUrl).toContain('category=dev-programming')
  })
})

describe('SkillHubAdapter URL 构造', () => {
  it('buildDownloadUrl 走 /api/v1/download?slug=', () => {
    const url = adapter.buildDownloadUrl('my-skill')
    expect(url).toBe('https://api.skillhub.cn/api/v1/download?slug=my-skill')
  })

  it('buildSkillMdUrl 带可选 version', () => {
    expect(adapter.buildSkillMdUrl('my-skill')).toBe(
      'https://api.skillhub.cn/api/v1/skills/my-skill/file?path=SKILL.md',
    )
    expect(adapter.buildSkillMdUrl('my-skill', '2.0.0')).toBe(
      'https://api.skillhub.cn/api/v1/skills/my-skill/file?path=SKILL.md&version=2.0.0',
    )
  })

  it('强制纠正历史错误 host', () => {
    const legacy = new SkillHubAdapter({
      registryId: 'skillhub',
      apiBaseUrl: 'https://skillhub.cn', // 旧库写入的网页 host（无 JSON API）
      configJson: '{}',
    })
    expect(legacy.buildDownloadUrl('x')).toBe('https://api.skillhub.cn/api/v1/download?slug=x')
  })
})
