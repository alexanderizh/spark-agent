/**
 * 无限画布统一放置引擎的纯几何内核。
 *
 * 这里只负责“把一个已完成内部排版的批次，整体放到无碰撞位置”。调用方需要先把
 * 多节点批次（例如任务的 4 个产物 + 组框）排成局部坐标，再把现有节点、组框和并发
 * 任务预留区统一作为 obstacles 传入。纯函数设计便于所有添加入口逐步接入同一套规则。
 */

export type CanvasPlacementPoint = { x: number; y: number }

export type CanvasPlacementRect = CanvasPlacementPoint & {
  width: number
  height: number
}

export type CanvasPlacementItem = CanvasPlacementRect & {
  id?: string
}

export type CanvasPlacementResult<T extends CanvasPlacementItem> = {
  origin: CanvasPlacementPoint
  items: T[]
  bounds: CanvasPlacementRect
  searchSteps: number
}

export type FindCanvasPlacementInput<T extends CanvasPlacementItem> = {
  preferred: CanvasPlacementPoint
  items: readonly T[]
  obstacles: readonly CanvasPlacementRect[]
  /** 节点/组与障碍物之间的最小安全距离。 */
  gap?: number
  /** 候选搜索的网格步长；越小越紧凑，越大搜索越快。 */
  searchStep?: number
  /** 最大扩展环数，避免异常数据导致无限搜索。 */
  maxRings?: number
}

export const DEFAULT_CANVAS_PLACEMENT_GAP = 56
export const DEFAULT_CANVAS_PLACEMENT_SEARCH_STEP = 48
export const DEFAULT_CANVAS_PLACEMENT_MAX_RINGS = 160

export function getCanvasPlacementBounds(
  items: readonly CanvasPlacementRect[],
): CanvasPlacementRect {
  if (items.length === 0) return { x: 0, y: 0, width: 0, height: 0 }

  const left = Math.min(...items.map((item) => item.x))
  const top = Math.min(...items.map((item) => item.y))
  const right = Math.max(...items.map((item) => item.x + Math.max(0, item.width)))
  const bottom = Math.max(...items.map((item) => item.y + Math.max(0, item.height)))

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

export function canvasPlacementRectsOverlap(
  first: CanvasPlacementRect,
  second: CanvasPlacementRect,
  gap = 0,
): boolean {
  return !(
    first.x + first.width + gap <= second.x ||
    second.x + second.width + gap <= first.x ||
    first.y + first.height + gap <= second.y ||
    second.y + second.height + gap <= first.y
  )
}

/**
 * 在 preferred 周围按“右侧优先、随后向下、再绕方形环扩展”的顺序找空位。
 * 批次始终整体平移，成员间距和组内排版不会被搜索过程破坏。
 */
export function findCollisionFreeCanvasPlacement<T extends CanvasPlacementItem>(
  input: FindCanvasPlacementInput<T>,
): CanvasPlacementResult<T> | null {
  if (input.items.length === 0) return null

  const gap = Math.max(0, input.gap ?? DEFAULT_CANVAS_PLACEMENT_GAP)
  const searchStep = Math.max(8, input.searchStep ?? DEFAULT_CANVAS_PLACEMENT_SEARCH_STEP)
  const maxRings = Math.max(0, input.maxRings ?? DEFAULT_CANVAS_PLACEMENT_MAX_RINGS)
  const localBounds = getCanvasPlacementBounds(input.items)
  let searchSteps = 0

  for (const offset of canvasPlacementSearchOffsets(maxRings)) {
    const origin = {
      x: Math.round(input.preferred.x + offset.x * searchStep),
      y: Math.round(input.preferred.y + offset.y * searchStep),
    }
    const bounds = {
      x: origin.x,
      y: origin.y,
      width: localBounds.width,
      height: localBounds.height,
    }
    searchSteps += 1

    if (
      input.obstacles.some((obstacle) => canvasPlacementRectsOverlap(bounds, obstacle, gap))
    ) {
      continue
    }

    const deltaX = origin.x - localBounds.x
    const deltaY = origin.y - localBounds.y
    return {
      origin,
      bounds,
      searchSteps,
      items: input.items.map((item) => ({
        ...item,
        x: Math.round(item.x + deltaX),
        y: Math.round(item.y + deltaY),
      })) as T[],
    }
  }

  return null
}

/** 候选顺序可预测，避免同一快照在不同入口得到不同位置。 */
export function* canvasPlacementSearchOffsets(
  maxRings: number,
): Generator<CanvasPlacementPoint> {
  yield { x: 0, y: 0 }

  for (let ring = 1; ring <= maxRings; ring += 1) {
    // 先尝试正右方，然后沿右边向下，符合创作流水线从左到右的阅读方向。
    yield { x: ring, y: 0 }
    for (let y = 1; y <= ring; y += 1) yield { x: ring, y }

    // 沿底边从右向左。
    for (let x = ring - 1; x >= -ring; x -= 1) yield { x, y: ring }

    // 沿左边从下向上。
    for (let y = ring - 1; y >= -ring; y -= 1) yield { x: -ring, y }

    // 沿顶边从左向右，最后补正右方上半边。
    for (let x = -ring + 1; x <= ring; x += 1) yield { x, y: -ring }
    for (let y = -ring + 1; y < 0; y += 1) yield { x: ring, y }
  }
}
