import { useCallback, useEffect, useState } from 'react'

import {
  configureLocalProvider,
  createConfiguredRuntime,
  inspectConfiguredModels,
  persistSelectedModel,
  type ConfiguredModelCatalog,
  type ConfiguredModelRuntime,
  type LocalProviderInput,
} from '../config/model-config.js'
import { defaultSparkHome } from '../env.js'
import type { SwitchableLlmService } from '../llm/switchable.js'

/**
 * Interactive model state for the TUI: what is selected, what is available,
 * and how to switch. Everything funnels through the SwitchableLlmService so
 * swaps are impossible mid-turn (docs 016 §3.3).
 */
export interface ModelRuntimeSeams {
  readonly cwd: string
  readonly sparkHome: string
  inspect(options: { cwd: string }): Promise<ConfiguredModelCatalog>
  createRuntime(options: { cwd: string; model: string }): Promise<ConfiguredModelRuntime>
  configure(input: LocalProviderInput): Promise<{ configPath: string; modelEntryId: string }>
  /** Persists the selection as [agent].model so the next launch skips the picker. */
  persist(input: { sparkHome: string; model: string }): Promise<void>
}

export interface ModelRuntimeController {
  readonly model: string | undefined
  readonly catalog: ConfiguredModelCatalog | undefined
  readonly busy: boolean
  readonly refreshing: boolean
  readonly error: string | undefined
  readonly startupError: string | undefined
  readonly open: boolean
  readonly notice: string | undefined
  openPicker(reason?: string): void
  closePicker(): void
  select(modelId: string): Promise<void>
  refresh(): Promise<void>
  configureLocal(input: Omit<LocalProviderInput, 'sparkHome'>): Promise<boolean>
  /** Called whenever the effective model changes (runTui records it on new sessions). */
  onModelChanged?: ((model: string | undefined) => void) | undefined
}

export interface UseModelRuntimeOptions {
  readonly switchable: SwitchableLlmService
  readonly initialModel?: string
  readonly startupError?: string
  readonly seams?: ModelRuntimeSeams
  readonly onModelChanged?: (model: string | undefined) => void
}

export function useModelRuntime(options: UseModelRuntimeOptions): ModelRuntimeController {
  const [seams] = useState(() => options.seams ?? defaultSeams())
  const [model, setModel] = useState<string | undefined>(options.initialModel)
  const [catalog, setCatalog] = useState<ConfiguredModelCatalog | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [open, setOpen] = useState(options.initialModel === undefined)
  const [notice, setNotice] = useState<string | undefined>(options.startupError)

  const applyModel = useCallback(
    (runtime: ConfiguredModelRuntime) => {
      options.switchable.set(runtime.service)
      setModel(runtime.modelId)
      setError(undefined)
      setNotice(undefined)
      setOpen(false)
      options.onModelChanged?.(runtime.modelId)
    },
    [options],
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setCatalog(await seams.inspect({ cwd: seams.cwd }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRefreshing(false)
    }
  }, [seams])

  useEffect(() => {
    if (options.initialModel === undefined) void refresh()
  }, [options.initialModel, refresh])

  const select = useCallback(
    async (modelId: string) => {
      setBusy(true)
      try {
        const runtime = await seams.createRuntime({ cwd: seams.cwd, model: modelId })
        const persistFailure = await persistSelection(seams, modelId)
        applyModel(runtime)
        if (persistFailure !== undefined) {
          // The model works for this session; reopen the picker so the reason
          // is visible and esc keeps using it while a re-pick retries the write.
          setOpen(true)
          setNotice('模型已切换，但写入默认配置失败（esc 可继续使用）')
          setError(`写入默认模型配置失败：${persistFailure}`)
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusy(false)
      }
    },
    [applyModel, seams],
  )

  const configureLocal = useCallback(
    async (input: Omit<LocalProviderInput, 'sparkHome'>) => {
      setBusy(true)
      try {
        const result = await seams.configure({ ...input, sparkHome: seams.sparkHome })
        await refresh()
        const runtime = await seams.createRuntime({ cwd: seams.cwd, model: result.modelEntryId })
        const persistFailure = await persistSelection(seams, result.modelEntryId)
        applyModel(runtime)
        if (persistFailure !== undefined) {
          setOpen(true)
          setNotice('模型已切换，但写入默认配置失败（esc 可继续使用）')
          setError(`写入默认模型配置失败：${persistFailure}`)
        }
        return true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        setBusy(false)
      }
    },
    [applyModel, refresh, seams],
  )

  return {
    model,
    catalog,
    busy,
    refreshing,
    error,
    startupError: options.startupError,
    open,
    notice,
    openPicker: (reason?: string) => {
      setNotice(reason ?? '切换模型')
      setOpen(true)
    },
    closePicker: () => {
      if (model !== undefined) {
        setOpen(false)
        setNotice(undefined)
      }
    },
    select,
    refresh,
    configureLocal,
    onModelChanged: options.onModelChanged,
  }
}

function defaultSeams(): ModelRuntimeSeams {
  return {
    cwd: process.cwd(),
    sparkHome: defaultSparkHome(),
    inspect: (options) => inspectConfiguredModels(options),
    createRuntime: (options) => createConfiguredRuntime(options),
    configure: (input) => configureLocalProvider(input),
    persist: async (input) => {
      await persistSelectedModel(input)
    },
  }
}

/**
 * Best-effort persistence of a user-driven model switch. Returns the failure
 * message on error instead of throwing: the selection already applies to the
 * live session, so a config write problem must not undo it — the caller shows
 * the reason and the next launch simply falls back to the picker again.
 */
async function persistSelection(
  seams: ModelRuntimeSeams,
  modelId: string,
): Promise<string | undefined> {
  try {
    await seams.persist({ sparkHome: seams.sparkHome, model: modelId })
    return undefined
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}
