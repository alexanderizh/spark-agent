import { describe, expect, it } from 'vitest'
import type { UIBlock } from '../../services/event-mapper'
import {
  getToolLogGroupKind,
  isChatActivitySegmentRunning,
  splitChatActivitySegments,
  summarizeChatActivitySegment,
} from './ChatActivitySegments'

function text(content: string, segmentId: string): Extract<UIBlock, { kind: 'text' }> {
  return { kind: 'text', content, isStreaming: false, segmentId }
}

function thinking(segmentId: string, isStreaming: boolean): Extract<UIBlock, { kind: 'thinking' }> {
  return { kind: 'thinking', content: '正在检查', isStreaming, segmentId }
}

function tool(
  toolCallId: string,
  toolName: string,
  status: Extract<UIBlock, { kind: 'tool_call' }>['status'],
): Extract<UIBlock, { kind: 'tool_call' }> {
  return {
    kind: 'tool_call',
    toolCallId,
    toolName,
    toolInput: {},
    status,
    output: undefined,
    error: undefined,
    durationMs: undefined,
  }
}

function terminal(
  toolCallId: string,
  isStreaming: boolean,
): Extract<UIBlock, { kind: 'terminal' }> {
  return {
    kind: 'terminal',
    toolCallId,
    stdout: '',
    stderr: '',
    isStreaming,
    exitCode: isStreaming ? undefined : 0,
  }
}

function subagent(toolCallId: string): Extract<UIBlock, { kind: 'subagent' }> {
  return {
    kind: 'subagent',
    toolCallId,
    name: 'Search',
    role: 'researcher',
    task: '检查小地图',
    status: 'done',
    tokens: '100',
  }
}

describe('ChatActivitySegments', () => {
  it('groups contiguous activity and seals it at visible content boundaries', () => {
    const items = splitChatActivitySegments([
      thinking('think-1', false),
      tool('read-1', 'Read', 'success'),
      terminal('terminal-1', false),
      text('定位完成', 'text-1'),
      tool('bash-1', 'Bash', 'running'),
    ])

    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      kind: 'activity',
      key: 'activity:thinking:think-1',
      sealed: true,
      blocks: [{ kind: 'thinking' }, { kind: 'tool_call' }, { kind: 'terminal' }],
    })
    expect(items[1]).toMatchObject({ kind: 'content', key: 'content:text:text-1' })
    expect(items[2]).toMatchObject({
      kind: 'activity',
      key: 'activity:tool:bash-1',
      sealed: false,
      blocks: [{ kind: 'tool_call', toolCallId: 'bash-1' }],
    })
  })

  it('treats a subagent card as a boundary between independent activity segments', () => {
    const items = splitChatActivitySegments([
      tool('read-1', 'Read', 'success'),
      subagent('subagent-1'),
      thinking('think-2', true),
    ])

    expect(items.map((item) => item.kind)).toEqual(['activity', 'content', 'activity'])
    expect(items[0]).toMatchObject({ sealed: true })
    expect(items[2]).toMatchObject({ sealed: false })
  })

  it('uses stable block identities and only falls back to a turn-local segment ordinal', () => {
    const withStableIdentity = splitChatActivitySegments([tool('tool-stable', 'Read', 'success')])
    const legacyThinking: Extract<UIBlock, { kind: 'thinking' }> = {
      kind: 'thinking',
      content: 'legacy',
      isStreaming: false,
    }
    const withFallback = splitChatActivitySegments([text('before', 'text-1'), legacyThinking])
    const withoutInvisiblePrefix = splitChatActivitySegments([legacyThinking])
    const withInvisiblePrefix = splitChatActivitySegments([
      {
        kind: 'context_ledger',
        sections: [],
        totalEstimatedTokens: 0,
        softLimitTokens: 0,
        contextWindowTokens: 0,
        usagePercent: 0,
      },
      legacyThinking,
    ])

    expect(withStableIdentity[0]).toMatchObject({ key: 'activity:tool:tool-stable' })
    expect(withFallback[1]).toMatchObject({ key: 'activity:thinking-index:1' })
    expect(withInvisiblePrefix[0]?.key).toBe(withoutInvisiblePrefix[0]?.key)
  })

  it('keeps repeated file paths distinct across separate activity segments', () => {
    const fileChange = (): Extract<UIBlock, { kind: 'file_change' }> => ({
      kind: 'file_change',
      changeType: 'modify',
      path: 'src/repeated.ts',
      diff: '@@ -1 +1 @@',
    })
    const items = splitChatActivitySegments([
      fileChange(),
      text('第一段完成', 'text-1'),
      fileChange(),
    ])
    const withUnrelatedPrefix = splitChatActivitySegments([
      text('前置正文', 'text-prefix'),
      fileChange(),
    ])

    expect(items[0]).toMatchObject({ key: 'activity:file:src/repeated.ts' })
    expect(items[2]).toMatchObject({ key: 'activity:file:src/repeated.ts:2' })
    expect(withUnrelatedPrefix[1]).toMatchObject({ key: 'activity:file:src/repeated.ts' })
  })

  it('ignores invisible metadata instead of sealing visible activity', () => {
    const items = splitChatActivitySegments([
      tool('read-1', 'Read', 'success'),
      {
        kind: 'file_change',
        changeType: 'modify',
        path: 'src/no-diff.ts',
        diff: undefined,
      },
      {
        kind: 'context_ledger',
        sections: [],
        totalEstimatedTokens: 0,
        softLimitTokens: 0,
        contextWindowTokens: 0,
        usagePercent: 0,
      },
      {
        kind: 'presented_files',
        // 1e9476b0 起图片/音视频 presented_files 渲染为可见媒体并封口 activity；
        // 非 document/非媒体路径（如 json）仍是不可见元数据，不应封口可见活动。
        files: [{ path: 'output/result.json' }],
      },
    ])

    expect(items).toMatchObject([{ kind: 'activity', sealed: false }])
  })

  it('classifies tool groups with the existing read, command, write and generic semantics', () => {
    expect(getToolLogGroupKind(tool('read', 'Grep', 'success'), 'main')).toBe('read')
    expect(getToolLogGroupKind(tool('command', 'run_command', 'success'), 'main')).toBe('command')
    expect(getToolLogGroupKind(tool('write', 'apply_patch', 'success'), 'main')).toBe('write')
    expect(getToolLogGroupKind(tool('todo', 'todo_write', 'success'), 'main')).toBeNull()
  })

  it('classifies web, browser, media and image-read tools into dedicated groups', () => {
    expect(getToolLogGroupKind(tool('web', 'web_search', 'success'), 'main')).toBe('web')
    expect(
      getToolLogGroupKind(tool('fetch', 'mcp__spark_search__fetch_url', 'success'), 'main'),
    ).toBe('web')
    expect(
      getToolLogGroupKind(tool('browser', 'mcp__playwright__browser_click', 'success'), 'main'),
    ).toBe('browser')
    expect(
      getToolLogGroupKind(
        tool('spark-browser', 'mcp__spark_browser__screenshot', 'success'),
        'main',
      ),
    ).toBe('browser')
    expect(
      getToolLogGroupKind(tool('media', 'mcp__spark_media__generate_image', 'success'), 'main'),
    ).toBe('media')
    expect(getToolLogGroupKind(tool('media-video', 'generate_video', 'success'), 'main')).toBe(
      'media',
    )

    const imageRead: Extract<UIBlock, { kind: 'tool_call' }> = {
      ...tool('img-read', 'Read', 'success'),
      toolInput: { file_path: '/tmp/screenshots/preview.png' },
    }
    expect(getToolLogGroupKind(imageRead, 'main')).toBe('image')
    // 非图片路径的 Read 仍归 read
    const textRead: Extract<UIBlock, { kind: 'tool_call' }> = {
      ...tool('text-read', 'Read', 'success'),
      toolInput: { file_path: '/tmp/src/index.ts' },
    }
    expect(getToolLogGroupKind(textRead, 'main')).toBe('read')
  })

  it('builds a compact natural-language summary without double-counting file changes', () => {
    const blocks: UIBlock[] = [
      thinking('think-1', false),
      tool('read-1', 'Read', 'success'),
      tool('read-2', 'Grep', 'success'),
      terminal('command-1', false),
      tool('command-1', 'Bash', 'success'),
      tool('write-1', 'Edit', 'success'),
      {
        kind: 'file_change',
        changeType: 'modify',
        path: 'src/a.ts',
        diff: undefined,
      },
    ]

    expect(summarizeChatActivitySegment(blocks)).toBe(
      '查看了 2 个文件 · 运行了 1 条命令 · 修改了 1 个文件 · 进行了思考',
    )
  })

  it('summarizes image, web, browser and media groups with dedicated verbs', () => {
    const imageRead: Extract<UIBlock, { kind: 'tool_call' }> = {
      ...tool('img-read', 'Read', 'success'),
      toolInput: { file_path: '/tmp/a.png' },
    }
    const blocks: UIBlock[] = [
      imageRead,
      tool('web-1', 'web_search', 'success'),
      tool('browser-1', 'mcp__playwright__browser_click', 'success'),
      tool('media-1', 'mcp__spark_media__generate_image', 'success'),
    ]

    expect(summarizeChatActivitySegment(blocks)).toBe(
      '查看了 1 张图片 · 联网检索 1 次 · 操作浏览器 1 次 · 生成了 1 个媒体',
    )
  })

  it('detects running thinking, tools and terminals independently', () => {
    expect(isChatActivitySegmentRunning([thinking('think-1', true)])).toBe(true)
    expect(isChatActivitySegmentRunning([tool('tool-1', 'Read', 'pending')])).toBe(true)
    expect(isChatActivitySegmentRunning([terminal('terminal-1', true)])).toBe(true)
    expect(
      isChatActivitySegmentRunning([
        thinking('think-2', false),
        tool('tool-2', 'Read', 'success'),
        terminal('terminal-2', false),
      ]),
    ).toBe(false)
  })
})
