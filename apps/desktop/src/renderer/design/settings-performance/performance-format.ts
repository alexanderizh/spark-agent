/**
 * @module performance-format
 *
 * 性能设置页的纯函数工具（无 React / IPC 依赖，便于单测）：
 * 字节/百分比格式化、压力级别元数据、子进程分类中文映射、
 * 指标阈值联动着色。判定语义对齐主方案 §3.3——pct 直比，bytes 仅展示。
 */

import type {
  ChildProcessSample,
  PressureIndicatorKey,
  PressureLevel,
  TrackedProcessKind,
} from '@spark/protocol'

/* ─── 压力级别元数据 ─────────────────────────────────────────────────────────── */

export const PRESSURE_LEVEL_META: Record<
  PressureLevel,
  { name: string; colorVar: string; rank: number }
> = {
  nominal: { name: '正常', colorVar: 'var(--primary)', rank: 0 },
  warning: { name: '警告', colorVar: 'var(--warning)', rank: 1 },
  critical: { name: '严重', colorVar: 'var(--perf-critical)', rank: 2 },
  emergency: { name: '危急', colorVar: 'var(--danger)', rank: 3 },
}

/** 级别对应的降级状态描述（降级矩阵 §4.2 的用户可读形态）。 */
export function pressureActionCopy(level: PressureLevel): string {
  switch (level) {
    case 'nominal':
      return '资源充裕 · 正常调度'
    case 'warning':
      return '限制新任务 · 进行中任务不受影响'
    case 'critical':
      return '暂停新派发 · 后台任务延迟执行'
    case 'emergency':
      return '暂停全部新任务派发 · 必要时终止排队任务'
  }
}

/* ─── 指标元数据 ────────────────────────────────────────────────────────────── */

export const INDICATOR_LABELS: Record<PressureIndicatorKey, string> = {
  'system-used-pct': '系统内存',
  'app-footprint-pct': '应用占用',
  'host-rss-pct': '宿主内存',
  'children-rss-pct': '子进程内存',
  'children-count': '子进程数',
  'event-loop-delay-ms': '事件循环延迟',
}

/** 指标当前值的人类可读形式（阈值联动着色由组件层完成）。 */
export function formatIndicatorValue(key: PressureIndicatorKey, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  switch (key) {
    case 'system-used-pct':
    case 'app-footprint-pct':
    case 'host-rss-pct':
    case 'children-rss-pct':
      return `${formatPct(value)}%`
    case 'children-count':
      return `${Math.round(value)} 个`
    case 'event-loop-delay-ms':
      return `${Math.round(value)} ms`
  }
}

/* ─── 格式化 ────────────────────────────────────────────────────────────────── */

export function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 10) / 10}`.replace(/\.0$/, '')
}

/** 字节数 → 「1.2 GB / 345 MB」紧凑形式（设计稿 fmtMB 同款规则）。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${Math.round(mb)} MB`
}

export function formatMs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value)} ms`
}

export function formatClock(iso: string | null | undefined): string {
  if (iso == null) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/* ─── 子进程分类 ────────────────────────────────────────────────────────────── */

const PROCESS_KIND_LABELS: Record<TrackedProcessKind, string> = {
  'claude-cli': 'Claude CLI',
  'codex-cli': 'Codex CLI',
  'agent-unknown': '未知 Agent',
  'mcp-bridge': 'MCP 桥',
  'platform-pool': '平台常驻池',
  'codex-pool': 'Codex 池',
  'engine-subagent': '引擎子代理',
  'media-mcp': '媒体 MCP',
  'tool-package': '工具包',
  'terminal-pty': '终端',
  'subapp-service': '子应用服务',
  'media-tool': '媒体工具',
  other: '其他',
}

export function processKindLabel(kind: TrackedProcessKind): string {
  return PROCESS_KIND_LABELS[kind]
}

export interface ProcessKindAggregate {
  kind: TrackedProcessKind
  label: string
  count: number
  rssBytes: number
}

/** full 快照 pid 明细按 kind 聚合（RSS 降序），供子进程卡堆叠条与明细行。 */
export function aggregateChildrenByKind(entries: ChildProcessSample[]): ProcessKindAggregate[] {
  const map = new Map<TrackedProcessKind, ProcessKindAggregate>()
  for (const entry of entries) {
    const current = map.get(entry.kind)
    if (current == null) {
      map.set(entry.kind, {
        kind: entry.kind,
        label: processKindLabel(entry.kind),
        count: 1,
        rssBytes: entry.rssBytes ?? 0,
      })
    } else {
      current.count += 1
      current.rssBytes += entry.rssBytes ?? 0
    }
  }
  return [...map.values()].sort((a, b) => b.rssBytes - a.rssBytes || b.count - a.count)
}

/* ─── 说明 ────────────────────────────────────────────────────────────────────
 * 指标着色不走本模块：性能总览直接消费 summary.pressure.indicators 的
 * 服务端逐指标级别（权威判定），见 PerformanceOverview.toneForLevel。
 * ──────────────────────────────────────────────────────────────────────────── */
