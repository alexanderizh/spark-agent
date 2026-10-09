/**
 * @module dream.test
 *
 * AutoDream 梦境契约测试：提案 schema 校验（dream_propose_* 工具的服务端口径）
 * 与置信度分流判定（计划 §7）——分流规则错一条就会误删/误改用户记忆，必须钉死。
 */

import { describe, it, expect } from 'vitest'
import {
  DREAM_SETTING_DEFAULTS,
  resolveDreamProposalOutcome,
  validateDreamProposal,
} from './dream.js'
import type { DreamMemoryProposal, DreamWikiProposal } from './dream.js'

function validMemoryProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'memory',
    op: 'create',
    confidence: 0.9,
    rationale: '会话中多次出现该偏好，值得沉淀',
    sourceRefs: [{ kind: 'session', id: 'sess-1', note: '用户明确要求' }],
    payload: { type: 'user', name: '不吃辣', description: '饮食偏好', body: '不吃辣，爱甜食' },
    ...overrides,
  }
}

describe('dream 提案校验', () => {
  it('合法 memory create 提案通过并归一化', () => {
    const r = validateDreamProposal(validMemoryProposal())
    expect(r.ok).toBe(true)
    expect(r.proposal?.kind).toBe('memory')
    expect(r.proposal?.op).toBe('create')
    expect((r.proposal as DreamMemoryProposal).payload?.name).toBe('不吃辣')
  })

  it('合法 wiki create 提案必须携带 spaceId', () => {
    const base = {
      kind: 'wiki',
      op: 'create',
      confidence: 0.8,
      rationale: '新知识点沉淀',
      sourceRefs: [{ kind: 'session', id: 'sess-1' }],
      payload: { title: '部署手册', body: '…' },
    }
    expect(validateDreamProposal(base).ok).toBe(false)
    const r = validateDreamProposal({ ...base, spaceId: 'sp-1' })
    expect(r.ok).toBe(true)
    const wiki = r.proposal as DreamWikiProposal
    expect(wiki.kind).toBe('wiki')
    expect(wiki.spaceId).toBe('sp-1')
  })

  it('update/merge/delete 必须携带 targetId；merge 另需 mergeTargetId', () => {
    for (const op of ['update', 'merge', 'delete'] as const) {
      const noTarget = validMemoryProposal({ op })
      expect(validateDreamProposal(noTarget).ok).toBe(false)
      expect(validateDreamProposal({ ...noTarget, targetId: 'm-1' }).ok).toBe(op !== 'merge')
    }
    const merge = validMemoryProposal({ op: 'merge', targetId: 'm-1' })
    const r = validateDreamProposal({ ...merge, mergeTargetId: 'm-2' })
    expect(r.ok).toBe(true)
    expect(r.proposal?.mergeTargetId).toBe('m-2')
  })

  it('缺 rationale / sourceRefs / payload 的提案被拒绝', () => {
    expect(validateDreamProposal(validMemoryProposal({ rationale: '  ' })).ok).toBe(false)
    expect(validateDreamProposal(validMemoryProposal({ sourceRefs: [] })).ok).toBe(false)
    expect(validateDreamProposal(validMemoryProposal({ payload: undefined })).ok).toBe(false)
  })

  it('sourceRefs 里非法条目被剔除，剔空则拒绝', () => {
    const dirty = validMemoryProposal({
      sourceRefs: [{ kind: 'bogus', id: 'x' }, { kind: 'session', id: 'sess-2' }, 'not-an-object'],
    })
    const r = validateDreamProposal(dirty)
    expect(r.ok).toBe(true)
    expect((r.proposal as DreamMemoryProposal).sourceRefs).toHaveLength(1)
    expect(
      validateDreamProposal(validMemoryProposal({ sourceRefs: [{ kind: 'bogus', id: 'x' }] })).ok,
    ).toBe(false)
  })

  it('confidence 非法输入 clamp 到 [0,1]', () => {
    const high = validateDreamProposal(validMemoryProposal({ confidence: 7 }))
    expect(high.proposal?.confidence).toBe(1)
    const nan = validateDreamProposal(validMemoryProposal({ confidence: 'abc' }))
    expect(nan.proposal?.confidence).toBe(0)
  })

  it('枚举字段非法被拒绝（op/type/kind）', () => {
    expect(validateDreamProposal(validMemoryProposal({ op: 'upsert' })).ok).toBe(false)
    expect(
      validateDreamProposal(
        validMemoryProposal({ payload: { type: 'dream', name: 'a', description: 'b', body: 'c' } }),
      ).ok,
    ).toBe(false)
    expect(validateDreamProposal({ ...validMemoryProposal(), kind: 'canvas' }).ok).toBe(false)
  })

  it('长度上限：超长 rationale/body/description 拒绝', () => {
    expect(validateDreamProposal(validMemoryProposal({ rationale: 'x'.repeat(2001) })).ok).toBe(
      false,
    )
    expect(
      validateDreamProposal(
        validMemoryProposal({
          payload: { type: 'user', name: 'n', description: 'd', body: 'x'.repeat(20001) },
        }),
      ).ok,
    ).toBe(false)
    expect(
      validateDreamProposal(
        validMemoryProposal({
          payload: { type: 'user', name: 'n', description: 'd'.repeat(2001), body: 'b' },
        }),
      ).ok,
    ).toBe(false)
  })

  it('merge 的 targetId 与 mergeTargetId 相同（自合并）被拒绝', () => {
    const r = validateDreamProposal(
      validMemoryProposal({
        op: 'merge',
        targetId: 'm-1',
        mergeTargetId: 'm-1',
      }),
    )
    expect(r.ok).toBe(false)
  })

  it('非对象输入直接拒绝', () => {
    expect(validateDreamProposal('create memory').ok).toBe(false)
    expect(validateDreamProposal(null).ok).toBe(false)
  })
})

describe('dream 置信度分流', () => {
  const base = { autoApplyThresholdPct: 85, autoDeleteEnabled: false }

  it('达阈值自动落库；未达进人审', () => {
    expect(resolveDreamProposalOutcome({ ...base, op: 'create', confidence: 0.85 })).toBe(
      'auto-applied',
    )
    expect(resolveDreamProposalOutcome({ ...base, op: 'create', confidence: 0.849 })).toBe(
      'pending-review',
    )
  })

  it('delete 在未开 autoDeleteEnabled 时无视置信度一律人审', () => {
    expect(resolveDreamProposalOutcome({ ...base, op: 'delete', confidence: 1 })).toBe(
      'pending-review',
    )
  })

  it('delete 在开启 autoDeleteEnabled 后按阈值分流', () => {
    expect(
      resolveDreamProposalOutcome({
        ...base,
        op: 'delete',
        confidence: 0.95,
        autoDeleteEnabled: true,
      }),
    ).toBe('auto-applied')
    expect(
      resolveDreamProposalOutcome({
        ...base,
        op: 'delete',
        confidence: 0.5,
        autoDeleteEnabled: true,
      }),
    ).toBe('pending-review')
  })

  it('merge/update 与 create 同规则', () => {
    expect(resolveDreamProposalOutcome({ ...base, op: 'merge', confidence: 0.9 })).toBe(
      'auto-applied',
    )
    expect(resolveDreamProposalOutcome({ ...base, op: 'update', confidence: 0.6 })).toBe(
      'pending-review',
    )
  })

  it('浮点边界不误判：恰好达阈即自动落库（0.29*100 的 28.99…96 案例）', () => {
    expect(
      resolveDreamProposalOutcome({
        ...base,
        autoApplyThresholdPct: 29,
        op: 'create',
        confidence: 0.29,
      }),
    ).toBe('auto-applied')
    expect(
      resolveDreamProposalOutcome({
        ...base,
        autoApplyThresholdPct: 29,
        op: 'create',
        confidence: 0.289,
      }),
    ).toBe('pending-review')
  })
})

describe('dream 配置默认值', () => {
  it('总开关与危险项默认关；阈值默认 85（计划 §12 已拍板）', () => {
    expect(DREAM_SETTING_DEFAULTS.enabled).toBe(false)
    expect(DREAM_SETTING_DEFAULTS.autoDeleteEnabled).toBe(false)
    expect(DREAM_SETTING_DEFAULTS.autoApplyThreshold).toBe(85)
    expect(DREAM_SETTING_DEFAULTS.scheduleTrigger).toBe('off')
    expect(DREAM_SETTING_DEFAULTS.batchLimit).toBe(50)
    expect(DREAM_SETTING_DEFAULTS.sessionScanDays).toBe(7)
  })
})
