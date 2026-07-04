import { useMemo } from 'react'
import { Progress } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import type { CanvasSnapshot } from './canvas.types'
import {
  computePipelineProgress,
  type PipelineStageKey,
} from './canvasPipelineProgress'

/**
 * 制作面板（导演台 / Production Cockpit）。
 *
 * 把整条「文稿 → 剧本 → 资源 → 分镜 → 关键帧 → 视频」流水线的完成度可视化，
 * 并给出「下一步」行动号召，让用户始终知道现在该做什么。
 */

const STAGE_ICON: Record<PipelineStageKey, React.ReactNode> = {
  manuscript: <Icons.FileText size={16} />,
  screenplay: <Icons.Edit size={16} />,
  resource: <Icons.Users size={16} />,
  shot: <Icons.Layers size={16} />,
  keyframe: <Icons.Image size={16} />,
  video: <Icons.Play size={16} />,
}

export function CanvasProductionPanel({
  snapshot,
  onOpenFilmCenter,
}: {
  snapshot: CanvasSnapshot
  onOpenFilmCenter: (stageKey?: PipelineStageKey) => void
}) {
  const progress = useMemo(
    () =>
      computePipelineProgress({
        assets: snapshot.assets,
        nodes: snapshot.nodes,
        metadata: snapshot.project.metadata,
      }),
    [snapshot.assets, snapshot.nodes, snapshot.project.metadata],
  )

  return (
    <div className="canvas-side-panel-content canvas-production-panel">
      <section className="canvas-panel-section">
        <div className="canvas-production-hero">
          <Progress
            type="dashboard"
            size={92}
            percent={progress.percent}
            strokeColor={{ '0%': '#8b5cf6', '100%': '#22d3ee' }}
            format={(p) => (
              <span className="canvas-production-hero-pct">
                {p}%<small>{progress.completedStages}/{progress.totalStages} 阶段</small>
              </span>
            )}
          />
          <div className="canvas-production-hero-meta">
            <h3>制作进度</h3>
            <p>{progress.percent === 100 ? '全流程已就绪，可导出成片清单' : '按下方流水线推进，从文稿走到成片'}</p>
          </div>
        </div>
      </section>

      {progress.nextAction && (
        <section className="canvas-panel-section">
          <div className="canvas-production-next">
            <div className="canvas-production-next-label">
              <Icons.Sparkles size={14} /> 下一步
            </div>
            <div className="canvas-production-next-cta">{progress.nextAction.cta}</div>
            <div className="canvas-production-next-hint">{progress.nextAction.hint}</div>
            <Button
              type="primary"
              size="middle"
              block
              onClick={() => onOpenFilmCenter(progress.nextAction!.stageKey)}
            >
              {progress.nextAction.cta} →
            </Button>
          </div>
        </section>
      )}

      <section className="canvas-panel-section">
        <div className="canvas-panel-title-row">
          <h3>流水线</h3>
        </div>
        <ol className="canvas-production-stages">
          {progress.stages.map((stage, index) => {
            const isNext = progress.nextAction?.stageKey === stage.key
            return (
              <li
                key={stage.key}
                className={`canvas-production-stage${stage.done ? ' is-done' : ''}${isNext ? ' is-next' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onOpenFilmCenter(stage.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onOpenFilmCenter(stage.key)
                }}
                title={`定位到「${stage.label}」`}
              >
                <span className="canvas-production-stage-rail">
                  <span className="canvas-production-stage-dot">
                    {stage.done ? <Icons.Check size={13} /> : STAGE_ICON[stage.key]}
                  </span>
                  {index < progress.stages.length - 1 && (
                    <span className="canvas-production-stage-line" />
                  )}
                </span>
                <span className="canvas-production-stage-body">
                  <span className="canvas-production-stage-label">{stage.label}</span>
                  <span className="canvas-production-stage-detail">
                    {stage.done ? stage.detail ?? '已完成' : isNext ? '待开始' : '—'}
                  </span>
                </span>
                {stage.count > 0 && (
                  <span className="canvas-production-stage-count">{stage.count}</span>
                )}
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
