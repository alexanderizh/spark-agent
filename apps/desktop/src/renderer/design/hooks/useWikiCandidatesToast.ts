/**
 * useWikiCandidatesToast — wiki 里程碑沉淀候选通知（P1 可见性）
 *
 * 订阅 stream:wiki:candidates-ready（主进程仅在 inserted>0 时推送，零产出不打扰）：
 * 右上角 toast「沉淀了 N 条知识候选」+「去确认」跳转知识库。
 * 挂载于 Shell（ToastProvider 内、任意视图常驻），WikiView 内另有同源监听刷新徽标。
 */

import { useEffect, useRef } from 'react'
import { useToast } from '../components/Toast'
import { useI18n } from '../i18n'

export interface UseWikiCandidatesToastOptions {
  /** 点击 toast「去确认」时跳转知识库（由宿主注入导航） */
  onOpenWiki: () => void
}

export function useWikiCandidatesToast(options: UseWikiCandidatesToastOptions): void {
  const { toast, dismiss } = useToast()
  const { t } = useI18n()

  const onOpenWikiRef = useRef(options.onOpenWiki)
  onOpenWikiRef.current = options.onOpenWiki
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    const unsubscribe = window.spark?.on?.('stream:wiki:candidates-ready', (payload) => {
      const tr = tRef.current
      const id = toast.info(tr('wiki.candidates.readyToast', { n: String(payload.inserted) }), {
        actions: [
          {
            label: tr('wiki.candidates.review'),
            onClick: () => {
              dismiss(id)
              onOpenWikiRef.current()
            },
          },
        ],
      })
    })
    return () => unsubscribe?.()
  }, [toast, dismiss])
}
