import { useCallback, useEffect, useState } from 'react'

import {
  configureLocalProvider,
  createConfiguredRuntime,
  inspectConfiguredModels,
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
        applyModel(await seams.createRuntime({ cwd: seams.cwd, model: modelId }))
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
        applyModel(await seams.createRuntime({ cwd: seams.cwd, model: result.modelEntryId }))
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
  }
}
