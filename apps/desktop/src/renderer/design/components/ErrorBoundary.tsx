/**
 * ErrorBoundary — React 错误边界组件
 *
 * 捕获子组件渲染阶段的 JavaScript 错误，展示友好的错误页面。
 * 支持「页面级」和「全局级」两种展示模式。
 *
 * 用法：
 *   <ErrorBoundary level="global">  // 全屏白屏错误
 *   <ErrorBoundary level="page">    // 内嵌区域错误
 */
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Icons } from '../Icons'

/* ---------- Types ---------- */

export type ErrorBoundaryLevel = 'global' | 'page'

type ErrorBoundaryProps = {
  children: ReactNode
  /** 错误展示级别：global 全屏白屏, page 内嵌区域 */
  level?: ErrorBoundaryLevel
  /** 自定义错误边界名称（用于日志标识） */
  name?: string
  /** 可选：自定义错误回调（如上报错误） */
  onError?: (error: Error, info: ErrorInfo) => void
}

type ErrorBoundaryState = {
  hasError: boolean
  error: Error | null
}

/* ---------- Component ---------- */

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const { name, onError } = this.props
    const label = name ?? 'ErrorBoundary'
    console.error(`[${label}] Rendering error:`, error, info)
    onError?.(error, info)
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  handleReport = (): void => {
    const { error } = this.state
    if (!error) return
    const body = [
      '**Error Report**',
      `Boundary: ${this.props.name ?? 'unknown'}`,
      `Level: ${this.props.level ?? 'page'}`,
      '',
      `\`\`\``,
      `Message: ${error.message}`,
      `Stack:`,
      error.stack ?? '(no stack)',
      `\`\`\``,
    ].join('\n')
    // Copy to clipboard so user can paste into GitHub issue
    void navigator.clipboard.writeText(body).then(() => {
      // Brief visual feedback — the retry button text changes briefly
    })
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    const { level = 'page', name } = this.props
    const error = this.state.error

    if (level === 'global') {
      return <GlobalErrorFallback error={error} name={name} onRetry={this.handleRetry} onReport={this.handleReport} />
    }

    return <PageErrorFallback error={error} name={name} onRetry={this.handleRetry} onReport={this.handleReport} />
  }
}

/* ---------- Fallback Components ---------- */

function GlobalErrorFallback({ error, name, onRetry, onReport }: {
  error: Error | null
  name: string | undefined
  onRetry: () => void
  onReport: () => void
}) {
  return (
    <div className="error-boundary-fallback error-boundary-global">
      <div className="error-boundary-drag-bar" aria-hidden />
      <div className="error-boundary-inner">
        <div className="error-boundary-icon">
          <Icons.AlertTriangle size={36} />
        </div>
        <h2 className="error-boundary-title">应用遇到了问题</h2>
        <p className="error-boundary-desc">
          {name ? `[${name}] ` : ''}渲染过程中发生了未预期的错误。请尝试刷新页面。
        </p>
        {error && (
          <pre className="error-boundary-detail">{error.message}</pre>
        )}
        <div className="error-boundary-actions">
          <button className="btn primary" onClick={onRetry}>
            <Icons.Refresh size={13} /> 重试
          </button>
          <button className="btn" onClick={onReport}>
            <Icons.Copy size={13} /> 复制错误报告
          </button>
        </div>
      </div>
    </div>
  )
}

function PageErrorFallback({ error, name, onRetry, onReport }: {
  error: Error | null
  name: string | undefined
  onRetry: () => void
  onReport: () => void
}) {
  return (
    <div className="error-boundary-fallback error-boundary-page">
      <div className="error-boundary-icon-sm">
        <Icons.AlertTriangle size={18} />
      </div>
      <div className="error-boundary-content">
        <div className="error-boundary-title-sm">
          页面渲染出错
        </div>
        {error && (
          <div className="error-boundary-desc-sm">{name ? `[${name}] ` : ''}{error.message}</div>
        )}
      </div>
      <div className="error-boundary-actions-sm">
        <button className="btn ghost sm" onClick={onRetry}>
          <Icons.Refresh size={11} /> 重试
        </button>
        <button className="btn ghost sm" onClick={onReport}>
          复制错误
        </button>
      </div>
    </div>
  )
}
