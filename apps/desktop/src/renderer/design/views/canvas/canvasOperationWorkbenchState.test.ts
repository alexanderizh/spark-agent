import { describe, expect, it } from 'vitest'
import {
  createCanvasOperationWorkbenchState,
  reduceCanvasOperationWorkbenchState,
} from './canvasOperationWorkbenchState'

describe('canvas operation workbench state', () => {
  it('opens on the primary output and follows a new primary selection', () => {
    const initial = createCanvasOperationWorkbenchState(true, 1, 2)
    expect(initial).toMatchObject({ tab: 'output', runIndex: 1, outputIndex: 2 })

    expect(
      reduceCanvasOperationWorkbenchState(initial, {
        type: 'sync-primary',
        hasOutputs: true,
        runIndex: 0,
        outputIndex: 1,
      }),
    ).toMatchObject({ tab: 'output', runIndex: 0, outputIndex: 1, editingOutput: false })
  })

  it('requires explicit selection mode before tracking batch outputs', () => {
    const initial = createCanvasOperationWorkbenchState(true, 0, 0)
    const ignored = reduceCanvasOperationWorkbenchState(initial, {
      type: 'toggle-output-selection',
      outputId: 'output-a',
    })
    expect(ignored.selectedOutputIds).toEqual([])

    const selecting = reduceCanvasOperationWorkbenchState(initial, {
      type: 'toggle-selection-mode',
    })
    const selected = reduceCanvasOperationWorkbenchState(selecting, {
      type: 'toggle-output-selection',
      outputId: 'output-a',
    })
    expect(selected).toMatchObject({ selectionMode: true, selectedOutputIds: ['output-a'] })
  })

  it('clears editing and batch selection when switching runs', () => {
    const state = {
      ...createCanvasOperationWorkbenchState(true, 0, 0),
      editingOutput: true,
      selectionMode: true,
      selectedOutputIds: ['output-a'],
    }
    expect(
      reduceCanvasOperationWorkbenchState(state, { type: 'select-run', runIndex: 2 }),
    ).toMatchObject({
      runIndex: 2,
      outputIndex: 0,
      editingOutput: false,
      selectionMode: false,
      selectedOutputIds: [],
    })
  })

  it('supports selecting the whole active run and resets after deletion', () => {
    const selecting = reduceCanvasOperationWorkbenchState(
      createCanvasOperationWorkbenchState(true, 0, 0),
      { type: 'toggle-selection-mode' },
    )
    const selected = reduceCanvasOperationWorkbenchState(selecting, {
      type: 'set-output-selection',
      outputIds: ['output-a', 'output-b', 'output-a'],
    })
    expect(selected.selectedOutputIds).toEqual(['output-a', 'output-b'])

    expect(
      reduceCanvasOperationWorkbenchState(selected, { type: 'finish-output-deletion' }),
    ).toMatchObject({
      selectionMode: false,
      selectedOutputIds: [],
      editingOutput: false,
    })
  })

  it('keeps node settings available when the workbench has no outputs', () => {
    const settings = reduceCanvasOperationWorkbenchState(
      createCanvasOperationWorkbenchState(false, 0, 0),
      { type: 'select-tab', tab: 'settings' },
    )

    expect(
      reduceCanvasOperationWorkbenchState(settings, {
        type: 'sync-primary',
        hasOutputs: false,
        runIndex: 0,
        outputIndex: 0,
      }),
    ).toMatchObject({ tab: 'settings' })
  })
})
