import { Icons } from '../../Icons'
import type { CanvasPresetTargetDefinition, CanvasPresetTargetId } from './canvasOperationPresets'
import type { CanvasPresetTargetGroup } from './canvasPresetCenterModel'

export type CanvasPresetNodeOverridesProps = {
  groups: CanvasPresetTargetGroup[]
  activeTargetId: CanvasPresetTargetId
  hasOverride: (targetId: CanvasPresetTargetId) => boolean
  labelForTarget: (target: CanvasPresetTargetDefinition) => string
  summaryForTarget: (target: CanvasPresetTargetDefinition) => string
  onSelect: (targetId: CanvasPresetTargetId) => void
}

export function CanvasPresetNodeOverrides({
  groups,
  activeTargetId,
  hasOverride,
  labelForTarget,
  summaryForTarget,
  onSelect,
}: CanvasPresetNodeOverridesProps) {
  return (
    <aside className="canvas-preset-node-list" aria-label="节点功能类型">
      <div className="canvas-preset-node-list-intro">
        <strong>只设置需要例外的节点</strong>
        <span>其余节点自动继承对应的任务默认</span>
      </div>
      {groups.map((group) => (
        <section key={group.id} className="canvas-preset-node-group">
          <header>
            <span>{group.label}</span>
            <small>{group.targets.length}</small>
          </header>
          <div className="canvas-preset-node-group-rows">
            {group.targets.map((target) => {
              const overridden = hasOverride(target.id)
              const active = target.id === activeTargetId
              return (
                <button
                  key={target.id}
                  type="button"
                  data-preset-target={target.id}
                  className={`canvas-preset-node-row${active ? ' is-active' : ''}`}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelect(target.id)}
                >
                  <span className="canvas-preset-node-row-copy">
                    <strong>{labelForTarget(target)}</strong>
                    <small>{summaryForTarget(target)}</small>
                  </span>
                  <span
                    className={`canvas-preset-node-row-status${overridden ? ' is-override' : ''}`}
                  >
                    {overridden ? '已单独设置' : '继承默认'}
                  </span>
                  <Icons.ChevronRight size={14} />
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </aside>
  )
}
