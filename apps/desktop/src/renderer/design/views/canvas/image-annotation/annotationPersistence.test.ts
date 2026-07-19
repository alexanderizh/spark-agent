import { describe, expect, it } from 'vitest'
import type { CanvasImageAnnotationDocument, CanvasNode } from '../canvas.types'
import {
  annotationBaseName,
  createCanvasImageAnnotationRef,
  resolveCanvasImageAnnotationDraftPath,
} from './annotationPersistence'

const sourceNode = {
  id: 'source-node',
  assetId: 'asset-1',
  title: '  测试 / image  ',
} as CanvasNode

const document = {
  schemaVersion: 1,
  artboard: {
    width: 1200,
    height: 900,
    background: '#ffffff',
    padding: { top: 32, right: 64, bottom: 32, left: 64 },
  },
  updatedAt: '2026-07-18T08:00:00.000Z',
} as CanvasImageAnnotationDocument

describe('annotationPersistence', () => {
  it('normalizes a portable annotation base name', () => {
    expect(annotationBaseName(sourceNode)).toBe('测试-image')
  })

  it('creates a compact editable-document reference', () => {
    expect(
      createCanvasImageAnnotationRef({
        documentPath: '/project/assets/annotations/draft.spark-annotation.json',
        document,
        sourceNode,
      }),
    ).toEqual({
      schemaVersion: 1,
      documentPath: '/project/assets/annotations/draft.spark-annotation.json',
      sourceNodeId: 'source-node',
      sourceAssetId: 'asset-1',
      artboard: {
        width: 1200,
        height: 900,
        background: '#ffffff',
        padding: { top: 32, right: 64, bottom: 32, left: 64 },
      },
      updatedAt: '2026-07-18T08:00:00.000Z',
    })
  })

  it('restores only an unfinished draft owned by the current node', () => {
    const draftNode = {
      ...sourceNode,
      data: {
        imageAnnotation: createCanvasImageAnnotationRef({
          documentPath: '/project/assets/annotations/draft.spark-annotation.json',
          document,
          sourceNode,
        }),
      },
    } as CanvasNode

    expect(resolveCanvasImageAnnotationDraftPath(draftNode)).toBe(
      '/project/assets/annotations/draft.spark-annotation.json',
    )
  })

  it('starts a completed result from its flattened image instead of the previous document', () => {
    const completedResult = {
      ...sourceNode,
      id: 'completed-result',
      data: {
        imageAnnotation: createCanvasImageAnnotationRef({
          documentPath: '/project/assets/annotations/completed.spark-annotation.json',
          document,
          sourceNode,
        }),
      },
    } as CanvasNode

    expect(resolveCanvasImageAnnotationDraftPath(completedResult)).toBeNull()
  })
})
