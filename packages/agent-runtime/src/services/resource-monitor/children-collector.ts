/**
 * @module resource-monitor/children-collector
 *
 * 子进程批量采集器（方案 §3.1）：单次批量 `ps` 拉全量进程表 → 内存构建
 * 进程树 → 从宿主 pid 向下遍历后代；kind 分类注册表优先、comm 启发式兜底。
 *
 * 采集自身不能成为压力源：每轮只 spawn 一次外部命令（带超时），树遍历
 * 与汇总全在内存完成；解析函数全部纯函数可单测。
 *
 * 隐私红线：只读 pid/ppid/rss/comm 四列，不读 argv/env/打开文件。
 */

import { execText } from './collectors.js'
import type {
  ChildProcessSample,
  ChildrenProcessSummary,
  TrackedProcessKind,
} from '@spark/protocol'
import {
  GOVERNED_PROCESS_KINDS,
  isGovernedProcessKind,
  type TrackedProcessRegistry,
} from './tracked-process-registry.js'

/** ps 单行（pid/ppid/rss/comm；rss 为 KB）。 */
export interface PsRow {
  pid: number
  ppid: number
  rssKb: number | null
  comm: string
}

const GOVERNED_ANCESTORS: readonly TrackedProcessKind[] = GOVERNED_PROCESS_KINDS

/**
 * 解析 `ps -o pid=,ppid=,rss=,comm=` 输出（macOS/Linux 同格式）。
 * 前 3 列为数字，剩余全部为 comm（路径可能含空格）；畸形行跳过不抛错。
 */
export function parsePsOutput(output: string): PsRow[] {
  const rows: PsRow[] = []
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line)
    if (match == null) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const rssKb = Number(match[3])
    const comm = match[4] ?? ''
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(ppid) || ppid < 0) continue
    rows.push({ pid, ppid, rssKb: Number.isFinite(rssKb) && rssKb > 0 ? rssKb : null, comm })
  }
  return rows
}

/** 解析 PowerShell Win32_Process 输出（pid/ppid/rssBytes/name.exe）。 */
export function parseWindowsProcessOutput(output: string): PsRow[] {
  const rows: PsRow[] = []
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line)
    if (match == null) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const rssBytes = Number(match[3])
    const comm = match[4] ?? ''
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(ppid) || ppid < 0) continue
    rows.push({
      pid,
      ppid,
      rssKb: Number.isFinite(rssBytes) && rssBytes > 0 ? Math.round(rssBytes / 1024) : null,
      comm,
    })
  }
  return rows
}

async function collectProcessRows(): Promise<PsRow[] | null> {
  if (process.platform === 'win32') {
    const output = await execText(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "{0} {1} {2} {3}" -f $_.ProcessId, $_.ParentProcessId, $_.WorkingSet64, $_.Name }',
      ],
      5_000,
    )
    return output == null ? null : parseWindowsProcessOutput(output)
  }
  const output = await execText('ps', ['-axo', 'pid=,ppid=,rss=,comm='], 3_000)
  return output == null ? null : parsePsOutput(output)
}

function commBasename(comm: string): string {
  const normalized = comm.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  const base = idx >= 0 ? normalized.slice(idx + 1) : normalized
  return base.toLowerCase()
}

/** comm 启发式：仅识别 claude/codex 家族可执行名；node/electron 返回 null 交给父链判定。 */
export function classifyByComm(comm: string): TrackedProcessKind | null {
  const base = commBasename(comm)
  if (base.includes('claude')) return 'claude-cli'
  if (base.includes('codex')) return 'codex-cli'
  return null
}

function isNodeFamily(base: string): boolean {
  return (
    base === 'node' ||
    base === 'node.exe' ||
    base.includes('electron') ||
    base === 'bun' ||
    base === 'bun.exe'
  )
}

/**
 * 从 rootPid 向下遍历进程树，产出全部后代行（BFS；防环：已访问 pid 跳过）。
 */
export function buildDescendantRows(rows: PsRow[], rootPid: number): PsRow[] {
  const byParent = new Map<number, PsRow[]>()
  for (const row of rows) {
    const list = byParent.get(row.ppid)
    if (list != null) list.push(row)
    else byParent.set(row.ppid, [row])
  }
  const descendants: PsRow[] = []
  const visited = new Set<number>([rootPid])
  const queue: PsRow[] = byParent.get(rootPid) ?? []
  while (queue.length > 0) {
    const row = queue.shift() as PsRow
    if (visited.has(row.pid)) continue
    visited.add(row.pid)
    descendants.push(row)
    const children = byParent.get(row.pid)
    if (children != null) queue.push(...children)
  }
  return descendants
}

/**
 * 单个后代样本定 kind：注册表精确标注优先；无注册时 comm 启发式；
 * node/electron 且祖辈已是治理家族（CLI 内部 Task 孙进程）→ agent-unknown；
 * 其余无特征 → other。
 */
function resolveKind(
  row: PsRow,
  registryKind: TrackedProcessKind | null,
  nearestGovernedAncestor: boolean,
): TrackedProcessKind {
  if (registryKind != null) return registryKind
  const byComm = classifyByComm(row.comm)
  if (byComm != null) return byComm
  const base = commBasename(row.comm)
  if (isNodeFamily(base) && nearestGovernedAncestor) return 'agent-unknown'
  return 'other'
}

export interface CollectChildrenArgs {
  registry: TrackedProcessRegistry
  rootPid: number
  /** 快照 pid 明细上限（超限按 RSS 取 top）。 */
  maxEntries: number
}

/**
 * 一轮完整子进程采集：批量 ps → 树遍历 → 分类汇总。
 * 失败（ps 不可用/超时/空输出）返回 null，由服务层退避 + stale 标记。
 */
export async function collectChildrenSummary(
  args: CollectChildrenArgs,
): Promise<ChildrenProcessSummary | null> {
  const rows = await collectProcessRows()
  if (rows == null || rows.length === 0) return null
  return summarizeRows(rows, args)
}

/** 纯汇总（可测）：进程表行 → 后代树 → 分类 → 双口径统计 + 注册表对账。 */
export function summarizeRows(
  rows: PsRow[],
  args: Omit<CollectChildrenArgs, never>,
): ChildrenProcessSummary {
  const descendants = buildDescendantRows(rows, args.rootPid)
  if (descendants.length === 0) {
    // 无后代也要对账注册表（观测集为空 → 未注册的幽灵项计数增加）。
    args.registry.reconcileWithObservedPids(new Set<number>())
    return {
      totalCount: 0,
      totalRssBytes: 0,
      governedCount: 0,
      governedRssBytes: 0,
      byKind: {},
      registryTracked: 0,
      sweepDiscovered: 0,
      entries: [],
    }
  }

  // 先按 pid 建行索引，供父链回溯判定「最近治理祖先」。
  const rowByPid = new Map<number, PsRow>()
  for (const row of descendants) rowByPid.set(row.pid, row)

  const registrySnapshot = args.registry.snapshot()
  const observedPids = new Set<number>()
  let registryTracked = 0
  let sweepDiscovered = 0
  const samples: ChildProcessSample[] = []

  for (const row of descendants) {
    observedPids.add(row.pid)
    const registryKind = registrySnapshot.get(row.pid)?.kind ?? null
    if (registryKind != null) registryTracked += 1
    else sweepDiscovered += 1
    // 最近治理祖先：沿树向上找第一个 governed 行（注册 kind 或 comm 特征）。
    let ancestorGoverned = false
    let cursor = rowByPid.get(row.ppid)
    for (let depth = 0; cursor != null && depth < 16; depth += 1) {
      const cursorKind = registrySnapshot.get(cursor.pid)?.kind ?? classifyByComm(cursor.comm)
      if (cursorKind != null && isGovernedProcessKind(cursorKind)) {
        ancestorGoverned = true
        break
      }
      cursor = rowByPid.get(cursor.ppid)
    }
    const kind = resolveKind(row, registryKind, ancestorGoverned)
    samples.push({
      pid: row.pid,
      kind,
      rssBytes: row.rssKb != null ? row.rssKb * 1024 : null,
      governed: isGovernedProcessKind(kind),
      source: registryKind != null ? 'registry' : 'sweep',
    })
  }

  args.registry.reconcileWithObservedPids(observedPids)

  const byKind: Partial<Record<TrackedProcessKind, number>> = {}
  let totalRss = 0
  let totalRssKnown = false
  let governedCount = 0
  let governedRss = 0
  let governedRssKnown = false
  for (const sample of samples) {
    byKind[sample.kind] = (byKind[sample.kind] ?? 0) + 1
    if (sample.rssBytes != null) {
      totalRss += sample.rssBytes
      totalRssKnown = true
      if (sample.governed) {
        governedRss += sample.rssBytes
        governedRssKnown = true
      }
    }
    if (sample.governed) governedCount += 1
  }

  const entries =
    samples.length <= args.maxEntries
      ? samples
      : [...samples].sort((a, b) => (b.rssBytes ?? 0) - (a.rssBytes ?? 0)).slice(0, args.maxEntries)

  return {
    totalCount: samples.length,
    totalRssBytes: totalRssKnown ? totalRss : null,
    governedCount,
    governedRssBytes: governedRssKnown ? governedRss : null,
    byKind,
    registryTracked,
    sweepDiscovered,
    entries,
  }
}

/** 供测试：治理家族 kind 常量再导出（避免测试直接依赖内部数组）。 */
export const GOVERNED_KINDS = GOVERNED_ANCESTORS
