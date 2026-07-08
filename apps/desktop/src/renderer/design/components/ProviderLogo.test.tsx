// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

const iconMocks = vi.hoisted(() => {
  const icon = (title: string) => {
    const Icon = () => null
    Icon.Avatar = () => null
    Icon.Combine = () => null
    Icon.title = title
    return Icon
  }
  const required = [
    'Alibaba',
    'Anthropic',
    'Azure',
    'Baidu',
    'Bailian',
    'Bedrock',
    'Bfl',
    'ChatGLM',
    'Claude',
    'ClaudeCode',
    'Codex',
    'Cohere',
    'Dalle',
    'DeepSeek',
    'ElevenLabs',
    'Flux',
    'Github',
    'Gemini',
    'Google',
    'Grok',
    'Hailuo',
    'HuggingFace',
    'HuaweiCloud',
    'Ideogram',
    'IFlyTekCloud',
    'Infinigence',
    'Kling',
    'Kimi',
    'Meta',
    'Midjourney',
    'Minimax',
    'Mistral',
    'Moonshot',
    'NewAPI',
    'Ollama',
    'OpenAI',
    'OpenRouter',
    'Perplexity',
    'Pika',
    'PixVerse',
    'Qwen',
    'Replicate',
    'Runway',
    'SiliconCloud',
    'Stability',
    'StateCloud',
    'Suno',
    'Tencent',
    'TencentCloud',
    'Together',
    'Trae',
    'Udio',
    'Volcengine',
    'XAI',
    'XiaomiMiMo',
    'Zhipu',
  ]
  const entries: Array<[string, unknown]> = required.map((name) => [name, icon(name)])
  entries.push(['WrappedDefault', { default: icon('Wrapped Default') }])
  for (let i = 0; i < 220; i += 1) entries.push([`MockModel${i}`, icon(`Mock Model ${i}`)])
  return {
    icon,
    icons: Object.fromEntries(entries),
  }
})

vi.mock('@lobehub/icons/es/icons', () => iconMocks.icons)

vi.mock('@lobehub/icons/es/features/modelConfig', () => {
  const entries = Object.entries(iconMocks.icons)
  return {
    modelMappings: entries.map(([name, value]) => ({
      Icon: typeof value === 'object' && value != null && 'default' in value
        ? (value as { default: unknown }).default
        : value,
      keywords: [name],
    })),
  }
})

vi.mock('@lobehub/icons/es/features/providerConfig', () => {
  const entries = Object.entries(iconMocks.icons)
  return {
    providerMappings: entries.map(([name, value]) => ({
      Icon: typeof value === 'object' && value != null && 'default' in value
        ? (value as { default: unknown }).default
        : value,
      keywords: [name],
    })),
  }
})

describe('ProviderLogo icon catalog', () => {
  it('does not expose the brand style and normalizes legacy brand values to avatar', async () => {
    const { PROVIDER_ICON_STYLES, normalizeProviderIconConfig } = await import('./ProviderLogo')

    expect(PROVIDER_ICON_STYLES.map((item) => item.value)).toEqual(['avatar', 'mono'])
    expect(normalizeProviderIconConfig({ id: 'openai', style: 'brand' as 'avatar' })).toEqual({
      id: 'openai',
      style: 'avatar',
    })
  })

  it('loads the broad LobeHub icon catalog instead of a small hand-picked list', async () => {
    const { PROVIDER_ICON_CATALOG } = await import('./ProviderLogo')

    expect(PROVIDER_ICON_CATALOG.length).toBeGreaterThan(200)
    expect(PROVIDER_ICON_CATALOG[0]).toMatchObject({
      id: 'generic',
      label: '通用模型',
    })
    expect(PROVIDER_ICON_CATALOG.map((item) => item.id)).toEqual(
      expect.arrayContaining(['openai', 'anthropic', 'deepseek', 'gemini', 'openrouter', 'wrappeddefault']),
    )
  })

  it('keeps the built-in generic icon selectable and normalizable', async () => {
    const { normalizeProviderIconConfig } = await import('./ProviderLogo')

    expect(normalizeProviderIconConfig({ id: 'generic', style: 'avatar' })).toEqual({
      id: 'generic',
      style: 'avatar',
    })
    expect(normalizeProviderIconConfig({ id: 'generic', style: 'mono' })).toEqual({
      id: 'generic',
      style: 'mono',
    })
  })

  it('maps automatic router vendors to their own model icons', async () => {
    const { getProviderIconForVendor } = await import('./ProviderLogo')

    expect(getProviderIconForVendor('claude-auto-router')).toEqual({ id: 'claude', style: 'avatar' })
    expect(getProviderIconForVendor('codex-auto-router')).toEqual({ id: 'codex', style: 'avatar' })
  })
})
