import { useState } from 'react'
import { Button, InputNumber, Popover, Tag } from 'antd'
import { Icons } from '../../../Icons'
import {
  STAGE3D_MOTION_CATEGORY_LABEL,
  STAGE3D_MOTION_PRESETS,
  describeStage3DMotion,
  getStage3DMotionPreset,
  makeKeyframe,
  type Stage3DCameraKeyframe,
  type Stage3DCameraMotion,
  type Stage3DMotionCategory,
  type Stage3DMotionPresetId,
} from './cameraMotion'
import type { Stage3DCamera } from './stage3d.types'

/** 运镜库类别展示顺序 */
const MOTION_CATEGORY_ORDER: Stage3DMotionCategory[] = [
  'push-pull',
  'follow',
  'orbit',
  'truck',
  'crane',
]

/**
 * 机位运动轨迹面板（相机属性面板的「运动轨迹」Tab）。
 *
 * - 预设运镜：运镜库 13 个电影运镜预设，点击即以当前机位为起点套用并自动试播；
 * - 创建运动轨迹：关键帧编辑器，逐帧抓取当前机位组成自定义轨迹；
 * - 播放预览：驱动上层播放器（取景预览 + 机位预览小窗同步跟播）。
 */
export function CameraMotionPanel({
  motion,
  camera,
  playing,
  progress,
  onApplyPreset,
  onPlay,
  onStop,
  onDuration,
  onClear,
  onSaveKeyframes,
  onApplyKeyframe,
}: {
  motion: Stage3DCameraMotion | undefined
  camera: Stage3DCamera
  playing: boolean
  progress: number
  onApplyPreset: (presetId: Stage3DMotionPresetId) => void
  onPlay: () => void
  onStop: () => void
  onDuration: (durationSec: number) => void
  onClear: () => void
  /** 保存关键帧轨迹（构建 motion 挂到工作机位） */
  onSaveKeyframes: (keyframes: Stage3DCameraKeyframe[], durationSec: number) => void
  /** 把某关键帧位姿应用回工作机位（定位按钮） */
  onApplyKeyframe: (keyframe: Stage3DCameraKeyframe) => void
}) {
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftKeyframes, setDraftKeyframes] = useState<Stage3DCameraKeyframe[]>([])
  const [draftDuration, setDraftDuration] = useState(3)

  const startKeyframeEditing = () => {
    // 从现有轨迹关键帧继续编辑（若有），否则以当前机位为第一帧
    if (motion?.kind === 'keyframes' && motion.keyframes && motion.keyframes.length > 0) {
      setDraftKeyframes(motion.keyframes.map((kf) => ({ ...kf })))
      setDraftDuration(motion.durationSec)
    } else {
      setDraftKeyframes([makeKeyframe(0, camera.position, camera.target)])
      setDraftDuration(motion?.durationSec ?? 3)
    }
    setEditing(true)
  }

  const addKeyframe = () => {
    const last = draftKeyframes[draftKeyframes.length - 1]
    const t = last ? Math.min(draftDuration, last.t + 1) : 0
    setDraftKeyframes((list) => [...list, makeKeyframe(t, camera.position, camera.target)])
  }

  const saveKeyframes = () => {
    if (draftKeyframes.length < 2) return
    onSaveKeyframes(draftKeyframes, draftDuration)
    setEditing(false)
  }

  const presetLabel = motion?.kind === 'preset' ? getStage3DMotionPreset(motion.presetId)?.label : null

  const libraryContent = (
    <div className="stage3d-motion-library">
      <div className="stage3d-motion-library-title">运镜库</div>
      {MOTION_CATEGORY_ORDER.map((category) => {
        const presets = STAGE3D_MOTION_PRESETS.filter((p) => p.category === category)
        if (presets.length === 0) return null
        return (
          <div key={category} className="stage3d-motion-library-group">
            <div className="stage3d-motion-library-group-title">
              {STAGE3D_MOTION_CATEGORY_LABEL[category]}
            </div>
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`stage3d-motion-library-item${motion?.kind === 'preset' && motion.presetId === preset.id ? ' active' : ''}`}
                onClick={() => {
                  setLibraryOpen(false)
                  onApplyPreset(preset.id)
                }}
              >
                <span>{preset.label}</span>
                <span className="stage3d-motion-library-duration">{preset.durationSec}s</span>
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )

  return (
    <>
      <div className="stage3d-motion-actions">
        <Popover
          content={libraryContent}
          trigger="click"
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          placement="left"
          overlayClassName="stage3d-motion-library-popover"
        >
          <Button block size="small" icon={<Icons.Film size={13} />}>
            预设运镜
          </Button>
        </Popover>
        <Button block size="small" icon={<Icons.Activity size={13} />} onClick={startKeyframeEditing}>
          {motion?.kind === 'keyframes' ? '编辑运动轨迹' : '创建运动轨迹'}
        </Button>
      </div>

      {editing ? (
        <div className="stage3d-motion-keyframe-editor">
          <div className="stage3d-motion-kf-head">
            <span>关键帧（{draftKeyframes.length}）</span>
            <Button
              size="small"
              type="text"
              icon={<Icons.Plus size={12} />}
              onClick={addKeyframe}
              title="把当前工作机位追加为下一关键帧"
            >
              添加当前机位
            </Button>
          </div>
          {draftKeyframes.map((kf, index) => (
            <div key={kf.id} className="stage3d-motion-kf-row">
              <span className="stage3d-motion-kf-index">{index + 1}</span>
              <InputNumber
                size="small"
                min={0}
                max={draftDuration}
                step={0.1}
                value={Number(kf.t.toFixed(1))}
                onChange={(v) =>
                  setDraftKeyframes((list) =>
                    list.map((item) =>
                      item.id === kf.id ? { ...item, t: Math.max(0, Number(v) || 0) } : item,
                    ),
                  )
                }
              />
              <span className="stage3d-motion-kf-unit">s</span>
              <Button
                size="small"
                type="text"
                icon={<Icons.Crosshair size={12} />}
                title="把机位移到该关键帧"
                onClick={() => onApplyKeyframe(kf)}
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<Icons.Trash size={12} />}
                title="删除该关键帧"
                disabled={draftKeyframes.length <= 1}
                onClick={() =>
                  setDraftKeyframes((list) => list.filter((item) => item.id !== kf.id))
                }
              />
            </div>
          ))}
          <div className="stage3d-motion-kf-duration">
            <span>总时长</span>
            <InputNumber
              size="small"
              min={0.5}
              max={30}
              step={0.5}
              value={draftDuration}
              onChange={(v) => setDraftDuration(Math.max(0.5, Math.min(30, Number(v) || 3)))}
            />
            <span className="stage3d-motion-kf-unit">s</span>
          </div>
          <div className="stage3d-motion-kf-tip">
            调好机位后点「添加当前机位」逐帧记录；播放按帧间平滑插值。
          </div>
          <div className="stage3d-motion-kf-actions">
            <Button
              size="small"
              type="primary"
              disabled={draftKeyframes.length < 2}
              onClick={saveKeyframes}
            >
              保存轨迹
            </Button>
            <Button size="small" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : motion ? (
        <div className="stage3d-motion-summary">
          <div className="stage3d-motion-summary-row">
            <Tag color="gold">{motion.kind === 'preset' ? presetLabel ?? '预设运镜' : '自定义轨迹'}</Tag>
            <span className="stage3d-motion-summary-desc">{describeStage3DMotion(motion)}</span>
          </div>
          {playing ? (
            <>
              <div className="stage3d-motion-progress">
                <div className="stage3d-motion-progress-bar" style={{ width: `${progress * 100}%` }} />
              </div>
              <Button block size="small" icon={<Icons.Square size={12} />} onClick={onStop}>
                停止预览
              </Button>
            </>
          ) : (
            <Button block size="small" type="primary" ghost icon={<Icons.Play size={12} />} onClick={onPlay}>
              播放预览
            </Button>
          )}
          <div className="stage3d-motion-duration">
            <span>时长</span>
            <InputNumber
              size="small"
              min={0.5}
              max={30}
              step={0.1}
              value={motion.durationSec}
              onChange={(v) => onDuration(Math.max(0.5, Math.min(30, Number(v) || 1)))}
            />
            <span className="stage3d-motion-kf-unit">s</span>
          </div>
          <Button block size="small" type="text" danger icon={<Icons.Trash size={12} />} onClick={onClear}>
            清除轨迹
          </Button>
        </div>
      ) : (
        <div className="stage3d-tip">
          从运镜库选一个预设（以当前机位为起点），或逐帧创建自定义运动轨迹；播放预览同步到机位预览小窗，可直接录制运镜视频。
        </div>
      )}
    </>
  )
}
