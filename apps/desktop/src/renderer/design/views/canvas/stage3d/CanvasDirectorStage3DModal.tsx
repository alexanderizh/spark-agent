import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Dropdown, Input, Popover, Segmented, Select, Slider, message } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../../Icons'
import type { CanvasNode } from '../canvas.types'
import { Scene3D, type Scene3DHandle } from './Scene3D'
import { PoseEditorModal } from './PoseEditorModal'
import { JointSliders } from './JointSliders'
import {
  createDefaultStage3DData,
  defaultStage3DLighting,
  makeStage3DActor,
  makeStage3DCrowdActors,
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
  type Stage3DActorModelId,
  type Stage3DBackdropMode,
  type Stage3DBodyType,
  type Stage3DCamera,
  type Stage3DData,
  type Stage3DProp,
  type Stage3DShot,
} from './stage3d.types'
import {
  BUILTIN_STAGE3D_ACTOR_MODELS,
  DEFAULT_STAGE3D_ACTOR_MODEL_ID,
  getStage3DActorModel,
} from './actorModelRegistry'
import {
  JOINT_GROUPS,
  JOINT_IDS,
  JOINT_LIMITS,
  POSE_PRESETS,
  composePose,
  copySidePose,
  getPose,
  mirrorPose,
  type AxisLimit,
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
import { makeLocalModelProp, readStage3DLocalModelFile } from './localModelImport'
import { useCanvasUnsavedChangesGuard } from '../useCanvasUnsavedChangesGuard'
import './stage3d.less'

const RAD = Math.PI / 180

/** macOS 无边框窗口红绿灯安全区（顶栏左侧留白，避免标题被交通灯压住） */
const isPlatformDarwin = typeof window !== 'undefined' && window.spark?.platform === 'darwin'

/** 从画布快照里筛出可用作背景/角色绑定的节点 */
type CanvasImageNode = { id: string; title: string; url: string; thumbnailUrl?: string }
type CanvasCharacterNode = { id: string; title: string }

// ─────────────────────────── 姿势编辑撤销/重做（T3 4.1） ───────────────────────────

/** 姿势编辑范围内的可撤销状态：预设 id + 逐关节覆盖。 */
type PoseSnapshot = { pose: string; joints: Record<string, Vec3> | undefined }
type PoseUndoEntry = { actorId: string; before: PoseSnapshot; after: PoseSnapshot }

const UNDO_STACK_LIMIT = 50

function snapshotOf(actor: Stage3DActor): PoseSnapshot {
  return { pose: actor.pose, joints: actor.joints ? { ...actor.joints } : undefined }
}

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
  const initial = useMemo(() => (node ? readStage3DData(node) : createDefaultStage3DData()), [node])
  const [draft, setDraft] = useState<Stage3DData>(initial)
  const savedDraftSignatureRef = useRef(JSON.stringify(initial))
  const loadedNodeIdRef = useRef<string | null | undefined>(undefined)
  const [cameraPreview, setCameraPreview] = useState(false)
  const [viewNavigationMode, setViewNavigationMode] = useState<'orbit' | 'pan'>('orbit')
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate'>('translate')
  /** 吸附对齐（问题 4）：默认开启，对齐半格网格与 15° 步进 */
  const [snap, setSnap] = useState(true)
  /** 构图参考线（C3）：纯 DOM overlay，不进入截图 */
  const [guide, setGuide] = useState<'none' | 'thirds' | 'cross'>('none')
  /** 摆姿势模式（T2）：选中人偶后可在视口用环+IK 直接摆姿势 */
  const [poseMode, setPoseMode] = useState(false)
  /** 全屏姿势编辑页（R2a）：把当前角色扔进 PoseEditorModal 大视口编辑 */
  const [poseEditorOpen, setPoseEditorOpen] = useState(false)
  const [crowdRows, setCrowdRows] = useState(3)
  const [crowdColumns, setCrowdColumns] = useState(4)
  const [crowdSpacing, setCrowdSpacing] = useState(1.2)
  const [newActorModelId, setNewActorModelId] = useState<Stage3DActorModelId>(
    DEFAULT_STAGE3D_ACTOR_MODEL_ID,
  )
  const [toolsCollapsed, setToolsCollapsed] = useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const sceneRef = useRef<Scene3DHandle>(null)
  const localModelInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) {
      loadedNodeIdRef.current = undefined
      return
    }
    // 同一节点在后台快照刷新时会拿到新的对象引用，不能因此覆盖当前未保存草稿。
    if (loadedNodeIdRef.current === (node?.id ?? null)) return
    const next = node ? readStage3DData(node) : createDefaultStage3DData()
    setDraft(next)
    savedDraftSignatureRef.current = JSON.stringify(next)
    loadedNodeIdRef.current = node?.id ?? null
  }, [node, open])

  // ─────────── 姿势编辑撤销/重做（T3 4.1）：per-actor 栈，只记录 pose/joints 变更 ───────────
  const undoStackRef = useRef<PoseUndoEntry[]>([])
  const redoStackRef = useRef<PoseUndoEntry[]>([])
  const [undoRedoTick, setUndoRedoTick] = useState(0) // 仅用于触发按钮禁用态重渲染
  /** 拖拽/滑杆类操作待落栈的「操作前」快照（pointerdown/onFocus 时记录，pointerup/onChangeComplete 时消费）。 */
  const pendingBeforeRef = useRef<{ actorId: string; before: PoseSnapshot } | null>(null)

  // ─────────── undo/redo 纯函数（可单测，无 React 依赖） ───────────
  /** 把一条 PoseUndoEntry 推入 undo 栈，清空 redo 栈（新动作截断 redo 分支），按上限截断。 */
  const pushPoseUndo = useCallback((entry: PoseUndoEntry) => {
    undoStackRef.current.push(entry)
    if (undoStackRef.current.length > UNDO_STACK_LIMIT) {
      undoStackRef.current.shift()
    }
    redoStackRef.current = []
    setUndoRedoTick((t) => t + 1)
  }, [])

  /** 标记一次姿势编辑开始：记录操作前快照（同 actor 重复调用会覆盖，避免连续滑杆产生多条 undo）。 */
  const beginPoseEdit = useCallback(
    (actorId: string) => {
      const a = draft.actors.find((x) => x.id === actorId)
      if (!a) return
      pendingBeforeRef.current = { actorId, before: snapshotOf(a) }
    },
    [draft.actors],
  )

  /** 提交一次姿势编辑：把 before→当前快照 入栈。无 pending 时 no-op。 */
  const commitPoseEdit = useCallback(
    (actorId: string) => {
      const pending = pendingBeforeRef.current
      if (!pending || pending.actorId !== actorId) return
      const a = draft.actors.find((x) => x.id === actorId)
      if (!a) {
        pendingBeforeRef.current = null
        return
      }
      const after = snapshotOf(a)
      // 操作前后无变化则不入栈（避免空操作占位）
      if (
        after.pose === pending.before.pose &&
        JSON.stringify(after.joints ?? {}) === JSON.stringify(pending.before.joints ?? {})
      ) {
        pendingBeforeRef.current = null
        return
      }
      pushPoseUndo({ actorId, before: pending.before, after })
      pendingBeforeRef.current = null
    },
    [draft.actors, pushPoseUndo],
  )

  /** 撤销：弹出最近一条 entry，把 actor 恢复到 before，并把 after 入 redo 栈。 */
  const undoPose = useCallback(() => {
    const entry = undoStackRef.current.pop()
    if (!entry) return
    setDraft((d) => ({
      ...d,
      actors: d.actors.map((a) => {
        if (a.id !== entry.actorId) return a
        return {
          ...a,
          pose: entry.before.pose,
          joints: entry.before.joints ? { ...entry.before.joints } : undefined,
        }
      }),
    }))
    redoStackRef.current.push(entry)
    setUndoRedoTick((t) => t + 1)
  }, [])

  /** 重做：弹出 redo 栈顶，把 actor 推进到 after，并把 before 入 undo 栈。 */
  const redoPose = useCallback(() => {
    const entry = redoStackRef.current.pop()
    if (!entry) return
    setDraft((d) => ({
      ...d,
      actors: d.actors.map((a) => {
        if (a.id !== entry.actorId) return a
        return {
          ...a,
          pose: entry.after.pose,
          joints: entry.after.joints ? { ...entry.after.joints } : undefined,
        }
      }),
    }))
    undoStackRef.current.push(entry)
    setUndoRedoTick((t) => t + 1)
  }, [])

  const canUndo = undoRedoTick >= 0 && undoStackRef.current.length > 0
  const canRedo = undoRedoTick >= 0 && redoStackRef.current.length > 0

  // ─────────── PoseGizmo 拖拽 commit 回调：一次性落 undo 快照 ───────────
  const handleActorPoseDragCommit = useCallback(
    (actorId: string) => {
      // pendingBefore 在拖拽开始时由 Scene3D 透传（见下方 onActorPoseDragBegin）；
      // 若没有 begin（兼容老调用），则把当前视为 before + 立即 commit 也无意义——这里仅 commit。
      commitPoseEdit(actorId)
    },
    [commitPoseEdit],
  )

  // PoseGizmo 拖拽开始钩子：记录操作前快照
  const handleActorPoseDragBegin = useCallback(
    (actorId: string) => {
      beginPoseEdit(actorId)
    },
    [beginPoseEdit],
  )

  // ─────────── Cmd+Z / Cmd+Shift+Z 快捷键（不冒泡到画布） ───────────
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      const tag = (e.target as HTMLElement)?.tagName
      // 在输入框/文本域里不拦截（让浏览器原生 undo 生效）
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) redoPose()
        else undoPose()
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        e.stopPropagation()
        redoPose()
      }
    }
    window.addEventListener('keydown', onKey, true) // capture 阶段抢先，避免被画布吞掉
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, undoPose, redoPose])

  const prompt = useMemo(() => buildStage3DPrompt(draft), [draft])
  const isDirty = JSON.stringify(draft) !== savedDraftSignatureRef.current
  const requestClose = useCanvasUnsavedChangesGuard({
    dirty: isDirty,
    onClose,
    subject: '3D 场景',
  })

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

  /** 滑杆聚焦：标记一次关节微调开始（落 undo before 快照）。 */
  const beginActorJointEdit = useCallback(
    (id: string) => {
      beginPoseEdit(id)
    },
    [beginPoseEdit],
  )
  /** 滑杆释放/失焦：提交 undo entry。 */
  const commitActorJointEdit = useCallback(
    (id: string) => {
      commitPoseEdit(id)
    },
    [commitPoseEdit],
  )

  const resetActorJoints = useCallback(
    (id: string) => {
      // 视为一次完整编辑：直接 before/after 入栈，再清空 joints
      const a = draft.actors.find((x) => x.id === id)
      if (!a) return
      const before = snapshotOf(a)
      const after: PoseSnapshot = { pose: a.pose, joints: undefined }
      pushPoseUndo({ actorId: id, before, after })
      setDraft((d) => ({
        ...d,
        actors: d.actors.map((x) => (x.id === id ? { ...x, joints: undefined } : x)),
      }))
    },
    [draft.actors, pushPoseUndo],
  )

  /**
   * 写入整个关节的最终欧拉角（弧度，来自 PoseGizmo 的视口交互）。
   * 存储语义与滑杆一致：joints 是「叠加在预设之上的覆盖」，故 override = 最终值 − 预设基准。
   */
  const setActorJointEuler = useCallback((id: string, jointId: JointId, euler: Vec3) => {
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
  }, [])

  // ─────────── 添加 ───────────
  const addActor = useCallback(
    (boundNodeId?: string, boundName?: string) => {
      setDraft((d) => {
        const index = d.actors.length
        const model = getStage3DActorModel(newActorModelId)
        const actor = makeStage3DActor(index, {
          modelId: model.id,
          modelSource: model.source,
          rigType: model.rigType,
          ...(boundNodeId ? { boundNodeId } : {}),
          ...(boundName ? { name: boundName } : {}),
        })
        return { ...d, actors: [...d.actors, actor], activeId: actor.id }
      })
    },
    [newActorModelId],
  )

  const addCrowdActors = useCallback(() => {
    setDraft((d) => {
      const rows = Math.round(clamp(crowdRows, 1, 12))
      const columns = Math.round(clamp(crowdColumns, 1, 12))
      const spacing = clamp(crowdSpacing, 0.5, 4)
      const maxZ = d.actors.length > 0 ? Math.max(...d.actors.map((actor) => actor.position[2])) : 0
      const model = getStage3DActorModel(newActorModelId)
      const crowd = makeStage3DCrowdActors(
        d.actors.length,
        {
          rows,
          columns,
          spacing,
          modelId: model.id,
          modelSource: model.source,
          rigType: model.rigType,
        },
        [0, 0, Number((maxZ + spacing * 2).toFixed(4))],
      )
      return {
        ...d,
        actors: [...d.actors, ...crowd],
        activeId: crowd[crowd.length - 1]?.id ?? d.activeId,
      }
    })
  }, [crowdColumns, crowdRows, crowdSpacing, newActorModelId])

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

  const importLocalModel = useCallback(async (file: File | undefined) => {
    if (!file) return
    try {
      const asset = await readStage3DLocalModelFile(file)
      setDraft((d) => {
        const prop = makeLocalModelProp(asset, d.props.length)
        return { ...d, props: [...d.props, prop], activeId: prop.id }
      })
      message.success('本地模型已添加到场景')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '本地模型导入失败')
    }
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
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        draft.activeId &&
        draft.activeId !== 'camera'
      ) {
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
  const handleCrowdTransform = useCallback(
    (crowdId: string, position: [number, number, number], rotationY: number) => {
      setDraft((d) => {
        const members = d.actors.filter((actor) => actor.crowdId === crowdId)
        if (members.length === 0) return d
        const anchor = members.reduce(
          (acc, actor) => {
            acc[0] += actor.position[0]
            acc[1] += actor.position[1]
            acc[2] += actor.position[2]
            return acc
          },
          [0, 0, 0] as [number, number, number],
        )
        const count = members.length
        const anchorPosition: [number, number, number] = [
          anchor[0] / count,
          anchor[1] / count,
          anchor[2] / count,
        ]
        const referenceRotation = members[0]?.rotationY ?? 0
        const deltaRotation = rotationY - referenceRotation
        const cos = Math.cos(deltaRotation)
        const sin = Math.sin(deltaRotation)

        return {
          ...d,
          actors: d.actors.map((actor) => {
            if (actor.crowdId !== crowdId) return actor
            const dx = actor.position[0] - anchorPosition[0]
            const dz = actor.position[2] - anchorPosition[2]
            return {
              ...actor,
              position: [
                Number((position[0] + dx * cos + dz * sin).toFixed(4)),
                Number((position[1] + (actor.position[1] - anchorPosition[1])).toFixed(4)),
                Number((position[2] - dx * sin + dz * cos).toFixed(4)),
              ],
              rotationY: actor.rotationY + deltaRotation,
            }
          }),
        }
      })
    },
    [],
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
    savedDraftSignatureRef.current = JSON.stringify(next)
    message.success('3D 导演台已保存')
  }, [draft, onSave, prompt])

  useEffect(() => {
    if (!open) return
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
      event.preventDefault()
      event.stopPropagation()
      void save()
    }
    window.addEventListener('keydown', onShortcut, true)
    return () => window.removeEventListener('keydown', onShortcut, true)
  }, [open, save])

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
      const title = numberPart ? `${scenePart}${numberPart} ${shot.name}`.trim() : shot.name
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
  const setLighting = useCallback((patch: Partial<Stage3DData['lighting'] & object>) => {
    setDraft((d) => ({
      ...d,
      lighting: { ...(d.lighting ?? defaultStage3DLighting()), ...patch },
    }))
  }, [])

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
        <div className={`stage3d-topbar${isPlatformDarwin ? ' platform-darwin-safe-area' : ''}`}>
          <div className="stage3d-titlebox">
            <div className="stage3d-kicker">3D Director Stage</div>
            <div className="stage3d-title">{node?.title ?? '3D 导演台'}</div>
          </div>
          <div className="stage3d-topbar-actions">
            <Button
              size="small"
              type={toolsCollapsed ? 'primary' : 'text'}
              icon={<Icons.PanelLeft size={14} />}
              onClick={() => setToolsCollapsed((v) => !v)}
              title={toolsCollapsed ? '展开左侧面板' : '折叠左侧面板'}
            />
            <Button
              size="small"
              type={inspectorCollapsed ? 'primary' : 'text'}
              icon={<Icons.PanelRight size={14} />}
              onClick={() => setInspectorCollapsed((v) => !v)}
              title={inspectorCollapsed ? '展开右侧面板' : '折叠右侧面板'}
            />
            <Button
              size="small"
              type={cameraPreview ? 'primary' : 'text'}
              icon={<Icons.Eye size={14} />}
              onClick={() => setCameraPreview((v) => !v)}
            >
              {cameraPreview ? '退出取景视角' : '进入取景视角'}
            </Button>
            <Button
              size="small"
              type="text"
              icon={<Icons.Image size={14} />}
              onClick={captureScreenshot}
            >
              截图入画布
            </Button>
            {onExportScreenshots && (
              <Button
                size="small"
                type="text"
                icon={<Icons.Film size={14} />}
                disabled={shots.length === 0}
                onClick={exportAllShots}
              >
                导出全部镜头{shots.length > 0 ? `（${shots.length}）` : ''}
              </Button>
            )}
            <Button size="small" type="text" icon={<Icons.Copy size={14} />} onClick={copyPrompt}>
              复制提示词
            </Button>
            {onInsertPrompt && (
              <Button
                size="small"
                type="text"
                icon={<Icons.FileText size={14} />}
                onClick={insertPrompt}
              >
                提示词节点
              </Button>
            )}
            <Button size="small" type="text" icon={<Icons.Check size={14} />} onClick={save}>
              保存
            </Button>
            <Button
              size="small"
              type="text"
              icon={<Icons.X size={16} />}
              onClick={requestClose}
              title="关闭（有未保存内容时会提示）"
            />
          </div>
        </div>

        <div className="stage3d-body">
          {/* 左：工具栏 */}
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
            <aside className="stage3d-tools">
              <button
                type="button"
                className="stage3d-panel-collapse stage3d-panel-collapse-left"
                onClick={() => setToolsCollapsed(true)}
                title="折叠左侧面板"
              >
                <Icons.ChevronLeft size={14} />
              </button>
              <div className="stage3d-section-title">添加角色</div>
              <label className="stage3d-field">
                <span>人物模型</span>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  value={newActorModelId}
                  onChange={(id) => setNewActorModelId(id as Stage3DActorModelId)}
                  options={BUILTIN_STAGE3D_ACTOR_MODELS.map((model) => ({
                    value: model.id,
                    label: model.label,
                  }))}
                />
              </label>
              <Button block size="small" icon={<Icons.User size={14} />} onClick={() => addActor()}>
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

              <div className="stage3d-section-title">群众阵列</div>
              <div className="stage3d-crowd-grid">
                <label className="stage3d-field">
                  <span>行</span>
                  <Input
                    size="small"
                    type="number"
                    min={1}
                    max={12}
                    value={crowdRows}
                    onChange={(e) => setCrowdRows(clamp(Number(e.target.value), 1, 12))}
                  />
                </label>
                <label className="stage3d-field">
                  <span>列</span>
                  <Input
                    size="small"
                    type="number"
                    min={1}
                    max={12}
                    value={crowdColumns}
                    onChange={(e) => setCrowdColumns(clamp(Number(e.target.value), 1, 12))}
                  />
                </label>
                <label className="stage3d-field">
                  <span>间距</span>
                  <Input
                    size="small"
                    type="number"
                    min={0.5}
                    max={4}
                    step={0.1}
                    value={crowdSpacing}
                    onChange={(e) => setCrowdSpacing(clamp(Number(e.target.value), 0.5, 4))}
                  />
                </label>
              </div>
              <Button block size="small" icon={<Icons.Users size={14} />} onClick={addCrowdActors}>
                添加群众阵列（{Math.round(crowdRows)}x{Math.round(crowdColumns)}）
              </Button>

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
                <div className="stage3d-tip">
                  Kenney 家具资产由后续阶段接入，当前可用几何道具搭建布局。
                </div>
              ) : (
                <FurniturePanel onPick={addGlbProp} />
              )}

              <div className="stage3d-section-title">本地模型</div>
              <input
                ref={localModelInputRef}
                type="file"
                accept=".fbx,.obj,.glb"
                className="stage3d-hidden-input"
                onChange={(e) => {
                  const input = e.currentTarget
                  void importLocalModel(input.files?.[0]).finally(() => {
                    input.value = ''
                  })
                }}
              />
              <Button
                block
                size="small"
                icon={<Icons.Upload size={14} />}
                onClick={() => localModelInputRef.current?.click()}
              >
                导入 FBX / OBJ / GLB
              </Button>

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
                    {draft.backdrop.mode === 'panorama'
                      ? '选一张全景图作为环境球'
                      : '选一张场景图作为背板'}
                  </div>
                  {imageNodes.length === 0 ? (
                    <div className="stage3d-tip">
                      画布中暂无图片节点，先生成/上传一张图片再回来选取。
                    </div>
                  ) : (
                    <Select
                      size="small"
                      className="stage3d-image-select"
                      placeholder="选择背板图"
                      allowClear
                      showSearch
                      optionFilterProp="title"
                      value={bgNode?.id}
                      options={backdropImageOptions}
                      popupClassName="stage3d-image-select-popup"
                      onChange={(id) =>
                        setBackdropImage(imageNodes.find((n) => n.id === id) ?? null)
                      }
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
                          setDraft((d) => ({
                            ...d,
                            backdrop: { ...d.backdrop, backdropDistance: v },
                          }))
                        }
                      />
                    </label>
                  )}
                </>
              )}

              <div className="stage3d-section-title">对象列表</div>
              <div className="stage3d-object-list">
                {!poseMode && (
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
                )}
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
                    <Tag>{getStage3DActorModel(a.modelId).label}</Tag>
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
          )}

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
              onCrowdTransform={handleCrowdTransform}
              onPropTransform={handlePropTransform}
              onCameraTransform={handleCameraTransform}
              onActorPoseDragBegin={handleActorPoseDragBegin}
              onActorPoseDragCommit={handleActorPoseDragCommit}
              viewNavigationMode={viewNavigationMode}
            />
            {cameraPreview && (
              <div className="stage3d-frame-mask" data-aspect={draft.camera.aspect} />
            )}
            {/* C3 构图参考线：纯 DOM overlay，只在取景预览时显示，不参与离屏截图 */}
            {cameraPreview && guide !== 'none' && (
              <div className={`stage3d-guide stage3d-guide-${guide}`} aria-hidden />
            )}
            {!cameraPreview && (
              <div className="stage3d-viewport-toolbar">
                <Segmented
                  size="small"
                  value={viewNavigationMode}
                  onChange={(v) => setViewNavigationMode(v as 'orbit' | 'pan')}
                  options={[
                    {
                      label: (
                        <span className="stage3d-toolbar-option" title="左键旋转视角，右键平移画布">
                          <Icons.Compass size={13} />
                          视角
                        </span>
                      ),
                      value: 'orbit',
                    },
                    {
                      label: (
                        <span className="stage3d-toolbar-option" title="左键拖动画布前后左右移动">
                          <Icons.Hand size={13} />
                          平移
                        </span>
                      ),
                      value: 'pan',
                    },
                  ]}
                />
                <Segmented
                  size="small"
                  value={transformMode}
                  onChange={(v) => setTransformMode(v as 'translate' | 'rotate')}
                  options={[
                    { label: '移动', value: 'translate' },
                    { label: '旋转', value: 'rotate' },
                  ]}
                />
                <Button
                  size="small"
                  type={snap ? 'primary' : 'default'}
                  icon={<Icons.Grid size={13} />}
                  onClick={() => setSnap((v) => !v)}
                  title="吸附对齐：半格网格 0.25m / 15°"
                >
                  吸附
                </Button>
                {activeActor && (
                  <Button
                    size="small"
                    type={poseMode ? 'primary' : 'default'}
                    icon={<Icons.User size={13} />}
                    onClick={() => setPoseMode((v) => !v)}
                    title="摆姿势：点关节后用视口调节器调整 XYZ，手脚末端可拖 IK（Esc 退出）"
                  >
                    摆姿势
                  </Button>
                )}
                {activeActor && (
                  <Button
                    size="small"
                    icon={<Icons.Maximize size={13} />}
                    onClick={() => setPoseEditorOpen(true)}
                    title="全屏编辑：把当前角色扔进大视口摆姿势"
                  >
                    全屏编辑
                  </Button>
                )}
                {poseMode && (
                  <>
                    <Button
                      size="small"
                      icon={<Icons.Undo2 size={13} />}
                      disabled={!canUndo}
                      onClick={undoPose}
                      title="撤销（Cmd/Ctrl+Z）"
                    >
                      撤销
                    </Button>
                    <Button
                      size="small"
                      icon={<Icons.Redo2 size={13} />}
                      disabled={!canRedo}
                      onClick={redoPose}
                      title="重做（Cmd/Ctrl+Shift+Z）"
                    >
                      重做
                    </Button>
                  </>
                )}
              </div>
            )}
            {cameraPreview && (
              <div className="stage3d-viewport-toolbar">
                <Segmented
                  size="small"
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
            <aside className="stage3d-inspector">
              <button
                type="button"
                className="stage3d-panel-collapse stage3d-panel-collapse-right"
                onClick={() => setInspectorCollapsed(true)}
                title="折叠右侧面板"
              >
                <Icons.ChevronRight size={14} />
              </button>
              {activeIsCamera ? (
                <CameraInspector draft={draft} setDraft={setDraft} onAim={aimCameraAtSelected} />
              ) : activeActor ? (
                <ActorInspector
                  actor={activeActor}
                  characterNodes={characterNodes}
                  onUpdate={(patch) => updateActor(activeActor.id, patch)}
                  onJoint={(joint, axis, deg) => updateActorJoint(activeActor.id, joint, axis, deg)}
                  onJointBegin={() => beginActorJointEdit(activeActor.id)}
                  onJointCommit={() => commitActorJointEdit(activeActor.id)}
                  onResetJoints={() => resetActorJoints(activeActor.id)}
                />
              ) : activeProp ? (
                <PropInspector
                  prop={activeProp}
                  onUpdate={(patch) => updateProp(activeProp.id, patch)}
                />
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
          )}
        </div>
      </div>
      {poseEditorOpen && activeActor && (
        <PoseEditorModal
          actor={activeActor}
          onChange={(joints) => {
            // 把全屏页编辑结果写回当前 actor 的 joints + 同步 pose=stand（与 poseLibrary 套用语义一致）
            updateActor(activeActor.id, { joints, pose: 'stand' })
            setPoseEditorOpen(false)
          }}
          onClose={() => setPoseEditorOpen(false)}
        />
      )}
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
      <Button block size="small" icon={<Icons.Plus size={13} />} onClick={onSaveCurrent}>
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
                  size="small"
                  className="stage3d-shot-number"
                  value={shot.shotNumber}
                  placeholder="镜号"
                  onChange={(e) => onUpdate(shot.id, { shotNumber: e.target.value })}
                />
                <Input
                  size="small"
                  value={shot.name}
                  placeholder="镜头名"
                  onChange={(e) => onUpdate(shot.id, { name: e.target.value })}
                />
              </div>
              <div className="stage3d-shot-actions">
                <Button
                  size="small"
                  type="text"
                  icon={<Icons.Eye size={12} />}
                  onClick={() => onApply(shot)}
                >
                  切换
                </Button>
                <Button
                  size="small"
                  type="text"
                  icon={<Icons.Copy size={12} />}
                  onClick={() => onDuplicate(shot.id)}
                >
                  复制
                </Button>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<Icons.Trash size={12} />}
                  onClick={() => onRemove(shot.id)}
                >
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
          size="small"
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
          <Input
            size="small"
            value={scene}
            placeholder="3"
            onChange={(e) => onChange({ scene: e.target.value })}
          />
        </label>
        <label className="stage3d-field">
          <span>镜号</span>
          <Input
            size="small"
            value={shotNumber}
            placeholder="3A"
            onChange={(e) => onChange({ shotNumber: e.target.value })}
          />
        </label>
        <label className="stage3d-field">
          <span>Take</span>
          <Input
            size="small"
            value={take}
            placeholder="2"
            onChange={(e) => onChange({ take: e.target.value })}
          />
        </label>
      </div>
      <label className="stage3d-field">
        <span>场记备注（可选）</span>
        <Input
          size="small"
          value={note}
          placeholder="例如：情绪高点，注意手部"
          onChange={(e) => onChange({ note: e.target.value })}
        />
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
          size="small"
          block
          value={camera.aspect}
          onChange={(v) => setCam({ aspect: v as Stage3DData['camera']['aspect'] })}
          options={STAGE3D_ASPECTS.map((a) => ({ label: a, value: a }))}
        />
      </label>
      <label className="stage3d-field">
        <span>
          视角 {Math.round(camera.fov)}°（≈
          {Math.round(24 / (2 * Math.tan((camera.fov * Math.PI) / 360)))}mm）
        </span>
        <Slider min={12} max={90} value={camera.fov} onChange={(v) => setCam({ fov: v })} />
      </label>
      <label className="stage3d-field">
        <span>相机高度 {camera.position[1].toFixed(1)}m</span>
        <Slider
          min={0.2}
          max={6}
          step={0.1}
          value={camera.position[1]}
          onChange={(v) => setCam({ position: [camera.position[0], v, camera.position[2]] })}
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
  onJointBegin,
  onJointCommit,
  onResetJoints,
}: {
  actor: Stage3DActor
  characterNodes: CanvasCharacterNode[]
  onUpdate: (patch: Partial<Stage3DActor>) => void
  onJoint: (joint: JointId, axis: 0 | 1 | 2, deg: number) => void
  /** 滑杆聚焦：标记一次关节微调开始（落 undo before 快照）。 */
  onJointBegin: () => void
  /** 滑杆释放/失焦：提交 undo entry。 */
  onJointCommit: () => void
  onResetJoints: () => void
}) {
  const [showJoints, setShowJoints] = useState(false)
  return (
    <>
      <div className="stage3d-section-title">角色属性</div>
      <label className="stage3d-field">
        <span>名称</span>
        <Input
          size="small"
          value={actor.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
        />
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
        <span>人物模型</span>
        <Select
          size="small"
          style={{ width: '100%' }}
          value={actor.modelId ?? DEFAULT_STAGE3D_ACTOR_MODEL_ID}
          onChange={(id) => {
            const model = getStage3DActorModel(id)
            onUpdate({ modelId: model.id, modelSource: model.source, rigType: model.rigType })
          }}
          options={BUILTIN_STAGE3D_ACTOR_MODELS.map((model) => ({
            value: model.id,
            label: model.label,
          }))}
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
                onBegin={onJointBegin}
                onCommit={onJointCommit}
              />
            ))}
          </div>
        ))}
    </>
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
        <Input
          size="small"
          value={prop.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
        />
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
