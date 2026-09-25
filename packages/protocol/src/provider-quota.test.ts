import { describe, expect, it } from 'vitest'
import { detectProviderQuotaVendor, PROVIDER_QUOTA_VENDORS } from './provider-quota.js'

describe('detectProviderQuotaVendor', () => {
  it('按 endpoint 识别智谱渠道（anthropic / openai 预设端点均可命中）', () => {
    expect(
      detectProviderQuotaVendor({
        name: '自定义渠道',
        apiEndpoint: 'https://open.bigmodel.cn/api/anthropic',
      })?.id,
    ).toBe('zhipu')
    expect(
      detectProviderQuotaVendor({
        name: '自定义渠道',
        apiEndpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
      })?.id,
    ).toBe('zhipu')
  })

  it('endpoint 大小写不敏感', () => {
    expect(
      detectProviderQuotaVendor({ name: 'x', apiEndpoint: 'https://BIGMODEL.cn/api/x' })?.id,
    ).toBe('zhipu')
  })

  it('endpoint 缺省时按名称兜底识别', () => {
    expect(detectProviderQuotaVendor({ name: '智谱 GLM Coding Plan' })?.id).toBe('zhipu')
    expect(detectProviderQuotaVendor({ name: 'my bigmodel channel' })?.id).toBe('zhipu')
  })

  it('无关渠道返回 null', () => {
    expect(
      detectProviderQuotaVendor({ name: 'DeepSeek', apiEndpoint: 'https://api.deepseek.com' }),
    ).toBeNull()
    expect(
      detectProviderQuotaVendor({ name: '自定义', apiEndpoint: 'https://api.example.com' }),
    ).toBeNull()
    expect(detectProviderQuotaVendor({ name: '', apiEndpoint: '' })).toBeNull()
  })

  it('注册表仅含已实现适配器的厂商（当前智谱）', () => {
    expect(PROVIDER_QUOTA_VENDORS.map((v) => v.id)).toEqual(['zhipu'])
  })
})
