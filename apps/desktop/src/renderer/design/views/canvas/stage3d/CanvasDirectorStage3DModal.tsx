import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Dropdown, Input, Segmented, Select, Slider, message } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../../Icons'
import type { CanvasNode } from '../canvas.types'
import { Scene3D, type Scene3DHandle } from './Scene3D'
import {
  createDefaultStage3DData,
  defaultStage3DLighting,
  makeStage3DActor,
  makeStage3DShot,
  readStage3DData,
  STAGE3D_ACTOR_COLORS,
  STAGE3D_ASPECTS,
  STAGE3D_BODY_TYPE_LABEL,
  STAGE3D_BODY_TYPES,
  STAGE3D_LIGHTING_LABEL,
  STAGE3D_LIGHTING_PRESETS,
  clamp,
  type Stage3DActor,
  type Stage3DBackdropMode,
  type Stage3DBodyType,
  type Stage3DCamera,
  type Stage3DData,
  type Stage3DProp,
  type Stage3DShot,
} from './stage3d.types'
import {
  JOINT_GROUPS,
  JOINT_LABEL,
  POSE_PRESETS,
  getPose,
  type JointId,
  type Vec3,
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

/** macOS 无边框窗口红绿灯安全区（顶栏左侧留白，避免标题被交通灯压住） */
const isPlatformDarwin =
  typeof window !== 'undefined' && window.spark?.platform === 'darwin'

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
  onExportScreenshots,
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
  /** 批量导出全部镜头（C1）：每张带标题与各自提示词 */
  onExportScreenshots?: (
    inputs: { dataUrl: string; title: string; prompt: string }[],
  ) => Promise<void> | void
}) {
  const initial = useMemo(
    () => (node ? readStage3DData(node) : createDefaultStage3DData()),
    [node],
  )
  const [draft, setDraft] = useState<Stage3DData>(initial)
  const [cameraPreview, setCameraPreview] = useState(false)
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate'>('translate')
  /** 吸附对齐（问题 4）：默认开启，对齐半格网格与 15° 步进 */
  const [snap, setSnap] = useState(true)
  /** 构图参考线（C3）：纯 DOM overlay，不进入截图 */
  const [guide, setGuide] = useState<'none' | 'thirds' | 'cross'>('none')
  /** 摆姿势模式（T2）：选中人偶后可在视口用环+IK 直接摆姿势 */
  const [poseMode, setPoseMode] = useState(false)
  const sceneRef = useRef<Scene3DHandle>(null)

  const prompt = useMemo(() => buildStage3DPrompt(draft), [draft])

  const activeActor = draft.actors.find((a) => a.id === draft.activeId) ?? null
  const activeProp = draft.props.find((p) => p.id === draft.activeId) ?? null
  const activeIsCamera = draft.activeId === 'camera'

  // ─────────── 更新 helpers ───────────
  const setActive = useCallback((id: string | null) => {
    setDraft((d) => {
      // 切换选中对象（非当前人偶）时自动退出摆姿势模式，避免对着别的对象留着 Gizmo
      if (id !== d.activeId) setPoseMode(false)
      return { ...d, activeId: id ?? undefined }
    })
  }, [])

  // Esc 退出摆姿势模式
  useEffect(() => {
    if (!poseMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPoseMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [poseMode])

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

  /**
   * 写入整个关节的最终欧拉角（弧度，来自 PoseGizmo 的视口交互）。
   * 存储语义与滑杆一致：joints 是「叠加在预设之上的覆盖」，故 override = 最终值 − 预设基准。
   */
  const setActorJointEuler = useCallback(
    (id: string, jointId: JointId, euler: Vec3) => {
      setDraft((d) => ({
        ...d,
        actors: d.actors.map((a) => {
          if (a.id !== id) return a
          const base = getPose(a.pose)[jointId] ?? [0, 0, 0]
          const joints = { ...(a.joints ?? {}) }
          joints[jointId] = [euler[0] - base[0], euler[1] - base[1], euler[2] - base[2]]
          return { ...a, joints }
        }),
      }))
    },
    [],
  )

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

  // ─────────── 镜头列表（C1） ───────────
  const shots = draft.shots ?? []

  const saveCurrentAsShot = useCallback(() => {
    setDraft((d) => {
      const list = d.shots ?? []
      const shot = makeStage3DShot(d.camera, list.length)
      return { ...d, shots: [...list, shot] }
    })
    message.success('已保存当前机位为镜头')
  }, [])

  const updateShot = useCallback((id: string, patch: Partial<Stage3DShot>) => {
    setDraft((d) => ({
      ...d,
      shots: (d.shots ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }))
  }, [])

  const removeShot = useCallback((id: string) => {
    setDraft((d) => ({ ...d, shots: (d.shots ?? []).filter((s) => s.id !== id) }))
  }, [])

  const duplicateShot = useCallback((id: string) => {
    setDraft((d) => {
      const list = d.shots ?? []
      const src = list.find((s) => s.id === id)
      if (!src) return d
      const copy = makeStage3DShot(
        { position: src.position, target: src.target, fov: src.fov, aspect: src.aspect },
        list.length,
        { name: `${src.name} 副本`, shotNumber: src.shotNumber },
      )
      return { ...d, shots: [...list, copy] }
    })
  }, [])

  /** 切换到某镜头：把镜头参数写回工作机位（camera），主视口/取景随之跳转 */
  const applyShot = useCallback((shot: Stage3DShot) => {
    setDraft((d) => ({
      ...d,
      camera: {
        position: [...shot.position],
        target: [...shot.target],
        fov: shot.fov,
        aspect: shot.aspect,
      },
      activeId: 'camera',
    }))
  }, [])

  const exportAllShots = useCallback(async () => {
    if (shots.length === 0) {
      message.warning('还没有保存任何镜头')
      return
    }
    if (!onExportScreenshots) return
    const inputs: { dataUrl: string; title: string; prompt: string }[] = []
    for (const shot of shots) {
      const cam: Stage3DCamera = {
        position: [...shot.position],
        target: [...shot.target],
        fov: shot.fov,
        aspect: shot.aspect,
      }
      const dataUrl = sceneRef.current?.screenshot(cam)
      if (!dataUrl) continue
      // 各镜头独立提示词（机位取该 shot）
      const shotPrompt = buildStage3DPrompt(draft, cam)
      // 命名优先用场记板「场次-镜号」，否则用镜号/镜头名
      const slate = draft.slate
      const scenePart = slate?.scene ? `${slate.scene}-` : ''
      const numberPart = shot.shotNumber || slate?.shotNumber || ''
      const title = numberPart
        ? `${scenePart}${numberPart} ${shot.name}`.trim()
        : shot.name
      inputs.push({ dataUrl, title, prompt: shotPrompt })
    }
    if (inputs.length === 0) {
      message.error('镜头截图失败，请重试')
      return
    }
    await onExportScreenshots(inputs)
  }, [draft, onExportScreenshots, shots])

  // ─────────── 灯光（C2） ───────────
  const lighting = draft.lighting ?? defaultStage3DLighting()
  const setLighting = useCallback(
    (patch: Partial<Stage3DData['lighting'] & object>) => {
      setDraft((d) => ({
        ...d,
        lighting: { ...(d.lighting ?? defaultStage3DLighting()), ...patch },
      }))
    },
    [],
  )

  // ─────────── 场记板（C4） ───────────
  const setSlate = useCallback((patch: Partial<NonNullable<Stage3DData['slate']>>) => {
    setDraft((d) => {
      const base = d.slate ?? { scene: '', shotNumber: '', take: '' }
      return { ...d, slate: { ...base, ...patch } }
    })
  }, [])

  if (!open) return null

  const bgNode = draft.backdrop.sourceNodeId
    ? imageNodes.find((n) => n.id === draft.backdrop.sourceNodeId)
    : undefined
  const backdropImageOptions = imageNodes.map((n) => ({
    value: n.id,
    title: n.title,
    label: (
      <div className="stage3d-select-option">
        <img
          className="stage3d-select-thumb"
          src={normalizeEduAssetUrl(n.thumbnailUrl ?? n.url)}
          alt={n.title}
          loading="lazy"
        />
        <span className="stage3d-select-name">{n.title}</span>
      </div>
    ),
  }))

  return (
    <div className="stage3d-modal-overlay" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="stage3d-shell">
        {/* 顶栏 */}
        <div
          className={`stage3d-topbar${isPlatformDarwin ? ' platform-darwin-safe-area' : ''}`}
        >
          <div className="stage3d-titlebox">
            <div className="stage3d-kicker">3D Director Stage</div>
            <div className="stage3d-title">{node?.title ?? '3D 导演台'}</div>
          </div>
          <div className="stage3d-topbar-actions">
            <Button
              size="middle"
              type={cameraPreview ? 'primary' : 'default'}
              icon={<Icons.Eye size={14} />}
              onClick={() => setCameraPreview((v) => !v)}
            >
              {cameraPreview ? '退出取景视角' : '进入取景视角'}
            </Button>
            <Button size="middle" icon={<Icons.Image size={14} />} onClick={captureScreenshot}>
              截图入画布
            </Button>
            {onExportScreenshots && (
              <Button
                size="middle"
                icon={<Icons.Film size={14} />}
                disabled={shots.length === 0}
                onClick={exportAllShots}
              >
                导出全部镜头{shots.length > 0 ? `（${shots.length}）` : ''}
              </Button>
            )}
            <Button size="middle" icon={<Icons.Copy size={14} />} onClick={copyPrompt}>
              复制提示词
            </Button>
            {onInsertPrompt && (
              <Button size="middle" icon={<Icons.FileText size={14} />} onClick={insertPrompt}>
                提示词节点
              </Button>
            )}
            <Button size="middle" type="primary" icon={<Icons.Check size={14} />} onClick={save}>
              保存
            </Button>
            <Button size="middle" type="text" icon={<Icons.X size={16} />} onClick={onClose} />
          </div>
        </div>

        <div className="stage3d-body">
          {/* 左：工具栏 */}
          <aside className="stage3d-tools">
            <div className="stage3d-section-title">添加角色</div>
            <Button
              block
              size="middle"
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
                <Button block size="middle" icon={<Icons.Users size={14} />}>
                  绑定画布角色
                </Button>
              </Dropdown>
            )}

            <div className="stage3d-section-title">添加几何道具</div>
            <div className="stage3d-prim-grid">
              {PRIMITIVE_DEFS.map((p) => (
                <Button key={p.id} size="middle" onClick={() => addPrimitive(p.id)}>
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
              size="middle"
              block
              value={draft.backdrop.mode}
              onChange={(v) => setBackdropMode(v as Stage3DBackdropMode)}
              options={[
                { label: '网格', value: 'grid' },
                // 全景模式在真机上纹理加载仍不可用（只见暗球），入口暂时隐藏，
                // 渲染/数据链路保留，修复验证后恢复此选项即可。
                { label: '背板', value: 'backdrop' },
              ]}
            />
            {draft.backdrop.mode !== 'grid' && (
              <>
                <div className="stage3d-subtle">
                  选一张场景图作为背板
                </div>
                {imageNodes.length === 0 ? (
                  <div className="stage3d-tip">画布中暂无图片节点，先生成/上传一张图片再回来选取。</div>
                ) : (
                  <Select
                    size="middle"
                    className="stage3d-image-select"
                    placeholder="选择背板图"
                    allowClear
                    showSearch
                    optionFilterProp="title"
                    value={bgNode?.id}
                    options={backdropImageOptions}
                    popupClassName="stage3d-image-select-popup"
                    onChange={(id) => setBackdropImage(imageNodes.find((n) => n.id === id) ?? null)}
                  />
                )}
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
              size="middle"
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
              snap={snap}
              poseMode={poseMode}
              onActorJointEuler={setActorJointEuler}
              onActorDoubleClick={(id) => {
                setActive(id)
                setPoseMode(true)
              }}
              onSelect={setActive}
              onActorTransform={handleActorTransform}
              onPropTransform={handlePropTransform}
              onCameraTransform={handleCameraTransform}
            />
            {cameraPreview && <div className="stage3d-frame-mask" data-aspect={draft.camera.aspect} />}
            {/* C3 构图参考线：纯 DOM overlay，只在取景预览时显示，不参与离屏截图 */}
            {cameraPreview && guide !== 'none' && (
              <div className={`stage3d-guide stage3d-guide-${guide}`} aria-hidden />
            )}
            {!cameraPreview && (
              <div className="stage3d-viewport-toolbar">
                <Segmented
                  size="middle"
                  value={transformMode}
                  onChange={(v) => setTransformMode(v as 'translate' | 'rotate')}
                  options={[
                    { label: '移动', value: 'translate' },
                    { label: '旋转', value: 'rotate' },
                  ]}
                />
                <Button
                  size="middle"
                  type={snap ? 'primary' : 'default'}
                  icon={<Icons.Grid size={13} />}
                  onClick={() => setSnap((v) => !v)}
                  title="吸附对齐：半格网格 0.25m / 15°"
                >
                  吸附
                </Button>
                {activeActor && (
                  <Button
                    size="middle"
                    type={poseMode ? 'primary' : 'default'}
                    icon={<Icons.User size={13} />}
                    onClick={() => setPoseMode((v) => !v)}
                    title="摆姿势：点关节出旋转环、拖手脚末端 IK（Esc 退出）"
                  >
                    摆姿势
                  </Button>
                )}
              </div>
            )}
            {cameraPreview && (
              <div className="stage3d-viewport-toolbar">
                <Segmented
                  size="middle"
                  value={guide}
                  onChange={(v) => setGuide(v as 'none' | 'thirds' | 'cross')}
                  options={[
                    { label: '无参考线', value: 'none' },
                    { label: '三分法', value: 'thirds' },
                    { label: '中心十字', value: 'cross' },
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

            <ShotListPanel
              shots={shots}
              onSaveCurrent={saveCurrentAsShot}
              onApply={applyShot}
              onUpdate={updateShot}
              onDuplicate={duplicateShot}
              onRemove={removeShot}
            />

            <LightingInspector
              preset={lighting.preset}
              intensity={lighting.intensity}
              onPreset={(preset) => setLighting({ preset })}
              onIntensity={(intensity) => setLighting({ intensity })}
            />

            <SlateInspector
              scene={draft.slate?.scene ?? ''}
              shotNumber={draft.slate?.shotNumber ?? ''}
              take={draft.slate?.take ?? ''}
              note={draft.slate?.note ?? ''}
              onChange={setSlate}
            />

            <div className="stage3d-section-title">场景与提示词</div>
            <label className="stage3d-field">
              <span>场景一句话</span>
              <Input
                size="middle"
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
        size="middle"
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

// ─────────────────────────── 镜头列表（C1） ───────────────────────────

function ShotListPanel({
  shots,
  onSaveCurrent,
  onApply,
  onUpdate,
  onDuplicate,
  onRemove,
}: {
  shots: Stage3DShot[]
  onSaveCurrent: () => void
  onApply: (shot: Stage3DShot) => void
  onUpdate: (id: string, patch: Partial<Stage3DShot>) => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <>
      <div className="stage3d-section-title">分镜镜头（{shots.length}）</div>
      <Button
        block
        size="middle"
        icon={<Icons.Plus size={13} />}
        onClick={onSaveCurrent}
      >
        保存当前机位为镜头
      </Button>
      {shots.length === 0 ? (
        <div className="stage3d-tip">
          调整取景相机后点上方按钮存为镜头，可积累多机位分镜，再「导出全部镜头」一次生成一组参考图。
        </div>
      ) : (
        <div className="stage3d-shot-list">
          {shots.map((shot) => (
            <div key={shot.id} className="stage3d-shot-item">
              <div className="stage3d-shot-row">
                <Input
                  size="middle"
                  className="stage3d-shot-number"
                  value={shot.shotNumber}
                  placeholder="镜号"
                  onChange={(e) => onUpdate(shot.id, { shotNumber: e.target.value })}
                />
                <Input
                  size="middle"
                  value={shot.name}
                  placeholder="镜头名"
                  onChange={(e) => onUpdate(shot.id, { name: e.target.value })}
                />
              </div>
              <div className="stage3d-shot-actions">
                <Button size="middle" type="text" icon={<Icons.Eye size={12} />} onClick={() => onApply(shot)}>
                  切换
                </Button>
                <Button size="middle" type="text" icon={<Icons.Copy size={12} />} onClick={() => onDuplicate(shot.id)}>
                  复制
                </Button>
                <Button size="middle" type="text" danger icon={<Icons.Trash size={12} />} onClick={() => onRemove(shot.id)}>
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ─────────────────────────── 场景级布光（C2） ───────────────────────────

function LightingInspector({
  preset,
  intensity,
  onPreset,
  onIntensity,
}: {
  preset: (typeof STAGE3D_LIGHTING_PRESETS)[number]
  intensity: number
  onPreset: (preset: (typeof STAGE3D_LIGHTING_PRESETS)[number]) => void
  onIntensity: (intensity: number) => void
}) {
  return (
    <>
      <div className="stage3d-section-title">场景布光</div>
      <label className="stage3d-field">
        <span>灯光预设</span>
        <Select
          size="middle"
          style={{ width: '100%' }}
          value={preset}
          onChange={(v) => onPreset(v)}
          options={STAGE3D_LIGHTING_PRESETS.map((p) => ({
            value: p,
            label: STAGE3D_LIGHTING_LABEL[p],
          }))}
        />
      </label>
      <label className="stage3d-field">
        <span>光照强度 {intensity.toFixed(1)}×</span>
        <Slider
          min={0.5}
          max={2}
          step={0.1}
          value={intensity}
          onChange={(v) => onIntensity(clamp(v, 0.5, 2))}
        />
      </label>
    </>
  )
}

// ─────────────────────────── 场记板（C4） ───────────────────────────

function SlateInspector({
  scene,
  shotNumber,
  take,
  note,
  onChange,
}: {
  scene: string
  shotNumber: string
  take: string
  note: string
  onChange: (patch: { scene?: string; shotNumber?: string; take?: string; note?: string }) => void
}) {
  return (
    <>
      <div className="stage3d-section-title">场记板</div>
      <div className="stage3d-slate-row">
        <label className="stage3d-field">
          <span>场次</span>
          <Input size="middle" value={scene} placeholder="3" onChange={(e) => onChange({ scene: e.target.value })} />
        </label>
        <label className="stage3d-field">
          <span>镜号</span>
          <Input size="middle" value={shotNumber} placeholder="3A" onChange={(e) => onChange({ shotNumber: e.target.value })} />
        </label>
        <label className="stage3d-field">
          <span>Take</span>
          <Input size="middle" value={take} placeholder="2" onChange={(e) => onChange({ take: e.target.value })} />
        </label>
      </div>
      <label className="stage3d-field">
        <span>场记备注（可选）</span>
        <Input size="middle" value={note} placeholder="例如：情绪高点，注意手部" onChange={(e) => onChange({ note: e.target.value })} />
      </label>
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
          size="middle"
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
      <Button size="middle" block icon={<Icons.Eye size={13} />} onClick={onAim}>
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
        <Input size="middle" value={actor.name} onChange={(e) => onUpdate({ name: e.target.value })} />
      </label>
      <label className="stage3d-field">
        <span>绑定角色节点</span>
        <Select
          size="middle"
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
          size="middle"
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
          size="middle"
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
          <Button size="middle" type="text" onClick={onResetJoints}>
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
        <Input size="middle" value={prop.name} onChange={(e) => onUpdate({ name: e.target.value })} />
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
