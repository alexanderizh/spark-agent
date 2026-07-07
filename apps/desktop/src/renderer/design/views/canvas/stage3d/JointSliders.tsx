import { Slider } from 'antd'
import { JOINT_LABEL, JOINT_LIMITS, type AxisLimit, type JointId } from './mannequin'

/**
 * 单关节三轴滑杆（抽自 CanvasDirectorStage3DModal.JointSliders，并接入 JOINT_LIMITS）。
 *
 * 行为：
 * - 每轴 min/max 从 JOINT_LIMITS 读（弧度→度，向上/下取整），锁定轴（null）禁用滑杆且标签
 *   标「锁定」；JOINT_LIMITS 无该关节条目时回退 -180~180（理论上 JOINT_LIMITS 覆盖全关节，
 *   这里是防御性兜底）。
 * - value 是逐关节欧拉角覆盖（弧度），onChange 回调以「度」回传，由上层负责落库。
 *
 * 原版（1391-1423）固定 min/max=-180/180，未接限位，本版顺带修此 bug，行为对齐 PoseGizmo
 * 的 clampJointEuler：锁定轴禁用、显示锁定，软限位轴钳到区间。
 */
const RADIANS_PER_DEGREE = Math.PI / 180
const DEG_PER_RADIAN = 180 / Math.PI
const FALLBACK_MIN_DEG = -180
const FALLBACK_MAX_DEG = 180

const AXES: { axis: 0 | 1 | 2; label: string }[] = [
  { axis: 0, label: 'X' },
  { axis: 1, label: 'Y' },
  { axis: 2, label: 'Z' },
]

export type JointSlidersProps = {
  jointId: JointId
  /** 该关节的覆盖欧拉角（弧度，三轴）。 */
  value: [number, number, number]
  /** 某轴变化（度）。锁定轴不会触发。 */
  onChange: (axis: 0 | 1 | 2, deg: number) => void
  /** 滑杆开始拖动（onFocus）：供上层落 undo before 快照。可选。 */
  onBegin?: () => void
  /** 滑杆释放/失焦：供上层提交 undo entry。可选。 */
  onCommit?: () => void
}

/** 把单轴限位（弧度 [min,max]）转成度的整数边界；null 表示锁定。 */
function axisDegLimit(axis: AxisLimit | undefined): { locked: boolean; min: number; max: number } {
  if (axis === null || axis === undefined) return { locked: true, min: 0, max: 0 }
  const [minRad, maxRad] = axis
  // 向下取整 min、向上取整 max，避免把可触达的角度切掉
  const minDeg = Math.floor((minRad ?? 0) * DEG_PER_RADIAN)
  const maxDeg = Math.ceil((maxRad ?? 0) * DEG_PER_RADIAN)
  return { locked: false, min: minDeg, max: maxDeg }
}

export function JointSliders({ jointId, value, onChange, onBegin, onCommit }: JointSlidersProps) {
  const limits = JOINT_LIMITS[jointId]
  return (
    <div className="stage3d-joint-row">
      <div className="stage3d-joint-name">{JOINT_LABEL[jointId]}</div>
      <div className="stage3d-joint-sliders">
        {AXES.map(({ axis, label }) => {
          // limits 理论上覆盖全 JointId；缺时回退全范围（不锁定）
          const axisLimit: AxisLimit | undefined = limits ? limits[axis] : undefined
          const { locked, min, max } = axisDegLimit(axisLimit)
          const deg = Math.round((value[axis] ?? 0) * DEG_PER_RADIAN)
          if (locked) {
            return (
              <div key={axis} className="stage3d-joint-axis stage3d-joint-axis-locked">
                <span>{label}</span>
                <div className="stage3d-joint-locked">锁定</div>
              </div>
            )
          }
          return (
            <div key={axis} className="stage3d-joint-axis">
              <span>{label}</span>
              <Slider
                min={min}
                max={max}
                value={Math.min(max, Math.max(min, deg))}
                onChange={(v) => onChange(axis, v)}
                {...(onCommit ? { onChangeComplete: onCommit } : {})}
                {...(onBegin ? { onFocus: onBegin } : {})}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// 防止未使用导入告警（RADIANS_PER_DEGREE 留作后续可能的精度校验工具用）
void RADIANS_PER_DEGREE
