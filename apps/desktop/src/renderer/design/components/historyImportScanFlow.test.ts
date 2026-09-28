import { describe, expect, it } from 'vitest'
import type { HistoryImportSource } from '@spark/protocol'
import {
  SCAN_CARD_HEIGHT,
  SCAN_CARD_SLOT,
  SCAN_CARD_WIDTH,
  SCAN_COLLECTOR_CENTER,
  SCAN_FLOW_HEIGHT,
  SCAN_MORE_LABEL,
  SCAN_NAMED_CARD_COUNT,
  buildScanFlowCards,
  mergeScanState,
  scanCardTop,
  scanLineGeometry,
  type ScanFlowCard,
  type ScanSourceState,
} from './historyImportScanFlow'

type MoreCard = Extract<ScanFlowCard, { kind: 'more' }>
type SourceCard = Extract<ScanFlowCard, { kind: 'source' }>
type LineGeometry = ReturnType<typeof scanLineGeometry>

const SOURCES = [
  { value: 'codex', label: 'Codex' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'zcode', label: 'ZCode' },
  { value: 'workbuddy', label: 'WorkBuddy' },
  { value: 'qoder', label: 'Qoder' },
] satisfies Array<{ value: HistoryImportSource; label: string }>

function defaultStates(): Record<HistoryImportSource, ScanSourceState> {
  return {
    codex: { status: 'done', count: 10, rootPath: '~/.codex/sessions' },
    'claude-code': { status: 'done', count: 20, rootPath: '~/.claude/projects' },
    zcode: { status: 'done', count: 30, rootPath: '~/.zcode' },
    workbuddy: { status: 'done', count: 40, rootPath: '~/.workbuddy/projects' },
    qoder: { status: 'done', count: 5, rootPath: '~/Library/com.qoder.app.stable' },
  }
}

function sourceCardAt(cards: ScanFlowCard[], index: number): SourceCard {
  const card = cards[index]
  if (card == null || card.kind !== 'source') {
    throw new Error(`expected a source card at index ${index}`)
  }
  return card
}

function trailingMoreCard(cards: ScanFlowCard[]): MoreCard {
  const card = cards[cards.length - 1]
  if (card == null || card.kind !== 'more') {
    throw new Error('expected a trailing more card')
  }
  return card
}

function geometryAt(index: number, cardCount: number): LineGeometry {
  return scanLineGeometry(scanCardTop(index, cardCount))
}

describe('buildScanFlowCards', () => {
  it('5 个来源收敛为 3 张具名卡 + 1 张「更多」聚合卡', () => {
    const cards = buildScanFlowCards(SOURCES, defaultStates())

    expect(cards.map((card) => card.key)).toEqual(['codex', 'claude-code', 'zcode', 'more'])
    expect(cards.map((card) => card.label)).toEqual([
      'Codex',
      'Claude Code',
      'ZCode',
      SCAN_MORE_LABEL,
    ])

    const more = trailingMoreCard(cards)
    expect(more.members).toEqual(['workbuddy', 'qoder'])
    expect(more.state.count).toBe(45)
    expect(more.state.status).toBe('done')
  })

  it('「更多」卡条数求和、状态按下限聚合（在扫 > 不可用 > 已完成）', () => {
    const scanning = defaultStates()
    scanning.workbuddy = { ...scanning.workbuddy, status: 'scanning', count: 0 }
    const scanningMore = trailingMoreCard(buildScanFlowCards(SOURCES, scanning))
    expect(scanningMore.state.status).toBe('scanning')
    expect(scanningMore.state.count).toBe(5)

    const partial = defaultStates()
    partial.workbuddy = {
      ...partial.workbuddy,
      status: 'unavailable',
      count: 0,
      error: '来源不可用',
    }
    const partialMore = trailingMoreCard(buildScanFlowCards(SOURCES, partial))
    expect(partialMore.state.status).toBe('done')
    expect(partialMore.state.count).toBe(5)

    const unavailable = defaultStates()
    unavailable.workbuddy = { ...unavailable.workbuddy, status: 'unavailable', count: 0 }
    unavailable.qoder = { ...unavailable.qoder, status: 'unavailable', count: 0 }
    const unavailableMore = trailingMoreCard(buildScanFlowCards(SOURCES, unavailable))
    expect(unavailableMore.state.status).toBe('unavailable')
    expect(unavailableMore.state.count).toBe(0)
  })

  it('多余来源只剩一个时直接具名展示，不套「更多」', () => {
    const cards = buildScanFlowCards(SOURCES.slice(0, SCAN_NAMED_CARD_COUNT + 1), defaultStates())

    expect(cards.map((card) => card.key)).toEqual(['codex', 'claude-code', 'zcode', 'workbuddy'])
    expect(cards.every((card) => card.kind === 'source')).toBe(true)
  })

  it('来源数不超过具名卡上限时不出现「更多」卡', () => {
    const cards = buildScanFlowCards(SOURCES.slice(0, SCAN_NAMED_CARD_COUNT), defaultStates())

    expect(cards.map((card) => card.key)).toEqual(['codex', 'claude-code', 'zcode'])
  })

  it('具名卡按来源表顺序保留各自扫描状态', () => {
    const states = defaultStates()
    states.codex = { ...states.codex, status: 'unavailable', count: 0 }

    const cards = buildScanFlowCards(SOURCES, states)
    expect(sourceCardAt(cards, 0).source).toBe('codex')
    expect(sourceCardAt(cards, 0).state.status).toBe('unavailable')
    expect(sourceCardAt(cards, 1).state.count).toBe(20)
  })
})

describe('mergeScanState', () => {
  it('空集合回落到已完成且条数为 0', () => {
    expect(mergeScanState([])).toEqual({ status: 'done', count: 0, rootPath: '' })
  })
})

describe('扫描动画几何', () => {
  it('卡片组围绕汇聚圆心垂直居中，且不超出扫描流程容器', () => {
    const cardCount = SCAN_NAMED_CARD_COUNT + 1
    const tops = Array.from({ length: cardCount }, (_, index) => scanCardTop(index, cardCount))
    const firstTop = tops[0] ?? Number.NaN
    const lastTop = tops[cardCount - 1] ?? Number.NaN

    expect((firstTop + lastTop) / 2 + SCAN_CARD_HEIGHT / 2).toBeCloseTo(SCAN_COLLECTOR_CENTER.y, 6)
    expect(firstTop).toBeGreaterThanOrEqual(0)
    expect(lastTop + SCAN_CARD_HEIGHT).toBeLessThanOrEqual(SCAN_FLOW_HEIGHT)
    for (let index = 1; index < cardCount; index += 1) {
      expect((tops[index] ?? Number.NaN) - (tops[index - 1] ?? Number.NaN)).toBeCloseTo(
        SCAN_CARD_SLOT,
        6,
      )
    }
  })

  it('每条连线的终点都精确收敛于汇聚圆圆心', () => {
    for (const cardCount of [SCAN_NAMED_CARD_COUNT + 1, SOURCES.length]) {
      for (let index = 0; index < cardCount; index += 1) {
        const geometry = geometryAt(index, cardCount)
        const radians = (geometry.angle * Math.PI) / 180
        const endX = SCAN_CARD_WIDTH + geometry.width * Math.cos(radians)
        const endY = geometry.top + geometry.width * Math.sin(radians)

        expect(endX).toBeCloseTo(SCAN_COLLECTOR_CENTER.x, 6)
        expect(endY).toBeCloseTo(SCAN_COLLECTOR_CENTER.y, 6)
      }
    }
  })

  it('4 卡布局的连线呈上下对称的扇形', () => {
    const cardCount = SCAN_NAMED_CARD_COUNT + 1
    const top = geometryAt(0, cardCount)
    const upper = geometryAt(1, cardCount)
    const lower = geometryAt(2, cardCount)
    const bottom = geometryAt(3, cardCount)

    expect(top.angle).toBeCloseTo(-bottom.angle, 6)
    expect(upper.angle).toBeCloseTo(-lower.angle, 6)
    expect(top.width).toBeCloseTo(bottom.width, 6)
  })
})
