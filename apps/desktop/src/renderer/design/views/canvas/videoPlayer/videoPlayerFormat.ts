/**
 * 画布自研视频播放器的纯函数工具：时间码格式化 + 边界收敛。
 *
 * 独立成文件便于聚焦测试（见 videoPlayerFormat.test.ts），组件内不重复实现。
 */

/** 逐帧步进的默认帧间隔（秒）。视频元数据拿不到帧率，按主流 30fps 取值。 */
export const VIDEO_PLAYER_FRAME_SEC = 1 / 30

/** 常规时间显示：mm:ss（不足 1 小时）/ h:mm:ss。 */
export function formatVideoPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const sec = total % 60
  const min = Math.floor(total / 60) % 60
  const hr = Math.floor(total / 3600)
  const mm = hr > 0 ? `${min}`.padStart(2, '0') : `${min}`
  const ss = `${sec}`.padStart(2, '0')
  return hr > 0 ? `${hr}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 面板档时间码：mm:ss.f，保留一位小数，用于逐帧步进时的精准定位。 */
export function formatVideoPlayerTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0'
  const base = formatVideoPlayerTime(Math.floor(seconds))
  const fraction = Math.floor((seconds - Math.floor(seconds)) * 10)
  return `${base}.${fraction}`
}

/** 收敛到 [min, max]，非有限数直接取 min。 */
export function clampVideoPlayerValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * 从 pointer 事件坐标换算进度条位置比例。
 * 返回值已收敛到 [0, 1]，空 target 兜底 0。
 */
export function ratioFromPointerEvent(
  event: { clientX: number },
  element: HTMLElement | null,
): number {
  if (!element) return 0
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0) return 0
  return clampVideoPlayerValue((event.clientX - rect.left) / rect.width, 0, 1)
}

/** 档位判定：随容器宽度自适应，宽度未知时给标准档。 */
export type VideoPlayerTier = 'mini' | 'standard' | 'panel'

export function resolveVideoPlayerTier(width: number): VideoPlayerTier {
  if (width <= 0) return 'standard'
  if (width < 260) return 'mini'
  if (width < 420) return 'standard'
  return 'panel'
}
