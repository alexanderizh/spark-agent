/**
 * 智谱（bigmodel.cn）Coding Plan 限额适配器。
 *
 * 接口：GET https://bigmodel.cn/api/monitor/usage/quota/limit
 * 鉴权：Authorization: Bearer <API Key>（实测直接传 apikey 头会报 1001，
 * 官方监控前端走的就是 Bearer）。
 *
 * 实测响应（lite 档，2026-09-24）：
 * {
 *   "code": 200, "success": true,
 *   "data": {
 *     "level": "lite",
 *     "limits": [
 *       { "type": "CREDIT_LIMIT", "unit": 3, "number": 5,
 *         "usage": 2000, "currentValue": 631, "remaining": 1368,
 *         "percentage": 31, "nextResetTime": 1790276413448 },
 *       { "type": "CREDIT_LIMIT", "unit": 6, "number": 1,
 *         "usage": 10000, "currentValue": 1791, "remaining": 8208,
 *         "percentage": 17, "nextResetTime": 1790736815982 }
 *     ]
 *   }
 * }
 *
 * 字段口径（实测交叉验证：631+1368≈2000=usage，percentage=31≈631/2000）：
 * - usage       窗口总额度
 * - currentValue 已用额度
 * - remaining   剩余额度
 * - percentage  已用百分比（向下取整）
 *
 * ⚠️ unit 不是跨档位一致的时间单位枚举，不能单独用来推断窗口名
 * （max 档周窗口用 unit=6，MCP 月额度用 unit=5）。窗口语义必须按
 * type+unit 组合判定，映射表来自 2026-09-24 与官方监控页逐卡片对照实锤：
 * - CREDIT_LIMIT / TOKENS_LIMIT + unit=3        → N 小时窗口（number=5 → 5小时）
 * - CREDIT_LIMIT  + unit=6（lite）              → 本月（重置时间在月末）
 * - TOKENS_LIMIT + unit=6（max）                → 本周（重置时间与官方"每周使用额度"卡精确吻合）
 * - TIME_LIMIT    + unit=5（max）               → MCP 每月共享额度
 *   （官方卡片名"MCP 每月额度"：网络搜索/网页读取/开源仓库 共享，
 *    usageDetails 分项用量之和 = currentValue，重置时间与官方卡精确吻合）
 *
 * 实测 max 档响应（2026-09-24，已与官方监控页三张卡逐项核对）：
 * {
 *   "data": { "level": "max", "limits": [
 *     { "type": "TIME_LIMIT", "unit": 5, "number": 1,
 *       "usage": 4000, "currentValue": 33, "remaining": 3967, "percentage": 1,
 *       "nextResetTime": 1790474562998,
 *       "usageDetails": [
 *         { "modelCode": "search-prime", "usage": 16 },
 *         { "modelCode": "web-reader", "usage": 17 },
 *         { "modelCode": "zread", "usage": 0 }
 *       ] },
 *     { "type": "TOKENS_LIMIT", "unit": 3, "number": 5,
 *       "percentage": 6, "nextResetTime": 1790270589380 },
 *     { "type": "TOKENS_LIMIT", "unit": 6, "number": 1,
 *       "percentage": 94, "nextResetTime": 1790358637996 }
 *   ] }
 * }
 * 交叉验证：percentage 与 currentValue/usage 口径一致（33/4000→1），均为已用百分比；
 * usageDetails 之和 16+17+0=33=currentValue。
 */

import type { ProviderQuotaLimit, ProviderQuotaSnapshot } from '@spark/protocol'
import { createLogger, fetchJson } from '@spark/shared'

const log = createLogger('provider.quota.zhipu')

const ZHIPU_QUOTA_URL = 'https://bigmodel.cn/api/monitor/usage/quota/limit'
const ZHIPU_QUOTA_TIMEOUT_MS = 10_000

/** 智谱限额接口原始响应（只声明用到的字段，多余字段忽略）。 */
interface ZhipuQuotaApiResponse {
  code: number
  msg?: string
  success?: boolean
  data?: {
    level?: string
    limits?: Array<{
      type?: string
      unit?: number
      number?: number
      usage?: number
      currentValue?: number
      remaining?: number
      percentage?: number
      nextResetTime?: number
      usageDetails?: Array<{ modelCode?: string; usage?: number }>
    }>
  }
}

/** 智谱 MCP usageDetails 的 modelCode → 官方展示名（官方卡片提示语同款措辞）。 */
const ZHIPU_MCP_DETAIL_LABELS: Record<string, string> = {
  'search-prime': '网络搜索',
  'web-reader': '网页读取',
  zread: '开源仓库',
}

interface ZhipuLimitClass {
  kind: string
  kindLabel: string
  windowLabel: string
  /** 展示排序：小时窗口在前，MCP 月度共享额度排最后；未知组合兜底排更后。 */
  rank: number
}

/**
 * 按 type+unit 组合判定窗口语义（unit 不是跨档位一致的时间枚举，见文件头实测记录）。
 * 已实锤组合：CREDIT_LIMIT/TOKENS_LIMIT+3=小时窗口、CREDIT_LIMIT+6=本月（lite）、
 * TOKENS_LIMIT+6=本周（max）、TIME_LIMIT=MCP 每月共享额度；
 * 未知组合给中性兜底文案，不透传原始英文到 UI。
 */
function zhipuClassifyLimit(item: {
  type?: string
  unit?: number
  number?: number
}): ZhipuLimitClass {
  const type = (item.type ?? '').trim().toUpperCase()
  const n = Number.isFinite(item.number) ? Math.max(0, item.number ?? 0) : 0
  // TIME_LIMIT = MCP 每月共享额度（网络搜索/网页读取/开源仓库，见官方卡片）
  if (type === 'TIME_LIMIT' || type.includes('MCP')) {
    return { kind: 'mcp', kindLabel: 'MCP', windowLabel: 'month', rank: 40 }
  }
  if (type === 'CREDIT_LIMIT' || type === 'TOKENS_LIMIT') {
    if (item.unit === 3) return { kind: 'credit', kindLabel: '额度', windowLabel: `${n}h`, rank: 0 }
    if (item.unit === 6) {
      // lite 档 CREDIT_LIMIT+6=月；max 档 TOKENS_LIMIT+6=周（均为实测重置时间实锤）
      if (type === 'TOKENS_LIMIT')
        return { kind: 'credit', kindLabel: '额度', windowLabel: 'week', rank: 10 }
      return { kind: 'credit', kindLabel: '额度', windowLabel: 'month', rank: 20 }
    }
  }
  return {
    kind: 'credit',
    kindLabel: '额度',
    windowLabel: `窗口(${n}×u${item.unit ?? '?'})`,
    rank: 50,
  }
}

/** 套餐档位展示名：lite/pro/max → Lite/Pro/Max，其余原样。 */
export function zhipuPlanLabel(level: string | undefined): string | undefined {
  if (!level) return undefined
  const known: Record<string, string> = { lite: 'Lite', pro: 'Pro', max: 'Max' }
  return known[level] ?? level
}

/**
 * 归一化智谱限额响应（导出供单测使用；不发起网络请求）。
 * 单条 limit 字段缺失/非法时跳过该条，不让整体失败。
 */
export function normalizeZhipuQuotaResponse(
  providerId: string,
  raw: ZhipuQuotaApiResponse,
  fetchedAt: number,
): ProviderQuotaSnapshot {
  const planLabel = zhipuPlanLabel(raw.data?.level)
  const limits: ProviderQuotaLimit[] = []
  // 按窗口跨度排序：5小时 → 本周 → 本月 → MCP 月度共享额度；未知组合排最后
  const rawItems = [...(raw.data?.limits ?? [])].sort(
    (a, b) =>
      zhipuClassifyLimit(a).rank - zhipuClassifyLimit(b).rank || (a.number ?? 0) - (b.number ?? 0),
  )
  for (const item of rawItems) {
    const total = Number.isFinite(item.usage) && (item.usage ?? 0) > 0 ? item.usage : undefined
    const used = Number.isFinite(item.currentValue)
      ? Math.max(0, item.currentValue ?? 0)
      : undefined
    const hasPercentage = Number.isFinite(item.percentage)
    // max 档 TOKENS_LIMIT 条目只有 percentage（无 usage/currentValue/remaining），
    // 只要能算出已用百分比就展示；数值与百分比都没有才跳过该条。
    if (!hasPercentage && (total === undefined || used === undefined)) continue
    const remaining = Number.isFinite(item.remaining)
      ? Math.max(0, item.remaining ?? 0)
      : total !== undefined && used !== undefined
        ? Math.max(0, total - used)
        : undefined
    const usedPercentage = hasPercentage
      ? Math.min(100, Math.max(0, Math.round(item.percentage ?? 0)))
      : total !== undefined && used !== undefined
        ? Math.min(100, Math.round((used / total) * 100))
        : 0
    const { kind, kindLabel, windowLabel } = zhipuClassifyLimit(item)
    // MCP 条目解析 usageDetails 分项（16+17+0=33=currentValue，口径已实测对齐）
    const details =
      kind === 'mcp' && Array.isArray(item.usageDetails)
        ? item.usageDetails
            .filter(
              (d): d is { modelCode: string; usage: number } =>
                typeof d?.modelCode === 'string' &&
                d.modelCode.trim().length > 0 &&
                typeof d?.usage === 'number' &&
                Number.isFinite(d.usage) &&
                d.usage >= 0,
            )
            .map((d) => ({
              key: d.modelCode,
              label: ZHIPU_MCP_DETAIL_LABELS[d.modelCode] ?? d.modelCode,
              used: d.usage,
            }))
        : []
    limits.push({
      kind,
      kindLabel,
      windowLabel,
      ...(details.length > 0 ? { details } : {}),
      ...(total !== undefined ? { total } : {}),
      ...(used !== undefined ? { used } : {}),
      ...(remaining !== undefined ? { remaining } : {}),
      usedPercentage,
      remainingPercentage: Math.max(0, 100 - usedPercentage),
      ...(Number.isFinite(item.nextResetTime) && (item.nextResetTime ?? 0) > 0
        ? { resetAt: item.nextResetTime }
        : {}),
      ...(item.type ? { rawType: item.type } : {}),
    })
  }
  return {
    providerId,
    vendor: 'zhipu',
    ...(raw.data?.level ? { planLevel: raw.data.level } : {}),
    ...(planLabel ? { planLabel } : {}),
    limits,
    fetchedAt,
  }
}

/** 真实调用智谱限额接口并归一化；失败抛错（调用方负责转成响应结构）。 */
export async function fetchZhipuQuota(
  providerId: string,
  apiKey: string,
): Promise<ProviderQuotaSnapshot> {
  const start = Date.now()
  const raw = await fetchJson<ZhipuQuotaApiResponse>(ZHIPU_QUOTA_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeoutMs: ZHIPU_QUOTA_TIMEOUT_MS,
  })
  const latencyMs = Date.now() - start
  if (!raw || raw.code !== 200 || !raw.data) {
    const msg = `zhipu quota api rejected: code=${raw?.code ?? 'n/a'}, msg=${raw?.msg ?? 'n/a'}`
    log.warn(`${msg}, id=${providerId}, latencyMs=${latencyMs}`)
    throw new Error(`智谱限额查询失败：${raw?.msg || `code ${raw?.code ?? 'n/a'}`}`)
  }
  const snapshot = normalizeZhipuQuotaResponse(providerId, raw, Date.now())
  log.info(
    `zhipu quota fetched, id=${providerId}, level=${snapshot.planLevel ?? 'n/a'}, ` +
      `limits=${snapshot.limits.length}, latencyMs=${latencyMs}`,
  )
  return snapshot
}
