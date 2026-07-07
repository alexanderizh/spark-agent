import { useEffect, useMemo, useState } from 'react'
import { Button } from '@lobehub/ui'
import { Segmented } from 'antd'
import { Icons } from '../../../Icons'
import { Scene3D } from './Scene3D'
import { JointSliders } from './JointSliders'
import { usePoseUndoRedo, withJointAxis } from './usePoseUndoRedo'
import {
  JOINT_GROUPS,
  composePose,
  type JointId,
  type Pose,
  type Vec3,
} from './mannequin'
import {
  createDefaultStage3DData,
  type Stage3DActor,
  type Stage3DData,
} from './stage3d.types'
import './stage3d.less'

const RAD = Math.PI / 180

/**
 * 全屏姿势编辑 Modal（R2a）。
 *
 * 与 CanvasDirectorStage3DModal 现地 poseMode 的差别：
 * - 全屏暗色 Modal（复用 .stage3d-modal-overlay/.stage3d-shell），视口更大、好操作；
 * - data 只含当前 actor，poseMode 强制开启，onSelect 禁用多选；
 * - 顶栏提供视角预设 Segmented（正/侧/顶/iso）→ Scene3D cameraPreset；
 * - 右侧面板：关节滑杆分组折叠 + 姿势库/镜像区占位（R2b 填）；
 * - actor 数据用本地副本（usePoseUndoRedo 拥有），「应用」一次性回调 onChange(joints) 写回
 *   Stage3DModal 的 actor + 关闭；「取消」丢弃。
 *
 * joints 语义与 actor.joints 一致：逐关节欧拉角覆盖（弧度，叠加在预设之上）。
 * 进入时把「合成姿势」（composePose(actor.pose, actor.joints)）平铺到 joints，pose 设为 stand，
 * 这样滑杆读到的就是最终欧拉，所见即所得；应用时把 joints 整体写回 actor，pose 同步设 stand，
 * 避免叠加错乱（与 poseLibrary 的 savePose→套用语义一致）。
 */
export type PoseEditorModalProps = {
  /** 要编辑的角色。null 时不渲染。 */
  actor: Stage3DActor | null
  /** 应用：把编辑后的 joints 写回 Stage3DModal 的 actor。 */
  onChange: (joints: Record<string, Vec3>) => void
  /** 取消/关闭回调。 */
  onClose: () => void
}

type CameraPreset = 'front' | 'side' | 'top' | 'iso'

const CAMERA_PRESET_OPTIONS: { label: string; value: CameraPreset }[] = [
  { label: '正视', value: 'front' },
  { label: '侧视', value: 'side' },
  { label: '顶视', value: 'top' },
  { label: 'ISO', value: 'iso' },
]

export function PoseEditorModal({ actor, onChange, onClose }: PoseEditorModalProps) {
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('front')

  // 进入时合成初始姿势：预设 + 逐关节覆盖 → 平铺 joints，pose 重置 stand
  const { initialJoints, sceneData } = useMemo(() => {
    if (!actor) {
      return { initialJoints: {} as Record<string, Vec3>, sceneData: null as Stage3DData | null }
    }
    const composed = composePose(actor.pose, actor.joints)
    // 平铺后清掉零向量条目，避免 joints 里堆积 [0,0,0] 噪声
    const filtered: Record<string, Vec3> = {}
    for (const [k, v] of Object.entries(composed)) {
      if (v && (v[0] !== 0 || v[1] !== 0 || v[2] !== 0)) filtered[k] = [v[0], v[1], v[2]]
    }
    // 仅供 Scene3D 渲染：拷贝 actor，强制 stand + 合成后的 joints（避免预设与 joints 二次叠加）
    const editorActor: Stage3DActor = {
      ...actor,
      pose: 'stand',
      joints: filtered,
    }
    const data: Stage3DData = {
      ...createDefaultStage3DData(),
      actors: [editorActor],
      activeId: actor.id,
    }
    return { initialJoints: filtered, sceneData: data }
  }, [actor])

  const undo = usePoseUndoRedo(initialJoints, 'stand')

  // 切换到不同 actor 时重置 hook（含历史栈）
  useEffect(() => {
    undo.reset(initialJoints, 'stand')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor?.id])

  if (!actor || !sceneData) return null

  // 同步 hook.joints 回 sceneData.actor.joints（Scene3D 用 props.data 渲染）
  const liveActor: Stage3DActor = {
    ...actor,
    pose: undo.pose,
    joints: undo.joints,
  }
  const liveData: Stage3DData = {
    ...sceneData,
    actors: [{ ...liveActor, pose: 'stand', joints: undo.joints }],
    activeId: actor.id,
  }

  const handleApply = () => {
    // 应用时把 hook.joints 写回（pose 已平铺为 stand，Stage3DModal 收到 joints 后会再次叠加
    // 在 stand 之上，等价于「最终欧拉 - stand 基准」的逐关节覆盖；stand 基准只有 upperArm 微旋，
    // 影响 6°/-6° 范围，可接受；如需精确可在 R2b 把 base 一并扣除。）
    onChange(undo.joints)
  }

  const handleReset = () => {
    undo.replace({}, 'stand')
  }

  return (
    <div className="stage3d-modal-overlay stage3d-pose-editor-overlay" tabIndex={-1}>
      <div className="stage3d-shell stage3d-pose-editor-shell">
        {/* 顶栏 */}
        <div className="stage3d-topbar stage3d-pose-editor-topbar">
          <div className="stage3d-titlebox">
            <div className="stage3d-kicker">Pose Editor</div>
            <div className="stage3d-title">{actor.name} · 姿势编辑</div>
          </div>
          <div className="stage3d-topbar-actions stage3d-pose-editor-topbar-actions">
            <Segmented
              size="middle"
              value={cameraPreset}
              onChange={(v) => setCameraPreset(v as CameraPreset)}
              options={CAMERA_PRESET_OPTIONS}
            />
            <Button
              size="middle"
              type="text"
              icon={<Icons.X size={16} />}
              onClick={onClose}
              title="取消（丢弃改动）"
            />
            <Button size="middle" type="primary" icon={<Icons.Check size={14} />} onClick={handleApply}>
              应用
            </Button>
          </div>
        </div>

        <div className="stage3d-body stage3d-pose-editor-body">
          {/* 左大视口 */}
          <div className="stage3d-viewport stage3d-pose-editor-viewport">
            <Scene3D
              data={liveData}
              cameraPreview={false}
              transformMode="translate"
              snap={false}
              poseMode
              cameraPreset={cameraPreset}
              onSelect={() => {
                /* 全屏页禁用多选：只编辑这一个 actor */
              }}
              onActorTransform={() => {
                /* 全屏页不允许整体移动人偶 */
              }}
              onPropTransform={() => {}}
              onCameraTransform={() => {}}
              onActorJointEuler={(_id, jointId, euler) => {
                // PoseGizmo 回传「最终欧拉」（弧度，含预设基准）；hook.joints 是 stand 基准之上的覆盖
                const base = (POSE_STAND_BASE as Pose)[jointId] ?? ([0, 0, 0] as Vec3)
                const ov: Vec3 = [euler[0] - base[0], euler[1] - base[1], euler[2] - base[2]]
                undo.begin()
                undo.replace({ ...undo.joints, [jointId]: ov })
                undo.commit()
              }}
              onActorPoseDragBegin={() => undo.begin()}
              onActorPoseDragCommit={() => undo.commit()}
            />
            <div className="stage3d-viewport-toolbar stage3d-pose-editor-toolbar">
              <Button
                size="middle"
                icon={<Icons.Undo2 size={13} />}
                disabled={!undo.canUndo}
                onClick={undo.undo}
                title="撤销（Cmd/Ctrl+Z）"
              >
                撤销
              </Button>
              <Button
                size="middle"
                icon={<Icons.Redo2 size={13} />}
                disabled={!undo.canRedo}
                onClick={undo.redo}
                title="重做（Cmd/Ctrl+Shift+Z）"
              >
                重做
              </Button>
              <Button
                size="middle"
                icon={<Icons.RotateCcw size={13} />}
                onClick={handleReset}
                title="重置所有关节覆盖（保留预设）"
              >
                重置覆盖
              </Button>
            </div>
          </div>

          {/* 右面板 */}
          <aside className="stage3d-inspector stage3d-pose-editor-inspector">
            <div className="stage3d-section-title">关节微调</div>
            <div className="stage3d-tip">
              点关节出旋转环、拖手脚末端 IK；滑杆按解剖学软限位钳制。
            </div>
            {JOINT_GROUPS.map((group) => (
              <JointGroup
                key={group.label}
                label={group.label}
                joints={group.joints}
                values={undo.joints}
                onBegin={undo.begin}
                onCommit={undo.commit}
                onChangeAxis={(jointId, axis, deg) => {
                  undo.begin()
                  undo.replace(withJointAxis(undo.joints, jointId, axis, deg))
                  undo.commit()
                }}
              />
            ))}

            <div className="stage3d-section-title stage3d-pose-editor-placeholder-title">
              姿势库（R2b）
            </div>
            <div className="stage3d-tip">保存 / 套用 / 重命名 / 删除 自定义姿势将在 R2b 落地。</div>

            <div className="stage3d-section-title stage3d-pose-editor-placeholder-title">
              镜像（R2b）
            </div>
            <div className="stage3d-tip">左右镜像 / 单侧拷贝将在 R2b 落地。</div>
          </aside>
        </div>
      </div>
    </div>
  )
}

// stand 基准（与 mannequin.ts POSE_PRESETS 中 stand 一致；用于 PoseGizmo 回传的「合成后欧拉」
// 反推覆盖量）。复制而非 import 是为了避免硬耦合 POSE_PRESETS 顺序变化。
const POSE_STAND_BASE: Pose = {
  upperArmL: [0, 0, 6 * RAD],
  upperArmR: [0, 0, -6 * RAD],
}

// ─────────────────────────── 关节分组（折叠） ───────────────────────────

function JointGroup({
  label,
  joints,
  values,
  onChangeAxis,
  onBegin,
  onCommit,
}: {
  label: string
  joints: JointId[]
  values: Record<string, Vec3>
  onChangeAxis: (jointId: JointId, axis: 0 | 1 | 2, deg: number) => void
  onBegin: () => void
  onCommit: () => void
}) {
  const [expanded, setExpanded] = useState(label === '躯干 / 头')
  return (
    <div className="stage3d-joint-group">
      <button
        type="button"
        className="stage3d-collapse-toggle stage3d-pose-editor-group-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? '▾' : '▸'} {label}
      </button>
      {expanded &&
        joints.map((jointId) => {
          const v = values[jointId] ?? ([0, 0, 0] as Vec3)
          return (
            <JointSliders
              key={jointId}
              jointId={jointId}
              value={[v[0], v[1], v[2]]}
              onChange={(axis, deg) => onChangeAxis(jointId, axis, deg)}
              onBegin={onBegin}
              onCommit={onCommit}
            />
          )
        })}
    </div>
  )
}

// 防御：未使用的导入不告警
