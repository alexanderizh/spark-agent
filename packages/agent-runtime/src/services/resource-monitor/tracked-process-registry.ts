/**
 * @module resource-monitor/tracked-process-registry
 *
 * TrackedProcessRegistry —— spawn 点主动注册的子进程簿记（方案 §3.1）。
 *
 * codex 池 / 平台 MCP / 终端 pty / 工具包 persistent 池等 spawn 点在拿到
 * pid 处调用 register（带 kind）；采集时注册 kind 优先于树扫 comm 启发式。
 *
 * 清理双保险：spawn 方反注册 + 采集连续 2 轮查无（树扫/批量采集均不见该
 * pid）自动剔除，防注册方泄漏导致永久幽灵进程。
 */

import type { TrackedProcessKind } from '@spark/protocol'

/** 注册项：pid + 分类 + 可选来源标识（诊断用，如 session/lease id）。 */
export interface TrackedProcessRegistration {
  pid: number
  kind: TrackedProcessKind
  /** 来源标识（refId：session id / lease id / terminal id 等），仅诊断。 */
  refId?: string
  registeredAt: number
}

interface RegistryEntry extends TrackedProcessRegistration {
  /** 连续采集轮次未见该 pid 的计数（≥2 自动剔除）。 */
  missedRounds: number
}

const MAX_MISSED_ROUNDS = 2

export class TrackedProcessRegistry {
  private readonly entries = new Map<number, RegistryEntry>()

  /** spawn 点注册。同一 pid 重复注册按最新 kind 覆盖。 */
  register(pid: number, kind: TrackedProcessKind, refId?: string): void {
    if (!Number.isInteger(pid) || pid <= 0) return
    const existing = this.entries.get(pid)
    this.entries.set(pid, {
      pid,
      kind,
      ...(refId != null ? { refId } : {}),
      registeredAt: existing?.registeredAt ?? Date.now(),
      missedRounds: 0,
    })
  }

  /** spawn 方退出时反注册。 */
  unregister(pid: number): void {
    this.entries.delete(pid)
  }

  /** 全部清空（测试 / 重建）。 */
  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }

  /** 当前注册快照（pid → 注册信息）。 */
  snapshot(): Map<number, TrackedProcessRegistration> {
    return new Map(
      [...this.entries.entries()].map(([pid, entry]) => [
        pid,
        {
          pid: entry.pid,
          kind: entry.kind,
          ...(entry.refId != null ? { refId: entry.refId } : {}),
          registeredAt: entry.registeredAt,
        } satisfies TrackedProcessRegistration,
      ]),
    )
  }

  kindFor(pid: number): TrackedProcessKind | null {
    return this.entries.get(pid)?.kind ?? null
  }

  /**
   * 采集轮结束后的簿记对账：本轮观测到的 pid 集合。
   * 注意：当前唯一调用方（children-collector）传入的是「宿主后代树」pid 集——
   * 因此本对账仅适用于注册时即为宿主后代的进程；detached spawn 或父进程退出后
   * 重挂（ppid=1）的进程（如常驻 Codex App Server）不会出现在后代集中，注册后
   * 将在 MAX_MISSED_ROUNDS 轮后被误剔除。此类进程暂勿经 registerChildProcess
   * 注册（依赖树扫兜底或显式 unregister 管理）；后续接入 spawn 点时如需注册
   * 非后代进程，应扩展观测集或为条目增加 descendant 标记。
   * 连续 MAX_MISSED_ROUNDS 轮未见 → 自动剔除（进程已退出而 spawn 方未反注册）。
   * 返回本轮被剔除的 pid（诊断）。
   */
  reconcileWithObservedPids(observedPids: ReadonlySet<number>): number[] {
    const pruned: number[] = []
    for (const [pid, entry] of this.entries) {
      if (observedPids.has(pid)) {
        if (entry.missedRounds !== 0) entry.missedRounds = 0
        continue
      }
      entry.missedRounds += 1
      if (entry.missedRounds >= MAX_MISSED_ROUNDS) {
        this.entries.delete(pid)
        pruned.push(pid)
      }
    }
    return pruned
  }
}

/** 治理口径分类：claude/codex 家族（含 CLI 内部 Task 孙进程的 agent-unknown）。 */
export const GOVERNED_PROCESS_KINDS: readonly TrackedProcessKind[] = [
  'claude-cli',
  'codex-cli',
  'agent-unknown',
] as const

export function isGovernedProcessKind(kind: TrackedProcessKind): boolean {
  return GOVERNED_PROCESS_KINDS.includes(kind)
}
