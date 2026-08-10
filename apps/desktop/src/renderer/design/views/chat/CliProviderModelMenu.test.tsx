import type { ProviderProfile } from '@spark/protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CliProviderModelMenu } from './CliProviderModelMenu'

function provider(overrides: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: 'provider',
    name: 'Provider',
    provider: 'openai',
    defaultModel: 'model',
    modelIds: ['model'],
    keystoreRef: 'test-key',
    isDefault: false,
    createdAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  }
}

describe('CliProviderModelMenu', () => {
  it('renders host and channel models in one flat menu without a nested dropdown', () => {
    const html = renderToStaticMarkup(
      <CliProviderModelMenu
        primaryProvider={provider({
          id: 'builtin:claude-cli',
          name: 'Claude CLI',
          defaultModel: 'claude-host',
          modelIds: ['claude-host'],
        })}
        primaryModelId="claude-host"
        primaryModelLabel="Claude Host"
        primarySelected
        sparkOverride={{ providerProfileId: 'spark-provider', modelId: 'claude-sonnet' }}
        providerGroups={[
          {
            provider: provider({
              id: 'spark-provider',
              name: 'Spark Provider',
              defaultModel: 'claude-sonnet',
              modelIds: ['claude-sonnet', 'claude-opus'],
            }),
            models: ['claude-sonnet', 'claude-opus'],
          },
        ]}
        disabled={false}
        isPinned={() => false}
        togglePinned={vi.fn()}
        resolveVendor={() => null}
        getModelLabel={(_provider, modelId) => `Label ${modelId}`}
        onSelectPrimaryModel={vi.fn()}
        onSelectSparkModel={vi.fn()}
        onClearSparkOverride={vi.fn()}
      />,
    )

    expect(html).toContain('使用宿主机配置')
    expect(html).toContain('Spark Provider')
    expect(html).toContain('Label claude-sonnet')
    expect(html).toContain('Label claude-opus')
    expect(html).toContain('composer-cli-model-subgroup')
    expect(html).not.toContain('composer-cli-model-submenu')
    expect(html).not.toContain('composer-cli-model-trigger-chevron')
  })
})
