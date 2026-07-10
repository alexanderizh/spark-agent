export type CanvasOperationParamSummaryItem = {
  key: string
  label: string
  value: string
}

const PARAM_GROUPS: Array<{ label: string; keys: string[]; unit?: string }> = [
  { label: '比例', keys: ['aspect_ratio', 'aspectRatio', 'aspect', 'ratio'] },
  { label: '分辨率', keys: ['resolution'] },
  { label: '尺寸', keys: ['size', 'image_size', 'imageSize'] },
  { label: '时长', keys: ['duration_seconds', 'durationSeconds', 'duration'], unit: '秒' },
  { label: '质量', keys: ['quality'] },
  { label: '帧率', keys: ['fps', 'frame_rate', 'frameRate'], unit: 'fps' },
  { label: '数量', keys: ['count', 'n', 'num_outputs', 'number'] },
  { label: '随机种子', keys: ['seed'] },
  { label: '格式', keys: ['output_format', 'format'] },
  { label: '音色', keys: ['voice'] },
]

function formatParamValue(value: unknown, unit?: string): string | null {
  let text: string
  if (typeof value === 'boolean') {
    text = value ? '开启' : '关闭'
  } else if (typeof value === 'string' || typeof value === 'number') {
    text = String(value).trim()
  } else if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 3 &&
    value.every((item) => typeof item === 'string' || typeof item === 'number')
  ) {
    text = value.join(' / ')
  } else {
    return null
  }
  if (!text) return null
  if (unit && !/[a-zA-Z一-鿿]/.test(text)) text = `${text}${unit}`
  return text.length > 24 ? `${text.slice(0, 23)}…` : text
}

/** 按产品优先级提取操作节点摘要参数；复杂对象不进入卡片，最多展示四项。 */
export function buildCanvasOperationParamSummary(
  modelParams: Record<string, unknown> | null | undefined,
  limit = 4,
): CanvasOperationParamSummaryItem[] {
  if (!modelParams || limit <= 0) return []
  const summary: CanvasOperationParamSummaryItem[] = []
  for (const group of PARAM_GROUPS) {
    const key = group.keys.find((candidate) => modelParams[candidate] != null)
    if (!key) continue
    const value = formatParamValue(modelParams[key], group.unit)
    if (!value) continue
    summary.push({ key, label: group.label, value })
    if (summary.length >= limit) break
  }
  return summary
}
