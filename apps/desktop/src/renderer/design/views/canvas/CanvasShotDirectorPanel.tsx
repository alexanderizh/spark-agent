import { useMemo, useState } from 'react'
import { Button, Tag, Tooltip } from '@lobehub/ui'
import { Input, Select, message } from 'antd'
import { Icons } from '../../Icons'

type ShotSubjectKind = 'character' | 'prop'
type ShotLayer = 'foreground' | 'midground' | 'background'
type CameraShotSize = 'wide' | 'full' | 'medium' | 'close-up'
type CameraAngle = 'eye-level' | 'high-angle' | 'low-angle' | 'top-down'
type CameraMove = 'static' | 'dolly-in' | 'dolly-out' | 'tracking' | 'orbit' | 'crane-up'

type ShotSubject = {
  id: string
  kind: ShotSubjectKind
  name: string
  description: string
  x: number
  y: number
  z: number
  facing: number
  layer: ShotLayer
}

type CameraState = {
  x: number
  y: number
  z: number
  target: string
  shotSize: CameraShotSize
  angle: CameraAngle
  focalLength: number
  composition: string
  movement: CameraMove
}

type CameraKeyframe = {
  id: string
  time: number
  x: number
  y: number
  z: number
  target: string
  movement: CameraMove
}

const SHOT_SIZE_LABEL: Record<CameraShotSize, string> = {
  wide: '远景',
  full: '全身',
  medium: '中景',
  'close-up': '特写',
}

const ANGLE_LABEL: Record<CameraAngle, string> = {
  'eye-level': '平视',
  'high-angle': '俯拍',
  'low-angle': '仰拍',
  'top-down': '顶拍',
}

const MOVE_LABEL: Record<CameraMove, string> = {
  static: '固定',
  'dolly-in': '推进',
  'dolly-out': '拉远',
  tracking: '跟拍',
  orbit: '环绕',
  'crane-up': '升降',
}

const LAYER_LABEL: Record<ShotLayer, string> = {
  foreground: '前景',
  midground: '中景',
  background: '背景',
}

const initialSubjects: ShotSubject[] = [
  {
    id: 'subject-a',
    kind: 'character',
    name: '主角',
    description: '站在画面左前方，面向对手，情绪克制',
    x: 34,
    y: 58,
    z: 0,
    facing: 20,
    layer: 'foreground',
  },
  {
    id: 'subject-b',
    kind: 'character',
    name: '对手',
    description: '站在画面右后方，回望主角',
    x: 68,
    y: 36,
    z: 0,
    facing: 205,
    layer: 'midground',
  },
]

const initialCamera: CameraState = {
  x: 50,
  y: 88,
  z: 1.6,
  target: 'subject-a',
  shotSize: 'medium',
  angle: 'eye-level',
  focalLength: 35,
  composition: '三角构图，主体落在三分线交点，保留运动方向空间',
  movement: 'dolly-in',
}

const initialKeyframes: CameraKeyframe[] = [
  { id: 'kf-0', time: 0, x: 50, y: 88, z: 1.6, target: '主角', movement: 'dolly-in' },
  { id: 'kf-1', time: 4, x: 46, y: 62, z: 1.5, target: '主角与对手之间', movement: 'dolly-in' },
]

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(Math.round(value), 0), 100)
}

function parseNumericInput(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function subjectKindLabel(kind: ShotSubjectKind): string {
  return kind === 'character' ? '人物' : '物件'
}

function buildPrompt(input: {
  sceneBrief: string
  subjects: ShotSubject[]
  camera: CameraState
  keyframes: CameraKeyframe[]
}): { imagePrompt: string; videoPrompt: string } {
  const { sceneBrief, subjects, camera, keyframes } = input
  const subjectLines = subjects.map((subject) => {
    const layer = LAYER_LABEL[subject.layer]
    return `${subject.name}（${subjectKindLabel(subject.kind)}）位于${layer}，画面坐标约 x=${subject.x}, y=${subject.y}, 朝向 ${subject.facing} 度；${subject.description}`
  })
  const target =
    subjects.find((subject) => subject.id === camera.target)?.name || camera.target || '主体'
  const cameraLine = `镜头位于 x=${camera.x}, y=${camera.y}, 高度 ${camera.z}m，拍摄目标为${target}；${SHOT_SIZE_LABEL[camera.shotSize]}，${ANGLE_LABEL[camera.angle]}，${camera.focalLength}mm 焦段。`
  const compositionLine = `构图要求：${camera.composition}`
  const keyframeLines = keyframes
    .slice()
    .sort((a, b) => a.time - b.time)
    .map(
      (keyframe) =>
        `${keyframe.time}s: 相机到 x=${keyframe.x}, y=${keyframe.y}, 高度 ${keyframe.z}m，看向${keyframe.target}，${MOVE_LABEL[keyframe.movement]}。`,
    )

  return {
    imagePrompt: [
      sceneBrief || '电影感画面',
      ...subjectLines,
      cameraLine,
      compositionLine,
      '强调人物空间关系、镜头透视、清晰站位和可读的画面层次。',
    ].join('\n'),
    videoPrompt: [
      sceneBrief || '电影感视频镜头',
      ...subjectLines,
      cameraLine,
      compositionLine,
      `运镜类型：${MOVE_LABEL[camera.movement]}。`,
      keyframeLines.length > 0 ? `关键帧：\n${keyframeLines.join('\n')}` : '',
      '保持角色位置连续、镜头运动平稳、主体始终可读。',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

export function CanvasShotDirectorPanel({
  open,
  onClose,
  onInsertPrompt,
}: {
  open: boolean
  onClose: () => void
  onInsertPrompt: (prompt: string) => Promise<void> | void
}) {
  const [sceneBrief, setSceneBrief] = useState('夜晚室内对峙场景，空气紧张，电影感布光')
  const [subjects, setSubjects] = useState<ShotSubject[]>(initialSubjects)
  const [camera, setCamera] = useState<CameraState>(initialCamera)
  const [keyframes, setKeyframes] = useState<CameraKeyframe[]>(initialKeyframes)
  const [promptMode, setPromptMode] = useState<'image' | 'video'>('video')

  const prompt = useMemo(
    () => buildPrompt({ sceneBrief, subjects, camera, keyframes }),
    [camera, keyframes, sceneBrief, subjects],
  )
  const activePrompt = promptMode === 'image' ? prompt.imagePrompt : prompt.videoPrompt
  const cameraTargetOptions = subjects.map((subject) => ({
    label: subject.name,
    value: subject.id,
  }))

  if (!open) return null

  const updateSubject = (id: string, patch: Partial<ShotSubject>) => {
    setSubjects((current) =>
      current.map((subject) => (subject.id === id ? { ...subject, ...patch } : subject)),
    )
  }

  const removeSubject = (id: string) => {
    setSubjects((current) => current.filter((subject) => subject.id !== id))
    setCamera((current) => (current.target === id ? { ...current, target: '' } : current))
  }

  const addSubject = (kind: ShotSubjectKind) => {
    setSubjects((current) => [
      ...current,
      {
        id: makeId(kind),
        kind,
        name: kind === 'character' ? `人物 ${current.length + 1}` : `物件 ${current.length + 1}`,
        description: kind === 'character' ? '描述人物身份、动作和情绪' : '描述物件外观和用途',
        x: kind === 'character' ? 42 : 58,
        y: kind === 'character' ? 52 : 44,
        z: 0,
        facing: 0,
        layer: 'midground',
      },
    ])
  }

  const addKeyframe = () => {
    const last = keyframes[keyframes.length - 1]
    setKeyframes((current) => [
      ...current,
      {
        id: makeId('kf'),
        time: (last?.time ?? 0) + 2,
        x: camera.x,
        y: camera.y,
        z: camera.z,
        target:
          subjects.find((subject) => subject.id === camera.target)?.name || camera.target || '主体',
        movement: camera.movement,
      },
    ])
  }

  const updateKeyframe = (id: string, patch: Partial<CameraKeyframe>) => {
    setKeyframes((current) =>
      current.map((keyframe) => (keyframe.id === id ? { ...keyframe, ...patch } : keyframe)),
    )
  }

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(activePrompt)
      message.success('提示词已复制')
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  const insertPrompt = async () => {
    await onInsertPrompt(activePrompt)
  }

  return (
    <section className="canvas-shot-director-panel" aria-label="分镜导演台">
      <header className="canvas-shot-director-head">
        <div>
          <strong>分镜导演台</strong>
          <span>编排站位、镜头与运镜，生成 AI 画面提示词</span>
        </div>
        <div className="canvas-shot-director-head-actions">
          <Tag color="blue">{subjects.length} 占位</Tag>
          <Tooltip title="关闭">
            <Button size="small" type="text" icon={<Icons.X size={15} />} onClick={onClose} />
          </Tooltip>
        </div>
      </header>

      <div className="canvas-shot-director-body">
        <div className="canvas-shot-director-left">
          <label className="canvas-shot-field canvas-shot-field-wide">
            <span>场景描述</span>
            <Input.TextArea
              value={sceneBrief}
              autoSize={{ minRows: 2, maxRows: 3 }}
              onChange={(event) => setSceneBrief(event.target.value)}
            />
          </label>

          <div className="canvas-shot-section-head">
            <strong>人物与物件</strong>
            <div>
              <Button size="small" icon={<Icons.User size={14} />} onClick={() => addSubject('character')}>
                人物
              </Button>
              <Button size="small" icon={<Icons.Box size={14} />} onClick={() => addSubject('prop')}>
                物件
              </Button>
            </div>
          </div>

          <div className="canvas-shot-subject-list">
            {subjects.map((subject) => (
              <article key={subject.id} className="canvas-shot-subject-card">
                <div className="canvas-shot-subject-card-head">
                  <Tag color={subject.kind === 'character' ? 'green' : 'orange'}>
                    {subjectKindLabel(subject.kind)}
                  </Tag>
                  <Button
                    size="small"
                    type="text"
                    icon={<Icons.Trash size={14} />}
                    onClick={() => removeSubject(subject.id)}
                  />
                </div>
                <div className="canvas-shot-grid-form">
                  <label className="canvas-shot-field">
                    <span>名称</span>
                    <Input
                      value={subject.name}
                      onChange={(event) => updateSubject(subject.id, { name: event.target.value })}
                    />
                  </label>
                  <label className="canvas-shot-field">
                    <span>层次</span>
                    <Select
                      value={subject.layer}
                      options={[
                        { label: '前景', value: 'foreground' },
                        { label: '中景', value: 'midground' },
                        { label: '背景', value: 'background' },
                      ]}
                      onChange={(value) => updateSubject(subject.id, { layer: value })}
                    />
                  </label>
                  <label className="canvas-shot-field">
                    <span>X</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={subject.x}
                      onChange={(event) =>
                        updateSubject(subject.id, {
                          x: clampPercent(parseNumericInput(event.target.value, subject.x)),
                        })
                      }
                    />
                  </label>
                  <label className="canvas-shot-field">
                    <span>Y</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={subject.y}
                      onChange={(event) =>
                        updateSubject(subject.id, {
                          y: clampPercent(parseNumericInput(event.target.value, subject.y)),
                        })
                      }
                    />
                  </label>
                  <label className="canvas-shot-field">
                    <span>朝向</span>
                    <input
                      type="number"
                      min={0}
                      max={359}
                      value={subject.facing}
                      onChange={(event) =>
                        updateSubject(subject.id, {
                          facing: parseNumericInput(event.target.value, subject.facing),
                        })
                      }
                    />
                  </label>
                  <label className="canvas-shot-field canvas-shot-field-wide">
                    <span>描述</span>
                    <Input
                      value={subject.description}
                      onChange={(event) =>
                        updateSubject(subject.id, { description: event.target.value })
                      }
                    />
                  </label>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="canvas-shot-director-preview">
          <div className="canvas-shot-preview-stage">
            <div
              className="canvas-shot-camera"
              style={{ left: `${camera.x}%`, top: `${camera.y}%` }}
            >
              <Icons.Film size={16} />
            </div>
            <div
              className="canvas-shot-camera-cone"
              style={{ left: `${camera.x}%`, top: `${camera.y}%` }}
            />
            {keyframes.map((keyframe, index) => (
              <div
                key={keyframe.id}
                className="canvas-shot-keyframe-dot"
                style={{ left: `${keyframe.x}%`, top: `${keyframe.y}%` }}
              >
                {index + 1}
              </div>
            ))}
            {subjects.map((subject) => (
              <div
                key={subject.id}
                className={`canvas-shot-subject-marker canvas-shot-subject-${subject.kind}`}
                style={{ left: `${subject.x}%`, top: `${subject.y}%` }}
                title={subject.name}
              >
                <span
                  className="canvas-shot-facing"
                  style={{ transform: `rotate(${subject.facing}deg)` }}
                />
                <strong>{subject.name.slice(0, 2)}</strong>
              </div>
            ))}
          </div>

          <div className="canvas-shot-camera-panel">
            <div className="canvas-shot-section-head">
              <strong>镜头</strong>
              <Tag color="purple">{MOVE_LABEL[camera.movement]}</Tag>
            </div>
            <div className="canvas-shot-grid-form">
              <label className="canvas-shot-field">
                <span>景别</span>
                <Select
                  value={camera.shotSize}
                  options={[
                    { label: '远景', value: 'wide' },
                    { label: '全身', value: 'full' },
                    { label: '中景', value: 'medium' },
                    { label: '特写', value: 'close-up' },
                  ]}
                  onChange={(value) => setCamera((current) => ({ ...current, shotSize: value }))}
                />
              </label>
              <label className="canvas-shot-field">
                <span>角度</span>
                <Select
                  value={camera.angle}
                  options={[
                    { label: '平视', value: 'eye-level' },
                    { label: '俯拍', value: 'high-angle' },
                    { label: '仰拍', value: 'low-angle' },
                    { label: '顶拍', value: 'top-down' },
                  ]}
                  onChange={(value) => setCamera((current) => ({ ...current, angle: value }))}
                />
              </label>
              <label className="canvas-shot-field">
                <span>目标</span>
                <Select
                  value={camera.target}
                  options={cameraTargetOptions}
                  onChange={(value) => setCamera((current) => ({ ...current, target: value }))}
                />
              </label>
              <label className="canvas-shot-field">
                <span>运镜</span>
                <Select
                  value={camera.movement}
                  options={[
                    { label: '固定', value: 'static' },
                    { label: '推进', value: 'dolly-in' },
                    { label: '拉远', value: 'dolly-out' },
                    { label: '跟拍', value: 'tracking' },
                    { label: '环绕', value: 'orbit' },
                    { label: '升降', value: 'crane-up' },
                  ]}
                  onChange={(value) => setCamera((current) => ({ ...current, movement: value }))}
                />
              </label>
              <label className="canvas-shot-field">
                <span>镜头 X</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={camera.x}
                  onChange={(event) =>
                    setCamera((current) => ({
                      ...current,
                      x: clampPercent(parseNumericInput(event.target.value, current.x)),
                    }))
                  }
                />
              </label>
              <label className="canvas-shot-field">
                <span>镜头 Y</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={camera.y}
                  onChange={(event) =>
                    setCamera((current) => ({
                      ...current,
                      y: clampPercent(parseNumericInput(event.target.value, current.y)),
                    }))
                  }
                />
              </label>
              <label className="canvas-shot-field">
                <span>高度 m</span>
                <input
                  type="number"
                  step="0.1"
                  min={0.2}
                  max={12}
                  value={camera.z}
                  onChange={(event) =>
                    setCamera((current) => ({
                      ...current,
                      z: parseNumericInput(event.target.value, current.z),
                    }))
                  }
                />
              </label>
              <label className="canvas-shot-field">
                <span>焦段 mm</span>
                <input
                  type="number"
                  min={12}
                  max={120}
                  value={camera.focalLength}
                  onChange={(event) =>
                    setCamera((current) => ({
                      ...current,
                      focalLength: parseNumericInput(event.target.value, current.focalLength),
                    }))
                  }
                />
              </label>
              <label className="canvas-shot-field canvas-shot-field-wide">
                <span>构图</span>
                <Input
                  value={camera.composition}
                  onChange={(event) =>
                    setCamera((current) => ({ ...current, composition: event.target.value }))
                  }
                />
              </label>
            </div>
          </div>
        </div>

        <div className="canvas-shot-director-right">
          <div className="canvas-shot-section-head">
            <strong>运镜关键帧</strong>
            <Button size="small" icon={<Icons.Plus size={14} />} onClick={addKeyframe}>
              关键帧
            </Button>
          </div>
          <div className="canvas-shot-keyframes">
            {keyframes.map((keyframe) => (
              <article key={keyframe.id} className="canvas-shot-keyframe-card">
                <div className="canvas-shot-grid-form">
                  <label className="canvas-shot-field">
                    <span>秒</span>
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={keyframe.time}
                      onChange={(event) =>
                        updateKeyframe(keyframe.id, {
                          time: parseNumericInput(event.target.value, keyframe.time),
                        })
                      }
                    />
                  </label>
                  <label className="canvas-shot-field">
                    <span>X</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={keyframe.x}
                      onChange={(event) =>
                        updateKeyframe(keyframe.id, {
                          x: clampPercent(parseNumericInput(event.target.value, keyframe.x)),
                        })
                      }
                    />
                  </label>
                  <label className="canvas-shot-field">
                    <span>Y</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={keyframe.y}
                      onChange={(event) =>
                        updateKeyframe(keyframe.id, {
                          y: clampPercent(parseNumericInput(event.target.value, keyframe.y)),
                        })
                      }
                    />
                  </label>
                  <label className="canvas-shot-field canvas-shot-field-wide">
                    <span>看向</span>
                    <Input
                      value={keyframe.target}
                      onChange={(event) =>
                        updateKeyframe(keyframe.id, { target: event.target.value })
                      }
                    />
                  </label>
                </div>
              </article>
            ))}
          </div>

          <div className="canvas-shot-prompt-box">
            <div className="canvas-shot-prompt-tabs">
              <button
                type="button"
                className={promptMode === 'image' ? 'active' : ''}
                onClick={() => setPromptMode('image')}
              >
                生图
              </button>
              <button
                type="button"
                className={promptMode === 'video' ? 'active' : ''}
                onClick={() => setPromptMode('video')}
              >
                视频
              </button>
            </div>
            <textarea value={activePrompt} readOnly />
            <div className="canvas-shot-prompt-actions">
              <Button size="small" icon={<Icons.Copy size={14} />} onClick={() => void copyPrompt()}>
                复制
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<Icons.FilePlus size={14} />}
                onClick={() => void insertPrompt()}
              >
                插入画布
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
