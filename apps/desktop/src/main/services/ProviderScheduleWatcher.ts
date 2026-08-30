/**
 * ProviderScheduleWatcher — 模型定时禁用（峰谷定价规避）边界 watcher。
 *
 * 读取时判定方案（不落库）下，时段边界的生效依赖各端重新拉取 provider 列表；
 * 本 watcher 在 main 进程常驻轮询，计算"当前被禁模型集合"指纹，仅在指纹变化
 * （时段开始 / 结束 / 配置变更导致的集合变化）时通过回调广播一次 provider
 * 配置变更，让全部窗口的选择器即时刷新。
 *
 * 设计要点：
 * - 启动时记录基线指纹但不广播（应用刚启动不该发无意义的变更事件）。
 * - 评估失败只记日志，下一轮重试；watcher 永不因单次异常退出。
 * - 不写库、无对账问题；应用在边界时刻未运行也不影响正确性
 *   （下次启动/轮询时读取侧按当前时刻重新判定）。
 */
import { scheduledBlockedModelIds, parseModelSchedules } from '@spark/protocol'
import { ProviderProfileRepository } from '@spark/storage'
import { createLogger } from '@spark/shared'
import { getDatabase } from '../db.js'

const log = createLogger('provider-schedule-watcher')

/** 分钟粒度的时段边界，30s 轮询足够即时（最迟半分钟生效）。 */
const POLL_INTERVAL_MS = 30_000

let timer: NodeJS.Timeout | null = null
let lastSignature = ''

function currentSignature(): string {
  const rows = new ProviderProfileRepository(getDatabase()).listAll()
  return rows
    .map((row) => {
      const blocked = [...scheduledBlockedModelIds(parseModelSchedules(row.config_json))]
        .sort()
        .join(',')
      return `${row.id}:${blocked}`
    })
    .sort()
    .join('|')
}

/** 启动 watcher；onChanged 在被禁模型集合变化时回调一次（用于广播配置变更）。 */
export function startProviderScheduleWatcher(onChanged: () => void): void {
  if (timer != null) return
  try {
    lastSignature = currentSignature()
  } catch (err) {
    log.warn(`Baseline evaluation failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  timer = setInterval(() => {
    try {
      const signature = currentSignature()
      if (signature === lastSignature) return
      lastSignature = signature
      log.info('Scheduled model blocking set changed, notifying config change listeners')
      onChanged()
    } catch (err) {
      log.warn(`Evaluation failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, POLL_INTERVAL_MS)
}

export function stopProviderScheduleWatcher(): void {
  if (timer != null) {
    clearInterval(timer)
    timer = null
  }
}
