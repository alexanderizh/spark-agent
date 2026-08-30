/**
 * 资产生成任务状态反查（步骤模式 R3）。
 *
 * 设定步骤的「生成设定图」走 createMediaTask + filmOutput：产物挂到影视资产
 * 由 applyMediaTaskResult 回填，任务本体是画布上的操作节点（node.data.outputFilmAssetId
 * 指向目标资产）。步骤模式视图不展示画布节点，因此从快照 nodes 反查每个资产
 * **最近一次**生成任务的状态，供详情抽屉与卡片角标消费。
 */

import type { CanvasNode, CanvasTaskStatus } from '../canvas.types'

export type AssetGenerationStatus = {
  /** 目标影视资产 id */
  assetId: string
  /** 最近一次生成任务的节点 id（可跳画布定位） */
  taskNodeId: string
  status: CanvasTaskStatus
  /** 0..1，仅 running 阶段有意义 */
  progress?: number | undefined
  /** 失败/取消时的说明 */
  message?: string | undefined
  /** 任务节点更新时间（ISO），抽屉按时间展示 */
  updatedAt?: string | undefined
}

function readOutputFilmAssetId(node: CanvasNode): string | null {
  const value = node.data?.outputFilmAssetId
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** running/pending 视为「进行中」：卡片角标与抽屉置顶提示共用口径 */
export function isAssetGenerationActive(status: AssetGenerationStatus | undefined): boolean {
  return status?.status === 'running' || status?.status === 'pending'
}

/**
 * 扫描快照节点，按资产聚合最近一次生成任务状态。
 *
 * 同一资产多次发起生成（重试/重生成）时取 updatedAt 最新的节点；updatedAt
 * 解析失败（脏数据）时退化为扫描顺序，同刻并列取后者（最近发起）。
 */
export function collectAssetGenerationStatuses(
  nodes: readonly CanvasNode[],
): Map<string, AssetGenerationStatus> {
  const latest = new Map<string, AssetGenerationStatus & { sortKey: number }>()
  let sequence = 0
  for (const node of nodes) {
    const assetId = readOutputFilmAssetId(node)
    if (!assetId) continue
    const data = node.data
    const status = data?.status
    if (!status) continue
    sequence += 1
    const candidate: AssetGenerationStatus & { sortKey: number } = {
      assetId,
      taskNodeId: node.id,
      status,
      ...(typeof data?.progress === 'number' && Number.isFinite(data.progress)
        ? { progress: data.progress }
        : {}),
      ...(typeof data?.message === 'string' && data.message.length > 0
        ? { message: data.message }
        : {}),
      updatedAt: node.updatedAt,
      sortKey: 0,
    }
    // updatedAt 必填；解析失败（脏数据）时退化为扫描顺序，保证多次发起仍可比较
    candidate.sortKey = Date.parse(node.updatedAt) || sequence
    const current = latest.get(assetId)
    if (!current || candidate.sortKey >= current.sortKey) {
      latest.set(assetId, candidate)
    }
  }
  const result = new Map<string, AssetGenerationStatus>()
  for (const [assetId, value] of latest) {
    const { sortKey: _sortKey, ...rest } = value
    result.set(assetId, rest)
  }
  return result
}
