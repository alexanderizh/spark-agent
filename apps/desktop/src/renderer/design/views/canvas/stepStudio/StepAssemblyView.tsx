/**
 * 步骤模式 · 第三步「视频」（设计文档 §5.3，P6 交付）。
 *
 * 汇总分镜步骤已完成分段的视频产物：一键幂等组装进视频工作台
 * （video_workbench 节点，保留用户在工作台手动添加的内容）、
 * 轻量顺序预览（`<video>` 逐段连播）、入口跳转工作台精剪。
 */

import { useMemo, useState } from 'react'
import { Button, Spin, message } from 'antd'
import type { CanvasSnapshot, StepStudioState } from '../canvas.types'
import { readStepStudioState } from './stepStudioMeta'
import { deriveSegmentRuntime, normalizeSequences, patchSegment } from './stepStoryboardModel'
import {
  collectAssemblySources,
  estimateAssemblyDurationSec,
  type StepAssemblySource,
} from './stepAssemblyModel'
import { Icons } from '../../../Icons'

export type StepAssemblyViewProps = Readonly<{
  snapshot: CanvasSnapshot
  /** 步骤工程当前挂载的工作台节点 id（null = 尚未组装过） */
  assemblyNodeId: string | null
  /**
   * 容器执行组装：确保 video_workbench 节点存在 → 写入组装结果 →
   * 回填 assemblyNodeId → 刷快照。返回是否成功。
   */
  onAssemble: (sources: StepAssemblySource[]) => Promise<boolean>
  /** 打开视频工作台精剪（Modal 由容器渲染） */
  onOpenWorkbench: () => void
}>

function formatDuration(totalSec: number): string {
  const seconds = Math.round(totalSec)
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`
}

export function StepAssemblyView({
  snapshot,
  assemblyNodeId,
  onAssemble,
  onOpenWorkbench,
}: StepAssemblyViewProps) {
  // sources 实时派生：persisted 的 status/outputVideoAssetIds 由分镜视图的终态
  // effect 回写，用户停留在本步骤等待时该视图未挂载、持久化不会前进——此处以
  // snapshot.tasks 现场派生终态（仅展示口径，不写库；回写仍归分镜视图）。
  const sources = useMemo(() => {
    const raw = readStepStudioState(snapshot.project)
    const assetsById = new Map(snapshot.assets.map((asset) => [asset.id, asset]))
    let state: StepStudioState = {
      schemaVersion: 1,
      sequences: normalizeSequences(raw?.sequences ?? []),
    }
    for (const sequence of state.sequences) {
      for (const segment of sequence.segments) {
        if (segment.status !== 'generating' || !segment.taskId) continue
        const runtime = deriveSegmentRuntime(segment, snapshot)
        if (runtime.status !== 'done' && runtime.status !== 'failed') continue
        const task = snapshot.tasks.find((item) => item.id === segment.taskId)
        const videoOutputIds = (task?.outputAssetIds ?? []).filter(
          (id) => assetsById.get(id)?.type === 'video',
        )
        state = patchSegment(state, sequence.id, segment.id, {
          status: runtime.status,
          ...(runtime.status === 'done'
            ? {
                outputVideoAssetIds: [
                  ...new Set([...segment.outputVideoAssetIds, ...videoOutputIds]),
                ],
              }
            : {}),
        })
      }
    }
    return collectAssemblySources(state, assetsById)
  }, [snapshot])

  const totalSegments = useMemo(() => {
    const raw = readStepStudioState(snapshot.project)
    return normalizeSequences(raw?.sequences ?? []).reduce(
      (count, seq) => count + seq.segments.length,
      0,
    )
  }, [snapshot.project])

  const [assembling, setAssembling] = useState(false)

  const handleAssemble = async () => {
    if (assembling) return
    if (sources.length === 0) {
      message.info('还没有完成的分段视频，先去「分镜」步骤生成分段')
      return
    }
    setAssembling(true)
    try {
      const ok = await onAssemble(sources)
      if (ok) message.success(assemblyNodeId ? '时间线已更新' : '已组装进视频工作台')
      else message.error('组装未完成，请重试；若持续失败请检查视频工作台节点状态')
    } catch (error) {
      message.error(`组装失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setAssembling(false)
    }
  }

  // ── 轻量顺序预览：逐段连播 ──
  const [previewIndex, setPreviewIndex] = useState(0)
  const activePreview = sources[previewIndex] ?? null
  // 重组装后 sources 数量可能变化，播放位溢出时回落第一段（渲染期容错，无需 effect）
  const effectiveIndex = activePreview ? previewIndex : 0

  const pendingCount = Math.max(0, totalSegments - sources.length)
  const totalDurationSec = estimateAssemblyDurationSec(sources)
  const hasWorkbench = assemblyNodeId != null

  return (
    <div className="step-assembly-view">
      <header className="step-assembly-summary">
        <div className="step-assembly-summary-stats">
          <span className="step-assembly-stat">
            已完成分段 <b>{sources.length}</b>
          </span>
          {pendingCount > 0 ? (
            <span className="step-assembly-stat is-muted">
              未完成 <b>{pendingCount}</b>（仅组装完成段）
            </span>
          ) : null}
          {sources.length > 0 ? (
            <span className="step-assembly-stat is-muted">
              预计总时长 <b>{formatDuration(totalDurationSec)}</b>
            </span>
          ) : null}
        </div>
        <div className="step-assembly-summary-actions">
          <Button
            type="primary"
            size="small"
            loading={assembling}
            disabled={sources.length === 0}
            onClick={() => void handleAssemble()}
          >
            {hasWorkbench ? '更新时间线' : '组装时间线'}
          </Button>
          <Button
            size="small"
            disabled={!hasWorkbench}
            icon={<Icons.Scissors size={13} />}
            onClick={onOpenWorkbench}
          >
            打开工作台精剪
          </Button>
        </div>
      </header>

      {sources.length === 0 ? (
        <div className="step-assembly-empty">
          <Icons.Video size={28} />
          <p>还没有可组装的分段视频</p>
          <p className="is-muted">在「分镜」步骤完成分段生成后，回到这里一键组装成片</p>
        </div>
      ) : (
        <div className="step-assembly-body">
          <section className="step-assembly-track-panel">
            <h4>分段轨（{sources.length} 段）</h4>
            <ol className="step-assembly-track">
              {sources.map((source, index) => (
                <li
                  key={source.segmentId}
                  className={`step-assembly-track-item${index === effectiveIndex ? ' is-playing' : ''}`}
                  onClick={() => setPreviewIndex(index)}
                >
                  <span className="step-assembly-track-index">{index + 1}</span>
                  <span className="step-assembly-track-title" title={source.videoAsset.title ?? ''}>
                    {source.sequenceTitle} · 第 {source.segmentOrder + 1} 段
                  </span>
                  <span className="step-assembly-track-duration">
                    {source.durationSec != null ? `${source.durationSec.toFixed(1)}s` : '—'}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="step-assembly-preview-panel">
            {activePreview || sources[0] ? (
              <>
                <video
                  key={sources[effectiveIndex]?.segmentId ?? 'preview'}
                  className="step-assembly-preview-video"
                  src={sources[effectiveIndex]?.videoAsset.url ?? undefined}
                  controls
                  preload="metadata"
                  onEnded={() => {
                    if (effectiveIndex + 1 < sources.length) setPreviewIndex(effectiveIndex + 1)
                  }}
                />
                <p className="step-assembly-preview-caption">
                  正在预览第 {effectiveIndex + 1} / {sources.length} 段
                  {effectiveIndex + 1 < sources.length ? '，播放完自动接下一段' : ''}
                </p>
              </>
            ) : (
              <Spin />
            )}
          </section>
        </div>
      )}
    </div>
  )
}
