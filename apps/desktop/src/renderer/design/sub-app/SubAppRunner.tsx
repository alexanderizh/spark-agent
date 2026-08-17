import React from 'react'
import { useSubAppRunner } from './useSubAppRunner'
import type { SubAppRunnerProps } from './useSubAppRunner'

export type { SubAppRunnerProps } from './useSubAppRunner'

/**
 * 无样式运行器：只负责 iframe + 状态，布局交给外层视图。
 * 加载/错误覆盖层使用极简内联样式，后续由视图层替换为设计规范组件。
 */
export function SubAppRunner(props: SubAppRunnerProps): React.ReactElement {
  const runner = useSubAppRunner(props)
  return (
    <div className={props.className} style={{ position: 'relative', height: '100%', minHeight: 0 }}>
      <iframe
        key={runner.instanceId}
        ref={runner.frameRef}
        title={props.manifest.name || '子应用'}
        sandbox="allow-scripts"
        srcDoc={runner.document}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          border: 0,
          background: 'transparent',
        }}
      />
      {runner.status === 'loading' ? (
        <div
          data-testid="sub-app-loading"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            opacity: 0.75,
            pointerEvents: 'none',
          }}
        >
          正在启动应用…
        </div>
      ) : null}
      {runner.status === 'error' && runner.errorMessage != null ? (
        <div
          data-testid="sub-app-error"
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontSize: 13,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <span>{runner.errorMessage}</span>
          <button type="button" onClick={() => runner.reload()}>
            重新加载
          </button>
        </div>
      ) : null}
    </div>
  )
}
