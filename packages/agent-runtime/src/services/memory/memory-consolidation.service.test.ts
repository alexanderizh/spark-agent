/**
 * @module memory-consolidation.service.test
 *
 * 单测：parseActions（动作解析 + id 校验 + 非法丢弃）—— 纯函数，不依赖真实 DB。
 * 执行路径（MERGE/ELEVATE 落库）由真实 DB 测试覆盖。
 */

import { describe, it, expect } from 'vitest'
import { parseActions } from './memory-consolidation.service.js'

const IDS = ['usr_a', 'usr_b', 'usr_c', 'usr_d', 'usr_e'].map((id) => ({ id }))

describe('parseActions', () => {
  it('parses a valid MERGE', () => {
    const raw = JSON.stringify([
      { action: 'MERGE', keepId: 'usr_a', dropIds: ['usr_b'], mergedDescription: '合并后', reason: '重复' },
    ])
    const out = parseActions(raw, IDS)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ action: 'MERGE', keepId: 'usr_a', dropIds: ['usr_b'] })
  })

  it('parses a valid ELEVATE', () => {
    const raw = JSON.stringify([
      {
        action: 'ELEVATE', sourceIds: ['usr_a', 'usr_b', 'usr_c'], reason: '升华',
        newMemory: { name: 'pattern', description: '高阶规律', body: 'body with **Why:** x **How to apply:** y', type: 'feedback', confidence: 0.85 },
      },
    ])
    const out = parseActions(raw, IDS)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ action: 'ELEVATE', sourceIds: ['usr_a', 'usr_b', 'usr_c'] })
  })

  it('drops MERGE with fabricated keepId', () => {
    const raw = JSON.stringify([
      { action: 'MERGE', keepId: 'usr_fabricated', dropIds: ['usr_b'], mergedDescription: 'x' },
    ])
    expect(parseActions(raw, IDS)).toHaveLength(0)
  })

  it('drops MERGE with no valid dropIds', () => {
    const raw = JSON.stringify([
      { action: 'MERGE', keepId: 'usr_a', dropIds: ['usr_fabricated'], mergedDescription: 'x' },
      { action: 'MERGE', keepId: 'usr_a', dropIds: [], mergedDescription: 'x' },
    ])
    expect(parseActions(raw, IDS)).toHaveLength(0)
  })

  it('filters dropIds to valid + excludes keepId', () => {
    const raw = JSON.stringify([
      { action: 'MERGE', keepId: 'usr_a', dropIds: ['usr_b', 'usr_fake', 'usr_a'], mergedDescription: 'x' },
    ])
    const out = parseActions(raw, IDS)
    expect((out[0] as { dropIds: string[] }).dropIds).toEqual(['usr_b'])
  })

  it('drops ELEVATE with < 2 valid sources', () => {
    const raw = JSON.stringify([
      { action: 'ELEVATE', sourceIds: ['usr_a'], newMemory: { name: 'p', description: 'd', body: 'b', type: 'feedback', confidence: 0.8 } },
      { action: 'ELEVATE', sourceIds: ['usr_a', 'usr_fake'], newMemory: { name: 'p', description: 'd', body: 'b', type: 'feedback', confidence: 0.8 } },
    ])
    expect(parseActions(raw, IDS)).toHaveLength(0)
  })

  it('drops ELEVATE with malformed newMemory', () => {
    const raw = JSON.stringify([
      { action: 'ELEVATE', sourceIds: ['usr_a', 'usr_b'], newMemory: { name: 'p' } }, // 缺 description/body
    ])
    expect(parseActions(raw, IDS)).toHaveLength(0)
  })

  it('coerces invalid type to feedback', () => {
    const raw = JSON.stringify([
      { action: 'ELEVATE', sourceIds: ['usr_a', 'usr_b'], newMemory: { name: 'p', description: 'd', body: 'b', type: 'weird', confidence: 0.8 } },
    ])
    const out = parseActions(raw, IDS) as Array<{ action: 'ELEVATE'; newMemory: { type: string } }>
    expect(out[0]!.newMemory.type).toBe('feedback')
  })

  it('strips ```json wrapper', () => {
    const raw = '```json\n[{"action":"MERGE","keepId":"usr_a","dropIds":["usr_b"],"mergedDescription":"x"}]\n```'
    expect(parseActions(raw, IDS)).toHaveLength(1)
  })

  it('non-array / unparseable → []', () => {
    expect(parseActions('not json', IDS)).toEqual([])
    expect(parseActions('{}', IDS)).toEqual([])
    expect(parseActions('"string"', IDS)).toEqual([])
  })

  it('truncates over-long description/reason', () => {
    const longDesc = 'x'.repeat(500)
    const longReason = 'y'.repeat(500)
    const raw = JSON.stringify([
      { action: 'MERGE', keepId: 'usr_a', dropIds: ['usr_b'], mergedDescription: longDesc, reason: longReason },
    ])
    const out = parseActions(raw, IDS) as Array<{ mergedDescription: string; reason: string }>
    expect(out[0]!.mergedDescription.length).toBe(200)
    expect(out[0]!.reason.length).toBe(200)
  })
})
