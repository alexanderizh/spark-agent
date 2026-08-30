/**
 * 资产库「分镜分组」视图（步骤模式设计文档 §5.4，P2 第一版）。
 *
 * 只读治理层：分组的新建 / 删除 / 展开到画布。片段级编辑（分镜表、关键帧、
 * 首尾帧）保留在画布模式的分镜工具中，后续由步骤模式「分镜」步骤（P5）
 * 提供全新实现；本视图只维护分组数据本体（project.metadata.film.shotGroups）。
 */

import { useMemo, useState } from 'react'
import { Modal, message } from 'antd'
import { Button } from '@lobehub/ui'
import type { CanvasSnapshot } from '../canvas.types'
import { type ShotGroup } from '../canvasFilmAssets'
import type { FilmCenterHandlers } from '../CanvasFilmAssetCenter'

export type AssetShotsViewProps = {
  snapshot: CanvasSnapshot
  handlers: FilmCenterHandlers
  /** 列表变化后通知容器刷新分类计数 */
  onChanged?: () => void
}

export function AssetShotsView({ snapshot, handlers, onChanged }: AssetShotsViewProps) {
  const shotGroups = useMemo<ShotGroup[]>(() => {
    const film = snapshot.project.metadata?.film as { shotGroups?: ShotGroup[] } | undefined
    return film?.shotGroups ?? []
  }, [snapshot.project.metadata])

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const createGroup = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await handlers.createShotGroup({ name: trimmed })
      message.success(`已创建分镜分组「${trimmed}」`)
      setName('')
      setCreating(false)
      onChanged?.()
    } catch {
      message.error('创建分组失败')
    }
  }

  const removeGroup = (group: ShotGroup) => {
    Modal.confirm({
      title: '删除分镜分组',
      content: `将删除「${group.name}」及其 ${group.segments.length} 个分镜片段，且不可恢复。`,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await handlers.deleteShotGroup(group.id)
          message.success('分组已删除')
          onChanged?.()
        } catch {
          message.error('删除分组失败')
        }
      },
    })
  }

  const expandGroup = async (group: ShotGroup) => {
    const expand = handlers.onExpandShotsToCanvas
    if (!expand) return
    try {
      const count = await expand(group)
      message.success(`已展开 ${count} 个分镜节点到画布`)
    } catch {
      message.error('展开分镜到画布失败')
    }
  }

  return (
    <div className="asset-library-grid-wrap">
      <div className="asset-library-shots-list">
        {shotGroups.length === 0 && !creating ? (
          <div className="asset-library-empty-hint">暂无分镜分组，点击右上「新建分组」开始</div>
        ) : null}
        {shotGroups.map((group) => (
          <div key={group.id} className="asset-library-shot-row">
            <div className="asset-library-shot-main">
              <div className="asset-library-shot-name">{group.name}</div>
              {group.description ? (
                <div className="asset-library-shot-desc" title={group.description}>
                  {group.description}
                </div>
              ) : null}
            </div>
            <span className="asset-library-shot-count">{group.segments.length} 镜</span>
            {handlers.onExpandShotsToCanvas ? (
              <Button size="small" variant="outlined" onClick={() => expandGroup(group)}>
                展开到画布
              </Button>
            ) : null}
            <Button
              size="small"
              type="text"
              onClick={() => removeGroup(group)}
              style={{ color: 'var(--ast-danger)' }}
            >
              删除
            </Button>
          </div>
        ))}
        {creating ? (
          <div className="asset-library-shot-row">
            <input
              className="asset-library-shot-input"
              autoFocus
              value={name}
              placeholder="分组名称"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') createGroup()
                if (event.key === 'Escape') {
                  setCreating(false)
                  setName('')
                }
              }}
            />
            <Button size="small" onClick={createGroup} disabled={!name.trim()}>
              创建
            </Button>
            <Button
              size="small"
              type="text"
              onClick={() => {
                setCreating(false)
                setName('')
              }}
            >
              取消
            </Button>
          </div>
        ) : null}
      </div>
      {!creating ? (
        <div className="asset-library-grid-footer">
          <Button variant="outlined" onClick={() => setCreating(true)}>
            新建分组
          </Button>
        </div>
      ) : null}
    </div>
  )
}
