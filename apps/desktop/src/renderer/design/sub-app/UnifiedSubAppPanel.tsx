import React, { useEffect, useState } from 'react'
import type { SubAppDetails } from '@spark/protocol'
import { subAppClient } from './subAppClient'
import { SubAppRunner } from './SubAppRunner'

/**
 * 统一侧边面板内的 panel 子应用内容区。
 *
 * 目录（SubAppSummary）不含 manifest/source，这里按 appId 拉取应用
 * details 后交给 SubAppRunner 渲染；与 SubAppPanelDock 一致优先运行
 * 发布快照（未发布的应用回落草稿）。
 */
export function UnifiedSubAppPanel({ appId }: { appId: string }): React.ReactElement {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; details: SubAppDetails }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    subAppClient
      .get({ appId })
      .then((details) => {
        if (!cancelled) setState({ status: 'ready', details })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setState({ status: 'error', message })
      })
    return () => {
      cancelled = true
    }
  }, [appId])

  if (state.status === 'loading') {
    return (
      <div className="subapp-unified-panel-state" data-testid="subapp-unified-panel-loading">
        正在加载应用…
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div
        className="subapp-unified-panel-state is-error"
        role="alert"
        data-testid="subapp-unified-panel-error"
      >
        应用加载失败：{state.message}
      </div>
    )
  }
  const runtime = state.details.publishedRelease ?? state.details.draft
  return (
    <SubAppRunner
      appId={appId}
      manifest={runtime.manifest}
      source={runtime.source}
      mode={state.details.publishedRelease != null ? 'published' : 'draft'}
      release={state.details.publishedRelease}
      className="subapp-unified-runner"
    />
  )
}
