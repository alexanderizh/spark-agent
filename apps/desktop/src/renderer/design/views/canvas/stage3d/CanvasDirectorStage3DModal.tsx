import { useCallback, useMemo, useRef, useState } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Dropdown, Input, Segmented, Select, Slider, message } from 'antd'
import { Icons } from '../../../Icons'
import type { CanvasNode } from '../canvas.types'
import { Scene3D, type Scene3DHandle } from './Scene3D'
import {
  createDefaultStage3DData,
  makeStage3DActor,
  readStage3DData,
  STAGE3D_ACTOR_COLORS,
  STAGE3D_ASPECTS,
  STAGE3D_BODY_TYPE_LABEL,
  STAGE3D_BODY_TYPES,
  clamp,
  type Stage3DActor,
  type Stage3DBackdropMode,
  type Stage3DBodyType,
  type Stage3DData,
  type Stage3DProp,
} from './stage3d.types'
import {
  JOINT_GROUPS,
  JOINT_LABEL,
  POSE_PRESETS,
  type JointId,
} from './mannequin'
import {
  GLB_ASSETS,
  GLB_CATEGORY_LABEL,
  GLB_CATEGORY_ORDER,
  PRIMITIVE_DEFS,
  makeGlbProp,
  makePrimitiveProp,
  type GlbAssetDef,
  type GlbCategory,
  type Stage3DPrimitiveShape,
} from './propRegistry'
import { buildStage3DPrompt } from './prompt'
import './stage3d.less'

const RAD = Math.PI / 180

/** 从画布快照里筛出可用作背景/角色绑定的节点 */
type CanvasImageNode = { id: string; title: string; url: string; thumbnailUrl?: string }
type CanvasCharacterNode = { id: string; title: string }

export function CanvasDirectorStage3DModal({
  node,
  open,
  onClose,
  onSave,
  imageNodes,
  characterNodes,
  onInsertPrompt,
  onExportScreenshot,
}: {
  node: CanvasNode | null
  open: boolean
  onClose: () => void
  onSave: (data: Stage3DData, prompt: string) => Promise<void>
  /** 画布中的图片节点（背景选择器用） */
  imageNodes: CanvasImageNode[]
  /** 画布中的角色板节点（角色绑定用） */
  characterNodes: CanvasCharacterNode[]
  onInsertPrompt?: (prompt: string) => Promise<void> | void
  onExportScreenshot?: (input: { dataUrl: string; prompt: string }) => Promise<void> | void
}) {
  const initial = useMemo(
    () => (node ? readStage3DData(node) : createDefaultStage3DData()),
    [node],
  )
  const [draft, setDraft] = useState<Stage3DData>(initial)
  const [cameraPreview, setCameraPreview] = useState(false)
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate'>('translate')
  const sceneRef = useRef<Scene3DHandle>(null)

  const prompt = useMemo(() => buildStage3DPrompt(draft), [draft])

  const activeActor = draft.actors.find((a) => a.id === draft.activeId) ?? null
  const activeProp = draft.props.find((p) => p.id === draft.activeId) ?? null
  const activeIsCamera = draft.activeId === 'camera'

  // ─────────── 更新 helpers ───────────
  const setActive = useCallback((id: string | null) => {
    setDraft((d) => ({ ...d, activeId: id ?? undefined }))
  }, [])

  const updateActor = useCallback((id: string, patch: Partial<Stage3DActor>) => {
    setDraft((d) => ({
      ...d,
      actors: d.actors.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }))
  }, [])

  const updateProp = useCallback((id: string, patch: Partial<Stage3DProp>) => {
    setDraft((d) => ({
      ...d,
      props: d.props.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))
  }, [])

  const updateActorJoint = useCallback(
    (id: string, joint: JointId, axis: 0 | 1 | 2, valueDeg: number) => {
      setDraft((d) => ({
        ...d,
        actors: d.actors.map((a) => {
          if (a.id !== id) return a
          const joints = { ...(a.joints ?? {}) }
          const current = joints[joint] ?? [0, 0, 0]
          const next: [number, number, number] = [...current]
          next[axis] = valueDeg * RAD
          joints[joint] = next
          return { ...a, joints }
        }),
      }))
    },
    [],
  )

  const resetActorJoints = useCallback((id: string) => {
    setDraft((d) => ({
      ...d,
      actors: d.actors.map((a) => (a.id === id ? { ...a, joints: undefined } : a)),
    }))
  }, [])

  // ─────────── 添加 ───────────
  const addActor = useCallback(
    (boundNodeId?: string, boundName?: string) => {
      setDraft((d) => {
        const index = d.actors.length
        const actor = makeStage3DActor(index, {
          ...(boundNodeId ? { boundNodeId } : {}),
          ...(boundName ? { name: boundName } : {}),
        })
        return { ...d, actors: [...d.actors, actor], activeId: actor.id }
      })
    },
    [],
  )

  const addPrimitive = useCallback((shape: Stage3DPrimitiveShape) => {
    setDraft((d) => {
      const prop = makePrimitiveProp(shape, d.props.length)
      return { ...d, props: [...d.props, prop], activeId: prop.id }
    })
  }, [])

  const addGlbProp = useCallback((assetId: string) => {
    const asset = GLB_ASSETS.find((a) => a.id === assetId)
    if (!asset) return
    setDraft((d) => {
      const prop = makeGlbProp(asset, d.props.length)
      return { ...d, props: [...d.props, prop], activeId: prop.id }
    })
  }, [])

  const removeActive = useCallback(() => {
    setDraft((d) => {
      if (!d.activeId || d.activeId === 'camera') return d
      const actors = d.actors.filter((a) => a.id !== d.activeId)
      const props = d.props.filter((p) => p.id !== d.activeId)
      if (actors.length === d.actors.length && props.length === d.props.length) return d
      const safeActors = actors.length > 0 ? actors : [makeStage3DActor(0)]
      return { ...d, actors: safeActors, props, activeId: safeActors[0]?.id }
    })
  }, [])

  // Delete 键删除
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && draft.activeId && draft.activeId !== 'camera') {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        removeActive()
      }
    },
    [draft.activeId, removeActive],
  )

  // ─────────── 变换回调（来自 Scene 的 TransformControls）───────────
  const handleActorTransform = useCallback(
    (id: string, position: [number, number, number], rotationY: number) => {
      updateActor(id, { position, rotationY })
    },
    [updateActor],
  )
  const handlePropTransform = useCallback(
    (id: string, position: [number, number, number], rotationY: number) => {
      updateProp(id, { position, rotationY })
    },
    [updateProp],
  )
  const handleCameraTransform = useCallback(
    (position: [number, number, number], target: [number, number, number]) => {
      setDraft((d) => ({ ...d, camera: { ...d.camera, position, target } }))
    },
    [],
  )

  // ─────────── 背景 ───────────
  const setBackdropMode = useCallback((mode: Stage3DBackdropMode) => {
    setDraft((d) => ({ ...d, backdrop: { ...d.backdrop, mode } }))
  }, [])

  const setBackdropImage = useCallback((imgNode: CanvasImageNode | null) => {
    setDraft((d) => ({
      ...d,
      backdrop: {
        ...d.backdrop,
        ...(imgNode
          ? { imageUrl: imgNode.url, sourceNodeId: imgNode.id }
          : { imageUrl: undefined, sourceNodeId: undefined }),
      },
    }))
  }, [])

  // ─────────── 相机 ───────────
  const aimCameraAtSelected = useCallback(() => {
    setDraft((d) => {
      const actor = d.actors.find((a) => a.id === d.activeId)
      const prop = d.props.find((p) => p.id === d.activeId)
      const t = actor?.position ?? prop?.position
      if (!t) return d
      return {
        ...d,
        camera: { ...d.camera, target: [t[0], (actor ? 1 : t[1]) as number, t[2]] },
      }
    })
  }, [])

  // ─────────── 导出 / 保存 ───────────
  const save = useCallback(async () => {
    const next = { ...draft, prompt }
    await onSave(next, prompt)
    setDraft(next)
    message.success('3D 导演台已保存')
  }, [draft, onSave, prompt])

  const copyPrompt = useCallback(async () => {
    await navigator.clipboard.writeText(prompt)
    message.success('已复制提示词')
  }, [prompt])

  const insertPrompt = useCallback(async () => {
    if (onInsertPrompt) await onInsertPrompt(prompt)
  }, [onInsertPrompt, prompt])

  const captureScreenshot = useCallback(async () => {
    const dataUrl = sceneRef.current?.screenshot()
    if (!dataUrl) {
      message.error('截图失败，请重试')
      return
    }
    if (onExportScreenshot) await onExportScreenshot({ dataUrl, prompt })
    else {
      const link = document.createElement('a')
      link.download = `${node?.title ?? 'stage3d'}.png`
      link.href = dataUrl
      link.click()
    }
  }, [node?.title, onExportScreenshot, prompt])

  if (!open) return null

  const bgNode = draft.backdrop.sourceNodeId
    ? imageNodes.find((n) => n.id === draft.backdrop.sourceNodeId)
    : undefined

  return (
    <div className="stage3d-modal-overlay" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="stage3d-shell">
        {/* 顶栏 */}
        <div className="stage3d-topbar">
          <div className="stage3d-titlebox">
            <div className="stage3d-kicker">3D Director Stage</div>
            <div className="stage3d-title">{node?.title ?? '真·3D 导演台'}</div>
          </div>
          <div className="stage3d-topbar-actions">
            <Button
              size="small"
              type={cameraPreview ? 'primary' : 'default'}
              icon={<Icons.Eye size={14} />}
              onClick={() => setCameraPreview((v) => !v)}
            >
              {cameraPreview ? '退出取景视角' : '进入取景视角'}
            </Button>
            <Button size="small" icon={<Icons.Image size={14} />} onClick={captureScreenshot}>
              截图入画布
            </Button>
            <Button size="small" icon={<Icons.Copy size={14} />} onClick={copyPrompt}>
              复制提示词
            </Button>
            {onInsertPrompt && (
              <Button size="small" icon={<Icons.FileText size={14} />} onClick={insertPrompt}>
                提示词节点
              </Button>
            )}
            <Button size="small" type="primary" icon={<Icons.Check size={14} />} onClick={save}>
              保存
            </Button>
            <Button size="small" type="text" icon={<Icons.X size={16} />} onClick={onClose} />
          </div>
        </div>

        <div className="stage3d-body">
          {/* 左：工具栏 */}
          <aside className="stage3d-tools">
            <div className="stage3d-section-title">添加角色</div>
            <Button
              block
              size="small"
              icon={<Icons.User size={14} />}
              onClick={() => addActor()}
            >
              路人角色
            </Button>
            {characterNodes.length > 0 && (
              <Dropdown
                menu={{
                  items: characterNodes.map((c) => ({ key: c.id, label: c.title })),
                  onClick: ({ key }) => {
                    const c = characterNodes.find((x) => x.id === key)
                    if (c) addActor(c.id, c.title)
                  },
                }}
              >
                <Button block size="small" icon={<Icons.Users size={14} />}>
                  绑定画布角色
                </Button>
              </Dropdown>
            )}

            <div className="stage3d-section-title">添加几何道具</div>
            <div className="stage3d-prim-grid">
              {PRIMITIVE_DEFS.map((p) => (
                <Button key={p.id} size="small" onClick={() => addPrimitive(p.id)}>
                  {p.label}
                </Button>
              ))}
            </div>

            <div className="stage3d-section-title">家具（GLB）</div>
            {GLB_ASSETS.length === 0 ? (
              <div className="stage3d-tip">Kenney 家具资产由后续阶段接入，当前可用几何道具搭建布局。</div>
            ) : (
              <FurniturePanel onPick={addGlbProp} />
            )}

            <div className="stage3d-section-title">背景</div>
            <Segmented
              size="small"
              block
              value={draft.backdrop.mode}
              onChange={(v) => setBackdropMode(v as Stage3DBackdropMode)}
              options={[
                { label: '网格', value: 'grid' },
                { label: '全景', value: 'panorama' },
                { label: '背板', value: 'backdrop' },
              ]}
            />
            {draft.backdrop.mode !== 'grid' && (
              <>
                <div className="stage3d-subtle">
                  {draft.backdrop.mode === 'panorama' ? '选一张全景图作为环境球' : '选一张场景图作为背板'}
                </div>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  placeholder="从画布图片节点选图"
                  value={bgNode?.id}
                  allowClear
                  onChange={(id) => setBackdropImage(imageNodes.find((n) => n.id === id) ?? null)}
                  options={imageNodes.map((n) => ({ value: n.id, label: n.title }))}
                />
                <label className="stage3d-field">
                  <span>旋转 {Math.round((draft.backdrop.rotationY ?? 0) / RAD)}°</span>
                  <Slider
                    min={-180}
                    max={180}
                    value={Math.round((draft.backdrop.rotationY ?? 0) / RAD)}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, backdrop: { ...d.backdrop, rotationY: v * RAD } }))
                    }
                  />
                </label>
                {draft.backdrop.mode === 'backdrop' && (
                  <label className="stage3d-field">
                    <span>背板距离 {(draft.backdrop.backdropDistance ?? 8).toFixed(0)}</span>
                    <Slider
                      min={3}
                      max={30}
                      value={draft.backdrop.backdropDistance ?? 8}
                      onChange={(v) =>
                        setDraft((d) => ({ ...d, backdrop: { ...d.backdrop, backdropDistance: v } }))
                      }
                    />
                  </label>
                )}
              </>
            )}

            <div className="stage3d-section-title">对象列表</div>
            <div className="stage3d-object-list">
              <button
                className={activeIsCamera ? 'active' : ''}
                onClick={() => setActive('camera')}
              >
                <span className="stage3d-swatch stage3d-swatch-cam">
                  <Icons.Eye size={11} />
                </span>
                取景相机
                <Tag>机位</Tag>
              </button>
              {draft.actors.map((a) => (
                <button
                  key={a.id}
                  className={a.id === draft.activeId ? 'active' : ''}
                  onClick={() => setActive(a.id)}
                >
                  <span className="stage3d-swatch" style={{ background: a.color }}>
                    <Icons.User size={11} />
                  </span>
                  {a.name}
                  <Tag>{a.boundNodeId ? '绑定' : '角色'}</Tag>
                </button>
              ))}
              {draft.props.map((p) => (
                <button
                  key={p.id}
                  className={p.id === draft.activeId ? 'active' : ''}
                  onClick={() => setActive(p.id)}
                >
                  <span className="stage3d-swatch" style={{ background: p.color ?? '#94a3b8' }}>
                    <Icons.Box size={11} />
                  </span>
                  {p.name}
                  <Tag>道具</Tag>
                </button>
              ))}
            </div>
            <Button
              block
              size="small"
              danger
              icon={<Icons.Trash size={13} />}
              disabled={activeIsCamera || !draft.activeId}
              onClick={removeActive}
            >
              删除选中
            </Button>
            <div className="stage3d-tip">
              点击选中对象；拖动坐标轴移动，切换到旋转微调朝向；Delete 删除。
            </div>
          </aside>

          {/* 中：3D 视口 */}
          <div className="stage3d-viewport">
            <Scene3D
              ref={sceneRef}
              data={draft}
              cameraPreview={cameraPreview}
              transformMode={transformMode}
              onSelect={setActive}
              onActorTransform={handleActorTransform}
              onPropTransform={handlePropTransform}
              onCameraTransform={handleCameraTransform}
            />
            {cameraPreview && <div className="stage3d-frame-mask" data-aspect={draft.camera.aspect} />}
            {!cameraPreview && (
              <div className="stage3d-viewport-toolbar">
                <Segmented
                  size="small"
                  value={transformMode}
                  onChange={(v) => setTransformMode(v as 'translate' | 'rotate')}
                  options={[
                    { label: '移动', value: 'translate' },
                    { label: '旋转', value: 'rotate' },
                  ]}
                />
              </div>
            )}
          </div>

          {/* 右：属性面板 */}
          <aside className="stage3d-inspector">
            {activeIsCamera ? (
              <CameraInspector draft={draft} setDraft={setDraft} onAim={aimCameraAtSelected} />
            ) : activeActor ? (
              <ActorInspector
                actor={activeActor}
                characterNodes={characterNodes}
                onUpdate={(patch) => updateActor(activeActor.id, patch)}
                onJoint={(joint, axis, deg) => updateActorJoint(activeActor.id, joint, axis, deg)}
                onResetJoints={() => resetActorJoints(activeActor.id)}
              />
            ) : activeProp ? (
              <PropInspector prop={activeProp} onUpdate={(patch) => updateProp(activeProp.id, patch)} />
            ) : (
              <div className="stage3d-tip">选中一个对象以编辑属性。</div>
            )}

            <div className="stage3d-section-title">场景与提示词</div>
            <label className="stage3d-field">
              <span>场景一句话</span>
              <Input
                size="small"
                value={draft.sceneBrief ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, sceneBrief: e.target.value }))}
                placeholder="例如：黄昏的咖啡馆窗边"
              />
            </label>
            <Input.TextArea
              className="stage3d-prompt"
              value={prompt}
              autoSize={{ minRows: 5, maxRows: 12 }}
              readOnly
            />
          </aside>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────── 家具面板（按类别分组） ───────────────────────────

function FurniturePanel({ onPick }: { onPick: (assetId: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const groups = useMemo(() => {
    const byCategory = new Map<GlbCategory, GlbAssetDef[]>()
    for (const asset of GLB_ASSETS) {
      const list = byCategory.get(asset.category) ?? []
      list.push(asset)
      byCategory.set(asset.category, list)
    }
    return GLB_CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({
      category: c,
      label: GLB_CATEGORY_LABEL[c],
      assets: byCategory.get(c) ?? [],
    }))
  }, [])

  return (
    <>
      <Button
        block
        size="small"
        icon={<Icons.Box size={14} />}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? '收起家具面板' : `选择家具（${GLB_ASSETS.length} 件）`}
      </Button>
      {expanded && (
        <div className="stage3d-furniture-panel">
          {groups.map((group) => (
            <div key={group.category} className="stage3d-furniture-group">
              <div className="stage3d-furniture-group-title">
                {group.label}
                <span>{group.assets.length}</span>
              </div>
              <div className="stage3d-furniture-grid">
                {group.assets.map((asset) => (
                  <button key={asset.id} title={asset.label} onClick={() => onPick(asset.id)}>
                    {asset.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ─────────────────────────── 属性面板：相机 ───────────────────────────

function CameraInspector({
  draft,
  setDraft,
  onAim,
}: {
  draft: Stage3DData
  setDraft: React.Dispatch<React.SetStateAction<Stage3DData>>
  onAim: () => void
}) {
  const { camera } = draft
  const setCam = (patch: Partial<Stage3DData['camera']>) =>
    setDraft((d) => ({ ...d, camera: { ...d.camera, ...patch } }))
  return (
    <>
      <div className="stage3d-section-title">取景相机</div>
      <label className="stage3d-field">
        <span>画幅</span>
        <Segmented
          size="small"
          block
          value={camera.aspect}
          onChange={(v) => setCam({ aspect: v as Stage3DData['camera']['aspect'] })}
          options={STAGE3D_ASPECTS.map((a) => ({ label: a, value: a }))}
        />
      </label>
      <label className="stage3d-field">
        <span>视角 {Math.round(camera.fov)}°（≈{Math.round(24 / (2 * Math.tan((camera.fov * Math.PI) / 360)))}mm）</span>
        <Slider min={12} max={90} value={camera.fov} onChange={(v) => setCam({ fov: v })} />
      </label>
      <label className="stage3d-field">
        <span>相机高度 {camera.position[1].toFixed(1)}m</span>
        <Slider
          min={0.2}
          max={6}
          step={0.1}
          value={camera.position[1]}
          onChange={(v) =>
            setCam({ position: [camera.position[0], v, camera.position[2]] })
          }
        />
      </label>
      <label className="stage3d-field">
        <span>目标高度 {camera.target[1].toFixed(1)}m</span>
        <Slider
          min={0}
          max={3}
          step={0.1}
          value={camera.target[1]}
          onChange={(v) => setCam({ target: [camera.target[0], v, camera.target[2]] })}
        />
      </label>
      <Button size="small" block icon={<Icons.Eye size={13} />} onClick={onAim}>
        对准选中对象
      </Button>
      <div className="stage3d-tip">在视口中拖动相机图标改机位；「进入取景视角」预览最终构图。</div>
    </>
  )
}

// ─────────────────────────── 属性面板：角色 ───────────────────────────

function ActorInspector({
  actor,
  characterNodes,
  onUpdate,
  onJoint,
  onResetJoints,
}: {
  actor: Stage3DActor
  characterNodes: CanvasCharacterNode[]
  onUpdate: (patch: Partial<Stage3DActor>) => void
  onJoint: (joint: JointId, axis: 0 | 1 | 2, deg: number) => void
  onResetJoints: () => void
}) {
  const [showJoints, setShowJoints] = useState(false)
  return (
    <>
      <div className="stage3d-section-title">角色属性</div>
      <label className="stage3d-field">
        <span>名称</span>
        <Input size="small" value={actor.name} onChange={(e) => onUpdate({ name: e.target.value })} />
      </label>
      <label className="stage3d-field">
        <span>绑定角色节点</span>
        <Select
          size="small"
          style={{ width: '100%' }}
          placeholder="不绑定（路人）"
          allowClear
          value={actor.boundNodeId}
          onChange={(id) => {
            const c = characterNodes.find((x) => x.id === id)
            onUpdate({ boundNodeId: id, ...(c ? { name: c.title } : {}) })
          }}
          options={characterNodes.map((c) => ({ value: c.id, label: c.title }))}
        />
      </label>
      <label className="stage3d-field">
        <span>体型</span>
        <Select
          size="small"
          style={{ width: '100%' }}
          value={actor.bodyType}
          onChange={(v) => onUpdate({ bodyType: v as Stage3DBodyType })}
          options={STAGE3D_BODY_TYPES.map((b) => ({
            value: b,
            label: STAGE3D_BODY_TYPE_LABEL[b],
          }))}
        />
      </label>
      <label className="stage3d-field">
        <span>身高缩放 {actor.heightScale.toFixed(2)}×</span>
        <Slider
          min={0.5}
          max={1.5}
          step={0.01}
          value={actor.heightScale}
          onChange={(v) => onUpdate({ heightScale: clamp(v, 0.5, 1.5) })}
        />
      </label>
      <label className="stage3d-field">
        <span>颜色</span>
        <div className="stage3d-color-row">
          {STAGE3D_ACTOR_COLORS.map((c) => (
            <button
              key={c}
              className={`stage3d-color-chip${actor.color === c ? ' active' : ''}`}
              style={{ background: c }}
              onClick={() => onUpdate({ color: c })}
            />
          ))}
          <input
            type="color"
            value={actor.color}
            onChange={(e) => onUpdate({ color: e.target.value })}
          />
        </div>
      </label>
      <label className="stage3d-field">
        <span>朝向 {Math.round(actor.rotationY / RAD)}°</span>
        <Slider
          min={-180}
          max={180}
          value={Math.round(actor.rotationY / RAD)}
          onChange={(v) => onUpdate({ rotationY: v * RAD })}
        />
      </label>
      <label className="stage3d-field">
        <span>姿势预设</span>
        <Select
          size="small"
          style={{ width: '100%' }}
          value={actor.pose}
          onChange={(v) => onUpdate({ pose: v })}
          options={POSE_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        />
      </label>
      <label className="stage3d-field">
        <span>备注 / 表演</span>
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 4 }}
          value={actor.note ?? ''}
          onChange={(e) => onUpdate({ note: e.target.value })}
          placeholder="例如：侧头看向左方，手插口袋"
        />
      </label>

      <div className="stage3d-joint-header">
        <button className="stage3d-collapse-toggle" onClick={() => setShowJoints((v) => !v)}>
          {showJoints ? '▾' : '▸'} 关节微调
        </button>
        {showJoints && (
          <Button size="small" type="text" onClick={onResetJoints}>
            重置
          </Button>
        )}
      </div>
      {showJoints &&
        JOINT_GROUPS.map((group) => (
          <div key={group.label} className="stage3d-joint-group">
            <div className="stage3d-joint-group-title">{group.label}</div>
            {group.joints.map((jointId) => (
              <JointSliders
                key={jointId}
                jointId={jointId}
                value={actor.joints?.[jointId] ?? [0, 0, 0]}
                onChange={(axis, deg) => onJoint(jointId, axis, deg)}
              />
            ))}
          </div>
        ))}
    </>
  )
}

function JointSliders({
  jointId,
  value,
  onChange,
}: {
  jointId: JointId
  value: [number, number, number]
  onChange: (axis: 0 | 1 | 2, deg: number) => void
}) {
  const axes: { axis: 0 | 1 | 2; label: string }[] = [
    { axis: 0, label: 'X' },
    { axis: 1, label: 'Y' },
    { axis: 2, label: 'Z' },
  ]
  return (
    <div className="stage3d-joint-row">
      <div className="stage3d-joint-name">{JOINT_LABEL[jointId]}</div>
      <div className="stage3d-joint-sliders">
        {axes.map(({ axis, label }) => (
          <div key={axis} className="stage3d-joint-axis">
            <span>{label}</span>
            <Slider
              min={-180}
              max={180}
              value={Math.round((value[axis] * 180) / Math.PI)}
              onChange={(v) => onChange(axis, v)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────── 属性面板：道具 ───────────────────────────

function PropInspector({
  prop,
  onUpdate,
}: {
  prop: Stage3DProp
  onUpdate: (patch: Partial<Stage3DProp>) => void
}) {
  return (
    <>
      <div className="stage3d-section-title">道具属性</div>
      <label className="stage3d-field">
        <span>名称</span>
        <Input size="small" value={prop.name} onChange={(e) => onUpdate({ name: e.target.value })} />
      </label>
      <label className="stage3d-field">
        <span>缩放 {prop.scale.toFixed(2)}×</span>
        <Slider
          min={0.1}
          max={5}
          step={0.05}
          value={prop.scale}
          onChange={(v) => onUpdate({ scale: v })}
        />
      </label>
      <label className="stage3d-field">
        <span>朝向 {Math.round(prop.rotationY / RAD)}°</span>
        <Slider
          min={-180}
          max={180}
          value={Math.round(prop.rotationY / RAD)}
          onChange={(v) => onUpdate({ rotationY: v * RAD })}
        />
      </label>
      {prop.kind === 'primitive' && (
        <label className="stage3d-field">
          <span>颜色</span>
          <input
            type="color"
            value={prop.color ?? '#cbd5e1'}
            onChange={(e) => onUpdate({ color: e.target.value })}
          />
        </label>
      )}
    </>
  )
}
