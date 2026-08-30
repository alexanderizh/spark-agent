/**
 * 成片时间线 / EDL（设计 §S9 后期与成片）。
 *
 * 纯逻辑：把分镜分组按顺序展开成带累计时间码的成片时间线，
 * 输出可读的 EDL（剪辑决策清单）文本，作为顺序拼接的依据 / 交付物。
 * 真正的视频拼接需后端 ffmpeg，本模块先产出时间线与清单。
 */

import type { ShotGroup, ShotSegment } from './canvasFilmAssets'

/** 时间线上的一条镜头 */
export type TimelineEntry = {
  groupName: string
  segmentTitle: string
  index: number
  /** 起始时间码（秒，累计） */
  startSec: number
  /** 时长（秒），缺省回退默认值 */
  durationSec: number
  dialogue?: string
  /** 关联的视频/关键帧节点 id（若已生成） */
  videoNodeId?: string
}

/** 缺省镜时（秒），用于没填 durationSec 的片段 */
export const DEFAULT_SHOT_SEC = 3

function segmentDuration(segment: ShotSegment): number {
  if (typeof segment.durationSec === 'number' && segment.durationSec > 0) return segment.durationSec
  if (
    typeof segment.inSec === 'number' &&
    typeof segment.outSec === 'number' &&
    segment.outSec > segment.inSec
  ) {
    return segment.outSec - segment.inSec
  }
  return DEFAULT_SHOT_SEC
}

/** 把分镜分组按顺序构建成带累计时间码的时间线 */
export function buildTimeline(groups: ShotGroup[]): TimelineEntry[] {
  const ordered = [...groups].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const entries: TimelineEntry[] = []
  let cursor = 0
  for (const group of ordered) {
    const segments = [...group.segments].sort((a, b) => a.index - b.index)
    for (const segment of segments) {
      const duration = segmentDuration(segment)
      entries.push({
        groupName: group.name,
        segmentTitle: segment.title,
        index: segment.index,
        startSec: Math.round(cursor * 100) / 100,
        durationSec: duration,
        ...(segment.dialogue ? { dialogue: segment.dialogue } : {}),
        ...(segment.keyframeNodeIds && segment.keyframeNodeIds.length > 0
          ? { videoNodeId: segment.keyframeNodeIds[0] }
          : {}),
      })
      cursor += duration
    }
  }
  return entries
}

/** 成片总时长（秒） */
export function totalRuntimeSec(entries: TimelineEntry[]): number {
  return Math.round(entries.reduce((sum, entry) => sum + entry.durationSec, 0) * 100) / 100
}

/** 秒 → mm:ss.s 时间码 */
export function formatTimecode(sec: number): string {
  const safe = Math.max(0, sec)
  const minutes = Math.floor(safe / 60)
  const seconds = safe - minutes * 60
  const secStr = seconds.toFixed(1).padStart(4, '0')
  return `${String(minutes).padStart(2, '0')}:${secStr}`
}

/** 构建可读 EDL（Markdown 表格 + 概览） */
export function buildEdlMarkdown(title: string, entries: TimelineEntry[]): string {
  const runtime = totalRuntimeSec(entries)
  const header = [
    `# 成片清单 (EDL) · ${title}`,
    '',
    `- 镜头数：${entries.length}`,
    `- 总时长：${formatTimecode(runtime)}（${runtime}s）`,
    '',
    '| # | 时间码 | 时长 | 分组 | 镜头 | 对白 |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  const rows = entries.map((entry, i) => {
    const dialogue = (entry.dialogue ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
    return `| ${i + 1} | ${formatTimecode(entry.startSec)} | ${entry.durationSec}s | ${entry.groupName} | ${entry.segmentTitle} | ${dialogue} |`
  })
  return [...header, ...rows].join('\n')
}
