import { describe, expect, it } from 'vitest'
import { normalizeZhipuQuotaResponse, zhipuPlanLabel } from './zhipuQuota.js'

/** 2026-09-24 用真实 Coding Plan key 抓到的 max 档响应（脱敏：不含任何凭据）。 */
const REAL_MAX_RESPONSE = {
  code: 200,
  msg: '操作成功',
  success: true,
  data: {
    limits: [
      {
        type: 'TIME_LIMIT',
        unit: 5,
        number: 1,
        usage: 4000,
        currentValue: 33,
        remaining: 3967,
        percentage: 1,
        nextResetTime: 1790474562998,
        usageDetails: [
          { modelCode: 'search-prime', usage: 16 },
          { modelCode: 'web-reader', usage: 17 },
          { modelCode: 'zread', usage: 0 },
        ],
      },
      {
        type: 'TOKENS_LIMIT',
        unit: 3,
        number: 5,
        percentage: 4,
        nextResetTime: 1790270589380,
      },
      {
        type: 'TOKENS_LIMIT',
        unit: 6,
        number: 1,
        percentage: 94,
        nextResetTime: 1790358637996,
      },
    ],
    level: 'max',
  },
}

/** 2026-09-24 用真实 Coding Plan key 抓到的 lite 档响应（脱敏：不含任何凭据）。 */
const REAL_LITE_RESPONSE = {
  code: 200,
  msg: '操作成功',
  success: true,
  data: {
    limits: [
      {
        type: 'CREDIT_LIMIT',
        unit: 3,
        number: 5,
        usage: 2000,
        currentValue: 631,
        remaining: 1368,
        percentage: 31,
        nextResetTime: 1790276413448,
      },
      {
        type: 'CREDIT_LIMIT',
        unit: 6,
        number: 1,
        usage: 10000,
        currentValue: 1791,
        remaining: 8208,
        percentage: 17,
        nextResetTime: 1790736815982,
      },
    ],
    level: 'lite',
  },
}

describe('normalizeZhipuQuotaResponse', () => {
  it('归一化真实 max 档响应：TIME_LIMIT=MCP 本月共享额度、TOKENS_LIMIT+u6=本周（与官方监控页对照实锤）', () => {
    const snapshot = normalizeZhipuQuotaResponse('p0', REAL_MAX_RESPONSE, 123)
    expect(snapshot.planLevel).toBe('max')
    expect(snapshot.planLabel).toBe('Max')
    // 按窗口跨度排序：5小时 → 本周 → MCP 本月
    expect(snapshot.limits.map((l) => `${l.kind}:${l.windowLabel}`)).toEqual([
      'credit:5h',
      'credit:week',
      'mcp:month',
    ])

    const [fiveHour, weekly, mcp] = snapshot.limits
    // TOKENS_LIMIT+unit=3(5小时) 只有 percentage：无数值字段，已用 4% → 剩 96%
    expect(fiveHour?.kind).toBe('credit')
    expect(fiveHour?.kindLabel).toBe('额度')
    expect(fiveHour?.total).toBeUndefined()
    expect(fiveHour?.used).toBeUndefined()
    expect(fiveHour?.remaining).toBeUndefined()
    expect(fiveHour?.usedPercentage).toBe(4)
    expect(fiveHour?.remainingPercentage).toBe(96)
    expect(fiveHour?.resetAt).toBe(1790270589380)
    expect(fiveHour?.rawType).toBe('TOKENS_LIMIT')

    // TOKENS_LIMIT+unit=6 = 本周（重置时间与官方"每周使用额度"卡精确吻合）：percentage=94 已用 → 剩 6%
    expect(weekly?.kind).toBe('credit')
    expect(weekly?.windowLabel).toBe('week')
    expect(weekly?.usedPercentage).toBe(94)
    expect(weekly?.remainingPercentage).toBe(6)

    // TIME_LIMIT = MCP 每月共享额度：有数值字段，已用 33/4000 → 剩 99%，分项明细对齐官方措辞
    expect(mcp?.kind).toBe('mcp')
    expect(mcp?.kindLabel).toBe('MCP')
    expect(mcp?.windowLabel).toBe('month')
    expect(mcp?.total).toBe(4000)
    expect(mcp?.used).toBe(33)
    expect(mcp?.remaining).toBe(3967)
    expect(mcp?.remainingPercentage).toBe(99)
    expect(mcp?.resetAt).toBe(1790474562998)
    expect(mcp?.rawType).toBe('TIME_LIMIT')
    expect(mcp?.details).toEqual([
      { key: 'search-prime', label: '网络搜索', used: 16 },
      { key: 'web-reader', label: '网页读取', used: 17 },
      { key: 'zread', label: '开源仓库', used: 0 },
    ])
  })

  it('归一化真实 lite 档响应：窗口标签 / 剩余比例 / 套餐档位', () => {
    const snapshot = normalizeZhipuQuotaResponse('p1', REAL_LITE_RESPONSE, 123)
    expect(snapshot.vendor).toBe('zhipu')
    expect(snapshot.planLevel).toBe('lite')
    expect(snapshot.planLabel).toBe('Lite')
    expect(snapshot.limits).toHaveLength(2)

    const [fiveHour, monthly] = snapshot.limits
    // unit=3 × number=5 → 5小时窗口
    expect(fiveHour?.windowLabel).toBe('5h')
    expect(fiveHour?.kind).toBe('credit')
    expect(fiveHour?.kindLabel).toBe('额度')
    expect(fiveHour?.total).toBe(2000)
    expect(fiveHour?.used).toBe(631)
    expect(fiveHour?.remaining).toBe(1368)
    expect(fiveHour?.usedPercentage).toBe(31)
    expect(fiveHour?.remainingPercentage).toBe(69)
    expect(fiveHour?.resetAt).toBe(1790276413448)

    // unit=6 × number=1 → 本月窗口
    expect(monthly?.windowLabel).toBe('month')
    expect(monthly?.remainingPercentage).toBe(83)
  })

  it('percentage 缺省时按 used/total 计算，remaining 缺省时按差额回填', () => {
    const snapshot = normalizeZhipuQuotaResponse(
      'p2',
      {
        code: 200,
        data: {
          level: 'max',
          limits: [
            {
              type: 'CREDIT_LIMIT',
              unit: 6,
              number: 1,
              usage: 100,
              currentValue: 25,
            },
          ],
        },
      },
      456,
    )
    expect(snapshot.planLabel).toBe('Max')
    const monthly = snapshot.limits[0]
    // CREDIT_LIMIT + unit=6 → 本月窗口（lite 档口径）
    expect(monthly?.windowLabel).toBe('month')
    expect(monthly?.usedPercentage).toBe(25)
    expect(monthly?.remaining).toBe(75)
    expect(monthly?.resetAt).toBeUndefined()
  })

  it('MCP 类别按关键字识别并保留前缀', () => {
    const snapshot = normalizeZhipuQuotaResponse(
      'p3',
      {
        code: 200,
        data: {
          limits: [
            { type: 'MCP_LIMIT', unit: 6, number: 1, usage: 500, currentValue: 5, percentage: 1 },
          ],
        },
      },
      789,
    )
    const mcp = snapshot.limits[0]
    expect(mcp?.kind).toBe('mcp')
    expect(mcp?.kindLabel).toBe('MCP')
    expect(mcp?.remainingPercentage).toBe(99)
    expect(snapshot.planLabel).toBeUndefined()
  })

  it('字段非法的 limit 条目跳过而非整体失败', () => {
    const snapshot = normalizeZhipuQuotaResponse(
      'p4',
      {
        code: 200,
        data: {
          limits: [
            { type: 'CREDIT_LIMIT', unit: 3, number: 5 }, // 缺 usage/currentValue
            { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 0, currentValue: 0 }, // total<=0
            { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 10, currentValue: 1 },
          ],
        },
      },
      1,
    )
    expect(snapshot.limits).toHaveLength(1)
    expect(snapshot.limits[0]?.total).toBe(10)
  })

  it('空 limits / 空 data 返回空快照不抛错', () => {
    expect(normalizeZhipuQuotaResponse('p5', { code: 200, data: {} }, 1).limits).toEqual([])
    expect(normalizeZhipuQuotaResponse('p6', { code: 200 }, 1).limits).toEqual([])
  })
})

describe('zhipuPlanLabel', () => {
  it('已知档位映射展示名，未知档位原样透传', () => {
    expect(zhipuPlanLabel('lite')).toBe('Lite')
    expect(zhipuPlanLabel('pro')).toBe('Pro')
    expect(zhipuPlanLabel('max')).toBe('Max')
    expect(zhipuPlanLabel('custom-tier')).toBe('custom-tier')
    expect(zhipuPlanLabel(undefined)).toBeUndefined()
  })
})
