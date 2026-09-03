export type CanvasDepthColormap = 'none' | 'turbo' | 'viridis'

export type CanvasDepthRenderPreference = {
  /** 反相：近暗远亮的经典 depth map 观感 */
  invert: boolean
  /** 伪彩色映射；非 none 输出 RGB */
  colormap: CanvasDepthColormap
  /** 时序平滑强度 0-1 */
  smoothStrength: number
  /** 对比度增强 0-10（归一化分位裁剪百分比） */
  contrast: number
}

export const CANVAS_DEPTH_RENDER_DEFAULTS: CanvasDepthRenderPreference = {
  invert: false,
  colormap: 'none',
  smoothStrength: 0.25,
  contrast: 2,
}

const COLORMAP_VALUES: ReadonlyArray<CanvasDepthColormap> = ['none', 'turbo', 'viridis']

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

/**
 * 从节点/任务的 modelParams.depthRender 解析渲染偏好；
 * 缺省或越界字段回退到与主进程一致的历史默认值，保证旧节点行为不变。
 */
export function resolveDepthRenderPreference(
  configuredValue: unknown,
): CanvasDepthRenderPreference {
  const source =
    configuredValue != null && typeof configuredValue === 'object'
      ? (configuredValue as Partial<Record<keyof CanvasDepthRenderPreference, unknown>>)
      : {}
  return {
    invert: source.invert === true,
    colormap: COLORMAP_VALUES.includes(source.colormap as CanvasDepthColormap)
      ? (source.colormap as CanvasDepthColormap)
      : 'none',
    smoothStrength: clamp(source.smoothStrength, 0, 1, CANVAS_DEPTH_RENDER_DEFAULTS.smoothStrength),
    contrast: clamp(source.contrast, 0, 10, CANVAS_DEPTH_RENDER_DEFAULTS.contrast),
  }
}
