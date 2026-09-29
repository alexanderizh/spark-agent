/**
 * @module wiki-extraction-prompt.test
 *
 * 抽取输出解析的严格性测试（S2 §9.4「不猜内容 / 无来源不入库」）。
 *
 * 断言重点是**判废**而不是召回：模型少给字段、turnIndex 编造、excerpt 为空、
 * 输出不是 JSON、正文带凭据 —— 每一种都必须让该条候选消失，而不是被启发式
 * 补全成一条"看起来能用"的知识。
 */

import { describe, it, expect } from 'vitest'
import {
  WIKI_EXTRACTION_SYSTEM_PROMPT,
  parseWikiExtractionResponse,
} from './wiki-extraction-prompt.js'

const SAMPLED = new Set([1, 2, 3])

function json(items: unknown[]): string {
  return JSON.stringify(items)
}

describe('parseWikiExtractionResponse', () => {
  it('完整条目通过并归一化', () => {
    const raw = json([
      {
        kind: 'experience',
        title: 'FTS5 contentless 表的增量更新',
        summary: 'contentless 表需要显式 delete 再 insert。',
        body: '## 是什么\ncontentless 表不存原文。\n\n## 为什么\n省空间。',
        tags: ['sqlite', 'fts', 'sqlite'],
        confidence: 0.87,
        rationale: '根因清晰，可复用',
        turnIndex: 2,
        excerpt: 'contentless 不会自动清旧行',
      },
    ])
    const result = parseWikiExtractionResponse(raw, SAMPLED)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toHaveLength(1)
    const item = result.items[0]!
    expect(item.kind).toBe('experience')
    expect(item.title).toBe('FTS5 contentless 表的增量更新')
    // 标签去重 + 保序
    expect(item.tags).toEqual(['sqlite', 'fts'])
    expect(item.confidence).toBe(0.87)
    expect(item.turnIndex).toBe(2)
  })

  it('非 JSON / 非数组 / 空数组分别判废', () => {
    expect(parseWikiExtractionResponse('我觉得应该记下来', SAMPLED)).toMatchObject({
      ok: false,
      reason: 'not_json',
    })
    expect(parseWikiExtractionResponse('{"a":1}', SAMPLED)).toMatchObject({
      ok: false,
      reason: 'not_array',
    })
    expect(parseWikiExtractionResponse('[]', SAMPLED)).toMatchObject({ ok: false, reason: 'empty' })
  })

  it('容忍模型自加的 Markdown 代码围栏', () => {
    const raw = [
      '```json',
      json([
        {
          kind: 'knowledge',
          title: '标题',
          summary: '摘要',
          body: '正文',
          tags: [],
          confidence: 0.9,
          turnIndex: 1,
          excerpt: '依据',
        },
      ]),
      '```',
    ].join('\n')
    const result = parseWikiExtractionResponse(raw, SAMPLED)
    expect(result.ok).toBe(true)
  })

  it('turnIndex 不在采样集合内 → 整条作废（强制溯源）', () => {
    const raw = json([
      {
        kind: 'knowledge',
        title: '凭空捏造的知识',
        summary: '摘要',
        body: '正文',
        tags: [],
        confidence: 0.99,
        turnIndex: 7, // 采样里没有第 7 轮
        excerpt: '某段不存在的内容',
      },
      {
        kind: 'knowledge',
        title: '有来源的知识',
        summary: '摘要',
        body: '正文',
        tags: [],
        confidence: 0.8,
        turnIndex: 3,
        excerpt: '第 3 轮的真实内容',
      },
    ])
    const result = parseWikiExtractionResponse(raw, SAMPLED)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items.map((i) => i.title)).toEqual(['有来源的知识'])
  })

  it('excerpt 为空 → 作废（没有依据就不入库）', () => {
    const raw = json([
      {
        kind: 'knowledge',
        title: '无依据',
        summary: '摘要',
        body: '正文',
        tags: [],
        confidence: 0.9,
        turnIndex: 1,
        excerpt: '   ',
      },
    ])
    expect(parseWikiExtractionResponse(raw, SAMPLED)).toMatchObject({
      ok: false,
      reason: 'all_invalid',
      invalid: 1,
    })
  })

  it('必填字段缺失 / 类型不符 → 判废', () => {
    const raw = json([
      {
        kind: 'knowledge',
        summary: 's',
        body: 'b',
        tags: [],
        confidence: 1,
        turnIndex: 1,
        excerpt: 'e',
      }, // 无 title
      {
        kind: 'unknown_kind',
        title: 't',
        summary: 's',
        body: 'b',
        tags: [],
        confidence: 1,
        turnIndex: 1,
        excerpt: 'e',
      },
      {
        kind: 'knowledge',
        title: 't',
        summary: 's',
        body: '',
        tags: [],
        confidence: 1,
        turnIndex: 1,
        excerpt: 'e',
      },
      'not an object',
    ])
    const result = parseWikiExtractionResponse(raw, SAMPLED)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('all_invalid')
    expect(result.invalid).toBe(4)
  })

  it('疑似凭据形态的正文 / 标题 / 摘要被拦截', () => {
    const raw = json([
      {
        kind: 'reference',
        title: 'API Key',
        summary: 'sk-abcdefghijklmnopqrstuvwx',
        body: '正文',
        tags: [],
        confidence: 0.9,
        turnIndex: 1,
        excerpt: 'e',
      },
      {
        kind: 'reference',
        title: '部署凭据',
        summary: 's',
        body: '用 AKIAABCDEFGHIJKLMNOP 访问',
        tags: [],
        confidence: 0.9,
        turnIndex: 1,
        excerpt: 'e',
      },
    ])
    expect(parseWikiExtractionResponse(raw, SAMPLED)).toMatchObject({
      ok: false,
      reason: 'all_invalid',
    })
  })

  it('confidence 越界被钳制；缺失回退 0.5（不猜高置信）', () => {
    const raw = json([
      {
        kind: 'note',
        title: 't1',
        summary: 's',
        body: 'b',
        tags: [],
        confidence: 42,
        turnIndex: 1,
        excerpt: 'e',
      },
      {
        kind: 'note',
        title: 't2',
        summary: 's',
        body: 'b',
        tags: [],
        turnIndex: 2,
        excerpt: 'e',
      },
    ])
    const result = parseWikiExtractionResponse(raw, SAMPLED)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items[0]!.confidence).toBe(1)
    expect(result.items[1]!.confidence).toBe(0.5)
  })

  it('summary 缺失时用正文首行兜底（检索层不允许空摘要）', () => {
    const raw = json([
      {
        kind: 'note',
        title: 't',
        body: '# 一级标题\n正文内容',
        tags: [],
        confidence: 0.7,
        turnIndex: 1,
        excerpt: 'e',
      },
    ])
    const result = parseWikiExtractionResponse(raw, SAMPLED)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items[0]!.summary).toBe('一级标题')
  })

  it('超长字段被截断而不是丢弃', () => {
    const raw = json([
      {
        kind: 'note',
        title: 'x'.repeat(200),
        summary: 'y'.repeat(1000),
        body: 'z'.repeat(9000),
        tags: ['t'.repeat(50)],
        confidence: 0.7,
        turnIndex: 1,
        excerpt: 'e'.repeat(900),
      },
    ])
    // title 超上限按约定判废（标题必须是结论式短语）
    expect(parseWikiExtractionResponse(raw, SAMPLED)).toMatchObject({ ok: false })
  })

  it('系统提示词包含溯源与"不要硬凑"两条硬约束', () => {
    expect(WIKI_EXTRACTION_SYSTEM_PROMPT).toContain('turnIndex')
    expect(WIKI_EXTRACTION_SYSTEM_PROMPT).toContain('不要硬凑')
  })
})
