import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type {
  CanvasInputBinding,
  CanvasInputBindingRole,
  CanvasPromptDocument,
  CanvasPromptRelation,
} from '@spark/protocol'
import type { CanvasNode } from './canvas.types'
import {
  activeCanvasInputBindings,
  addCanvasInputBinding,
  createCanvasInputBinding,
  reconcileCanvasInputBindings,
  removeCanvasInputBinding,
  removeCanvasInputBindingFromPromptDocument,
  removeCanvasInputNodeBindings,
  removeCanvasInputNodeFromPromptDocument,
} from './canvasInputBindings'

type CanvasInputBindingState = {
  document: CanvasPromptDocument
  bindings: CanvasInputBinding[]
}

export function useCanvasInputBindings(input: {
  resetKey?: string
  initialDocument: CanvasPromptDocument
  initialBindings?: readonly CanvasInputBinding[]
  nodes: readonly CanvasNode[]
  connectionNodeIds: readonly string[]
  promptOwnerNodeIdsBySourceNodeId?: ReadonlyMap<string, readonly string[]> | undefined
}) {
  const [state, setState] = useState<CanvasInputBindingState>(() => ({
    document: input.initialDocument,
    bindings: reconcileCanvasInputBindings({
      bindings: input.initialBindings ?? [],
      document: input.initialDocument,
      nodes: input.nodes,
      connectionNodeIds: input.connectionNodeIds,
      promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
    }),
  }))
  const resetKeyRef = useRef(input.resetKey)

  useEffect(() => {
    if (resetKeyRef.current !== input.resetKey) {
      resetKeyRef.current = input.resetKey
      setState({
        document: input.initialDocument,
        bindings: reconcileCanvasInputBindings({
          bindings: input.initialBindings ?? [],
          document: input.initialDocument,
          nodes: input.nodes,
          connectionNodeIds: input.connectionNodeIds,
          promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
        }),
      })
      return
    }
    setState((current) => ({
      ...current,
      bindings: reconcileCanvasInputBindings({
        bindings: current.bindings,
        document: current.document,
        nodes: input.nodes,
        connectionNodeIds: input.connectionNodeIds,
        promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
      }),
    }))
  }, [
    input.connectionNodeIds,
    input.initialBindings,
    input.initialDocument,
    input.nodes,
    input.promptOwnerNodeIdsBySourceNodeId,
    input.resetKey,
  ])

  const activeBindings = useMemo(() => activeCanvasInputBindings(state.bindings), [state.bindings])
  const selectedInputNodeIds = useMemo(
    () =>
      uniqueNodeIds(
        activeBindings.filter(
          (binding) => isMediaBinding(binding) && isDefaultMediaRole(binding.role),
        ),
      ),
    [activeBindings],
  )
  const firstFrameNodeId =
    activeBindings.find((binding) => binding.role === 'first_frame')?.sourceNodeId ?? ''
  const lastFrameNodeId =
    activeBindings.find((binding) => binding.role === 'last_frame')?.sourceNodeId ?? ''
  const referenceFrameNodeIds = useMemo(
    () =>
      uniqueNodeIds(
        activeBindings.filter(
          (binding) => binding.kind === 'image' && binding.role === 'reference',
        ),
      ),
    [activeBindings],
  )

  const setDocument = useCallback<Dispatch<SetStateAction<CanvasPromptDocument>>>(
    (action) => {
      setState((current) => {
        const document = typeof action === 'function' ? action(current.document) : action
        return {
          document,
          bindings: reconcileCanvasInputBindings({
            bindings: current.bindings,
            document,
            nodes: input.nodes,
            connectionNodeIds: input.connectionNodeIds,
            promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
          }),
        }
      })
    },
    [input.connectionNodeIds, input.nodes, input.promptOwnerNodeIdsBySourceNodeId],
  )

  const setSelectedInputNodeIds = useRoleSelectionSetter({
    setState,
    nodes: input.nodes,
    connectionNodeIds: input.connectionNodeIds,
    promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
    currentValues: selectedInputNodeIds,
    accepts: (binding) => isMediaBinding(binding) && isDefaultMediaRole(binding.role),
    roleForNode: (node) => (node.type === 'image' ? 'reference' : 'input'),
  })
  const setReferenceFrameNodeIds = useRoleSelectionSetter({
    setState,
    nodes: input.nodes,
    connectionNodeIds: input.connectionNodeIds,
    promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
    currentValues: referenceFrameNodeIds,
    accepts: (binding) => binding.kind === 'image' && binding.role === 'reference',
    roleForNode: () => 'reference',
    preservePromptMembershipOnRemove: true,
  })
  const setFirstFrameNodeId = useSingleRoleSelectionSetter({
    setState,
    nodes: input.nodes,
    connectionNodeIds: input.connectionNodeIds,
    promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
    currentValue: firstFrameNodeId,
    role: 'first_frame',
  })
  const setLastFrameNodeId = useSingleRoleSelectionSetter({
    setState,
    nodes: input.nodes,
    connectionNodeIds: input.connectionNodeIds,
    promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
    currentValue: lastFrameNodeId,
    role: 'last_frame',
  })

  const removeNode = useCallback(
    (nodeId: string) => {
      setState((current) => {
        const document = removeCanvasInputNodeFromPromptDocument(current.document, nodeId)
        return {
          document,
          bindings: reconcileCanvasInputBindings({
            bindings: removeCanvasInputNodeBindings(current.bindings, nodeId),
            document,
            nodes: input.nodes,
            connectionNodeIds: input.connectionNodeIds,
            promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
          }),
        }
      })
    },
    [input.connectionNodeIds, input.nodes, input.promptOwnerNodeIdsBySourceNodeId],
  )

  return {
    document: state.document,
    setDocument,
    bindings: state.bindings,
    selectedInputNodeIds,
    setSelectedInputNodeIds,
    firstFrameNodeId,
    setFirstFrameNodeId,
    lastFrameNodeId,
    setLastFrameNodeId,
    referenceFrameNodeIds,
    setReferenceFrameNodeIds,
    removeNode,
  }
}

function useSingleRoleSelectionSetter(input: {
  setState: Dispatch<SetStateAction<CanvasInputBindingState>>
  nodes: readonly CanvasNode[]
  connectionNodeIds: readonly string[]
  promptOwnerNodeIdsBySourceNodeId?: ReadonlyMap<string, readonly string[]> | undefined
  currentValue: string
  role: CanvasInputBindingRole
}): Dispatch<SetStateAction<string>> {
  return useCallback(
    (action) => {
      const values = typeof action === 'function' ? action(input.currentValue) : action
      updateRoleSelection(input.setState, {
        nodes: input.nodes,
        connectionNodeIds: input.connectionNodeIds,
        promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
        desiredNodeIds: values ? [values] : [],
        accepts: (binding) => binding.role === input.role,
        roleForNode: () => input.role,
      })
    },
    [input],
  )
}

function useRoleSelectionSetter(input: {
  setState: Dispatch<SetStateAction<CanvasInputBindingState>>
  nodes: readonly CanvasNode[]
  connectionNodeIds: readonly string[]
  promptOwnerNodeIdsBySourceNodeId?: ReadonlyMap<string, readonly string[]> | undefined
  currentValues: string[]
  accepts: (binding: CanvasInputBinding) => boolean
  roleForNode: (node: CanvasNode) => CanvasInputBindingRole
  preservePromptMembershipOnRemove?: boolean | undefined
}): Dispatch<SetStateAction<string[]>> {
  return useCallback(
    (action) => {
      const values = typeof action === 'function' ? action(input.currentValues) : action
      updateRoleSelection(input.setState, {
        nodes: input.nodes,
        connectionNodeIds: input.connectionNodeIds,
        promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
        desiredNodeIds: values,
        accepts: input.accepts,
        roleForNode: input.roleForNode,
        preservePromptMembershipOnRemove: input.preservePromptMembershipOnRemove,
      })
    },
    [input],
  )
}

function updateRoleSelection(
  setState: Dispatch<SetStateAction<CanvasInputBindingState>>,
  input: {
    nodes: readonly CanvasNode[]
    connectionNodeIds: readonly string[]
    promptOwnerNodeIdsBySourceNodeId?: ReadonlyMap<string, readonly string[]> | undefined
    desiredNodeIds: readonly string[]
    accepts: (binding: CanvasInputBinding) => boolean
    roleForNode: (node: CanvasNode) => CanvasInputBindingRole
    preservePromptMembershipOnRemove?: boolean | undefined
  },
) {
  setState((current) => {
    const desiredIds = new Set(input.desiredNodeIds)
    const removedBindings: CanvasInputBinding[] = []
    let bindings = current.bindings
    for (const binding of current.bindings) {
      if (!input.accepts(binding) || desiredIds.has(binding.sourceNodeId)) continue
      if (input.preservePromptMembershipOnRemove && binding.promptBlockId) {
        bindings = bindings.filter((candidate) => candidate.id !== binding.id)
        bindings = addCanvasInputBinding(
          bindings,
          createCanvasInputBinding({
            sourceNodeId: binding.sourceNodeId,
            origin: 'picker',
            kind: binding.kind,
            relation: binding.relation,
            role: 'input',
            order: binding.order,
            promptBlockId: binding.promptBlockId,
          }),
        )
        continue
      }
      bindings = removeCanvasInputBinding(bindings, binding.id)
      removedBindings.push(binding)
    }
    const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
    let document = current.document
    for (const nodeId of desiredIds) {
      const node = nodeById.get(nodeId)
      if (!node) continue
      const role = input.roleForNode(node)
      if (input.preservePromptMembershipOnRemove) {
        bindings = bindings.filter(
          (binding) => !(binding.sourceNodeId === node.id && binding.role === 'input'),
        )
      }
      const existing = bindings.find(
        (binding) => binding.sourceNodeId === node.id && (binding.role ?? 'input') === role,
      )
      if (existing?.origin === 'connection' && !input.connectionNodeIds.includes(node.id)) {
        document = removeCanvasInputBindingFromPromptDocument(document, existing)
        bindings = bindings.filter((binding) => binding.id !== existing.id)
      }
      bindings = addCanvasInputBinding(
        bindings,
        createCanvasInputBinding({
          sourceNodeId: node.id,
          origin: 'picker',
          kind: inputKindForNode(node),
          relation: relationForNodeAndRole(node, role),
          role,
          order: nextBindingOrder(bindings),
        }),
      )
      const restored = bindings.find(
        (binding) =>
          binding.sourceNodeId === node.id && (binding.role ?? 'input') === role && binding.enabled,
      )
      if (restored) {
        document = restoreCanvasInputBindingPromptDocument(document, restored)
      }
    }
    const active = activeCanvasInputBindings(bindings)
    for (const binding of removedBindings) {
      if (binding.promptBlockId) {
        document = removeCanvasInputBindingFromPromptDocument(document, binding)
        continue
      }
      if (active.some((candidate) => candidate.sourceNodeId === binding.sourceNodeId)) continue
      document = removeCanvasInputNodeFromPromptDocument(document, binding.sourceNodeId)
    }
    return {
      document,
      bindings: reconcileCanvasInputBindings({
        bindings,
        document,
        nodes: input.nodes,
        connectionNodeIds: input.connectionNodeIds,
        promptOwnerNodeIdsBySourceNodeId: input.promptOwnerNodeIdsBySourceNodeId,
      }),
    }
  })
}

function isMediaBinding(binding: CanvasInputBinding): boolean {
  return (
    binding.kind === 'image' ||
    binding.kind === 'video' ||
    binding.kind === 'audio' ||
    binding.kind === 'file'
  )
}

function isDefaultMediaRole(role: CanvasInputBinding['role']): boolean {
  return role === 'input' || role === 'reference' || role == null
}

function uniqueNodeIds(bindings: readonly CanvasInputBinding[]): string[] {
  return Array.from(new Set(bindings.map((binding) => binding.sourceNodeId)))
}

function inputKindForNode(node: CanvasNode): CanvasInputBinding['kind'] {
  if (node.type === 'image' || node.type === 'video' || node.type === 'audio') return node.type
  if (node.type === 'text' || node.type === 'prompt') return 'text'
  return 'file'
}

function relationForNodeAndRole(
  node: CanvasNode,
  role: CanvasInputBindingRole,
): CanvasPromptRelation {
  if (role === 'first_frame') return 'first_frame'
  if (role === 'last_frame') return 'last_frame'
  if (node.data.pipelineRole === 'character') return 'character'
  if (node.data.pipelineRole === 'scene') return 'scene'
  if (node.data.pipelineRole === 'prop') return 'prop'
  if (node.data.pipelineRole === 'shot') return 'storyboard'
  if (node.data.pipelineRole === 'screenplay') return 'screenplay'
  if (node.type === 'image') return 'reference_image'
  if (node.type === 'video') return 'reference_video'
  if (node.type === 'audio') return 'reference_audio'
  return 'generic'
}

function nextBindingOrder(bindings: readonly CanvasInputBinding[]): number {
  return bindings.reduce((max, binding) => Math.max(max, binding.order), -1) + 1
}

function restoreCanvasInputBindingPromptDocument(
  document: CanvasPromptDocument,
  binding: CanvasInputBinding,
): CanvasPromptDocument {
  if (!binding.promptBlockId) return document
  return {
    version: 2,
    blocks: document.blocks.map((block) => {
      if (block.id !== binding.promptBlockId || block.kind !== 'reference') return { ...block }
      const { disconnected: _disconnected, suppressed: _suppressed, ...rest } = block
      return rest
    }),
  }
}
