import { describe, expect, it } from 'vitest'
import {
  PROVIDER_PRESETS,
  PROVIDER_PROMOS,
  VENDOR_CATALOG,
  assertProviderAssetsConsistency,
  getPresetsByVendor,
  getProviderPromoByVendor,
  getUniqueVendorIds,
  getVendorMeta,
} from '../index.js'

describe('orcarouter promo templates', () => {
  it('ranks orcarouter as the first template vendor', () => {
    expect(getUniqueVendorIds()[0]).toBe('orcarouter')
  })

  it('derives vendor apiKeyUrl and banner switch target from the promo config', () => {
    const promo = getProviderPromoByVendor('orcarouter')
    // 密钥表单「获取密钥」链接与横幅「一键使用」目标都由 promo 单一配置源派生
    expect(promo?.apiKeyUrl).toBe('https://www.orcarouter.ai/console/token')
    expect(promo?.primaryPresetId).toBe('orcarouter-anthropic')
    expect(getVendorMeta('orcarouter')?.apiKeyUrl).toBe(promo?.apiKeyUrl)
    // 一键切换目标必须是真实存在的模板 id，防止配置漂移后按钮点击落空
    expect(PROVIDER_PRESETS.some((p) => p.id === promo?.primaryPresetId)).toBe(true)
  })

  it('derives dual-protocol presets from the promo config', () => {
    const presets = getPresetsByVendor('orcarouter')
    expect(presets.map((p) => p.id)).toEqual(['orcarouter-anthropic', 'orcarouter-openai'])
    const promo = getProviderPromoByVendor('orcarouter')
    expect(promo?.freeModels).toEqual(['orcarouter/free', 'qwen/qwen3.8-27b-free', 'tencent/hy3-free'])
    for (const preset of presets) {
      expect(preset.modelIds).toEqual(promo?.freeModels)
      expect(preset.defaultModel).toBe(promo?.freeModels[0])
      expect(preset.sourceUrls).toEqual([promo?.docsUrl])
    }
    expect(presets.find((p) => p.provider === 'anthropic')?.apiEndpoint).toBe(
      'https://api.orcarouter.ai',
    )
    expect(presets.find((p) => p.provider === 'openai')?.apiEndpoint).toBe(
      'https://api.orcarouter.ai/v1',
    )
  })

  it('keeps provider assets consistent after insertion', () => {
    // master 既有断链（unicom-aisp-anthropic 引用不存在的 vendor），非本次引入，只校验 orcarouter 无新增问题
    const issues = (assertProviderAssetsConsistency() ?? []).filter((issue) =>
      issue.includes('orcarouter'),
    )
    expect(issues).toEqual([])
    expect(PROVIDER_PROMOS.length).toBeGreaterThan(0)
    expect(PROVIDER_PRESETS[0]?.vendorId).toBe('orcarouter')
  })
})
