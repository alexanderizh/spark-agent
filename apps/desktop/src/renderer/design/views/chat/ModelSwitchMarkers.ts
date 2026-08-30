const STORAGE_KEY_PREFIX = 'spark:model-switch-markers:'

export interface ModelSwitchMarker {
  afterMessageId: string
  fromModel: string
  toModel: string
  createdAt: string
}

export function readModelSwitchMarkers(sessionId: string | null): ModelSwitchMarker[] {
  if (sessionId == null) return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isModelSwitchMarker)
  } catch {
    return []
  }
}

export function saveModelSwitchMarker(
  sessionId: string,
  marker: ModelSwitchMarker,
): ModelSwitchMarker[] {
  const existing = readModelSwitchMarkers(sessionId)
  const sameBoundaryIndex = existing.findIndex(
    (item) => item.afterMessageId === marker.afterMessageId,
  )
  const next =
    sameBoundaryIndex < 0
      ? [...existing, marker]
      : existing.map((item, index) =>
          index === sameBoundaryIndex
            ? { ...marker, fromModel: item.fromModel, createdAt: item.createdAt }
            : item,
        )
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${sessionId}`, JSON.stringify(next))
  } catch {
    // 存储不可用时仍保留本次内存态提示，不阻断模型切换。
  }
  return next
}

function isModelSwitchMarker(value: unknown): value is ModelSwitchMarker {
  if (value == null || typeof value !== 'object') return false
  const marker = value as Partial<ModelSwitchMarker>
  return (
    typeof marker.afterMessageId === 'string' &&
    typeof marker.fromModel === 'string' &&
    typeof marker.toModel === 'string' &&
    typeof marker.createdAt === 'string'
  )
}
