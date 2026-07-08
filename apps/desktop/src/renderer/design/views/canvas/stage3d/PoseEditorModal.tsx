import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@lobehub/ui'
import { Input, Segmented } from 'antd'
import { Icons } from '../../../Icons'
import { Scene3D } from './Scene3D'
import { JointSliders } from './JointSliders'
import { usePoseUndoRedo, withJointAxis } from './usePoseUndoRedo'
import {
  JOINT_GROUPS,
  POSE_PRESETS,
  composePose,
  copySidePose,
  mirrorPose,
  type JointId,
  type PoseGroup,
  type Vec3,
} from './mannequin'
import {
  deleteSavedPose,
  loadSavedPoses,
  renameSavedPose,
  savePose,
  type SavedPose,
} from './poseLibrary'
import { poseEditorOverrideFromFinalEuler, poseEditorOverridesFromFinalPose } from './poseEditorMath'
import { createDefaultStage3DData, type Stage3DActor, type Stage3DData } from './stage3d.types'
import './stage3d.less'

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
 * joints 语义与 actor.joints 一致：逐关节欧拉角覆盖（弧度，叠加在 stand 之上）。
 * 进入时先把 actor.pose + actor.joints 合成为最终欧拉，再转换为 stand 覆盖，
 * 这样 Scene3D 以 pose='stand' 渲染时能还原原始视觉，避免 stand 基准被叠加两次。
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
  const [toolsCollapsed, setToolsCollapsed] = useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)

  // 进入时合成初始姿势：预设 + 逐关节覆盖 → stand 覆盖，pose 重置 stand
  const { initialJoints, sceneData } = useMemo(() => {
    if (!actor) {
      return { initialJoints: {} as Record<string, Vec3>, sceneData: null as Stage3DData | null }
    }
    const filtered = poseEditorOverridesFromFinalPose(composePose(actor.pose, actor.joints))
    // 仅供 Scene3D 渲染：拷贝 actor，强制 stand + 转换后的覆盖（避免预设与 joints 二次叠加）
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
    onChange(undo.joints)
  }

  const handleReset = () => {
    undo.replace({}, 'stand')
  }

  const applyPreset = (presetId: string) => {
    const composed = poseEditorOverridesFromFinalPose(composePose(presetId))
    undo.begin()
    undo.replace(composed)
    undo.commit()
  }

  const applyMirror = () => {
    undo.begin()
    undo.replace(mirrorPose(undo.joints))
    undo.commit()
  }

  const copyLeftToRight = () => {
    undo.begin()
    undo.replace(copySidePose(undo.joints, 'L'))
    undo.commit()
  }

  const copyRightToLeft = () => {
    undo.begin()
    undo.replace(copySidePose(undo.joints, 'R'))
    undo.commit()
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
            <Button
              size="small"
              type={toolsCollapsed ? 'primary' : 'text'}
              icon={<Icons.PanelLeft size={15} />}
              onClick={() => setToolsCollapsed((v) => !v)}
              title={toolsCollapsed ? '展开左侧面板' : '折叠左侧面板'}
            />
            <Button
              size="small"
              type={inspectorCollapsed ? 'primary' : 'text'}
              icon={<Icons.PanelRight size={15} />}
              onClick={() => setInspectorCollapsed((v) => !v)}
              title={inspectorCollapsed ? '展开右侧面板' : '折叠右侧面板'}
            />
            <Button
              size="small"
              type="text"
              icon={<Icons.X size={16} />}
              onClick={onClose}
              title="取消（丢弃改动）"
            />
            <Button
              size="small"
              type="primary"
              icon={<Icons.Check size={14} />}
              onClick={handleApply}
            >
              应用
            </Button>
          </div>
        </div>

        <div className="stage3d-body stage3d-pose-editor-body">
          {toolsCollapsed ? (
            <button
              type="button"
              className="stage3d-panel-rail stage3d-panel-rail-left"
              onClick={() => setToolsCollapsed(false)}
              title="展开左侧面板"
            >
              <Icons.PanelLeft size={16} />
            </button>
          ) : (
            <aside className="stage3d-tools stage3d-pose-editor-tools">
              <button
                type="button"
                className="stage3d-panel-collapse stage3d-panel-collapse-left"
                onClick={() => setToolsCollapsed(true)}
                title="折叠左侧面板"
              >
                <Icons.ChevronLeft size={14} />
              </button>
              <div className="stage3d-section-title">视角</div>
              <Segmented
                size="small"
                block
                value={cameraPreset}
                onChange={(v) => setCameraPreset(v as CameraPreset)}
                options={CAMERA_PRESET_OPTIONS}
              />
              <div className="stage3d-section-title">快速操作</div>
              <div className="stage3d-pose-editor-quick-grid">
                <Button
                  size="small"
                  icon={<Icons.Undo2 size={13} />}
                  disabled={!undo.canUndo}
                  onClick={undo.undo}
                  title="撤销"
                />
                <Button
                  size="small"
                  icon={<Icons.Redo2 size={13} />}
                  disabled={!undo.canRedo}
                  onClick={undo.redo}
                  title="重做"
                />
                <Button
                  size="small"
                  icon={<Icons.RotateCcw size={13} />}
                  onClick={handleReset}
                  title="重置"
                />
              </div>
              <div className="stage3d-pose-editor-mirror-row">
                <Button size="small" onClick={applyMirror}>
                  左右镜像
                </Button>
                <Button size="small" onClick={copyLeftToRight}>
                  左 → 右
                </Button>
                <Button size="small" onClick={copyRightToLeft}>
                  右 → 左
                </Button>
              </div>
              <PresetGroupApply onApply={applyPreset} compact />
            </aside>
          )}

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
              onCrowdTransform={() => {
                /* 全屏页只编辑单个 actor，不处理群众阵列 */
              }}
              onPropTransform={() => {}}
              onCameraTransform={() => {}}
              onActorJointEuler={(_id, jointId, euler) => {
                // PoseGizmo 回传「最终欧拉」（弧度，含预设基准）；hook.joints 是 stand 基准之上的覆盖
                undo.begin()
                undo.replace({ ...undo.joints, [jointId]: poseEditorOverrideFromFinalEuler(jointId, euler) })
                undo.commit()
              }}
              onActorPoseDragBegin={() => undo.begin()}
              onActorPoseDragCommit={() => undo.commit()}
            />
            <div className="stage3d-viewport-toolbar stage3d-pose-editor-toolbar">
              <Button
                size="small"
                icon={<Icons.Undo2 size={13} />}
                disabled={!undo.canUndo}
                onClick={undo.undo}
                title="撤销（Cmd/Ctrl+Z）"
              >
                撤销
              </Button>
              <Button
                size="small"
                icon={<Icons.Redo2 size={13} />}
                disabled={!undo.canRedo}
                onClick={undo.redo}
                title="重做（Cmd/Ctrl+Shift+Z）"
              >
                重做
              </Button>
              <Button
                size="small"
                icon={<Icons.RotateCcw size={13} />}
                onClick={handleReset}
                title="重置所有关节覆盖（保留预设）"
              >
                重置覆盖
              </Button>
            </div>
          </div>

          {/* 右面板 */}
          {inspectorCollapsed ? (
            <button
              type="button"
              className="stage3d-panel-rail stage3d-panel-rail-right"
              onClick={() => setInspectorCollapsed(false)}
              title="展开右侧面板"
            >
              <Icons.PanelRight size={16} />
            </button>
          ) : (
            <aside className="stage3d-inspector stage3d-pose-editor-inspector">
              <button
                type="button"
                className="stage3d-panel-collapse stage3d-panel-collapse-right"
                onClick={() => setInspectorCollapsed(true)}
                title="折叠右侧面板"
              >
                <Icons.ChevronRight size={14} />
              </button>
              <div className="stage3d-section-title">关节微调</div>
              <div className="stage3d-tip">
                点关节后可用视口调节器或右侧滑杆自由调整 XYZ；手脚末端仍可拖 IK。
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

              {/* 预设姿势分组套用：基础 / 武打 */}
              <PresetGroupApply onApply={applyPreset} />

              {/* 姿势库：保存 / 套用 / 重命名 / 删除 */}
              <PoseLibraryPanel
                getJoints={() => ({ pose: undo.pose, joints: undo.joints })}
                onApply={(joints) => {
                  undo.begin()
                  undo.replace(poseEditorOverridesFromFinalPose(joints))
                  undo.commit()
                }}
              />

              {/* 镜像：左右镜像 / 单侧拷贝 */}
              <div className="stage3d-section-title stage3d-pose-editor-placeholder-title">
                镜像
              </div>
              <div className="stage3d-tip">
                镜像 / 单侧拷贝作用于当前覆盖（基于 stand 基准之上）。
              </div>
              <div className="stage3d-pose-editor-mirror-row">
                <Button
                  size="small"
                  onClick={applyMirror}
                  title="左右互换 + y/z 取反（中线关节仅取反）"
                >
                  左右镜像
                </Button>
                <Button
                  size="small"
                  onClick={copyLeftToRight}
                  title="把左侧（L）的臂/腿/手指姿势拷到右侧（镜像翻转 y/z）"
                >
                  左 → 右
                </Button>
                <Button
                  size="small"
                  onClick={copyRightToLeft}
                  title="把右侧（R）的臂/腿/手指姿势拷到左侧（镜像翻转 y/z）"
                >
                  右 → 左
                </Button>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
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

// ─────────────────────────── 预设姿势分组套用 ───────────────────────────

/** 按 group 分组展示预设按钮，点击后由上层转换为 stand 覆盖。 */
function PresetGroupApply({
  onApply,
  compact,
}: {
  onApply: (presetId: string) => void
  compact?: boolean | undefined
}) {
  const groups: { group: PoseGroup; presets: typeof POSE_PRESETS }[] = []
  for (const preset of POSE_PRESETS) {
    let bucket = groups.find((g) => g.group === preset.group)
    if (!bucket) {
      bucket = { group: preset.group, presets: [] }
      groups.push(bucket)
    }
    bucket.presets.push(preset)
  }
  return (
    <>
      <div className="stage3d-section-title stage3d-pose-editor-placeholder-title">
        预设姿势
      </div>
      <div className="stage3d-tip">点击整体替换当前姿势（基于 stand 合成）。</div>
      {groups.map(({ group, presets }) => (
        <div
          key={group}
          className={`stage3d-pose-editor-preset-group${compact ? ' is-compact' : ''}`}
        >
          <div className="stage3d-pose-editor-preset-group-title">{group}</div>
          <div className="stage3d-pose-editor-preset-row">
            {presets.map((p) => (
              <Button
                key={p.id}
                size="small"
                onClick={() => onApply(p.id)}
                title={`套用「${p.label}」预设`}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

// ─────────────────────────── 姿势库面板 ───────────────────────────

/**
 * 自定义姿势库面板（应用级 localStorage）。
 *
 * - 保存：调 savePose(name, undo.pose, undo.joints)，内部 composePose 合成完整快照。
 * - 套用：SavedPose.joints 是最终欧拉快照，需先转换为 stand 覆盖再写回 undo.joints。
 * - 重命名 / 删除：操作 localStorage 后刷新本地列表。
 *
 * 列表数据用 useState 持有，每次保存/删除/重命名后 loadSavedPoses() 重新拉取。
 */
function PoseLibraryPanel({
  getJoints,
  onApply,
}: {
  getJoints: () => { pose: string; joints: Record<string, Vec3> }
  onApply: (joints: Record<string, Vec3>) => void
}) {
  const [list, setList] = useState<SavedPose[]>(() => loadSavedPoses())
  const [name, setName] = useState('')

  const refresh = useCallback(() => setList(loadSavedPoses()), [])

  const handleSave = () => {
    const { pose, joints } = getJoints()
    const r = savePose(name, pose, joints)
    if (!r.ok) {
      window.alert(r.reason)
      return
    }
    setName('')
    refresh()
  }

  const handleRename = (id: string, oldName: string) => {
    const next = window.prompt('重命名姿势', oldName)
    if (next === null) return
    if (!renameSavedPose(id, next)) {
      window.alert('重命名失败：名称为空或姿势已不存在')
      return
    }
    refresh()
  }

  const handleDelete = (id: string) => {
    if (!deleteSavedPose(id)) return
    refresh()
  }

  return (
    <>
      <div className="stage3d-section-title stage3d-pose-editor-placeholder-title">姿势库</div>
      <div className="stage3d-tip">保存当前姿势为快照，跨画布复用。</div>
      <div className="stage3d-pose-editor-save-row">
        <Input
          size="small"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="姿势名称"
          onPressEnter={handleSave}
          maxLength={32}
        />
        <Button size="small" type="primary" onClick={handleSave} disabled={!name.trim()}>
          保存
        </Button>
      </div>
      {list.length === 0 ? (
        <div className="stage3d-tip stage3d-pose-editor-empty">暂无已保存姿势</div>
      ) : (
        <div className="stage3d-pose-editor-pose-list">
          {list.map((p) => (
            <div key={p.id} className="stage3d-pose-editor-pose-item">
              <span className="stage3d-pose-editor-pose-name" title={p.name}>
                {p.name}
              </span>
              <span className="stage3d-pose-editor-pose-actions">
                <Button size="small" onClick={() => onApply(p.joints)} title="套用此姿势">
                  套用
                </Button>
                <Button
                  size="small"
                  type="text"
                  onClick={() => handleRename(p.id, p.name)}
                  title="重命名"
                >
                  重命名
                </Button>
                <Button size="small" type="text" onClick={() => handleDelete(p.id)} title="删除">
                  删除
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
