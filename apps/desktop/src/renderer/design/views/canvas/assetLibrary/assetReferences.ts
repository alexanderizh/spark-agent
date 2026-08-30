/**
 * 资产引用统计（步骤模式设计文档 §4.4 缺陷 1）。
 *
 * 资产的「引用」来自画布节点的 `node.assetId`。统计口径与下载/渲染一致：
 * `hidden=true` 的软删节点不计入（deleteNodes 只做软删，历史实现把已删节点
 * 也算进「N 引用」，导致资产看起来仍被引用）。
 */

import type { CanvasNode } from '../canvas.types'

/**
 * 引用反查：assetId → 引用它的**未软删**节点列表。
 * 供资产管理面板展示「N 引用」与引用位置定位使用。
 */
export function collectAssetReferences(nodes: readonly CanvasNode[]): Map<string, CanvasNode[]> {
  const map = new Map<string, CanvasNode[]>()
  for (const node of nodes) {
    if (node.hidden) continue
    if (!node.assetId) continue
    const list = map.get(node.assetId) ?? []
    list.push(node)
    map.set(node.assetId, list)
  }
  return map
}

/** 引用计数：assetId → 未软删引用节点数（统计口径与 collectAssetReferences 一致） */
export function countAssetReferences(nodes: readonly CanvasNode[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    if (node.hidden) continue
    if (!node.assetId) continue
    counts.set(node.assetId, (counts.get(node.assetId) ?? 0) + 1)
  }
  return counts
}
