import type { ComputerObservation } from '@spark/protocol'
import { describe, expect, it } from 'vitest'
import {
  TREE_SUFFICIENT_MIN_ELEMENTS,
  isTreeSufficient,
} from './ComputerTreeSufficiency.js'

function observation(overrides: {
  elementCount?: number
  text?: string
}): ComputerObservation {
  const elementCount = overrides.elementCount ?? 0
  return {
    frameId: 'frame-1',
    treeVersion: 'tree-1',
    capturedAt: '2026-10-01T00:00:00.000Z',
    display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 2 },
    foreground: {
      app: { id: 'app-1', name: 'SparkWork' },
      window: {
        id: 'window-1',
        title: 'SparkWork',
        bounds: { x: 0, y: 0, width: 1200, height: 800 },
      },
    },
    screenshot: { snapshotId: 'snapshot-1', width: 1200, height: 800 },
    tree: { mode: 'full', text: overrides.text ?? '- window "SparkWork" [1]', elementCount },
    elements: [],
    loading: false,
    sensitiveRegions: [],
  }
}

describe('isTreeSufficient', () => {
  it('accepts a real tree once the element count passes the shell budget', () => {
    expect(isTreeSufficient(observation({ elementCount: TREE_SUFFICIENT_MIN_ELEMENTS }))).toBe(
      true,
    )
    expect(
      isTreeSufficient(observation({ elementCount: TREE_SUFFICIENT_MIN_ELEMENTS - 1 })),
    ).toBe(false)
  })

  it('rejects a Chromium window shell that is still building, regardless of count', () => {
    // Measured failure shape: the pendingNotice prepended to a still-building
    // Electron tree. A tree that crossed the element threshold purely through
    // native chrome while the web content is missing must stay vision-first.
    expect(
      isTreeSufficient({
        ...observation({ elementCount: 400 }),
        tree: {
          mode: 'full',
          text: '[accessibility: this Chromium app is still building its web-content tree — only the window shell is shown; observe again in a moment]\n- window "SparkWork" [1]',
          elementCount: 400,
        },
      }),
    ).toBe(false)
  })

  it('rejects the OCR fallback tree', () => {
    expect(
      isTreeSufficient({
        ...observation({ elementCount: 0 }),
        tree: {
          mode: 'full',
          text: '[accessibility tree unavailable: some reason; this is OCR text with no element ids — use coordinates]\nsome OCR text',
          elementCount: 0,
        },
      }),
    ).toBe(false)
  })
})
