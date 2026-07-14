import { describe, expect, it } from 'vitest'
import { buildCanvasTaskDetailParams, summarizeCanvasTaskInputFiles } from './canvasTaskInputDiagnostics'

describe('canvasTaskInputDiagnostics', () => {
  it('summarizes base64 image inputs with transport and format', () => {
    expect(
      summarizeCanvasTaskInputFiles([
        {
          type: 'image',
          role: 'reference',
          dataUrl: 'data:image/png;base64,AAECAwQF',
        },
      ]),
    ).toEqual([
      {
        type: 'image',
        role: 'reference',
        payloadField: 'dataUrl',
        transport: 'base64_data_url',
        mimeType: 'image/png',
        format: 'png',
        valuePreview: 'data:image/png;base64,AAECAwQF',
      },
    ])
  })

  it('summarizes safe-file inputs with URL payload and inferred format', () => {
    expect(
      summarizeCanvasTaskInputFiles([
        {
          type: 'image',
          role: 'first_frame',
          url: 'safe-file://x/canvas-input.webp',
        },
      ]),
    ).toEqual([
      {
        type: 'image',
        role: 'first_frame',
        payloadField: 'url',
        transport: 'safe_file_url',
        format: 'webp',
        valuePreview: 'safe-file://x/canvas-input.webp',
      },
    ])
  })

  it('merges input diagnostics into task detail params', () => {
    expect(
      buildCanvasTaskDetailParams({
        modelParams: { size: '2:1', resolution: '2k' },
        inputFileDiagnostics: [
          {
            type: 'image',
            payloadField: 'dataUrl',
            transport: 'base64_data_url',
            mimeType: 'image/png',
            format: 'png',
            valuePreview: 'data:image/png;base64,AAECAwQF',
          },
        ],
      }),
    ).toEqual({
      size: '2:1',
      resolution: '2k',
      _requestInputFiles: [
        {
          type: 'image',
          payloadField: 'dataUrl',
          transport: 'base64_data_url',
          mimeType: 'image/png',
          format: 'png',
          valuePreview: 'data:image/png;base64,AAECAwQF',
        },
      ],
    })
  })
})
