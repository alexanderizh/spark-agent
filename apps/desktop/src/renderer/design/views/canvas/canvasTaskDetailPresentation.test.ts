import { describe, expect, it } from 'vitest'
import { stripDuplicateCanvasRuntimeDiagnostics } from './canvasTaskDetailPresentation'

describe('canvas task detail presentation', () => {
  it('removes output fields already rendered by authoritative sections', () => {
    expect(
      stripDuplicateCanvasRuntimeDiagnostics({
        outputText: 'raw output',
        text: 'fallback output',
        parsedEntities: [{ id: 'shot-1' }],
        provider: 'openai',
        modelCallUrl: 'https://api.example.com/v1/responses',
      }),
    ).toEqual({
      provider: 'openai',
      modelCallUrl: 'https://api.example.com/v1/responses',
    })
  })
})
