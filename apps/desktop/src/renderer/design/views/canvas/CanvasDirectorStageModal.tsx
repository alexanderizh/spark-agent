import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Input, Modal, Select, message } from 'antd'
import { Icons } from '../../Icons'
import type { CanvasNode } from './canvas.types'

type Vec3 = { x: number; y: number; z: number }
type Rotation3 = { yaw: number; pitch: number; roll: number }
type StageObjectKind = 'character' | 'prop' | 'camera'

type StageObject = {
  id: string
  kind: StageObjectKind
  name: string
  color: string
  position: Vec3
  rotation: Rotation3
  pose?: string
}

export type DirectorStageData = {
  version: 1
  objects: StageObject[]
  activeObjectId?: string
  gridSize: number
  prompt?: string
}

const defaultCamera: StageObject = {
  id: 'cam-1',
  kind: 'camera',
  name: '机位1',
  color: '#f59e0b',
  position: { x: -2, y: 0.45, z: 2.2 },
  rotation: { yaw: 35, pitch: -8, roll: 0 },
}

const defaultCharacter: StageObject = {
  id: 'char-1',
  kind: 'character',
  name: '角色A',
  color: '#60a5fa',
  position: { x: 0, y: 0.85, z: 0 },
  rotation: { yaw: 180, pitch: 0, roll: 0 },
  pose: '站立，面向镜头',
}

function createDefaultDirectorStageDataInternal(): DirectorStageData {
  return {
    version: 1,
    gridSize: 0.5,
    activeObjectId: 'cam-1',
    objects: [defaultCamera, defaultCharacter],
  }
}

function readDirectorStageData(node: CanvasNode | null | undefined): DirectorStageData {
  const raw = node?.data.directorStage
  if (!raw || typeof raw !== 'object') return createDefaultDirectorStageData()
  const data = raw as Partial<DirectorStageData>
  const objects = Array.isArray(data.objects) ? data.objects.filter(isStageObject) : []
  const hasCamera = objects.some((item) => item.kind === 'camera')
  return {
    version: 1,
    gridSize: typeof data.gridSize === 'number' && data.gridSize > 0 ? data.gridSize : 0.5,
    activeObjectId: data.activeObjectId ?? objects[0]?.id ?? 'cam-1',
    objects: hasCamera ? objects : [defaultCamera, ...objects],
    ...(typeof data.prompt === 'string' ? { prompt: data.prompt } : {}),
  }
}

function isStageObject(value: unknown): value is StageObject {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<StageObject>
  return Boolean(item.id && item.name && item.kind && item.position && item.rotation)
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function snap(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize
}

function buildDirectorPrompt(data: DirectorStageData): string {
  const cameras = data.objects.filter((item) => item.kind === 'camera')
  const objects = data.objects.filter((item) => item.kind !== 'camera')
  return [
    '3D 导演台编排：真实三维空间，地面 XY 中心点为 (0, 0)，Z 为高度。',
    `摄像机：${cameras.map((camera) => `${camera.name} 位于 x=${camera.position.x.toFixed(2)}, y=${camera.position.y.toFixed(2)}, z=${camera.position.z.toFixed(2)}m，朝向 yaw=${camera.rotation.yaw}°, pitch=${camera.rotation.pitch}°`).join('；')}`,
    `人物/物体：${objects.map((item) => `${item.name}(${item.kind}) 位于 x=${item.position.x.toFixed(2)}, y=${item.position.y.toFixed(2)}, z=${item.position.z.toFixed(2)}m，朝向 yaw=${item.rotation.yaw}°${item.pose ? `，姿势：${item.pose}` : ''}`).join('；') || '暂无'}`,
    '请按以上三维站位、人物朝向、镜头位置与焦点关系生成画面/镜头提示词。',
  ].join('\n')
}

export const createDefaultDirectorStageData = createDefaultDirectorStageDataInternal

export function CanvasDirectorStageModal({
  node,
  open,
  onClose,
  onSave,
}: {
  node: CanvasNode | null
  open: boolean
  onClose: () => void
  onSave: (data: DirectorStageData, prompt: string) => Promise<void>
}) {
  const initial = useMemo(() => readDirectorStageData(node), [node])
  const [draft, setDraft] = useState<DirectorStageData>(initial)
  const [drag, setDrag] = useState<{
    id: string
    startX: number
    startY: number
    start: Vec3
  } | null>(null)
  const active = draft.objects.find((item) => item.id === draft.activeObjectId) ?? draft.objects[0]
  const prompt = buildDirectorPrompt(draft)

  const updateActive = (patch: Partial<StageObject>) => {
    if (!active) return
    setDraft((current) => ({
      ...current,
      objects: current.objects.map((item) =>
        item.id === active.id ? { ...item, ...patch } : item,
      ),
    }))
  }

  const addObject = (kind: StageObjectKind) => {
    const object: StageObject = {
      id: makeId(kind === 'camera' ? 'cam' : kind === 'character' ? 'char' : 'prop'),
      kind,
      name:
        kind === 'camera'
          ? `机位${draft.objects.filter((item) => item.kind === 'camera').length + 1}`
          : kind === 'character'
            ? `角色${draft.objects.filter((item) => item.kind === 'character').length + 1}`
            : `道具${draft.objects.filter((item) => item.kind === 'prop').length + 1}`,
      color: kind === 'camera' ? '#f59e0b' : kind === 'character' ? '#60a5fa' : '#f8fafc',
      position: {
        x: kind === 'camera' ? -2 : 1,
        y: kind === 'camera' ? 0.45 : 0.8,
        z: kind === 'camera' ? 2 : 0,
      },
      rotation: { yaw: kind === 'camera' ? 35 : 180, pitch: 0, roll: 0 },
      ...(kind === 'character' ? { pose: '站立' } : {}),
    }
    setDraft((current) => ({
      ...current,
      activeObjectId: object.id,
      objects: [...current.objects, object],
    }))
  }

  const removeActive = () => {
    if (!active) return
    if (
      active.kind === 'camera' &&
      draft.objects.filter((item) => item.kind === 'camera').length <= 1
    ) {
      message.warning('每个导演台至少需要一个摄像机')
      return
    }
    setDraft((current) => {
      const objects = current.objects.filter((item) => item.id !== active.id)
      return { ...current, objects, ...(objects[0]?.id ? { activeObjectId: objects[0].id } : {}) }
    })
  }

  const beginDrag = (object: StageObject, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraft((current) => ({ ...current, activeObjectId: object.id }))
    setDrag({ id: object.id, startX: event.clientX, startY: event.clientY, start: object.position })
  }

  const handleDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const dx = (event.clientX - drag.startX) / 44
    const dz = (event.clientY - drag.startY) / 44
    setDraft((current) => ({
      ...current,
      objects: current.objects.map((item) =>
        item.id === drag.id
          ? {
              ...item,
              position: {
                ...item.position,
                x: snap(clamp(drag.start.x + dx, -5, 5), current.gridSize),
                z: snap(clamp(drag.start.z + dz, -5, 5), current.gridSize),
              },
            }
          : item,
      ),
    }))
  }

  const save = async () => {
    await onSave({ ...draft, prompt }, prompt)
    message.success('导演台已保存')
  }

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt)
    message.success('已复制导演台提示词')
  }

  const exportShot = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#05070d'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#123244'
    for (let i = 0; i < 24; i += 1) {
      const x = 120 + i * 44
      ctx.beginPath()
      ctx.moveTo(x, 160)
      ctx.lineTo(x - 260, 650)
      ctx.stroke()
      const y = 190 + i * 20
      ctx.beginPath()
      ctx.moveTo(60, y)
      ctx.lineTo(1220, y)
      ctx.stroke()
    }
    draft.objects.forEach((item) => {
      const x = 640 + item.position.x * 90
      const y = 520 - item.position.z * 58 - item.position.y * 46
      ctx.fillStyle = item.color
      ctx.beginPath()
      ctx.arc(x, y, item.kind === 'camera' ? 18 : 24, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = '18px sans-serif'
      ctx.fillText(item.name, x + 24, y - 12)
    })
    const link = document.createElement('a')
    link.download = `${node?.title ?? 'director-stage'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="92vw"
      className="canvas-director-stage-modal"
      title="3D 导演台节点"
    >
      <div className="canvas-director-stage-shell">
        <aside className="canvas-director-stage-tools">
          <Button onClick={() => addObject('character')} icon={<Icons.User size={14} />}>
            添加人物
          </Button>
          <Button onClick={() => addObject('camera')} icon={<Icons.Play size={14} />}>
            添加摄像机
          </Button>
          <Button onClick={() => addObject('prop')} icon={<Icons.Box size={14} />}>
            添加道具
          </Button>
          <Button danger onClick={removeActive} icon={<Icons.Trash size={14} />}>
            删除选中
          </Button>
          <div className="canvas-director-stage-object-list">
            {draft.objects.map((item) => (
              <button
                key={item.id}
                className={item.id === active?.id ? 'active' : ''}
                onClick={() => setDraft((current) => ({ ...current, activeObjectId: item.id }))}
              >
                <span style={{ background: item.color }} />
                {item.name}
                <Tag>{item.kind}</Tag>
              </button>
            ))}
          </div>
        </aside>
        <div
          className="canvas-director-stage-viewport"
          onPointerMove={handleDrag}
          onPointerUp={() => setDrag(null)}
        >
          <div className="canvas-director-stage-world">
            <div className="canvas-director-stage-grid" />
            <div className="canvas-director-stage-origin">XY 中心点 (0,0)</div>
            {draft.objects.map((item) => (
              <button
                key={item.id}
                className={`canvas-director-stage-object ${item.kind} ${item.id === active?.id ? 'active' : ''}`}
                style={{
                  ['--x' as string]: item.position.x,
                  ['--y' as string]: item.position.y,
                  ['--z' as string]: item.position.z,
                  ['--yaw' as string]: `${item.rotation.yaw}deg`,
                  ['--color' as string]: item.color,
                }}
                onPointerDown={(event) => beginDrag(item, event)}
              >
                <span className="canvas-director-stage-label">{item.name}</span>
                <span className="canvas-director-stage-gizmo">
                  <i className="x" />
                  <i className="y" />
                  <i className="z" />
                </span>
              </button>
            ))}
          </div>
        </div>
        <aside className="canvas-director-stage-inspector">
          {active && (
            <>
              <Input value={active.name} onChange={(e) => updateActive({ name: e.target.value })} />
              <Select
                value={active.kind}
                disabled
                options={[
                  { value: 'character', label: '人物' },
                  { value: 'camera', label: '摄像机' },
                  { value: 'prop', label: '道具' },
                ]}
              />
              {(['x', 'y', 'z'] as const).map((axis) => (
                <label key={axis}>
                  {axis.toUpperCase()}
                  <Input
                    type="number"
                    value={active.position[axis]}
                    step={0.1}
                    onChange={(e) =>
                      updateActive({
                        position: { ...active.position, [axis]: Number(e.target.value) },
                      })
                    }
                  />
                </label>
              ))}
              {(['yaw', 'pitch', 'roll'] as const).map((axis) => (
                <label key={axis}>
                  {axis}
                  <Input
                    type="number"
                    value={active.rotation[axis]}
                    onChange={(e) =>
                      updateActive({
                        rotation: { ...active.rotation, [axis]: Number(e.target.value) },
                      })
                    }
                  />
                </label>
              ))}
              {active.kind === 'character' && (
                <Input.TextArea
                  value={active.pose}
                  onChange={(e) => updateActive({ pose: e.target.value })}
                  placeholder="姿势/动作描述"
                />
              )}
            </>
          )}
          <Input.TextArea value={prompt} autoSize={{ minRows: 6, maxRows: 10 }} readOnly />
          <div className="canvas-director-stage-actions">
            <Button onClick={copyPrompt}>输出提示词</Button>
            <Button onClick={exportShot}>导出截图</Button>
            <Button type="primary" onClick={save}>
              保存
            </Button>
          </div>
        </aside>
      </div>
    </Modal>
  )
}
