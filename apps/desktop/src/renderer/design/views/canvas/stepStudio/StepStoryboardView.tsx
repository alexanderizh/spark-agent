/**
 * 步骤模式 · 第二步「分镜」（步骤模式设计文档 §5.2，P5 交付）。
 *
 * 左侧序列（集）列表 + 主区分段卡片列表。分段剧本/出镜资产/生成模式编辑
 * 经本地草稿叠加层（防抖 700ms）写回 stepStudioState，避免逐键全量落盘；
 * 结构操作（增删移、生成回填）立即写。生成态以 snapshot.tasks 实时派生，
 * 任务终态由同步 effect 回写持久化 status / outputVideoAssetIds（P6 组装消费）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Modal, Select, Spin, message } from 'antd'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import type {
  CanvasSnapshot,
  StepShotSegment,
  StepShotSequence,
  StepStudioState,
} from '../canvas.types'
import { canvasApi } from '../canvas.api'
import { readAssetKind } from '../canvasFilmAssets'
import { buildProductionBiblePrompt } from '../canvasPipeline'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import type { CanvasMediaTaskSubmitter } from '../assetLibrary/assetCreateTypes'
import { CanvasModelPicker } from '../CanvasModelPicker'
import { mediaModelKey } from '../canvasModelPickerModel'
import { readBreakdownTask, readStepStudioState } from './stepStudioMeta'
import {
  addSegment,
  breakdownDraftToSegment,
  buildScriptBreakdownPrompt,
  buildStepSegmentPrompt,
  collectSegmentInputFiles,
  createSequence,
  deriveSegmentRuntime,
  isSegmentGeneratable,
  moveSegment,
  normalizeSequences,
  parseBreakdownDrafts,
  patchSegment,
  removeSegment,
  reorderSegment,
  removeSequence,
  upsertSequence,
} from './stepStoryboardModel'
import { StepSegmentCard, type SegmentAssetOption } from './StepSegmentCard'
import { Icons } from '../../../Icons'

export type StepStoryboardViewProps = Readonly<{
  projectId: string
  snapshot: CanvasSnapshot
  onCreateMediaTask: CanvasMediaTaskSubmitter
  /** 写 stepStudioState（容器封装 updateProjectMetadata + 刷快照） */
  onUpdateState: (state: StepStudioState) => Promise<void>
  refreshSnapshot: () => Promise<void>
}>

const FLUSH_DEBOUNCE_MS = 700
/** 批量生成默认并发（设计文档决策：默认 4，可调 1-8） */
const DEFAULT_CONCURRENCY = 4

export function StepStoryboardView({
  projectId,
  snapshot,
  onCreateMediaTask,
  onUpdateState,
}: StepStoryboardViewProps) {
  // ── 持久化 state（snapshot 派生）与最新值 ref（异步写操作基准）──
  // 渲染只读 persisted；异步回调（flush/生成/批量）读 stateRef，
  // 规开 props 刷新滞后的窗口。effect 镜像：persisted 引用变化即 snapshot 已含写入。
  const persisted = useMemo<StepStudioState>(() => {
    const raw = readStepStudioState(snapshot.project)
    // 展开保留 sequences 之外的字段（assemblyNodeId / breakdown）：
    // 整键重构会在每次快照刷新时把这些指针静默清掉
    return raw
      ? { ...raw, sequences: normalizeSequences(raw.sequences) }
      : { schemaVersion: 1, sequences: [] }
  }, [snapshot.project])
  const stateRef = useRef<StepStudioState>(persisted)
  useEffect(() => {
    stateRef.current = persisted
  }, [persisted])
  // snapshot 镜像：flushDrafts 落盘前取最新持久化 state 作基准，
  // 避免覆盖此期间的其他写入（如视频步骤组装回填的 assemblyNodeId）
  const snapshotRef = useRef(snapshot)
  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  const sequences = persisted.sequences
  const assetsById = useMemo(
    () => new Map(snapshot.assets.map((asset) => [asset.id, asset])),
    [snapshot.assets],
  )

  // ── 本地草稿叠加层（segment 级 patch，防抖落盘）──
  // 渲染读 state；事件/定时器回调经 ref 镜像取最新值（标准「最新值 ref」模式）。
  const [drafts, setDrafts] = useState<Map<string, Partial<StepShotSegment>>>(() => new Map())
  const draftsRef = useRef(drafts)
  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])
  const flushTimerRef = useRef<number | null>(null)

  /**
   * 把给定草稿合并进「最新持久化 state」（保留此期间其他写入，如组装回填的
   * assemblyNodeId）。flush 与终态同步共用本函数作写入基准，避免两条写入
   * 路径基于不同快照整键覆盖、静默丢掉对方（或用户）刚写入的内容。
   */
  const mergeDraftsIntoLatest = useCallback(
    (
      drafts: ReadonlyMap<string, Partial<StepShotSegment>>,
      fallbackSequences: StepShotSequence[],
    ): StepStudioState => {
      const latestPersisted = readStepStudioState(snapshotRef.current.project)
      // 与 persisted 同理：展开保留 assemblyNodeId / breakdown 等序列外字段
      let next: StepStudioState = {
        ...(latestPersisted ?? { schemaVersion: 1, sequences: fallbackSequences }),
        sequences: normalizeSequences(latestPersisted?.sequences ?? fallbackSequences),
      }
      for (const [segmentId, patch] of drafts) {
        let owner = next.sequences.find((seq) => seq.segments.some((seg) => seg.id === segmentId))
        if (!owner) {
          // 最新快照尚未含该段（结构写入在途）：fallback 的序列结构更新，并入后再打草稿
          const ownerInFallback = fallbackSequences.find((seq) =>
            seq.segments.some((seg) => seg.id === segmentId),
          )
          if (ownerInFallback) {
            next = upsertSequence(next, ownerInFallback)
            owner = next.sequences.find((seq) => seq.id === ownerInFallback.id)
          }
        }
        if (owner) next = patchSegment(next, owner.id, segmentId, patch)
      }
      return next
    },
    [],
  )

  /** 合并草稿并落盘；返回合并后的最新 state（供生成等即时消费） */
  const flushDrafts = useCallback(async (): Promise<StepStudioState> => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    const pending = draftsRef.current
    if (pending.size === 0) return stateRef.current
    draftsRef.current = new Map()
    setDrafts(new Map())
    const next = mergeDraftsIntoLatest(pending, stateRef.current.sequences)
    stateRef.current = next
    await onUpdateState(next)
    return next
  }, [mergeDraftsIntoLatest, onUpdateState])

  const patchSegmentLocal = useCallback(
    (segmentId: string, patch: Partial<StepShotSegment>) => {
      const merged = { ...(draftsRef.current.get(segmentId) ?? {}), ...patch }
      const nextDrafts = new Map(draftsRef.current)
      nextDrafts.set(segmentId, merged)
      draftsRef.current = nextDrafts
      setDrafts(nextDrafts)
      if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = window.setTimeout(() => void flushDrafts(), FLUSH_DEBOUNCE_MS)
    },
    [flushDrafts],
  )

  // 卸载前冲刷未落盘草稿。依赖必须为空数组：cleanup 只在真正卸载时执行一次；
  // 若依赖 flushDrafts（随 onUpdateState 引用变化），每次父级重渲都会触发
  // cleanup → 草稿被立即冲刷，700ms 防抖形同虚设。最新闭包经 ref 转发。
  const flushDraftsRef = useRef(flushDrafts)
  useEffect(() => {
    flushDraftsRef.current = flushDrafts
  }, [flushDrafts])
  useEffect(() => {
    return () => {
      if (draftsRef.current.size > 0) void flushDraftsRef.current()
    }
  }, [])

  // ── 序列选择与初始化 ──
  const [activeSequenceId, setActiveSequenceId] = useState<string | null>(null)
  const activeSequence = useMemo(() => {
    if (sequences.length === 0) return null
    return sequences.find((seq) => seq.id === activeSequenceId) ?? sequences[0] ?? null
  }, [sequences, activeSequenceId])

  // 首次挂载且无任何序列时初始化一个默认序列。只在挂载时判定一次：
  // 若持续观察 sequences.length，用户删光所有序列后会立刻“复活”默认序列，
  // 无法保持清空状态。
  const initializedRef = useRef(false)
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    if (stateRef.current.sequences.length > 0) return
    void onUpdateState({ schemaVersion: 1, sequences: [createSequence(projectId, 0, '第一集')] })
  }, [projectId, onUpdateState])

  // ── 序列操作 ──
  const commitSequences = useCallback(
    (next: StepStudioState) => {
      stateRef.current = next
      return onUpdateState(next)
    },
    [onUpdateState],
  )

  const handleAddSequence = useCallback(() => {
    const order = stateRef.current.sequences.length
    void commitSequences({
      ...stateRef.current,
      sequences: [...stateRef.current.sequences, createSequence(projectId, order)],
    })
  }, [projectId, commitSequences])

  const handleRenameSequence = useCallback(
    (sequence: StepShotSequence, title: string) => {
      const trimmed = title.trim()
      if (!trimmed || trimmed === sequence.title) return
      void commitSequences(upsertSequence(stateRef.current, { ...sequence, title: trimmed }))
    },
    [commitSequences],
  )

  const handleRemoveSequence = useCallback(
    (sequence: StepShotSequence) => {
      const segmentCount = sequence.segments.length
      const confirmText =
        segmentCount > 0
          ? `「${sequence.title}」含 ${segmentCount} 个分段，删除后不可恢复，确定删除？`
          : `确定删除序列「${sequence.title}」？`
      if (!window.confirm(confirmText)) return
      void commitSequences(removeSequence(stateRef.current, sequence.id))
    },
    [commitSequences],
  )

  // ── 分段结构操作 ──
  const handleAddSegment = useCallback(() => {
    if (!activeSequence) return
    void commitSequences(addSegment(stateRef.current, activeSequence.id))
  }, [activeSequence, commitSequences])

  const handleRemoveSegment = useCallback(
    (segmentId: string) => {
      if (!activeSequence) return
      void commitSequences(removeSegment(stateRef.current, activeSequence.id, segmentId))
    },
    [activeSequence, commitSequences],
  )

  const handleMoveSegment = useCallback(
    (segmentId: string, direction: 'up' | 'down') => {
      if (!activeSequence) return
      void commitSequences(moveSegment(stateRef.current, activeSequence.id, segmentId, direction))
    },
    [activeSequence, commitSequences],
  )

  // ── 分段拖拽排序（二期，@dnd-kit，与 QueuedTaskList 同套习惯）──
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const handleSegmentDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (over == null || active.id === over.id) return
      if (!activeSequence) return
      const segmentId = String(active.id)
      const toIndex = activeSequence.segments.findIndex((seg) => seg.id === String(over.id))
      if (toIndex < 0) return
      void commitSequences(reorderSegment(stateRef.current, activeSequence.id, segmentId, toIndex))
    },
    [activeSequence, commitSequences],
  )

  // ── 出镜资产下拉数据 ──
  const assetOptions = useMemo(() => {
    const characters: SegmentAssetOption[] = []
    const scenes: SegmentAssetOption[] = []
    const props: SegmentAssetOption[] = []
    for (const asset of snapshot.assets) {
      const option: SegmentAssetOption = {
        value: asset.id,
        label: asset.title?.trim() || '未命名',
        previewUrl: typeof asset.thumbnailUrl === 'string' ? asset.thumbnailUrl : null,
      }
      const kind = readAssetKind(asset)
      if (kind === 'character') characters.push(option)
      else if (kind === 'scene') scenes.push(option)
      else if (kind === 'prop') props.push(option)
    }
    return { characters, scenes, props }
  }, [snapshot.assets])

  const imageOptions = useMemo<SegmentAssetOption[]>(
    () =>
      snapshot.assets
        .filter((asset) => asset.type === 'image')
        .map((asset) => ({
          value: asset.id,
          label: asset.title?.trim() || '未命名图片',
          previewUrl: typeof asset.thumbnailUrl === 'string' ? asset.thumbnailUrl : null,
        })),
    [snapshot.assets],
  )

  // ── 视频模型选择 ──
  const [videoModels, setVideoModels] = useState<CanvasMediaModelSummary[]>([])
  // 挂载即进入加载态（初始 true，effect 内不同步 setState，规避 set-state-in-effect）
  const [modelsLoading, setModelsLoading] = useState(true)
  const [modelKey, setModelKey] = useState('')
  useEffect(() => {
    let cancelled = false
    void canvasApi
      .listMediaModels({ enabledOnly: true })
      .then((response) => {
        if (!cancelled) setVideoModels(response.models)
      })
      .catch(() => {
        if (!cancelled) setVideoModels([])
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  const videoModelOptions = useMemo(
    () =>
      videoModels.filter((model) =>
        model.capabilities.some(
          (capability) =>
            capability.id === 'video.generate' || capability.id === 'video.image_to_video',
        ),
      ),
    [videoModels],
  )
  const selectedModel = useMemo(
    () => videoModelOptions.find((model) => mediaModelKey(model) === modelKey),
    [videoModelOptions, modelKey],
  )

  // ── 单段生成 ──
  const generateSegment = useCallback(
    async (sequenceId: string, segmentId: string): Promise<boolean> => {
      const latestState = await flushDrafts()
      const sequence = latestState.sequences.find((seq) => seq.id === sequenceId)
      const segment = sequence?.segments.find((seg) => seg.id === segmentId)
      if (!sequence || !segment) return false

      // 任务必须落在激活画板：snapshot.tasks 只含激活画板的任务（snapshotFromDb
      // 按 boardId 过滤），落错画板会导致进度/终态同步整链路看不到任务
      const boardId = snapshot.board?.id ?? ''
      if (!boardId) {
        message.error('画板信息缺失，无法发起生成')
        return false
      }

      const inputFiles = collectSegmentInputFiles(segment, assetsById)
      const styleBible = buildProductionBiblePrompt(snapshot.project.metadata)
      const prompt = buildStepSegmentPrompt(segment, assetsById, styleBible)
      const operation = inputFiles.length > 0 ? 'image_to_video' : 'text_to_video'
      const createdTaskRef: { taskId?: string } = {}

      // 先标 generating 并清除旧 taskId（即时反馈 + 阻止重复提交；
      // 保留旧 taskId 会让 runtime 派生回 done，提交窗口内按钮可重复点击）
      const marking = patchSegment(latestState, sequenceId, segmentId, {
        status: 'generating',
        taskId: null,
      })
      stateRef.current = marking
      try {
        await onUpdateState(marking)
      } catch (error) {
        message.error(`状态写入失败：${error instanceof Error ? error.message : String(error)}`)
        return false
      }

      try {
        await onCreateMediaTask(
          {
            boardId,
            operation,
            prompt,
            taskTitle: `分段视频 · ${sequence.title} ${segment.order + 1}`,
            outputTitle: `${sequence.title} 第 ${segment.order + 1} 段`,
            ...(inputFiles.length > 0 ? { inputFiles } : {}),
            ...(selectedModel?.manifestId ? { manifestId: selectedModel.manifestId } : {}),
            ...(selectedModel?.providerProfileId
              ? { providerProfileId: selectedModel.providerProfileId }
              : {}),
            ...(selectedModel?.modelId ? { modelId: selectedModel.modelId } : {}),
          },
          { createdTaskRef },
        )
        const taskId = createdTaskRef.taskId ?? null
        const current = stateRef.current
        const stillThere = current.sequences.some((seq) =>
          seq.segments.some((seg) => seg.id === segmentId),
        )
        if (taskId && stillThere) {
          const updated = patchSegment(current, sequenceId, segmentId, { taskId })
          stateRef.current = updated
          await onUpdateState(updated)
        }
        return true
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        message.error(`分段生成提交失败：${text}`)
        const current = stateRef.current
        const updated = patchSegment(current, sequenceId, segmentId, { status: 'failed' })
        stateRef.current = updated
        await onUpdateState(updated)
        return false
      }
    },
    [
      flushDrafts,
      snapshot.board?.id,
      snapshot.project.metadata,
      assetsById,
      onCreateMediaTask,
      onUpdateState,
      selectedModel,
    ],
  )

  // ── 批量生成（简单并发池）──
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY)
  const [batchState, setBatchState] = useState<{ total: number; done: number } | null>(null)

  const handleBatchGenerate = useCallback(async () => {
    if (!activeSequence || batchState != null) return
    const targets = activeSequence.segments.filter((segment) => {
      const draft = draftsRef.current.get(segment.id) ?? {}
      const merged = { ...segment, ...draft }
      const runtime = deriveSegmentRuntime(merged, snapshot)
      // 只排队草稿/失败段（设计文档 §5.2）：已完成的段可能被用户保留多版本，
      // 批量重跑全部属于付费任务，只能由单段按钮显式重试
      if (runtime.status !== 'draft' && runtime.status !== 'failed') return false
      return isSegmentGeneratable(merged, runtime.status)
    })
    if (targets.length === 0) {
      message.info('没有待生成的分段（仅草稿 / 失败段参与批量生成，需要剧本或参考输入）')
      return
    }
    setBatchState({ total: targets.length, done: 0 })
    const queue = [...targets]
    let completed = 0
    let submitted = 0
    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const next = queue.shift()
        if (!next) break
        const ok = await generateSegment(activeSequence.id, next.id).catch(() => false)
        if (ok) submitted += 1
        completed += 1
        setBatchState({ total: targets.length, done: completed })
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, targets.length) }, () => worker())
    try {
      await Promise.all(workers)
    } finally {
      // 任一 worker 异常也必须退出批量态，否则按钮永久禁用
      setBatchState(null)
      if (submitted === targets.length) {
        message.success(`${targets.length} 个分段已全部提交生成`)
      } else if (submitted > 0) {
        message.warning(`${submitted}/${targets.length} 个分段已提交，其余失败，可单独重试`)
      } else {
        message.error('没有分段提交成功，请检查任务服务后重试')
      }
    }
  }, [activeSequence, batchState, concurrency, generateSegment, snapshot])

  // ── AI 拆分剧本（二期 R2-2）：提交 text_generate 任务，终态后自动追加分段草稿 ──
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const [breakdownScript, setBreakdownScript] = useState('')
  const [breakdownSubmitting, setBreakdownSubmitting] = useState(false)
  // 追加去重守卫：终态写入落盘前 effect 可能因其他快照事件重跑，
  // 无守卫会把同批草稿重复追加（写盘与追加之间非原子）
  const breakdownHandledRef = useRef<string | null>(null)

  const handleBreakdownSubmit = useCallback(async () => {
    const script = breakdownScript.trim()
    if (!script) {
      message.warning('请先粘贴剧本内容')
      return
    }
    if (!activeSequence) return
    const boardId = snapshot.board?.id ?? ''
    if (!boardId) {
      message.error('画板信息缺失，无法提交拆分任务')
      return
    }
    setBreakdownSubmitting(true)
    try {
      await flushDrafts()
      const before = new Set(snapshotRef.current.tasks.map((task) => task.id))
      // 拆解任务落激活画板（snapshot.tasks 按画板过滤，落错则终态同步看不到）
      const after = await canvasApi.createTextTask(projectId, {
        boardId,
        operation: 'text_generate',
        prompt: buildScriptBreakdownPrompt(script, {
          characters: assetOptions.characters.map((option) => option.label),
          scenes: assetOptions.scenes.map((option) => option.label),
          props: assetOptions.props.map((option) => option.label),
        }),
        taskTitle: 'AI 拆分剧本',
        outputTitle: `${activeSequence.title} · 分镜拆解`,
      })
      const created = after.tasks.find((task) => !before.has(task.id))
      if (!created) throw new Error('未能在快照中定位新建任务')
      const base = mergeDraftsIntoLatest(draftsRef.current, stateRef.current.sequences)
      const next: StepStudioState = {
        ...base,
        breakdown: { taskId: created.id, sequenceId: activeSequence.id },
      }
      stateRef.current = next
      await onUpdateState(next)
      setBreakdownOpen(false)
      setBreakdownScript('')
      message.success('AI 拆分任务已提交，完成后将自动追加分段草稿')
    } catch (error) {
      message.error(`AI 拆分提交失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBreakdownSubmitting(false)
    }
  }, [
    breakdownScript,
    activeSequence,
    snapshot.board?.id,
    projectId,
    flushDrafts,
    assetOptions,
    mergeDraftsIntoLatest,
    onUpdateState,
  ])

  // ── 任务终态同步：派生 done/failed 回写持久化（P6 组装消费 outputVideoAssetIds）──
  // 写入基准与 flushDrafts 一致（最新持久化 + 未落盘草稿），否则与防抖 flush
  // 交错时会把用户刚输入的草稿静默覆盖掉。任务被删（画布任务面板清理）时派生
  // failed，避免分段永久卡在 generating。
  useEffect(() => {
    let next: StepStudioState | null = null
    for (const sequence of persisted.sequences) {
      for (const segment of sequence.segments) {
        if (segment.status !== 'generating') continue
        if (!segment.taskId) continue
        const task = snapshot.tasks.find((item) => item.id === segment.taskId)
        let patch: Partial<StepShotSegment>
        if (!task) {
          // taskId 已回填但任务不在快照：任务被清理，标 failed 给出重试出口
          patch = { status: 'failed' }
        } else {
          const runtime = deriveSegmentRuntime(segment, snapshot)
          if (runtime.status !== 'done' && runtime.status !== 'failed') continue
          const videoOutputIds = task.outputAssetIds.filter((id) => {
            const asset = assetsById.get(id)
            return asset?.type === 'video'
          })
          patch = {
            status: runtime.status,
            // 历次生成去重追加、最新在末尾（类型契约，canvas.types.ts StepShotSegment）
            outputVideoAssetIds: [...new Set([...segment.outputVideoAssetIds, ...videoOutputIds])],
          }
        }
        if (!next) next = mergeDraftsIntoLatest(draftsRef.current, persisted.sequences)
        next = patchSegment(next, sequence.id, segment.id, patch)
      }
    }

    // ── AI 拆分剧本任务终态（R2-2）──
    const breakdown = readBreakdownTask(persisted)
    if (breakdown != null && breakdownHandledRef.current !== breakdown.taskId) {
      const task = snapshot.tasks.find((item) => item.id === breakdown.taskId)
      const terminal = task == null || task.status === 'failed' || task.status === 'cancelled'
      if (terminal || task?.status === 'completed') {
        breakdownHandledRef.current = breakdown.taskId
        if (next == null) next = mergeDraftsIntoLatest(draftsRef.current, persisted.sequences)
        if (task == null) {
          message.error('AI 拆分任务已不存在（可能被清理），请重新发起')
        } else if (task.status === 'completed') {
          const modelText = task.outputAssetIds
            .map((id) => assetsById.get(id))
            .filter((asset): asset is NonNullable<typeof asset> => asset?.type === 'text')
            .map((asset) => asset.contentText?.trim() ?? '')
            .filter(Boolean)
            .join('\n')
          const drafts = parseBreakdownDrafts(modelText)
          const sequence = next.sequences.find((seq) => seq.id === breakdown.sequenceId)
          if (drafts.length === 0) {
            message.warning('AI 拆分结果解析失败，可打开画布上的文本产物手动整理')
          } else if (!sequence) {
            message.warning('目标序列已被删除，AI 拆分结果已丢弃（文本产物保留在画布）')
          } else {
            // 名称匹配池：只收 character/scene/prop 三类影视资产
            const matchPool = snapshot.assets.flatMap((asset) => {
              const kind = readAssetKind(asset)
              if (kind !== 'character' && kind !== 'scene' && kind !== 'prop') return []
              return [{ id: asset.id, title: asset.title?.trim() ?? '', kind }]
            })
            const startOrder =
              sequence.segments.length > 0
                ? Math.max(...sequence.segments.map((seg) => seg.order)) + 1
                : 0
            const appended = drafts.map((draft, index) =>
              breakdownDraftToSegment(draft, sequence.id, startOrder + index, matchPool),
            )
            next = upsertSequence(next, {
              ...sequence,
              segments: [...sequence.segments, ...appended],
            })
            message.success(`AI 拆分完成，已追加 ${appended.length} 个分段草稿`)
          }
        } else {
          message.error('AI 拆分任务失败，请调整剧本后重试')
        }
        next = { ...next, breakdown: null }
      }
    }

    if (next) {
      stateRef.current = next
      void onUpdateState(next)
    }
  }, [persisted, snapshot, assetsById, onUpdateState, mergeDraftsIntoLatest])

  // ── 渲染 ──
  const segments = activeSequence?.segments ?? []
  const draftCount = drafts.size
  const breakdownTask = readBreakdownTask(persisted)
  const breakdownRunning =
    breakdownTask != null &&
    snapshot.tasks.some((task) => task.id === breakdownTask.taskId && task.status === 'running')

  return (
    <div className="step-storyboard-view">
      <aside className="step-sequence-rail">
        <div className="step-sequence-rail-head">
          <span>分镜序列</span>
          <Button
            size="small"
            type="text"
            icon={<Icons.Plus size={13} />}
            aria-label="新建序列"
            onClick={handleAddSequence}
          />
        </div>
        <div className="step-sequence-list" role="tablist" aria-label="分镜序列">
          {sequences.map((sequence) => (
            <button
              key={sequence.id}
              type="button"
              role="tab"
              aria-selected={sequence.id === activeSequence?.id}
              className={`step-sequence-item${sequence.id === activeSequence?.id ? ' is-active' : ''}`}
              onClick={() => setActiveSequenceId(sequence.id)}
            >
              <span className="step-sequence-item-title">{sequence.title}</span>
              <span className="step-sequence-item-count">{sequence.segments.length} 段</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="step-storyboard-main">
        {activeSequence ? (
          <>
            <header className="step-storyboard-toolbar">
              <Input
                className="step-sequence-title-input"
                defaultValue={activeSequence.title}
                key={activeSequence.id}
                size="small"
                maxLength={40}
                // 失焦/回车才提交：避免逐键触发整键 stepStudioState 落盘
                onBlur={(event) => handleRenameSequence(activeSequence, event.target.value)}
                onPressEnter={(event) => (event.target as HTMLInputElement).blur()}
              />
              <Button
                size="small"
                danger
                type="text"
                icon={<Icons.Trash size={13} />}
                aria-label="删除当前序列"
                onClick={() => handleRemoveSequence(activeSequence)}
              />
              <span className="step-storyboard-toolbar-spacer" />
              <CanvasModelPicker
                models={videoModelOptions}
                value={modelKey}
                loading={modelsLoading}
                allowEmpty
                emptyLabel="沿用平台默认视频模型"
                onChange={setModelKey}
              />
              <Select
                className="step-concurrency-select"
                size="small"
                value={concurrency}
                onChange={setConcurrency}
                options={[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: `并发 ${n}` }))}
              />
              <Button
                size="small"
                icon={<Icons.Sparkles size={13} />}
                loading={breakdownRunning}
                disabled={breakdownSubmitting}
                onClick={() => setBreakdownOpen(true)}
              >
                AI 拆剧本
              </Button>
              <Button
                size="small"
                disabled={batchState != null || segments.length === 0}
                onClick={() => void handleBatchGenerate()}
              >
                {batchState ? `批量生成中 ${batchState.done}/${batchState.total}` : '批量生视频'}
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<Icons.Plus size={13} />}
                onClick={handleAddSegment}
              >
                新建分段
              </Button>
            </header>

            <div className="step-segment-list">
              <DndContext
                sensors={dragSensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis]}
                onDragEnd={handleSegmentDragEnd}
              >
                <SortableContext
                  items={segments.map((segment) => segment.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <Spin spinning={modelsLoading && segments.length === 0}>
                    {segments.map((segment, index) => {
                      const draft = drafts.get(segment.id) ?? {}
                      const merged: StepShotSegment = { ...segment, ...draft }
                      const runtime = deriveSegmentRuntime(merged, snapshot)
                      return (
                        <StepSegmentCard
                          key={segment.id}
                          segment={merged}
                          index={index}
                          total={segments.length}
                          runtime={runtime}
                          characterOptions={assetOptions.characters}
                          sceneOptions={assetOptions.scenes}
                          propOptions={assetOptions.props}
                          imageOptions={imageOptions}
                          generatable={isSegmentGeneratable(merged, runtime.status)}
                          onPatch={(patch) => patchSegmentLocal(segment.id, patch)}
                          onGenerate={() => void generateSegment(activeSequence.id, segment.id)}
                          onRemove={() => handleRemoveSegment(segment.id)}
                          onMove={(direction) => handleMoveSegment(segment.id, direction)}
                        />
                      )
                    })}
                    {segments.length === 0 ? (
                      <div className="step-storyboard-empty">
                        还没有分段，点击右上角「新建分段」开始编排这一集的分镜
                        {draftCount > 0 ? '（有未保存编辑，自动保存中…）' : ''}
                      </div>
                    ) : null}
                  </Spin>
                </SortableContext>
              </DndContext>
            </div>
          </>
        ) : (
          <div className="step-storyboard-empty">
            <Spin spinning />
            <p>正在初始化分镜序列…</p>
          </div>
        )}
      </section>

      <Modal
        open={breakdownOpen}
        title="AI 拆分剧本"
        rootClassName="step-breakdown-modal"
        destroyOnHidden
        okText="开始拆分"
        cancelText="取消"
        okButtonProps={{ loading: breakdownSubmitting }}
        onOk={() => void handleBreakdownSubmit()}
        onCancel={() => setBreakdownOpen(false)}
      >
        <p className="step-breakdown-hint">
          粘贴本集剧本，AI 将按叙事拆为分段草稿；出镜角色/场景/道具会自动引用项目资产，
          匹配不到的留空，可在分段卡片上手动补选。
        </p>
        <Input.TextArea
          value={breakdownScript}
          onChange={(event) => setBreakdownScript(event.target.value)}
          autoSize={{ minRows: 8, maxRows: 16 }}
          maxLength={8000}
          showCount
          placeholder="粘贴剧本全文…"
        />
      </Modal>
    </div>
  )
}
