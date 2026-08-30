import { describe, expect, it } from 'vitest'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import {
  buildCanvasModelProviderGroups,
  filterCanvasModelProviderGroups,
  mediaModelKey,
  resolveSelectedCanvasModel,
} from './canvasModelPickerModel'

function model(input: Partial<CanvasMediaModelSummary>): CanvasMediaModelSummary {
  return {
    manifestId: input.manifestId ?? 'xai:grok-imagine-1',
    providerKind: input.providerKind ?? 'xai',
    modelId: input.modelId ?? 'grok-imagine-1',
    effectiveModelId: input.effectiveModelId ?? 'grok-imagine-1',
    displayName: input.displayName ?? 'Grok Imagine 1.0',
    domains: input.domains ?? ['image'],
    invocationMode: input.invocationMode ?? 'sync',
    capabilities: input.capabilities ?? [],
    sourceUrls: input.sourceUrls ?? [],
    enabled: input.enabled ?? true,
    ...(input.providerProfileId ? { providerProfileId: input.providerProfileId } : {}),
    ...(input.providerName ? { providerName: input.providerName } : {}),
  }
}

describe('canvasModelPickerModel', () => {
  const apimartGrok = model({
    providerProfileId: 'apimart-1',
    providerName: 'APIMart',
    providerKind: 'apimart',
  })
  const apimartVeo = model({
    providerProfileId: 'apimart-1',
    providerName: 'APIMart',
    providerKind: 'apimart',
    manifestId: 'google:veo-3',
    modelId: 'veo-3',
    effectiveModelId: 'veo-3',
    displayName: 'VEO3',
    domains: ['video'],
  })
  const xaiGrok = model({
    providerProfileId: 'xai-1',
    providerName: 'xAI 官方',
    providerKind: 'xai',
  })
  const models = [apimartGrok, apimartVeo, xaiGrok]

  it('keeps the same model independent across provider profiles', () => {
    expect(mediaModelKey(apimartGrok)).not.toBe(mediaModelKey(xaiGrok))
  })

  it('groups models by provider profile and keeps provider order stable', () => {
    expect(
      buildCanvasModelProviderGroups(models).map((group) => [group.label, group.models.length]),
    ).toEqual([
      ['APIMart', 2],
      ['xAI 官方', 1],
    ])
  })

  it('searches provider names, model names, manifest ids, and effective ids', () => {
    const groups = buildCanvasModelProviderGroups(models)
    expect(
      filterCanvasModelProviderGroups(groups, 'veo')
        .flatMap((group) => group.models)
        .map((item) => item.displayName),
    ).toEqual(['VEO3'])
    expect(filterCanvasModelProviderGroups(groups, 'xAI 官方')).toHaveLength(1)
  })

  it('resolves a selected model without collapsing provider identity', () => {
    expect(resolveSelectedCanvasModel(models, mediaModelKey(xaiGrok))?.providerProfileId).toBe(
      'xai-1',
    )
  })
})
