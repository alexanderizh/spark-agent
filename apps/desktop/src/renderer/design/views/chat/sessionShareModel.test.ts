import { describe, expect, it } from 'vitest'
import type { UIMessage } from '../../services/event-mapper'
import {
  SHARE_SHEET_WIDTH,
  SHARE_TARGET_SCALE,
  buildSessionShareCaption,
  buildSessionShareEntries,
  buildSessionShareFileName,
  maxShareSheetCssHeight,
  nextOmittedMessageCount,
  resolveShareCaptureScale,
} from './sessionShareModel'

function message(partial: Pick<UIMessage, 'id' | 'role' | 'blocks'> & Partial<UIMessage>): UIMessage {
  return {
    status: 'completed',
    usage: null,
    eventIds: [],
    ...partial,
  }
}

describe('session share capture scale', () => {
  it('keeps a 2x export when the sheet fits in the canvas limit', () => {
    expect(resolveShareCaptureScale(SHARE_SHEET_WIDTH, 4_000)).toBe(SHARE_TARGET_SCALE)
  })

  it('lowers the scale before the bitmap edge overflows', () => {
    const height = 40_000
    const scale = resolveShareCaptureScale(SHARE_SHEET_WIDTH, height)
    expect(scale).toBeLessThan(SHARE_TARGET_SCALE)
    expect(Math.ceil(height * scale)).toBeLessThanOrEqual(16_384)
    expect(Math.ceil(SHARE_SHEET_WIDTH * scale)).toBeLessThanOrEqual(16_384)
  })

  it('drops older messages until the sheet can stay sharp', () => {
    const maxHeight = maxShareSheetCssHeight()
    const first = nextOmittedMessageCount(10, 0, maxHeight * 2, maxHeight)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(10)
    const second = nextOmittedMessageCount(10, first, maxHeight * 2, maxHeight)
    expect(second).toBeGreaterThan(first)
    expect(nextOmittedMessageCount(10, 9, maxHeight * 4, maxHeight)).toBe(9)
  })
})

describe('session share projection', () => {
  const generatedAt = new Date('2026-10-14T09:51:00')

  it('keeps conversation text and collapses tool activity into one line', () => {
    const entries = buildSessionShareEntries(
      [
        message({
          id: 'user-1',
          role: 'user',
          timestamp: '2026-10-14T09:40:00',
          blocks: [{ kind: 'text', content: '  帮我看一下登录页  ', isStreaming: false }],
          attachments: [{ type: 'file', path: '/tmp/login.tsx', name: 'login.tsx' }],
        }),
        message({
          id: 'assistant-1',
          role: 'assistant',
          agentName: 'Spark',
          timestamp: '2026-10-13T18:02:00',
          blocks: [
            { kind: 'thinking', content: '先读文件', isStreaming: false },
            {
              kind: 'tool_call',
              toolCallId: 'a',
              toolName: 'Read',
              toolInput: {},
              status: 'success',
              output: 'file body',
              error: undefined,
              durationMs: 12,
            },
            {
              kind: 'tool_call',
              toolCallId: 'b',
              toolName: 'Read',
              toolInput: {},
              status: 'success',
              output: 'file body',
              error: undefined,
              durationMs: 8,
            },
            { kind: 'text', content: '登录页的问题在表单校验。', isStreaming: false },
            {
              kind: 'turn_file_summary',
              files: [],
              totalAdds: 12,
              totalDels: 3,
              latestCheckpointId: undefined,
            },
          ],
        }),
      ],
      { generatedAt },
    )

    expect(entries.map((entry) => entry.role)).toEqual(['user', 'assistant'])
    expect(entries[0]).toMatchObject({
      name: '我',
      text: '帮我看一下登录页',
      timeLabel: '09:40',
      attachments: [{ name: 'login.tsx' }],
    })
    expect(entries[1]?.name).toBe('Spark')
    expect(entries[1]?.text).toBe('登录页的问题在表单校验。')
    expect(entries[1]?.notes).toEqual(['调用 读取文件 ×2', '代码改动 · +12 −3'])
    expect(entries[1]?.timeLabel).toContain('10')
  })

  it('skips thinking-only messages and names the export file from the title', () => {
    expect(
      buildSessionShareEntries([
        message({
          id: 'think',
          role: 'assistant',
          blocks: [{ kind: 'thinking', content: '内部思考', isStreaming: false }],
        }),
      ]),
    ).toEqual([])

    expect(buildSessionShareFileName('登录/修复?', generatedAt)).toBe(
      'SparkWork-登录 修复-2026-10-14.png',
    )
    const caption = buildSessionShareCaption({
      workspaceName: '不使用项目',
      shownCount: 2,
      totalCount: 5,
      generatedAt,
    })
    expect(caption).toContain('最近 2 / 5 条')
    expect(caption).not.toContain('不使用项目')
  })
})
