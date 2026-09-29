/**
 * Wiki IPC 契约测试 — S2/S3/S4 新增通道的 zod 校验与不变量。
 *
 * 为什么值得单测：这些通道是渲染端与主进程之间唯一的边界，schema 漏一个
 * 字段校验就会让畸形请求直达服务层；而「拒绝原因必填」「所有权枚举封闭」
 * 这类业务不变量写在 zod 里，改 schema 时必须有人盯着。
 */

import { describe, it, expect } from 'vitest'
import type { WikiIpcChannelMap } from './wiki.js'
import { WikiIpcSchemaRegistry } from './wiki.js'
import type { WikiRepoPageOwnership, WikiSkillProposalStatus } from './wiki.js'

type Channel = keyof WikiIpcChannelMap

describe('Wiki IPC 契约（S2/S3/S4 通道）', () => {
  it('S3/S4 通道齐备且都在 SchemaRegistry 里登记', () => {
    const expected: Channel[] = [
      'wiki:skill:list',
      'wiki:skill:accept',
      'wiki:skill:reject',
      'wiki:repo:scan',
      'wiki:repo:rebuild',
      'wiki:repo:status',
      'wiki:repo:page:ownership',
    ]
    for (const channel of expected) {
      expect(Object.keys(WikiIpcSchemaRegistry)).toContain(channel)
    }
  })

  it('skill 状态枚举与存储 CHECK 约束一致', () => {
    const schema = WikiIpcSchemaRegistry['wiki:skill:list']
    const parsed = schema.parse({ status: 'pending' })
    expect(parsed.status).toBe('pending')
    const statuses: WikiSkillProposalStatus[] = ['pending', 'accepted', 'rejected', 'superseded']
    for (const status of statuses) {
      expect(schema.safeParse({ status }).success).toBe(true)
    }
    expect(schema.safeParse({ status: 'nope' }).success).toBe(false)
  })

  it('拒绝原因必填且上限 500（留给下一轮提议的反馈信号不能丢）', () => {
    const schema = WikiIpcSchemaRegistry['wiki:skill:reject']
    expect(schema.safeParse({ id: 'wskp_abc', reason: '' }).success).toBe(false)
    expect(schema.safeParse({ id: 'wskp_abc' }).success).toBe(false)
    expect(schema.safeParse({ id: 'wskp_abc', reason: '范围太大' }).success).toBe(true)
    expect(schema.safeParse({ id: 'wskp_abc', reason: 'x'.repeat(501) }).success).toBe(false)
    expect(schema.safeParse({ id: 'wskp_abc', reason: 'x'.repeat(500) }).success).toBe(true)
  })

  it('repo 所有权枚举封闭（防止渲染端发明第四种状态）', () => {
    const schema = WikiIpcSchemaRegistry['wiki:repo:page:ownership']
    const ownerships: WikiRepoPageOwnership[] = ['generated', 'manual', 'ignored']
    for (const ownership of ownerships) {
      expect(schema.safeParse({ pageId: 'wp_x', ownership }).success).toBe(true)
    }
    expect(schema.safeParse({ pageId: 'wp_x', ownership: 'locked' }).success).toBe(false)
  })

  it('repo 扫描参数有边界（maxFiles 上限防误设导致超长扫描）', () => {
    const schema = WikiIpcSchemaRegistry['wiki:repo:scan']
    expect(schema.safeParse({ repoPath: '/tmp/x' }).success).toBe(true)
    expect(schema.safeParse({ repoPath: '' }).success).toBe(false)
    expect(schema.safeParse({ repoPath: '/tmp/x', maxFiles: 0 }).success).toBe(false)
    expect(schema.safeParse({ repoPath: '/tmp/x', maxFiles: 200_001 }).success).toBe(false)
    expect(schema.safeParse({ repoPath: '/tmp/x', maxFiles: 5000 }).success).toBe(true)
    // 忽略路径上限：防止把整份 .gitignore 塞进来当扫描配置
    expect(
      schema.safeParse({ repoPath: '/tmp/x', ignoreGlobs: Array(101).fill('a') }).success,
    ).toBe(false)
  })

  it('S0-S2 既有通道未被破坏（向后兼容）', () => {
    for (const channel of [
      'wiki:space:list',
      'wiki:space:create',
      'wiki:page:create',
      'wiki:page:update',
      'wiki:search',
      'wiki:candidate:list',
      'wiki:candidate:confirm',
      'wiki:candidate:reject',
      'wiki:extract:distill',
    ] as Channel[]) {
      expect(Object.keys(WikiIpcSchemaRegistry)).toContain(channel)
    }
    // digest 是「所见即所存」的摘要绑定，长度有下限（8）——短摘要一律拒绝
    expect(
      WikiIpcSchemaRegistry['wiki:candidate:confirm'].safeParse({ id: 1, digest: 'a' }).success,
    ).toBe(false)
    expect(
      WikiIpcSchemaRegistry['wiki:candidate:confirm'].safeParse({
        id: 1,
        digest: '0f1e2d3c4b5a6978',
      }).success,
    ).toBe(true)
  })
})
