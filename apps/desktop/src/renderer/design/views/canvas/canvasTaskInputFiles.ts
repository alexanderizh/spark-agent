import type { CanvasMediaTaskInputFile } from '@spark/protocol'
import type { CanvasNode } from './canvas.types'

export type CanvasTaskInputRole = NonNullable<CanvasMediaTaskInputFile['role']>
export type CanvasTaskInputRoleSelection = CanvasTaskInputRole | CanvasTaskInputRole[]

export function buildTaskInputFiles(
  nodes: CanvasNode[],
  inputRoles?: Record<string, CanvasTaskInputRoleSelection>,
): CanvasMediaTaskInputFile[] {
  let imageIndex = 0
  return nodes.flatMap((node) => {
    const url = node.data.url
    if (!url) return []
    const type =
      node.type === 'image'
        ? ('image' as const)
        : node.type === 'audio'
          ? ('audio' as const)
          : node.type === 'video'
            ? ('video' as const)
            : ('file' as const)
    const currentImageIndex = node.type === 'image' ? imageIndex++ : -1
    const explicitRoles = normalizeCanvasTaskInputRoleSelection(inputRoles?.[node.id])
    const roles =
      explicitRoles.length > 0
        ? explicitRoles
        : [
            currentImageIndex >= 0
              ? currentImageIndex === 0
                ? ('first_frame' as const)
                : currentImageIndex === 1
                  ? ('last_frame' as const)
                  : ('reference' as const)
              : ('input' as const),
          ]
    return roles.map((role) => ({
      type,
      role,
      ...(url.startsWith('data:') ? { dataUrl: url } : { url }),
      ...(node.data.mimeType ? { mimeType: node.data.mimeType } : {}),
    }))
  })
}

export function normalizeCanvasTaskInputRoleSelection(
  selection: CanvasTaskInputRoleSelection | undefined,
): CanvasTaskInputRole[] {
  if (!selection) return []
  const values = Array.isArray(selection) ? selection : [selection]
  return Array.from(new Set(values.filter(Boolean)))
}

export function buildReferenceImageInputRoles(
  imageNodeIds: readonly string[],
): Record<string, CanvasTaskInputRoleSelection> {
  const roles: Record<string, CanvasTaskInputRoleSelection> = {}
  for (const nodeId of imageNodeIds) {
    if (nodeId) roles[nodeId] = 'reference'
  }
  return roles
}
