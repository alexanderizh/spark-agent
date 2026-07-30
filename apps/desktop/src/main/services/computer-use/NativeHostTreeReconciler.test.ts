import { describe, expect, it } from 'vitest'
import type { ComputerObservation } from '@spark/protocol'
import {
  reconcileObservationTree,
  reconstructFullTreeText,
} from './NativeHostTreeReconciler.js'

function rect(x: number, y: number, width = 10, height = 10) {
  return { x, y, width, height }
}

function buildObservation(overrides: {
  mode?: 'full' | 'diff'
  text?: string
  elements?: ComputerObservation['elements']
}): ComputerObservation {
  const elements = overrides.elements ?? [
    {
      id: 'element-1',
      treeVersion: 'tree-9',
      role: 'button',
      name: 'Save',
      bounds: rect(1, 2, 80, 24),
      enabled: true,
      focused: false,
      actions: ['invoke'],
    },
    {
      id: 'element-2',
      treeVersion: 'tree-9',
      role: 'textField',
      name: 'Email',
      value: 'a@b.c',
      bounds: rect(3, 4, 200, 30),
      enabled: true,
      focused: true,
      actions: ['set_value', 'focus'],
    },
  ]
  return {
    frameId: 'frame-1',
    treeVersion: 'tree-9',
    capturedAt: '2026-07-31T00:00:00.000Z',
    display: { id: 'display-1', width: 1440, height: 900, scaleFactor: 2 },
    foreground: {
      app: { id: 'app-1', name: 'Notes' },
      window: { id: 'window-1', title: 'Notes', bounds: rect(0, 0, 800, 600) },
    },
    screenshot: { snapshotId: 'snap-1', width: 800, height: 600 },
    tree: {
      mode: overrides.mode ?? 'full',
      text: overrides.text ?? '[]',
      elementCount: elements.length,
    },
    elements,
    loading: false,
    sensitiveRegions: [],
  }
}

describe('reconcileObservationTree', () => {
  it('passes a full-mode observation through unchanged', () => {
    const observation = buildObservation({ mode: 'full', text: 'host-rendered-text' })
    expect(reconcileObservationTree(observation)).toBe(observation)
  })

  it('rebuilds full text from elements and flips a diff observation to full mode', () => {
    const observation = buildObservation({
      mode: 'diff',
      text: JSON.stringify({ changed: [], removed: [] }),
    })

    const reconciled = reconcileObservationTree(observation)

    expect(reconciled.tree.mode).toBe('full')
    // Host shape: sorted keys, bounds sorted (height,width,x,y), value only when present.
    const parsed = JSON.parse(reconciled.tree.text) as Array<Record<string, unknown>>
    expect(parsed).toHaveLength(2)
    expect(Object.keys(parsed[0])).toEqual(
      ['actions', 'bounds', 'enabled', 'focused', 'id', 'name', 'role', 'treeVersion'].sort(),
    )
    expect(Object.keys(parsed[0].bounds as Record<string, unknown>)).toEqual(
      ['height', 'width', 'x', 'y'].sort(),
    )
    expect(parsed[1].value).toBe('a@b.c')
    expect(parsed[0].value).toBeUndefined()
  })

  it('preserves every non-tree field on the observation', () => {
    const observation = buildObservation({ mode: 'diff' })
    const reconciled = reconcileObservationTree(observation)
    expect(reconciled.frameId).toBe(observation.frameId)
    expect(reconciled.treeVersion).toBe(observation.treeVersion)
    expect(reconciled.elements).toBe(observation.elements)
    expect(reconciled.foreground).toEqual(observation.foreground)
    expect(reconciled.screenshot).toEqual(observation.screenshot)
    expect(reconciled.tree.elementCount).toBe(observation.tree.elementCount)
  })

  it('reconstructs an empty element list as an empty array', () => {
    const observation = buildObservation({ mode: 'diff', elements: [] })
    const reconciled = reconcileObservationTree(observation)
    expect(reconciled.tree.mode).toBe('full')
    expect(reconciled.tree.text).toBe('[]')
  })
})

describe('reconstructFullTreeText', () => {
  it('returns null if an element cannot be serialized', () => {
    const circular: unknown = { id: 'x' }
    ;(circular as Record<string, unknown>).self = circular
    // The element shape is wrong on purpose; sortKeys must throw on the cycle.
    expect(reconstructFullTreeText(circular as never)).toBeNull()
  })
})
