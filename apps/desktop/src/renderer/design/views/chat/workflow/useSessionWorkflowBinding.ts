import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  SessionGetWorkflowBindingResponse,
  SessionSetWorkflowBindingRequest,
  WorkflowItem,
} from '@spark/protocol'
import { useIpcInvoke, useIpcStream } from '../../../hooks/useIpc'
import { localizeBindingError } from './sessionWorkflowBindingModel'

export function useSessionWorkflowBinding(sessionId: string | null) {
  const getBinding = useIpcInvoke('session:get-workflow-binding')
  const setBinding = useIpcInvoke('session:set-workflow-binding')
  const abandonRunInvoke = useIpcInvoke('session:abandon-workflow-run')
  const listWorkflows = useIpcInvoke('workflow:list')
  const [state, setState] = useState<SessionGetWorkflowBindingResponse | null>(null)
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const activeSessionRef = useRef(sessionId)
  const requestGenerationRef = useRef(0)

  const reload = useCallback(async () => {
    const requestedSessionId = sessionId
    if (requestedSessionId == null) return
    const requestGeneration = ++requestGenerationRef.current
    try {
      const [bindingResult, workflowResult] = await Promise.all([
        getBinding.invoke({ sessionId: requestedSessionId }),
        listWorkflows.invoke({ includeArchived: false }),
      ])
      if (
        activeSessionRef.current !== requestedSessionId ||
        requestGenerationRef.current !== requestGeneration
      ) {
        return
      }
      setState(bindingResult)
      setWorkflows(
        workflowResult.workflows.filter(
          (workflow) => workflow.enabled && workflow.status === 'active',
        ),
      )
      setError(null)
    } catch (cause) {
      if (
        activeSessionRef.current !== requestedSessionId ||
        requestGenerationRef.current !== requestGeneration
      ) {
        return
      }
      setError(localizeBindingError(cause))
    }
  }, [getBinding.invoke, listWorkflows.invoke, sessionId])

  useEffect(() => {
    activeSessionRef.current = sessionId
    requestGenerationRef.current += 1
    setState(null)
    setWorkflows([])
    setError(null)
    void reload()
  }, [reload, sessionId])

  useIpcStream('stream:session:config-changed', (event) => {
    if (event.sessionId === sessionId && event.kind === 'workflow-binding') void reload()
  })

  const update = useCallback(
    async (next: { mode: 'inherit' | 'disabled' } | { mode: 'override'; workflowId: string }) => {
      if (sessionId == null || state == null) return
      try {
        const result = await setBinding.invoke({
          sessionId,
          expectedBindingInstanceId: state.binding?.bindingInstanceId ?? null,
          ...next,
        } as SessionSetWorkflowBindingRequest)
        if (result.error != null) {
          setError(localizeBindingError(result.error))
          await reload()
          return
        }
        if (!result.preflight.ok || result.binding == null) {
          setError(localizeBindingError(result.preflight.issues))
          return
        }
        setState({
          binding: result.binding,
          effective: result.effective,
          resumableRun: result.resumableRun,
          canChange: true,
          changeBlockers: [],
          features: state.features,
        })
        setError(null)
      } catch (cause) {
        setError(localizeBindingError(cause))
        await reload()
      }
    },
    [reload, sessionId, setBinding.invoke, state],
  )

  /** 「放弃并新建运行」：放弃当前代次失败 Run 并轮换代次；错误时刷新状态。 */
  const abandonRun = useCallback(async () => {
    if (
      sessionId == null ||
      state?.binding == null ||
      state.resumableRun == null ||
      state.resumableRun.status !== 'failed'
    ) {
      return
    }
    try {
      const result = await abandonRunInvoke.invoke({
        sessionId,
        expectedBindingInstanceId: state.binding.bindingInstanceId,
        runId: state.resumableRun.id,
      })
      if (result.error != null) {
        setError(localizeBindingError(result.error))
        await reload()
        return
      }
      setState({
        binding: result.binding,
        effective: result.effective,
        resumableRun: result.resumableRun,
        canChange: true,
        changeBlockers: [],
        features: state.features,
      })
      setError(null)
    } catch (cause) {
      setError(localizeBindingError(cause))
      await reload()
    }
  }, [abandonRunInvoke.invoke, reload, sessionId, state])

  return {
    state,
    workflows,
    loading: getBinding.loading || listWorkflows.loading,
    saving: setBinding.loading,
    abandoning: abandonRunInvoke.loading,
    error,
    reload,
    update,
    abandonRun,
  }
}
