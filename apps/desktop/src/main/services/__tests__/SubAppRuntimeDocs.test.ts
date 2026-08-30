import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  putSubAppRuntimeDoc,
  releaseSubAppRuntimeDoc,
  takeSubAppRuntimeDoc,
} from '../SubAppRuntimeDocs'

/**
 * 子应用沙箱文档注册表：token 约束、覆盖登记、容量上限与 TTL 兜底。
 * 注意：模块级 Map 状态跨用例保留，TTL 用例依赖各自的时间基准。
 */

const VALID_TOKEN = 'aaaaaaaa-bbbb-cccc-dddd'

describe('SubAppRuntimeDocs', () => {
  afterEach(() => {
    releaseSubAppRuntimeDoc({ token: VALID_TOKEN })
  })

  it('rejects malformed tokens', () => {
    expect(() => putSubAppRuntimeDoc({ token: 'short', document: '<html></html>' })).toThrow()
    expect(() => putSubAppRuntimeDoc({ token: '../escape', document: '<html></html>' })).toThrow()
    expect(() =>
      putSubAppRuntimeDoc({ token: 'x'.repeat(81), document: '<html></html>' }),
    ).toThrow()
    expect(() => releaseSubAppRuntimeDoc({ token: 'bad token!' })).toThrow()
    expect(takeSubAppRuntimeDoc('bad token!')).toBeNull()
  })

  it('put then take returns the document and renews ttl', () => {
    putSubAppRuntimeDoc({ token: VALID_TOKEN, document: '<!doctype html><html></html>' })
    expect(takeSubAppRuntimeDoc(VALID_TOKEN)).toBe('<!doctype html><html></html>')
    // 重复 take 仍可取（命中续期而非消费）
    expect(takeSubAppRuntimeDoc(VALID_TOKEN)).toBe('<!doctype html><html></html>')
  })

  it('release removes the document; take misses afterwards', () => {
    putSubAppRuntimeDoc({ token: VALID_TOKEN, document: 'x' })
    releaseSubAppRuntimeDoc({ token: VALID_TOKEN })
    expect(takeSubAppRuntimeDoc(VALID_TOKEN)).toBeNull()
  })

  it('re-put overwrites the same token', () => {
    putSubAppRuntimeDoc({ token: VALID_TOKEN, document: 'v1' })
    putSubAppRuntimeDoc({ token: VALID_TOKEN, document: 'v2' })
    expect(takeSubAppRuntimeDoc(VALID_TOKEN)).toBe('v2')
  })

  it('evicts the oldest entry when capacity is exceeded', () => {
    // 伪造时间推进：最早登记的条目 TTL 过期后被逐出
    const now = Date.now()
    const realNow = Date.now
    let clock = now
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      putSubAppRuntimeDoc({ token: 'tok-00000001', document: 'oldest' })
      // 推进 1ms 保证过期时间排序在前
      clock += 1
      for (let i = 2; i <= 64; i += 1) {
        putSubAppRuntimeDoc({ token: `tok-000000${i.toString().padStart(2, '0')}`, document: 'x' })
      }
      // 第 65 个写入触发容量逐出（最旧的 tok-00000001 被清）
      putSubAppRuntimeDoc({ token: 'tok-00000065', document: 'x' })
      expect(takeSubAppRuntimeDoc('tok-00000001')).toBeNull()
      expect(takeSubAppRuntimeDoc('tok-00000065')).toBe('x')
    } finally {
      vi.spyOn(Date, 'now').mockRestore()
      for (let i = 1; i <= 65; i += 1) {
        releaseSubAppRuntimeDoc({ token: `tok-000000${i.toString().padStart(2, '0')}` })
      }
      void realNow
    }
  })
})
