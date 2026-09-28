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
  // 兜底：目标模型名解析不出来的切换不落盘（调用点已用 shouldRecordModelSwitch 守卫），
  // 保证存储里永远不会出现渲染成半句话的 marker。
  if (!shouldRecordModelSwitch(marker.fromModel, marker.toModel)) return existing
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

function hasModelName(value: string): boolean {
  return value.trim().length > 0
}

function isModelSwitchMarker(value: unknown): value is ModelSwitchMarker {
  if (value == null || typeof value !== 'object') return false
  const marker = value as Partial<ModelSwitchMarker>
  return (
    typeof marker.afterMessageId === 'string' &&
    typeof marker.fromModel === 'string' &&
    typeof marker.toModel === 'string' &&
    typeof marker.createdAt === 'string' &&
    // 兼容历史数据：空模型名的旧 marker（切智能路由行落下的）无法渲染成完整提示，读取时直接丢弃。
    hasModelName(marker.fromModel) &&
    hasModelName(marker.toModel)
  )
}

/**
 * 是否应写入「模型已从 X 更改为 Y」提示条。
 *
 * 目标模型名解析为空时一律不写：典型场景是切到「智能路由」行 —— 该 Profile 天生没有
 * 模型（defaultModel/modelIds 均为空，由分流器每轮决定执行模型），此前会落盘
 * toModel: '' 并渲染出「模型已从 deepseek-v4.1-flash 更改为 」这样的半句话提示。
 * 「谁在干活」由「已路由」提示条与轮次 meta 行表达，不需要这条提示参与。
 */
export function shouldRecordModelSwitch(fromModel: string, toModel: string): boolean {
  return hasModelName(fromModel) && hasModelName(toModel) && fromModel.trim() !== toModel.trim()
}
