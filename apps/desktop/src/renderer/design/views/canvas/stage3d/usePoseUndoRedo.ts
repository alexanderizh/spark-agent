import { useCallback, useEffect, useRef, useState } from 'react'
import type { JointId, Vec3 } from './mannequin'

/**
 * 姿势编辑撤销/重做 Hook（抽自 CanvasDirectorStage3DModal 的 122-248 行栈逻辑）。
 *
 * 设计要点：
 * - 维护 joints（合成后逐关节覆盖，弧度）+ pose（预设 id）两份状态，外加 per-actor 的
 *   undo/redo 栈；新动作截断 redo 分支、按上限 UNDO_STACK_LIMIT 截断。
 * - begin()/commit() 配对：begin 记录「操作前」快照（同 actor 重复 begin 会覆盖，避免连续
 *   滑杆产生多条 undo）；commit 时若 before/after 无变化不入栈。
 * - undo()/redo() 在栈间移动 entry，写回当前 joints/pose。
 * - reset(joints) 用于「整体覆盖」（如套预设 / 重置 / 镜像 / 应用姿势库）：视为一次完整编辑
 *   直接落栈，再替换 joints。
 * - reset() 同时清空 undo/redo 栈，用于「换了一个 actor / 外部全量替换」时重置历史。
 *
 * 与原实现的差异：原版每条 entry 带 actorId（per-actor 栈但同栈混存），这里 hook 只服务于单个
 * actor（全屏姿势页 + 现地 poseMode 都是单 actor 编辑），故 entry 不再需要 actorId，逻辑更简。
 */

const UNDO_STACK_LIMIT = 50

export type PoseJoints = Record<string, Vec3>

type PoseSnapshot = { pose: string; joints: PoseJoints | undefined }
type PoseUndoEntry = { before: PoseSnapshot; after: PoseSnapshot }

export type UsePoseUndoRedoResult = {
  /** 当前 joints（合成后覆盖，弧度）。 */
  joints: PoseJoints
  /** 当前预设 id。 */
  pose: string
  /** 标记一次姿势编辑开始（记录 before 快照，同 actor 重复调用会覆盖）。 */
  begin: () => void
  /** 提交一次编辑（before→当前快照入栈，无变化不入栈）。 */
  commit: () => void
  /** 撤销。 */
  undo: () => void
  /** 重做。 */
  redo: () => void
  /** 是否可撤销。 */
  canUndo: boolean
  /** 是否可重做。 */
  canRedo: boolean
  /**
   * 整体替换 joints/pose（如套预设、镜像、应用姿势库、重置）。
   * 视为一次完整编辑直接落栈（before=当前、after=next），并写回状态。
   * 不传 pose 时保持当前 pose。
   */
  replace: (nextJoints: PoseJoints, pose?: string) => void
  /**
   * 重置历史栈（清空 undo/redo），并把 joints/pose 设回入参。
   * 用于「切换到另一个 actor」或「外部全量替换且不希望留 undo」。
   */
  reset: (joints: PoseJoints, pose: string) => void
}

function snapshotEq(a: PoseSnapshot, b: PoseSnapshot): boolean {
  if (a.pose !== b.pose) return false
  const aj = a.joints ?? {}
  const bj = b.joints ?? {}
  const ak = Object.keys(aj)
  const bk = Object.keys(bj)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    const av = aj[k]
    const bv = bj[k]
    if (!av || !bv) return false
    if (av[0] !== bv[0] || av[1] !== bv[1] || av[2] !== bv[2]) return false
  }
  return true
}

/**
 * @param initialJoints 初始 joints（合成后覆盖，弧度）
 * @param initialPose    初始预设 id
 */
export function usePoseUndoRedo(
  initialJoints: PoseJoints,
  initialPose: string,
): UsePoseUndoRedoResult {
  const [joints, setJoints] = useState<PoseJoints>(() => ({ ...initialJoints }))
  const [pose, setPose] = useState<string>(initialPose)

  const undoStackRef = useRef<PoseUndoEntry[]>([])
  const redoStackRef = useRef<PoseUndoEntry[]>([])
  // 仅用于触发 canUndo/canRedo 重渲染（ref 不引发重渲染，故配一个 tick）
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])

  const pendingBeforeRef = useRef<PoseSnapshot | null>(null)

  const snapshotOf = useCallback(
    (): PoseSnapshot => ({
      pose,
      joints: joints ? { ...joints } : undefined,
    }),
    [pose, joints],
  )

  const pushUndo = useCallback(
    (entry: PoseUndoEntry) => {
      undoStackRef.current.push(entry)
      if (undoStackRef.current.length > UNDO_STACK_LIMIT) {
        undoStackRef.current.shift()
      }
      redoStackRef.current = []
      bump()
    },
    [bump],
  )

  const begin = useCallback(() => {
    pendingBeforeRef.current = snapshotOf()
  }, [snapshotOf])

  const commit = useCallback(() => {
    const pending = pendingBeforeRef.current
    if (!pending) return
    const after = snapshotOf()
    if (!snapshotEq(pending, after)) {
      pushUndo({ before: pending, after })
    }
    pendingBeforeRef.current = null
  }, [snapshotOf, pushUndo])

  const undo = useCallback(() => {
    const entry = undoStackRef.current.pop()
    if (!entry) return
    setJoints(entry.before.joints ? { ...entry.before.joints } : {})
    setPose(entry.before.pose)
    redoStackRef.current.push(entry)
    bump()
  }, [bump])

  const redo = useCallback(() => {
    const entry = redoStackRef.current.pop()
    if (!entry) return
    setJoints(entry.after.joints ? { ...entry.after.joints } : {})
    setPose(entry.after.pose)
    undoStackRef.current.push(entry)
    bump()
  }, [bump])

  const replace = useCallback(
    (nextJoints: PoseJoints, nextPose?: string) => {
      const before = snapshotOf()
      const after: PoseSnapshot = {
        pose: nextPose ?? pose,
        joints: { ...nextJoints },
      }
      if (!snapshotEq(before, after)) {
        pushUndo({ before, after })
      }
      setJoints({ ...nextJoints })
      if (nextPose !== undefined) setPose(nextPose)
    },
    [snapshotOf, pushUndo, pose],
  )

  const reset = useCallback((nextJoints: PoseJoints, nextPose: string) => {
    undoStackRef.current = []
    redoStackRef.current = []
    pendingBeforeRef.current = null
    setJoints({ ...nextJoints })
    setPose(nextPose)
    setTick((t) => t + 1)
  }, [])

  // ── Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y 快捷键 ──
  // 在 INPUT/TEXTAREA 里不拦截，让浏览器原生 undo 生效。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) redo()
        else undo()
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        e.stopPropagation()
        redo()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [undo, redo])

  return {
    joints,
    pose,
    begin,
    commit,
    undo,
    redo,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
    replace,
    reset,
  }
}

/** 工具：把单个 joint 的某轴（度数）写入 joints 副本，返回新对象（不 mutate 入参）。 */
export function withJointAxis(
  joints: PoseJoints,
  jointId: JointId,
  axis: 0 | 1 | 2,
  valueDeg: number,
): PoseJoints {
  const RAD = Math.PI / 180
  const next: PoseJoints = { ...joints }
  const current = next[jointId] ?? ([0, 0, 0] as Vec3)
  const v: Vec3 = [current[0], current[1], current[2]]
  v[axis] = valueDeg * RAD
  next[jointId] = v
  return next
}
