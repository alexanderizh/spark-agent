export type CanvasOperationWorkbenchTab = 'output' | 'history' | 'config' | 'settings'

export type CanvasOperationWorkbenchState = {
  tab: CanvasOperationWorkbenchTab
  runIndex: number
  outputIndex: number
  editingOutput: boolean
  selectionMode: boolean
  selectedOutputIds: string[]
  busy: boolean
}

export type CanvasOperationWorkbenchAction =
  | {
      type: 'sync-primary'
      hasOutputs: boolean
      runIndex: number
      outputIndex: number
    }
  | { type: 'select-tab'; tab: CanvasOperationWorkbenchTab }
  | { type: 'select-run'; runIndex: number }
  | { type: 'select-output'; outputIndex: number }
  | { type: 'toggle-editing' }
  | { type: 'toggle-selection-mode' }
  | { type: 'toggle-output-selection'; outputId: string }
  | { type: 'set-output-selection'; outputIds: string[] }
  | { type: 'finish-output-deletion' }
  | { type: 'set-busy'; busy: boolean }

export function createCanvasOperationWorkbenchState(
  hasOutputs: boolean,
  runIndex: number,
  outputIndex: number,
): CanvasOperationWorkbenchState {
  return {
    tab: hasOutputs ? 'output' : 'config',
    runIndex: Math.max(0, runIndex),
    outputIndex: Math.max(0, outputIndex),
    editingOutput: false,
    selectionMode: false,
    selectedOutputIds: [],
    busy: false,
  }
}

export function reduceCanvasOperationWorkbenchState(
  state: CanvasOperationWorkbenchState,
  action: CanvasOperationWorkbenchAction,
): CanvasOperationWorkbenchState {
  switch (action.type) {
    case 'sync-primary':
      return {
        ...state,
        tab:
          state.tab === 'config' || state.tab === 'settings'
            ? state.tab
            : action.hasOutputs
              ? 'output'
              : 'config',
        runIndex: Math.max(0, action.runIndex),
        outputIndex: Math.max(0, action.outputIndex),
        editingOutput: false,
        selectionMode: false,
        selectedOutputIds: [],
      }
    case 'select-tab':
      return {
        ...state,
        tab: action.tab,
        editingOutput: false,
        selectionMode: false,
        selectedOutputIds: [],
      }
    case 'select-run':
      return {
        ...state,
        tab: 'output',
        runIndex: Math.max(0, action.runIndex),
        outputIndex: 0,
        editingOutput: false,
        selectionMode: false,
        selectedOutputIds: [],
      }
    case 'select-output':
      return { ...state, outputIndex: Math.max(0, action.outputIndex), editingOutput: false }
    case 'toggle-editing':
      return { ...state, editingOutput: !state.editingOutput }
    case 'toggle-selection-mode':
      return {
        ...state,
        selectionMode: !state.selectionMode,
        selectedOutputIds: [],
        editingOutput: false,
      }
    case 'toggle-output-selection':
      if (!state.selectionMode) return state
      return {
        ...state,
        selectedOutputIds: state.selectedOutputIds.includes(action.outputId)
          ? state.selectedOutputIds.filter((id) => id !== action.outputId)
          : [...state.selectedOutputIds, action.outputId],
      }
    case 'set-output-selection':
      if (!state.selectionMode) return state
      return { ...state, selectedOutputIds: [...new Set(action.outputIds)] }
    case 'finish-output-deletion':
      return {
        ...state,
        selectionMode: false,
        selectedOutputIds: [],
        editingOutput: false,
      }
    case 'set-busy':
      return { ...state, busy: action.busy }
  }
}
