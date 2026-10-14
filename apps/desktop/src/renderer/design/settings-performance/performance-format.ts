/**
 * @module performance-format
 *
 * 性能设置页的纯函数工具（无 React / IPC 依赖，便于单测）：
 * 字节/百分比格式化、压力级别元数据、子进程分类映射、
 * 指标阈值联动着色。判定语义对齐主方案 §3.3——pct 直比，bytes 仅展示。
 *
 * 多语言：所有面向用户的文本通过注入的 `t` 生成；与语言无关的结构
 * （颜色变量、rank、格式化规则）保持为模块级常量。
 */

import type {
  ChildProcessSample,
  PressureIndicatorKey,
  PressureLevel,
  TrackedProcessKind,
} from '@spark/protocol'
import type { TranslateFn } from '../i18n'

/* ─── 压力级别元数据 ─────────────────────────────────────────────────────────── */

const PRESSURE_LEVEL_META_BASE: Record<
  PressureLevel,
  { nameKey: string; colorVar: string; rank: number }
> = {
  nominal: { nameKey: 'perf.level.nominal', colorVar: 'var(--primary)', rank: 0 },
  warning: { nameKey: 'perf.level.warning', colorVar: 'var(--warning)', rank: 1 },
  critical: { nameKey: 'perf.level.critical', colorVar: 'var(--perf-critical)', rank: 2 },
  emergency: { nameKey: 'perf.level.emergency', colorVar: 'var(--danger)', rank: 3 },
}

export interface PressureLevelMeta {
  name: string
  colorVar: string
  rank: number
}

/** 按当前语言生成压力级别元数据（模块级常量无法随语言切换更新）。 */
export function getPressureLevelMeta(t: TranslateFn): Record<PressureLevel, PressureLevelMeta> {
  const out = {} as Record<PressureLevel, PressureLevelMeta>
  for (const level of Object.keys(PRESSURE_LEVEL_META_BASE) as PressureLevel[]) {
    const base = PRESSURE_LEVEL_META_BASE[level]
    out[level] = { name: t(base.nameKey), colorVar: base.colorVar, rank: base.rank }
  }
  return out
}

/** 级别对应的降级状态描述（降级矩阵 §4.2 的用户可读形态）。 */
export function pressureActionCopy(level: PressureLevel, t: TranslateFn): string {
  switch (level) {
    case 'nominal':
      return t('perf.levelAction.nominal')
    case 'warning':
      return t('perf.levelAction.warning')
    case 'critical':
      return t('perf.levelAction.critical')
    case 'emergency':
      return t('perf.levelAction.emergency')
  }
}

/* ─── 指标元数据 ────────────────────────────────────────────────────────────── */

const INDICATOR_LABEL_KEYS: Record<PressureIndicatorKey, string> = {
  'system-used-pct': 'perf.indicator.systemUsedPctLabel',
  'app-footprint-pct': 'perf.indicator.appFootprintPctLabel',
  'host-rss-pct': 'perf.indicator.hostRssPctLabel',
  'children-rss-pct': 'perf.indicator.childrenRssPctLabel',
  'children-count': 'perf.indicator.childrenCountLabel',
  'event-loop-delay-ms': 'perf.indicator.eventLoopDelayMsLabel',
}

/** 按当前语言生成指标显示名。 */
export function getIndicatorLabels(t: TranslateFn): Record<PressureIndicatorKey, string> {
  const out = {} as Record<PressureIndicatorKey, string>
  for (const key of Object.keys(INDICATOR_LABEL_KEYS) as PressureIndicatorKey[]) {
    out[key] = t(INDICATOR_LABEL_KEYS[key])
  }
  return out
}

/** 指标当前值的人类可读形式（阈值联动着色由组件层完成）。 */
export function formatIndicatorValue(
  key: PressureIndicatorKey,
  value: number | null,
  t: TranslateFn,
): string {
  if (value == null || !Number.isFinite(value)) return '—'
  switch (key) {
    case 'system-used-pct':
    case 'app-footprint-pct':
    case 'host-rss-pct':
    case 'children-rss-pct':
      return `${formatPct(value)}%`
    case 'children-count':
      return t('perf.unit.count', { value: Math.round(value) })
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

export function processKindLabel(kind: TrackedProcessKind, t: TranslateFn): string {
  switch (kind) {
    case 'claude-cli':
      return t('perf.processKind.claudeCli')
    case 'codex-cli':
      return t('perf.processKind.codexCli')
    case 'agent-unknown':
      return t('perf.processKind.agentUnknown')
    case 'mcp-bridge':
      return t('perf.processKind.mcpBridge')
    case 'platform-pool':
      return t('perf.processKind.platformPool')
    case 'codex-pool':
      return t('perf.processKind.codexPool')
    case 'engine-subagent':
      return t('perf.processKind.engineSubagent')
    case 'media-mcp':
      return t('perf.processKind.mediaMcp')
    case 'tool-package':
      return t('perf.processKind.toolPackage')
    case 'terminal-pty':
      return t('perf.processKind.terminalPty')
    case 'subapp-service':
      return t('perf.processKind.subappService')
    case 'media-tool':
      return t('perf.processKind.mediaTool')
    default:
      return t('perf.processKind.other')
  }
}

export interface ProcessKindAggregate {
  kind: TrackedProcessKind
  label: string
  count: number
  rssBytes: number
}

/** full 快照 pid 明细按 kind 聚合（RSS 降序），供子进程卡堆叠条与明细行。 */
export function aggregateChildrenByKind(
  entries: ChildProcessSample[],
  t: TranslateFn,
): ProcessKindAggregate[] {
  const map = new Map<TrackedProcessKind, ProcessKindAggregate>()
  for (const entry of entries) {
    const current = map.get(entry.kind)
    if (current == null) {
      map.set(entry.kind, {
        kind: entry.kind,
        label: processKindLabel(entry.kind, t),
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
