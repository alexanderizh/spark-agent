// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProviderQuotaSnapshot } from '@spark/protocol'

import { ProviderQuotaHoverCard } from './ProviderQuotaHoverCard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** max 档真实响应归一化后的快照样本（3 窗口：5小时 / 本周 / MCP 本月）。 */
const maxSnapshot: ProviderQuotaSnapshot = {
  providerId: 'provider-1',
  vendor: 'zhipu',
  planLevel: 'max',
  planLabel: 'Max',
  fetchedAt: Date.now(),
  limits: [
    {
      kind: 'credit',
      kindLabel: '额度',
      windowLabel: '5h',
      usedPercentage: 4,
      remainingPercentage: 96,
      resetAt: Date.now() + 42 * 60_000,
    },
    {
      kind: 'credit',
      kindLabel: '额度',
      windowLabel: 'week',
      total: 4000,
      used: 33,
      remaining: 3967,
      usedPercentage: 1,
      remainingPercentage: 99,
      resetAt: Date.now() + 72 * 3600_000,
    },
    {
      kind: 'mcp',
      kindLabel: 'MCP',
      windowLabel: 'month',
      usedPercentage: 1,
      remainingPercentage: 99,
      details: [
        { key: 'search-prime', label: '网络搜索', used: 16 },
        { key: 'web-reader', label: '网页读取', used: 17 },
      ],
    },
  ],
}

describe('ProviderQuotaHoverCard', () => {
  let container: HTMLDivElement
  let anchor: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    anchor = document.createElement('div')
    document.body.appendChild(anchor)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    anchor.remove()
    document.querySelector('.composer-provider-quota-card')?.remove()
  })

  function renderCard(props: Partial<Parameters<typeof ProviderQuotaHoverCard>[0]> = {}) {
    act(() => {
      root.render(
        <ProviderQuotaHoverCard
          providerName="Max-智谱 GLM Coding Plan"
          loading={false}
          anchorEl={anchor}
          {...props}
        />,
      )
    })
  }

  it('renders provider name, plan badge and quota chips', () => {
    renderCard({ quota: maxSnapshot })
    const card = document.querySelector('.composer-provider-quota-card')
    expect(card).not.toBeNull()
    expect(card?.querySelector('.composer-provider-quota-card-name')?.textContent).toBe(
      'Max-智谱 GLM Coding Plan',
    )
    expect(card?.querySelector('.pv_quota_plan')?.textContent).toBe('Max')
    const chips = Array.from(card?.querySelectorAll('.pv_quota_chip_label') ?? []).map(
      (el) => el.textContent,
    )
    expect(chips).toEqual(['5h 96%', 'week 99%', 'MCP month 99%'])
  })

  it('shows error message when quota fetch failed', () => {
    renderCard({ error: '请求超时' })
    const card = document.querySelector('.composer-provider-quota-card')
    expect(card?.querySelector('.composer-provider-quota-card-error')?.textContent).toBe('请求超时')
  })

  it('shows loading hint while fetching', () => {
    renderCard({ loading: true })
    const card = document.querySelector('.composer-provider-quota-card')
    expect(card?.querySelector('.composer-provider-quota-card-hint')?.textContent).toBe('查询中…')
  })

  it('shows empty hint when the snapshot has no limits', () => {
    renderCard({ quota: { ...maxSnapshot, limits: [] } })
    const card = document.querySelector('.composer-provider-quota-card')
    expect(card?.querySelector('.composer-provider-quota-card-hint')?.textContent).toBe(
      '无限额数据',
    )
    expect(card?.querySelectorAll('.pv_quota_chip').length).toBe(0)
  })

  it('omits the plan badge when the snapshot has no plan label', () => {
    // exactOptionalPropertyTypes：可选字段用 delete 摘除，不显式赋 undefined
    const noPlanSnapshot = { ...maxSnapshot }
    delete noPlanSnapshot.planLabel
    delete noPlanSnapshot.planLevel
    renderCard({ quota: noPlanSnapshot })
    const card = document.querySelector('.composer-provider-quota-card')
    expect(card?.querySelector('.pv_quota_plan')).toBeNull()
  })
})
