import { describe, expect, it } from 'vitest'
import { mergeCanvasTrackedWorkflowDiagnostics } from './canvasTrackedWorkflowDiagnostics'

describe('canvasTrackedWorkflowDiagnostics', () => {
  it('preserves the model output while later diagnostics add an error response', () => {
    expect(
      mergeCanvasTrackedWorkflowDiagnostics(
        { modelOutputText: '{"characters":[]}', modelId: 'model-a' },
        { rawResponse: { requestId: 'req-1' } },
      ),
    ).toEqual({
      modelOutputText: '{"characters":[]}',
      modelId: 'model-a',
      rawResponse: { requestId: 'req-1' },
    })
  })
})
