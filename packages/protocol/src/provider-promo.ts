/**
 * Provider 推广配置 — 模板卡片 free 标签 / 引导页与渠道管理页横幅的单一数据源。
 *
 * 运营位的链接、文案、免费模型列表后续可能更换：所有展示端（ProvidersView、
 * OnboardingView、模板目录卡片）一律从本配置读取，不在 UI 内散落硬编码；
 * provider-presets.ts 中对应模板的 modelIds 也由此派生，保证列表只有一处定义。
 */

export interface ProviderPromo {
  /** 推广位 id（唯一即可，与 vendorId 不必相同） */
  id: string
  /** 关联的 VENDOR_CATALOG vendor id */
  vendorId: string
  /** 模板卡片右上角小标签文案（如 "free"）；为空则不渲染标签 */
  badge: string
  /** 注册 / 官网入口（可携带推荐参数），模板卡片外链按钮与横幅共用 */
  registerUrl: string
  /** 官方文档地址（写入模板 sourceUrls） */
  docsUrl: string
  /** 免费模型列表：写入模板 modelIds，横幅提示也据此描述 */
  freeModels: string[]
  /** 横幅简短提示文案（保持一行，横幅设计为小体积提示条） */
  bannerText: string
  /** 横幅跳转按钮文案 */
  bannerCta: string
  /** 该渠道 API Key 控制台地址（派生到 VendorMeta.apiKeyUrl，密钥表单「获取密钥」链接用） */
  apiKeyUrl: string
  /** 一键切换目标模板 id（横幅「一键使用」按钮选中该预设）；展示端未传切换回调时不渲染按钮 */
  primaryPresetId: string
  /** 横幅「一键使用」按钮文案 */
  selectCta: string
}

export const PROVIDER_PROMOS: ProviderPromo[] = [
  {
    id: 'orcarouter-free',
    vendorId: 'orcarouter',
    badge: 'free',
    registerUrl: 'https://www.orcarouter.ai/ref/ref_a8c3f476f91204cf83ac',
    docsUrl: 'https://docs.orcarouter.ai/introduction',
    freeModels: ['orcarouter/free', 'qwen/qwen3.8-27b-free', 'tencent/hy3-free'],
    bannerText: 'OrcaRouter 提供免费模型（Qwen / Hunyuan 等），注册即可使用',
    bannerCta: '免费注册',
    apiKeyUrl: 'https://www.orcarouter.ai/console/token',
    primaryPresetId: 'orcarouter-anthropic',
    selectCta: '切换到OrcaRouter',
  },
]

export function getProviderPromoByVendor(vendorId: string): ProviderPromo | undefined {
  return PROVIDER_PROMOS.find((promo) => promo.vendorId === vendorId)
}
