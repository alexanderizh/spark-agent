import type { CanvasMediaModelSummary, CanvasMediaTaskInputFile } from '@spark/protocol'
import type { CanvasTask } from './canvas.types'

type CanvasTaskInputRole = NonNullable<CanvasMediaTaskInputFile['role']>
type CanvasTaskInputRoleSelection = CanvasTaskInputRole | CanvasTaskInputRole[]

export function buildOperationPanelRunInputNodeIds(input: {
  selectedInputNodeIds: string[]
  explicitFrameNodeIds: string[]
  textInputNodeIds: string[]
  supportsVideoFrameRoles: boolean
  mediaInputOptions: Array<{ value: string; type: string }>
}): string[] {
  const explicitFrameSet = new Set(input.explicitFrameNodeIds)
  const mediaTypeById = new Map(input.mediaInputOptions.map((item) => [item.value, item.type]))
  const selectedIds = input.supportsVideoFrameRoles
    ? input.selectedInputNodeIds.filter((id) => {
        const type = mediaTypeById.get(id)
        return type !== 'image' || explicitFrameSet.has(id)
      })
    : input.selectedInputNodeIds
  return Array.from(
    new Set([...selectedIds, ...input.explicitFrameNodeIds, ...input.textInputNodeIds]),
  )
}

export function buildVideoFrameInputRoles(
  imageNodeIds: string[],
  firstFrameNodeId: string,
  lastFrameNodeId: string,
  referenceFrameNodeIds: string[],
): Record<string, CanvasTaskInputRoleSelection> {
  const roles: Record<string, CanvasTaskInputRoleSelection> = {}
  const referenceIds = new Set(referenceFrameNodeIds)
  const addRole = (nodeId: string, role: CanvasTaskInputRole) => {
    const current = roles[nodeId]
    if (!current) {
      roles[nodeId] = role
      return
    }
    const currentList = Array.isArray(current) ? current : [current]
    if (!currentList.includes(role)) roles[nodeId] = [...currentList, role]
  }
  for (const nodeId of imageNodeIds) {
    if (nodeId === firstFrameNodeId) addRole(nodeId, 'first_frame')
    if (nodeId === lastFrameNodeId) addRole(nodeId, 'last_frame')
    if (referenceIds.has(nodeId)) addRole(nodeId, 'reference')
  }
  return roles
}

export function mergeDefaultReferenceFrameNodeIds(
  currentIds: string[],
  defaultImageNodeIds: string[],
  candidateNodeIds: string[],
): string[] {
  const candidateSet = new Set(candidateNodeIds)
  const result: string[] = []
  const push = (id: string) => {
    if (!id || !candidateSet.has(id) || result.includes(id)) return
    result.push(id)
  }
  for (const id of currentIds) push(id)
  for (const id of defaultImageNodeIds) push(id)
  return sameIdList(result, currentIds) ? currentIds : result
}

function sameIdList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function modelPrefersBase64Input(
  model: CanvasMediaModelSummary | null | undefined,
): boolean {
  return model?.providerKind === 'xai' || model?.providerKind === 'agnes'
}

export function normalizeVideoFrameNodeIds(
  firstFrameNodeId: string,
  lastFrameNodeId: string,
  referenceFrameNodeIds: string[],
): string[] {
  const result: string[] = []
  const push = (id: string) => {
    if (!id || result.includes(id)) return
    result.push(id)
  }
  push(firstFrameNodeId)
  push(lastFrameNodeId)
  for (const id of referenceFrameNodeIds) push(id)
  return result
}

export function operationStatusLabel(status: CanvasTask['status']): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'running') return '运行中'
  return '待提交'
}
