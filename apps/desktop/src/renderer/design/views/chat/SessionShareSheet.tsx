import { forwardRef, useCallback } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import sparkLogo from '../../../assets/spark-logo.png'
import { buildSessionShareCaption } from './sessionShareModel'
import './SessionShareDialog.css'

export interface SessionShareSheetProps {
  title: string
  workspaceName?: string | null | undefined
  omittedCount: number
  totalCount: number
  generatedAt: Date
  width: number
  paddingLeft: number
  paddingRight: number
  onLiveHost: (host: HTMLDivElement | null) => void
}

export const SessionShareSheet = forwardRef<HTMLElement, SessionShareSheetProps>(
  function SessionShareSheet(
    { title, workspaceName, omittedCount, totalCount, generatedAt, width, paddingLeft, paddingRight, onLiveHost },
    ref,
  ) {
    const caption = buildSessionShareCaption({
      workspaceName,
      shownCount: Math.max(0, totalCount - omittedCount),
      totalCount,
      generatedAt,
    })
    const footerDate = generatedAt.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    const setLiveHost = useCallback(
      (node: HTMLDivElement | null) => {
        onLiveHost(node)
      },
      [onLiveHost],
    )

    return (
      <article
        ref={ref}
        className="session-share-sheet"
        style={
          {
            width,
            '--session-share-pad-left': `${paddingLeft}px`,
            '--session-share-pad-right': `${paddingRight}px`,
          } as CSSProperties
        }
      >
        <header className="session-share-header">
          <h1>{title.trim() || '未命名会话'}</h1>
          <p>{caption}</p>
        </header>
        {omittedCount > 0 && (
          <p className="session-share-omit">
            较早的 {omittedCount} 条消息没有放进这张长图，好让文字保持清晰。
          </p>
        )}
        <div ref={setLiveHost} className="session-share-live-host" />
        <footer className="session-share-brand">
          <div className="session-share-brand-line" />
          <div className="session-share-brand-row">
            <img className="session-share-logo" src={sparkLogo} alt="" />
            <div className="session-share-brand-copy">
              <strong>SparkWork</strong>
              <span>会话分享</span>
            </div>
            <time>{footerDate}</time>
          </div>
        </footer>
      </article>
    )
  },
)

export function SessionShareLiveFrame({
  count,
  children,
}: {
  count: number
  children: ReactNode
}) {
  return (
    <div
      className="chat-stream session-share-live"
      data-share-live-ready=""
      data-share-count={count}
    >
      <div className="chat-stream-inner">
        <div className="chat-message-list" role="list">
          {children}
        </div>
      </div>
    </div>
  )
}
