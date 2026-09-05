/**
 * HistoryImportService.scanCodex 单测 —— 聚焦同一 thread 的 rollout 文件归并与主线拼接：
 *
 * Codex resume 机制让同一 thread 在磁盘上以多个 rollout 文件存在：
 *   - resume 增量文件只记新增内容，与前一文件时间衔接（thread 连续历史跨文件）；
 *   - 并行 resume 的文件时间窗互相重叠（并行工作线，拼接会重复）；
 *   - 增量文件首行是自己的新 session id，末尾回写原 thread 的 session_meta（归属标记）。
 *
 * 原缺陷（回归对象）：scan 按「一个文件 = 一个条目」枚举，各文件解析出的
 * sourceSessionId 全部撞成原 thread id —— 列表重复、前端按 key 勾选联动、
 * 导入去重静默丢弃。归并后同 thread 一条，导入按主线（衔接链）拼接完整历史。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SparkDatabase } from '@spark/storage'
import { HistoryImportService, type HistoryImportDeps } from './HistoryImportService.js'

/** rollout 行构造 helper */
const sessionMeta = (id: string, ts: string) => ({
  type: 'session_meta',
  timestamp: ts,
  payload: { id, cwd: '/Users/me/proj-x', timestamp: ts },
})
const userMsg = (text: string, ts: string) => ({
  type: 'response_item',
  timestamp: ts,
  payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
})
const assistantMsg = (text: string, ts: string) => ({
  type: 'response_item',
  timestamp: ts,
  payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
})
const jsonl = (lines: unknown[]): string => lines.map((l) => JSON.stringify(l)).join('\n')

describe('HistoryImportService.scanCodex（thread 归并 + 主线拼接）', () => {
  let home: string
  let service: HistoryImportService
  let origFile: string
  let deltaFile: string

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), 'history-import-codex-scan-'))
    const dayDir = path.join(home, '.codex', 'sessions', '2026', '09', '06')
    mkdirSync(dayDir, { recursive: true })

    // thread-a 起点文件：窗口 [04:00:00, 04:29:00]
    origFile = path.join(
      dayDir,
      'rollout-2026-09-06T12-00-00-a0000000-0000-0000-0000-0000000000aa.jsonl',
    )
    writeFileSync(
      origFile,
      jsonl([
        sessionMeta('thread-a', '2026-09-06T04:00:00.000Z'),
        userMsg('任务开始，帮我加个功能', '2026-09-06T04:00:01.000Z'),
        assistantMsg('好的，我先看看现状', '2026-09-06T04:29:00.000Z'),
      ]),
      'utf-8',
    )

    // thread-a 并行 resume 文件：窗口 [04:10:00, 04:10:05] 完全落在起点文件覆盖内 → 淘汰
    writeFileSync(
      path.join(dayDir, 'rollout-2026-09-06T12-10-00-b0000000-0000-0000-0000-0000000000aa.jsonl'),
      jsonl([
        sessionMeta('snap-1', '2026-09-06T04:10:00.000Z'),
        userMsg('并行任务', '2026-09-06T04:10:01.000Z'),
        assistantMsg('并行结果', '2026-09-06T04:10:02.000Z'),
        sessionMeta('thread-a', '2026-09-06T04:10:05.000Z'),
      ]),
      'utf-8',
    )

    // thread-a resume 增量文件：窗口 [04:30:00, 04:31:05] 与起点衔接 → 入主线。
    // 首条 user 是 resume 重放（Codex 会把 thread 最后一条 user message 重放进新
    // rollout 开头，时间戳为衔接时刻），拼接时应被去重
    deltaFile = path.join(
      dayDir,
      'rollout-2026-09-06T12-30-00-c0000000-0000-0000-0000-0000000000aa.jsonl',
    )
    writeFileSync(
      deltaFile,
      jsonl([
        sessionMeta('snap-2', '2026-09-06T04:30:00.000Z'),
        userMsg('任务开始，帮我加个功能', '2026-09-06T04:30:01.000Z'),
        userMsg('继续做刚才的', '2026-09-06T04:30:30.000Z'),
        assistantMsg('已完成', '2026-09-06T04:31:00.000Z'),
        sessionMeta('thread-a', '2026-09-06T04:31:05.000Z'),
      ]),
      'utf-8',
    )

    // 独立会话 thread-b：不受归并影响；mock db 已导入，验证 alreadyImported 按 threadId 生效
    writeFileSync(
      path.join(dayDir, 'rollout-2026-09-06T13-00-00-d0000000-0000-0000-0000-0000000000bb.jsonl'),
      jsonl([
        sessionMeta('thread-b', '2026-09-06T05:00:00.000Z'),
        userMsg('查一下报错原因', '2026-09-06T05:00:01.000Z'),
        assistantMsg('缺少默认值', '2026-09-06T05:00:02.000Z'),
      ]),
      'utf-8',
    )

    // session_index：thread-a 的 threadName 来源
    writeFileSync(
      path.join(home, '.codex', 'session_index.jsonl'),
      jsonl([{ id: 'thread-a', thread_name: '测试 Dev 模式 Agent 工作流' }]) + '\n',
      'utf-8',
    )

    const deps: HistoryImportDeps = {
      db: {
        raw: {
          prepare: () => ({
            all: () => [
              { metadata_json: JSON.stringify({ importHistory: { sourceSessionId: 'thread-b' } }) },
            ],
          }),
        },
      } as unknown as SparkDatabase,
      resolveProvider: async () => ({
        providerProfileId: 'p1',
        agentAdapter: 'codex' as const,
        permissionMode: 'codex-default' as const,
      }),
      createSession: async () => ({ sessionId: 's1' }),
      homeDir: home,
    }
    service = new HistoryImportService(deps)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('同 thread 多文件归并为一个条目，并行/独立会话不误并', async () => {
    const response = await service.scan(['codex'])
    const codexItems = response.items.filter((i) => i.source === 'codex')
    expect(codexItems).toHaveLength(2)
    expect(response.sources.find((s) => s.source === 'codex')?.count).toBe(2)
    expect(codexItems.filter((i) => i.sourceSessionId === 'thread-a')).toHaveLength(1)
    expect(codexItems.filter((i) => i.sourceSessionId === 'thread-b')).toHaveLength(1)
  })

  it('messageCount 为主线衔接文件计数之和，filePath 指向最全文件，时间聚合为 thread 跨度', async () => {
    const response = await service.scan(['codex'])
    const threadA = response.items.find(
      (i) => i.source === 'codex' && i.sourceSessionId === 'thread-a',
    )
    // 主线 = 起点文件(2 条) + 增量文件(3 条，含 1 条重放)；并行文件(2 条)被淘汰
    expect(threadA).toMatchObject({
      messageCount: 5,
      title: '测试 Dev 模式 Agent 工作流',
      firstTimestamp: '2026-09-06T04:00:00.000Z',
      lastTimestamp: '2026-09-06T04:31:05.000Z',
      alreadyImported: false,
    })
    // filePath 兜底源 = 字节最大的文件（delta 含 4 行 > orig 3 行 > 并行 4 行但更短文本）
    expect(threadA?.filePath).toBe(deltaFile)
  })

  it('alreadyImported 按 threadId 判断，独立会话标题来自首条用户消息', async () => {
    const response = await service.scan(['codex'])
    const threadB = response.items.find(
      (i) => i.source === 'codex' && i.sourceSessionId === 'thread-b',
    )
    expect(threadB).toMatchObject({ alreadyImported: true, title: '查一下报错原因' })
  })

  it('preview 按主线拼接：跨文件消息齐全，衔接处重放去重，并行文件排除', async () => {
    const response = await service.scan(['codex'])
    const threadA = response.items.find(
      (i) => i.source === 'codex' && i.sourceSessionId === 'thread-a',
    )
    const preview = await service.preview('codex', threadA!.filePath, 100, 'thread-a')
    const texts = preview.messages.map((m) => m.text)
    // 衔接段全部在（跨文件拼接生效）
    expect(texts).toContain('任务开始，帮我加个功能')
    expect(texts).toContain('继续做刚才的')
    // resume 重放的 user message 在衔接处被去重（只出现一次）
    expect(texts.filter((t) => t === '任务开始，帮我加个功能')).toHaveLength(1)
    // 并行重叠文件被排除
    expect(texts).not.toContain('并行任务')
  })
})
