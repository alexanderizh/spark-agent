/**
 * @module provider-vendor-hints
 *
 * 自定义供应商的品牌图标关键词推断（名称 → 模型 ID 两级）。
 *
 * 背景：自定义供应商此前只按 name 在 VENDOR_CATALOG 里做精确/包含匹配，
 * 名称里不含品牌名的自建供应商（网关聚合站、中转站等）命中不了任何条目：
 *   - 模型选择器（ComposerV2 resolveProviderVendor）会一路落到协议兜底——
 *     anthropic 协议的自定义供应商全部被画成 Anthropic「A\」标，无法区分；
 *   - 设置页（ProvidersView guessVendorByName）则退到字母占位。
 *
 * 这里按固定优先级做关键词推断，返回对齐 ProviderLogo VENDOR_AVATAR_MAP 的
 * 品牌 vendor。名称命中优先于模型命中；模型按 modelIds 顺序逐个匹配。推断只
 * 补「更像哪个品牌」的图标，不改变供应商本身的任何行为。
 */

import type { VendorMeta } from '@spark/protocol'

type VendorHint = {
  /** 小写不敏感的子串关键词（中文原样比较） */
  keywords: string[]
  /** 对齐 VENDOR_AVATAR_MAP 的品牌 id，emoji/color 仅作映射未命中时的兜底绘制 */
  vendor: VendorMeta
}

/** 关键词 → 品牌（顺序即优先级：具体品牌在前，通用协议品牌在后） */
const KEYWORD_VENDOR_HINTS: VendorHint[] = [
  {
    keywords: ['deepseek'],
    vendor: { id: 'deepseek-api', name: 'DeepSeek', emoji: 'DS', color: '#4d6bfe', desc: '', logoPath: '' },
  },
  {
    keywords: ['火山方舟', 'volcengine', 'volces', 'doubao', '豆包'],
    vendor: { id: 'volcengine', name: '火山方舟', emoji: 'VK', color: '#1a73e8', desc: '', logoPath: '' },
  },
  {
    keywords: ['智谱', 'zhipu', 'chatglm', 'glm'],
    vendor: { id: 'zhipu-glm-coding-plan', name: '智谱', emoji: 'ZG', color: '#3859ff', desc: '', logoPath: '' },
  },
  {
    keywords: ['kimi', 'moonshot', '月之暗面'],
    vendor: { id: 'kimi', name: 'Kimi', emoji: 'K', color: '#111111', desc: '', logoPath: '' },
  },
  {
    keywords: ['minimax', 'hailuo', '海螺'],
    vendor: { id: 'minimax', name: 'MiniMax', emoji: 'MM', color: '#6c5ce7', desc: '', logoPath: '' },
  },
  {
    keywords: ['qwen', 'qwq', '通义', '千问'],
    vendor: { id: 'qwen-tongyi', name: '通义千问', emoji: 'QW', color: '#615ced', desc: '', logoPath: '' },
  },
  {
    keywords: ['siliconflow', 'siliconcloud', '硅基'],
    vendor: { id: 'siliconflow', name: '硅基流动', emoji: 'SF', color: '#7c3aed', desc: '', logoPath: '' },
  },
  {
    keywords: ['iflytek', 'xfyun', '讯飞'],
    vendor: { id: 'xfyun', name: '讯飞', emoji: 'XF', color: '#0f6cff', desc: '', logoPath: '' },
  },
  {
    keywords: ['hunyuan', '混元', 'tencent'],
    vendor: { id: 'tencent-coding-plan', name: '腾讯', emoji: 'TC', color: '#0052d9', desc: '', logoPath: '' },
  },
  {
    keywords: ['ernie', 'qianfan', '百度', 'baidu'],
    vendor: { id: 'baidu', name: '百度', emoji: 'BD', color: '#2932e1', desc: '', logoPath: '' },
  },
  {
    keywords: ['gemini'],
    vendor: { id: 'google-gemini', name: 'Gemini', emoji: 'GM', color: '#1c69ff', desc: '', logoPath: '' },
  },
  {
    keywords: ['claude', 'anthropic'],
    vendor: { id: 'claude', name: 'Claude', emoji: 'C', color: '#d4a574', desc: '', logoPath: '' },
  },
  {
    keywords: ['gpt', 'openai', 'oai'],
    vendor: { id: 'openai', name: 'OpenAI', emoji: 'OA', color: '#10a37f', desc: '', logoPath: '' },
  },
]

function withDisplayName(vendor: VendorMeta, displayName: string | undefined): VendorMeta {
  return { ...vendor, name: displayName?.trim() || vendor.name }
}

function matchHint(text: string): VendorHint | null {
  if (!text) return null
  const lowered = text.toLowerCase()
  for (const hint of KEYWORD_VENDOR_HINTS) {
    if (hint.keywords.some((k) => lowered.includes(k))) return hint
  }
  return null
}

/**
 * 推断自定义供应商的品牌图标 vendor。
 *
 * @param name      供应商展示名（如「火山方舟 Coding Plan」）；名称命中优先
 * @param modelIds  模型 ID 列表（如 ['glm-5.3-flash']）；按顺序逐个匹配
 * @returns 命中返回品牌 vendor（保留用户展示名），无命中返回 null（调用方
 *          继续走协议兜底/首字母兜底）
 */
export function resolveVendorByKeywordHints(
  name: string | undefined | null,
  modelIds: readonly string[] | undefined,
): VendorMeta | null {
  const byName = matchHint(name ?? '')
  if (byName) return withDisplayName(byName.vendor, name ?? undefined)
  for (const modelId of modelIds ?? []) {
    const byModel = matchHint(modelId)
    if (byModel) return withDisplayName(byModel.vendor, name ?? undefined)
  }
  return null
}
