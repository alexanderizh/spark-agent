export const SESSION_REFERENCE_MIME = 'application/x-spark-session-reference'
export const SESSION_REFERENCE_DROP_TARGET_SELECTOR = '[data-session-reference-drop-target]'

export interface SessionReferenceDragPayload {
  sessionId: string
  title: string
  projectId?: string
  updatedAt?: string
  turnCount?: number
}

export function writeSessionReferenceDragPayload(
  dataTransfer: DataTransfer,
  payload: SessionReferenceDragPayload,
): void {
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(SESSION_REFERENCE_MIME, JSON.stringify(payload))
  dataTransfer.setData('text/plain', payload.title)
}

export function readSessionReferenceDragPayload(
  dataTransfer: DataTransfer | null,
): SessionReferenceDragPayload | null {
  if (dataTransfer == null) return null
  const raw = dataTransfer.getData(SESSION_REFERENCE_MIME)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<SessionReferenceDragPayload>
    if (typeof value.sessionId !== 'string' || value.sessionId.trim() === '') return null
    if (typeof value.title !== 'string') return null
    return {
      sessionId: value.sessionId,
      title: value.title,
      ...(typeof value.projectId === 'string' ? { projectId: value.projectId } : {}),
      ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
      ...(typeof value.turnCount === 'number' &&
      Number.isInteger(value.turnCount) &&
      value.turnCount >= 0
        ? { turnCount: value.turnCount }
        : {}),
    }
  } catch {
    return null
  }
}

export function hasSessionReferenceDrag(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer?.types.includes(SESSION_REFERENCE_MIME) === true
}

export function isSessionReferenceDropTarget(target: EventTarget | null): boolean {
  if (target == null) return false
  const closest = (target as { closest?: (selector: string) => Element | null }).closest
  return typeof closest === 'function'
    ? closest.call(target, SESSION_REFERENCE_DROP_TARGET_SELECTOR) != null
    : false
}
