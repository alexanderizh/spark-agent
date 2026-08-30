// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import type { SchemaField } from './canvasParameterPresentation'
import {
  CANVAS_MODEL_PARAMETER_PREFERENCES_KEY,
  canvasModelMatchesPersistedIdentity,
  canvasModelParameterPreferenceKey,
  readCanvasModelParameterPreferences,
  writeCanvasModelParameterPreferences,
} from './canvasModelParameterPreferences'

const fields: SchemaField[] = [
  {
    name: 'quality',
    title: '质量',
    type: 'string',
    enumValues: ['auto', 'high'],
  },
  {
    name: 'n',
    title: '数量',
    type: 'integer',
    enumValues: [],
    minimum: 1,
    maximum: 4,
  },
]

function model(
  providerProfileId: string,
  effectiveModelId = 'gpt-image-1',
): CanvasMediaModelSummary {
  return {
    providerProfileId,
    providerKind: 'openai',
    providerName: providerProfileId,
    manifestId: 'openai:gpt-image-1',
    modelId: effectiveModelId,
    effectiveModelId,
    displayName: effectiveModelId,
    domains: ['image'],
    invocationMode: 'sync',
    capabilities: [],
    sourceUrls: [],
    enabled: true,
  }
}

describe('canvas model parameter preferences', () => {
  beforeEach(() => window.localStorage.clear())

  it('restores compatible parameter choices for the same channel and model', () => {
    const key = canvasModelParameterPreferenceKey(model('provider-a'))
    writeCanvasModelParameterPreferences(key, fields, { quality: 'high', n: '3' })

    expect(readCanvasModelParameterPreferences(key, fields)).toEqual({
      quality: 'high',
      n: '3',
    })
  })

  it('isolates the same model between provider channels', () => {
    const firstKey = canvasModelParameterPreferenceKey(model('provider-a'))
    const secondKey = canvasModelParameterPreferenceKey(model('provider-b'))
    writeCanvasModelParameterPreferences(firstKey, fields, { quality: 'high', n: '2' })

    expect(readCanvasModelParameterPreferences(secondKey, fields)).toEqual({})
  })

  it('drops cached values that no longer satisfy the current model schema', () => {
    const key = canvasModelParameterPreferenceKey(model('provider-a'))
    window.localStorage.setItem(
      CANVAS_MODEL_PARAMETER_PREFERENCES_KEY,
      JSON.stringify({ [key]: { quality: 'ultra', n: '8' } }),
    )

    expect(readCanvasModelParameterPreferences(key, fields)).toEqual({})
  })

  it('matches persisted task identity using every available identity field', () => {
    const selected = model('provider-a')
    expect(
      canvasModelMatchesPersistedIdentity(selected, {
        providerProfileId: 'provider-a',
        modelId: 'gpt-image-1',
      }),
    ).toBe(true)
    expect(
      canvasModelMatchesPersistedIdentity(selected, {
        providerProfileId: 'provider-b',
        modelId: 'gpt-image-1',
      }),
    ).toBe(false)
  })
})
