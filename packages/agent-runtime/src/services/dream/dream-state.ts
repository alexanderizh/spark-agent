/**
 * @module dream-state
 *
 * 梦境运行状态的持久化与订阅（计划 §8.1）。
 *
 * 存储契约：settings JSON（category='dream'），不建新表 ——
 *   - `state:{track}`  → DreamRunState（当前/最近一次运行，重启后仍可读到终态）
 *   - `report:{track}` → DreamRunReport（最近一次完整报告，设置页摘要数据源）
 *
 * 广播契约：本类只做进程内订阅（onChange）；跨进程 IPC 广播由桌面 main 装配层
 * 桥接（pushStreamEvent('stream:dream:changed')），agent-runtime 不直接依赖 IPC。
 */

import { createLogger } from '@spark/shared'
import type { DreamRunReport, DreamRunState, DreamTrack } from '@spark/protocol'

const log = createLogger('dream:state')

const STATE_KEY = (track: DreamTrack): string => `state:${track}`
const REPORT_KEY = (track: DreamTrack): string => `report:${track}`

export interface DreamStateDeps {
  settingsGet: (category: string, key: string) => unknown
  settingsSet: ((category: string, key: string, value: unknown) => void) | null
}

export class DreamRunStateStore {
  private readonly deps: DreamStateDeps
  private readonly listeners = new Set<(state: DreamRunState) => void>()

  constructor(deps: DreamStateDeps) {
    this.deps = deps
  }

  getState(track: DreamTrack): DreamRunState | null {
    return this.readJson<DreamRunState>(STATE_KEY(track))
  }

  getReport(track: DreamTrack): DreamRunReport | null {
    return this.readJson<DreamRunReport>(REPORT_KEY(track))
  }

  /** 持久化并通知订阅者；写失败不抛（状态是增强信息，不能阻断整理主链路） */
  setState(state: DreamRunState): void {
    try {
      this.deps.settingsSet?.('dream', STATE_KEY(state.track), state)
    } catch (err) {
      log.warn(`persist state failed (track=${state.track}): ${errText(err)}`)
    }
    for (const fn of this.listeners) {
      try {
        fn(state)
      } catch (err) {
        log.warn(`state listener failed: ${errText(err)}`)
      }
    }
  }

  setReport(report: DreamRunReport): void {
    try {
      this.deps.settingsSet?.('dream', REPORT_KEY(report.track), report)
    } catch (err) {
      log.warn(`persist report failed (track=${report.track}): ${errText(err)}`)
    }
  }

  /** 订阅状态变更；返回取消订阅函数 */
  onChange(fn: (state: DreamRunState) => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /**
   * 清算上个进程残留的 running 状态（服务构造时调用一次）：内存锁是进程内
   * 的，构造时不可能有活跃运行——持久化里仍是 running 的必然是崩溃/退出
   * 留下的尸体。不清算会导致设置页永久显示「整理中」且立即整理按钮被禁用
   * （cancel 因内存无此轨拒绝），无逃生门。
   */
  reconcileStaleRunning(): void {
    for (const track of ['memory', 'wiki'] as const) {
      const state = this.getState(track)
      if (state == null || state.status !== 'running') continue
      const stale: DreamRunState = {
        ...state,
        status: 'failed',
        phase: 'prune',
        updatedAt: Date.now(),
        error: '应用重启中断（上次整理未完成，状态已自动收敛）',
      }
      log.warn(`reconciled stale running state (track=${track}) -> failed`)
      this.setState(stale)
    }
  }

  private readJson<T>(key: string): T | null {
    try {
      const raw = this.deps.settingsGet('dream', key)
      if (typeof raw !== 'string') return raw as T | null
      return JSON.parse(raw) as T
    } catch (err) {
      log.warn(`read ${key} failed: ${errText(err)}`)
      return null
    }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
