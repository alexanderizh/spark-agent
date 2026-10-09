/**
 * @module DreamNoticeHost
 * 【AutoDream S4】梦境整理完成通知：监听 stream:dream:changed，运行到达终态
 * （succeeded/failed/cancelled）时右上角 toast 告知结果摘要。
 * 复刻 PressureNoticeHost / ComputerKillSwitchNoticeHost 的 host 组件模式
 * （无 UI、只发全局通知）；设置页未打开也能收到完成通知（计划 R8）。
 */
import { useEffect, useRef } from 'react'

import type { DreamRunState } from '@spark/protocol'

import { useToast } from '../components/Toast'

const TRACK_LABEL: Record<DreamRunState['track'], string> = {
  memory: '记忆轨',
  wiki: '知识库轨',
}

/** 只对「本进程见过活跃态」的 run 弹终态通知：避免挂载时收到持久化残留状态重放 */
export function DreamNoticeHost(): null {
  const { toast } = useToast()
  const activeRuns = useRef(new Set<string>())

  useEffect(() => {
    const off =
      window.spark?.on?.('stream:dream:changed', (state: DreamRunState) => {
        if (state == null || state.runId == null) return
        if (state.status === 'queued' || state.status === 'running') {
          activeRuns.current.add(state.runId)
          return
        }
        if (!activeRuns.current.has(state.runId)) return
        activeRuns.current.delete(state.runId)
        const label = TRACK_LABEL[state.track] ?? state.track
        if (state.status === 'succeeded') {
          const { proposals, autoApplied, pendingReview } = state.stats
          toast.success(
            `自动整编完成（${label}）：提案 ${proposals} · 自动落库 ${autoApplied}` +
              (pendingReview > 0 ? ` · 待审 ${pendingReview}` : ''),
          )
          return
        }
        if (state.status === 'failed') {
          toast.error(`自动整编失败（${label}）：${state.error ?? '未知错误'}`)
          return
        }
        toast.info(`自动整编已取消（${label}）`)
      }) ?? (() => {})
    return off
  }, [toast])

  return null
}
