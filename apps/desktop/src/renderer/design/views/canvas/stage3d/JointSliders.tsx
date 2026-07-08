import { Slider } from 'antd'
import { JOINT_LABEL, type JointId } from './mannequin'

/**
 * 单关节三轴滑杆（抽自 CanvasDirectorStage3DModal.JointSliders）。
 *
 * 行为：
 * - XYZ 三轴都开放，范围统一 -360~360，避免视口调节器和侧栏滑杆出现一边能调一边锁定。
 * - value 是逐关节欧拉角覆盖（弧度），onChange 回调以「度」回传，由上层负责落库。
 */
const RADIANS_PER_DEGREE = Math.PI / 180
const DEG_PER_RADIAN = 180 / Math.PI
const FALLBACK_MIN_DEG = -360
const FALLBACK_MAX_DEG = 360

const AXES: { axis: 0 | 1 | 2; label: string }[] = [
  { axis: 0, label: 'X' },
  { axis: 1, label: 'Y' },
  { axis: 2, label: 'Z' },
]

export type JointSlidersProps = {
  jointId: JointId
  /** 该关节的覆盖欧拉角（弧度，三轴）。 */
  value: [number, number, number]
  /** 某轴变化（度）。 */
  onChange: (axis: 0 | 1 | 2, deg: number) => void
  /** 滑杆开始拖动（onFocus）：供上层落 undo before 快照。可选。 */
  onBegin?: () => void
  /** 滑杆释放/失焦：供上层提交 undo entry。可选。 */
  onCommit?: () => void
}

export function JointSliders({ jointId, value, onChange, onBegin, onCommit }: JointSlidersProps) {
  return (
    <div className="stage3d-joint-row">
      <div className="stage3d-joint-name">{JOINT_LABEL[jointId]}</div>
      <div className="stage3d-joint-sliders">
        {AXES.map(({ axis, label }) => {
          const deg = Math.round((value[axis] ?? 0) * DEG_PER_RADIAN)
          return (
            <div key={axis} className="stage3d-joint-axis">
              <span>{label}</span>
              <Slider
                min={FALLBACK_MIN_DEG}
                max={FALLBACK_MAX_DEG}
                value={Math.min(FALLBACK_MAX_DEG, Math.max(FALLBACK_MIN_DEG, deg))}
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
