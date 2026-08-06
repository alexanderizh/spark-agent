import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProviderProfile } from '@spark/protocol'

// 用户置顶的模型：复用通用 settings IPC 持久化（与斜杠命令置顶同一套机制）
export const PINNED_MODELS_CATEGORY = 'model-picker'
export const PINNED_MODELS_KEY = 'pinned'

/**
 * 置顶模型的唯一标识。
 *
 * 必须是 providerId + modelId 的组合而不是裸 modelId：同一个模型名
 * （如 glm-5）可能同时由 Spark 平台和第三方供应商提供，只按 modelId
 * 记录会导致置顶/取消置顶串到另一个供应商的同名模型上。
 */
export type PinnedModelRef = { providerId: string; modelId: string }

export type ProviderModelGroup = { provider: ProviderProfile; models: string[] }

export type ResolvedPinnedModel = { provider: ProviderProfile; modelId: string }

/** 宽松解析持久化内容：单条脏数据只丢弃自身，不影响其余置顶项 */
export function parsePinnedModelRefs(raw: unknown): PinnedModelRef[] {
  const source = typeof raw === 'string' ? safeParseJson(raw) : raw
  if (!Array.isArray(source)) return []
  const refs: PinnedModelRef[] = []
  const seen = new Set<string>()
  for (const entry of source) {
    if (entry == null || typeof entry !== 'object') continue
    const { providerId, modelId } = entry as Partial<PinnedModelRef>
    if (typeof providerId !== 'string' || typeof modelId !== 'string') continue
    if (providerId.length === 0 || modelId.length === 0) continue
    const key = pinnedModelRefKey(providerId, modelId)
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ providerId, modelId })
  }
  return refs
}

export function pinnedModelRefKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

export function isPinnedModelRef(
  pinned: readonly PinnedModelRef[],
  providerId: string,
  modelId: string,
): boolean {
  return pinned.some((ref) => ref.providerId === providerId && ref.modelId === modelId)
}

/** 已置顶则取消，否则置顶到列表头部（顺序即「常用」组的展示顺序） */
export function togglePinnedModelRef(
  pinned: readonly PinnedModelRef[],
  providerId: string,
  modelId: string,
): PinnedModelRef[] {
  if (isPinnedModelRef(pinned, providerId, modelId)) {
    return pinned.filter((ref) => !(ref.providerId === providerId && ref.modelId === modelId))
  }
  return [{ providerId, modelId }, ...pinned]
}

/**
 * 把「加载到的历史置顶」合并进「用户已做的即时操作」。
 *
 * 挂载时 settings:get 是异步的，若用户在读取返回前就置顶/取消过，直接
 * setPinned(loaded) 会用旧持久化值覆盖用户刚做的操作。合并时以用户当前
 * 状态为头部（保持其操作顺序），历史中未重复的项追加在后，不改变现有项。
 */
export function mergePinnedModelRefs(
  current: readonly PinnedModelRef[],
  loaded: readonly PinnedModelRef[],
): PinnedModelRef[] {
  if (current.length === 0) return [...loaded]
  const merged = [...current]
  for (const ref of loaded) {
    if (!isPinnedModelRef(current, ref.providerId, ref.modelId)) merged.push(ref)
  }
  return merged
}

/**
 * 把置顶记录解析成实际可选的模型项。
 *
 * 传入的 groups 应当是「搜索过滤后」的分组，这样「常用」组会跟着搜索一起收窄。
 *
 * 解析不到的记录（供应商被删除、模型下架、或供应商列表尚未加载完）只在这里
 * 跳过渲染，不回写清理持久化内容 —— 登出/配置刷新期间 providers 会短暂为空，
 * 顺手清理会把用户的置顶整批误删。
 */
export function resolvePinnedModelEntries(
  pinned: readonly PinnedModelRef[],
  groups: readonly ProviderModelGroup[],
): ResolvedPinnedModel[] {
  const entries: ResolvedPinnedModel[] = []
  for (const ref of pinned) {
    const group = groups.find((candidate) => candidate.provider.id === ref.providerId)
    if (group == null) continue
    if (!group.models.includes(ref.modelId)) continue
    entries.push({ provider: group.provider, modelId: ref.modelId })
  }
  return entries
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export type PinnedModelsController = {
  pinned: PinnedModelRef[]
  isPinned: (providerId: string, modelId: string) => boolean
  togglePinned: (providerId: string, modelId: string) => void
}

/** 置顶模型状态：挂载时从 settings 载入，切换时即时落库 */
export function usePinnedModels(): PinnedModelsController {
  const [pinned, setPinned] = useState<PinnedModelRef[]>([])
  const loadedRef = useRef(false)

  const persist = useCallback(async (refs: PinnedModelRef[]) => {
    try {
      await window.spark.invoke('settings:set', {
        category: PINNED_MODELS_CATEGORY,
        key: PINNED_MODELS_KEY,
        value: JSON.stringify(refs),
      })
    } catch {
      // 持久化失败不影响当前会话内的置顶体验
    }
  }, [])

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void (async () => {
      try {
        const res = await window.spark.invoke('settings:get', {
          category: PINNED_MODELS_CATEGORY,
          key: PINNED_MODELS_KEY,
        })
        const rawValue = res?.value
        const refs = parsePinnedModelRefs(rawValue)
        // settings 里存了内容却解析不出任何有效条目（被外部破坏等）：
        // 静默丢弃会让用户以为置顶「神秘消失」，打一条日志便于排查。
        // 空数组「[]」是用户清空置顶后的正常值，不算异常。
        if (rawValue != null && refs.length === 0 && JSON.stringify(rawValue) !== '[]') {
          console.warn('[model-picker] pinned model data present but unparseable, ignored:', rawValue)
        }
        // 合并而非覆盖：读取返回前用户可能已置顶/取消过，直接 setPinned(refs)
        // 会把刚做的操作冲掉（见 mergePinnedModelRefs）
        setPinned((prev) => {
          const merged = mergePinnedModelRefs(prev, refs)
          if (merged.length !== prev.length) void persist(merged)
          return merged
        })
      } catch {
        // 读取失败按空列表处理
      }
    })()
  }, [persist])

  const isPinned = useCallback(
    (providerId: string, modelId: string) => isPinnedModelRef(pinned, providerId, modelId),
    [pinned],
  )

  const togglePinned = useCallback(
    (providerId: string, modelId: string) => {
      setPinned((prev) => {
        const next = togglePinnedModelRef(prev, providerId, modelId)
        void persist(next)
        return next
      })
    },
    [persist],
  )

  return { pinned, isPinned, togglePinned }
}
