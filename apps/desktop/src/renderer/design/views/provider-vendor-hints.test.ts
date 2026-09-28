import { describe, expect, it } from 'vitest'
import { resolveVendorByKeywordHints } from './provider-vendor-hints'

describe('resolveVendorByKeywordHints', () => {
  it('matches vendor by provider name (case-insensitive) and keeps the display name', () => {
    const meta = resolveVendorByKeywordHints('火山方舟 Coding Plan', [])
    expect(meta?.id).toBe('volcengine')
    expect(meta?.name).toBe('火山方舟 Coding Plan')

    const deepseek = resolveVendorByKeywordHints('DeepSeek API', [])
    expect(deepseek?.id).toBe('deepseek-api')
    expect(deepseek?.name).toBe('DeepSeek API')
  })

  it('falls back to model id keywords when the name has no hit', () => {
    const meta = resolveVendorByKeywordHints('我的中转站', ['my-proxy', 'deepseek-chat'])
    expect(meta?.id).toBe('deepseek-api')
    expect(meta?.name).toBe('我的中转站')
  })

  it('prefers name hit over model hit', () => {
    const meta = resolveVendorByKeywordHints('OpenAI 专属', ['glm-5.3-flash'])
    expect(meta?.id).toBe('openai')
  })

  it('orders specific brands before generic protocol brands', () => {
    const meta = resolveVendorByKeywordHints('智谱 GLM Coding Plan', [])
    expect(meta?.id).toBe('zhipu-glm-coding-plan')
  })

  it('returns null when neither name nor models hint a brand', () => {
    expect(resolveVendorByKeywordHints('我的中转站', ['my-model-1', 'chat-mini'])).toBeNull()
  })

  it('tolerates empty inputs', () => {
    expect(resolveVendorByKeywordHints(null, undefined)).toBeNull()
    expect(resolveVendorByKeywordHints('', [])).toBeNull()
    expect(resolveVendorByKeywordHints(undefined, [''])).toBeNull()
  })
})
