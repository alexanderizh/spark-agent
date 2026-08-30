import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  putHtmlRenderRuntimeDoc,
  releaseHtmlRenderRuntimeDoc,
  takeHtmlRenderRuntimeDoc,
} from '../HtmlRenderRuntimeDocs'

/**
 * HTML 渲染块沙箱文档注册表：token 约束、覆盖登记、容量上限与 TTL 兜底。
 * 与 SubAppRuntimeDocs 共用 RuntimeDocRegistry 工厂，此处覆盖域专属容量。
 * 注意：模块级 Map 状态跨用例保留，TTL 用例依赖各自的时间基准。
 */

const VALID_TOKEN = 'hr-aaaaaaaa-bbbb-cccc'

describe('HtmlRenderRuntimeDocs', () => {
  afterEach(() => {
    releaseHtmlRenderRuntimeDoc({ token: VALID_TOKEN })
  })

  it('rejects malformed tokens', () => {
    expect(() => putHtmlRenderRuntimeDoc({ token: 'short', document: '<html></html>' })).toThrow()
    expect(() =>
      putHtmlRenderRuntimeDoc({ token: '../escape', document: '<html></html>' }),
    ).toThrow()
    expect(() => releaseHtmlRenderRuntimeDoc({ token: 'bad token!' })).toThrow()
    expect(takeHtmlRenderRuntimeDoc('bad token!')).toBeNull()
  })

  it('put then take returns the document and renews ttl', () => {
    putHtmlRenderRuntimeDoc({ token: VALID_TOKEN, document: '<!doctype html><html></html>' })
    expect(takeHtmlRenderRuntimeDoc(VALID_TOKEN)).toBe('<!doctype html><html></html>')
    // 重复 take 仍可取（命中续期而非消费）
    expect(takeHtmlRenderRuntimeDoc(VALID_TOKEN)).toBe('<!doctype html><html></html>')
  })

  it('release removes the document; take misses afterwards', () => {
    putHtmlRenderRuntimeDoc({ token: VALID_TOKEN, document: 'x' })
    releaseHtmlRenderRuntimeDoc({ token: VALID_TOKEN })
    expect(takeHtmlRenderRuntimeDoc(VALID_TOKEN)).toBeNull()
  })

  it('re-put overwrites the same token', () => {
    putHtmlRenderRuntimeDoc({ token: VALID_TOKEN, document: 'v1' })
    putHtmlRenderRuntimeDoc({ token: VALID_TOKEN, document: 'v2' })
    expect(takeHtmlRenderRuntimeDoc(VALID_TOKEN)).toBe('v2')
  })

  it('evicts the oldest entry when capacity is exceeded', () => {
    const realNow = Date.now
    let clock = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      putHtmlRenderRuntimeDoc({ token: 'hr-tok-000001', document: 'oldest' })
      // 推进 1ms 保证过期时间排序在前
      clock += 1
      for (let i = 2; i <= 256; i += 1) {
        putHtmlRenderRuntimeDoc({ token: `hr-tok-${i.toString().padStart(6, '0')}`, document: 'x' })
      }
      // 第 257 个写入触发容量逐出（最旧的 hr-tok-000001 被清）
      putHtmlRenderRuntimeDoc({ token: 'hr-tok-000257', document: 'x' })
      expect(takeHtmlRenderRuntimeDoc('hr-tok-000001')).toBeNull()
      expect(takeHtmlRenderRuntimeDoc('hr-tok-000257')).toBe('x')
    } finally {
      vi.spyOn(Date, 'now').mockRestore()
      for (let i = 1; i <= 257; i += 1) {
        releaseHtmlRenderRuntimeDoc({ token: `hr-tok-${i.toString().padStart(6, '0')}` })
      }
      void realNow
    }
  })
})
