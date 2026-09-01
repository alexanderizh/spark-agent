import { describe, expect, it } from 'vitest'
import type { UIBlock } from '../../services/event-mapper'
import { projectAssistantTurnCollapse } from './assistant-turn-collapse'

const text = (
  content: string,
  options: { streaming?: boolean; final?: boolean } = {},
): Extract<UIBlock, { kind: 'text' }> => ({
  kind: 'text',
  content,
  isStreaming: options.streaming ?? false,
  ...(options.final === true ? { isFinalAnswer: true } : {}),
})

describe('projectAssistantTurnCollapse', () => {
  it('waits for the normalized whole-turn completed status', () => {
    const blocks: UIBlock[] = [text('过程说明'), text('最终总结', { final: true })]

    expect(projectAssistantTurnCollapse('streaming', blocks)).toEqual({
      canCollapse: false,
      collapsedBlocks: blocks,
    })
    expect(projectAssistantTurnCollapse('error', blocks).canCollapse).toBe(false)
    expect(projectAssistantTurnCollapse('cancelled', blocks).canCollapse).toBe(false)
  })

  it('keeps only the provider-marked final host answer after completion', () => {
    const final = text('最终总结\n\n- 已完成 A\n- 已验证 B', { final: true })
    const blocks: UIBlock[] = [
      text('我先定位调用链。'),
      {
        kind: 'tool_call',
        toolCallId: 'tool-1',
        toolName: 'bash',
        toolInput: { command: 'pnpm test' },
        status: 'success',
        output: 'ok',
        error: undefined,
        durationMs: 10,
      },
      final,
    ]

    expect(projectAssistantTurnCollapse('completed', blocks)).toEqual({
      canCollapse: true,
      collapsedBlocks: [final],
    })
  })

  it('keeps the full trailing summary body together with its delivery summary card', () => {
    const finalPartOne = text('修复完成。')
    const finalPartTwo = text('验证结果：聚焦测试通过。', { final: true })
    const fileSummary: Extract<UIBlock, { kind: 'turn_file_summary' }> = {
      kind: 'turn_file_summary',
      files: [{ path: 'src/main.ts', changeType: 'modify', adds: 2, dels: 1 }],
      totalAdds: 2,
      totalDels: 1,
      latestCheckpointId: 'cp-1',
    }
    const blocks: UIBlock[] = [
      text('我先定位调用链。'),
      {
        kind: 'tool_call',
        toolCallId: 'tool-1',
        toolName: 'bash',
        toolInput: { command: 'pnpm test' },
        status: 'success',
        output: 'ok',
        error: undefined,
        durationMs: 10,
      },
      finalPartOne,
      fileSummary,
      finalPartTwo,
    ]

    expect(projectAssistantTurnCollapse('completed', blocks).collapsedBlocks).toEqual([
      finalPartOne,
      finalPartTwo,
      fileSummary,
    ])
  })

  it('keeps the full body split only by timeline-invisible quick replies as one summary', () => {
    // 真实 Claude 序列：正文主体 → suggest_replies（时间线不可见）→ 补充正文（result 只带最后一句）。
    const bodyPartOne = text(
      '好呀！结合你的技术背景，我想到几个适合测试自定义工具功能的点子。\n\n## 我的建议\n\n先做 HTTP 再做 Code。',
      { final: true },
    )
    const bodyPartTwo = text('你选一个方向，我就按流程帮你落地。', { final: true })
    const blocks: UIBlock[] = [
      { kind: 'thinking', content: '想想哪些工具适合测试。', isStreaming: false },
      bodyPartOne,
      { kind: 'quick_replies', toolCallId: 'quick-1', replies: ['就做二维码生成器吧'] },
      bodyPartTwo,
    ]

    expect(projectAssistantTurnCollapse('completed', blocks).collapsedBlocks).toEqual([
      bodyPartOne,
      bodyPartTwo,
    ])
  })

  it('keeps the invisible present_files tool call from splitting the trailing body', () => {
    const final = text('文件已交付。', { final: true })
    const presentedFiles: Extract<UIBlock, { kind: 'presented_files' }> = {
      kind: 'presented_files',
      files: [{ path: '/workspace/output/demo.mp4' }],
    }
    const blocks: UIBlock[] = [
      text('我先定位调用链。'),
      {
        kind: 'tool_call',
        toolCallId: 'tool-1',
        toolName: 'mcp__spark_files__present_files',
        toolInput: {},
        status: 'success',
        output: 'ok',
        error: undefined,
        durationMs: 10,
      },
      presentedFiles,
      final,
    ]

    expect(projectAssistantTurnCollapse('completed', blocks).collapsedBlocks).toEqual([
      final,
      presentedFiles,
    ])
  })

  it('keeps the whole marked run when only invisible quick replies sit between segments', () => {
    // 无过程边界的纯正文 + 快捷回复：mapper 已为 Claude 补齐 final 标记，filter 后应完整保留。
    const bodyPartOne = text('完整答复主体。', { final: true })
    const bodyPartTwo = text('选好方向我就开工。', { final: true })
    const blocks: UIBlock[] = [
      bodyPartOne,
      { kind: 'quick_replies', toolCallId: 'quick-1', replies: ['开工'] },
      bodyPartTwo,
    ]

    expect(projectAssistantTurnCollapse('completed', blocks).collapsedBlocks).toEqual([
      bodyPartOne,
      bodyPartTwo,
    ])
  })

  it('falls back to the trailing host summary after the last process block', () => {
    const process = text('旧历史过程正文')
    const summaryPartOne = text('旧历史总结第一段')
    const summaryPartTwo = text('旧历史总结第二段')
    const blocks: UIBlock[] = [
      process,
      {
        kind: 'tool_call',
        toolCallId: 'tool-1',
        toolName: 'bash',
        toolInput: { command: 'pnpm test' },
        status: 'success',
        output: 'ok',
        error: undefined,
        durationMs: 10,
      },
      summaryPartOne,
      summaryPartTwo,
    ]

    expect(projectAssistantTurnCollapse('completed', blocks).collapsedBlocks).toEqual([
      summaryPartOne,
      summaryPartTwo,
    ])
  })

  it('falls back to the trailing continuous body when legacy history has no process block', () => {
    const summaryPartOne = text('旧历史总结第一段')
    const summaryPartTwo = text('旧历史总结第二段')

    expect(
      projectAssistantTurnCollapse('completed', [summaryPartOne, summaryPartTwo]).collapsedBlocks,
    ).toEqual([summaryPartOne, summaryPartTwo])
  })

  it('does not treat pre-tool legacy prose as a final summary when no body follows', () => {
    const blocks: UIBlock[] = [
      text('旧历史过程正文'),
      {
        kind: 'tool_call',
        toolCallId: 'tool-1',
        toolName: 'bash',
        toolInput: { command: 'pnpm test' },
        status: 'success',
        output: 'ok',
        error: undefined,
        durationMs: 10,
      },
    ]

    expect(projectAssistantTurnCollapse('completed', blocks)).toEqual({
      canCollapse: false,
      collapsedBlocks: blocks,
    })
  })

  it('does not hide pending approvals, questions, warnings, or running work', () => {
    const final = text('暂时总结', { final: true })
    const blockers: UIBlock[] = [
      { kind: 'plan_proposed', plan: '等待确认' },
      {
        kind: 'user_question',
        toolCallId: 'question-1',
        questions: [],
        answered: false,
      },
      {
        kind: 'runtime_signal',
        signal: 'rate_limit',
        level: 'warning',
        title: '额度提醒',
        message: '请注意',
        retryable: false,
      },
      {
        kind: 'team_dispatch',
        dispatchId: 'dispatch-1',
        hostAgentId: 'host',
        memberAgentId: 'member',
        task: {
          taskId: 'task-1',
          hostAgentId: 'host',
          memberAgentId: 'member',
          rootTurnId: 'turn-1',
          instruction: '检查实现',
        },
        state: 'working',
      },
    ]

    for (const blocker of blockers) {
      expect(projectAssistantTurnCollapse('completed', [final, blocker]).canCollapse).toBe(false)
    }
  })

  it('keeps deliverable presentation blocks visible after collapse', () => {
    const final = text('视频已生成完毕。', { final: true })
    const presentedFiles: Extract<UIBlock, { kind: 'presented_files' }> = {
      kind: 'presented_files',
      files: [
        { path: '/workspace/output/demo.mp4' },
        { path: '/workspace/output/report.md', title: '报告' },
      ],
    }
    const htmlBlock: Extract<UIBlock, { kind: 'html_block' }> = {
      kind: 'html_block',
      toolCallId: 'html-1',
      html: '<p>报告</p>',
      title: '数据报告',
      height: 320,
      status: 'rendered',
      error: undefined,
      warnings: [],
    }
    const diagramBlock: Extract<UIBlock, { kind: 'diagram_block' }> = {
      kind: 'diagram_block',
      toolCallId: 'diagram-1',
      diagramType: 'mermaid',
      source: 'flowchart TD',
      title: '流程图',
      height: 320,
      status: 'rendered',
      error: undefined,
      warnings: [],
    }
    const blocks: UIBlock[] = [
      text('我先定位调用链。'),
      presentedFiles,
      htmlBlock,
      diagramBlock,
      final,
    ]

    expect(projectAssistantTurnCollapse('completed', blocks)).toEqual({
      canCollapse: true,
      collapsedBlocks: [final, presentedFiles, htmlBlock, diagramBlock],
    })
  })

  it('drops presentation blocks with nothing visible to show after collapse', () => {
    const final = text('已完成。', { final: true })
    const blocks: UIBlock[] = [
      {
        kind: 'presented_files',
        files: [{ path: '/workspace/src/main.ts' }],
      },
      {
        kind: 'html_block',
        toolCallId: 'html-1',
        html: '',
        title: '渲染失败',
        height: 320,
        status: 'error',
        error: 'sandbox denied',
        warnings: [],
      },
      final,
    ]

    expect(projectAssistantTurnCollapse('completed', blocks).collapsedBlocks).toEqual([final])
  })

  it('keeps delivery summary cards visible after collapse', () => {
    const final = text('本轮修改完成。', { final: true })
    const fileSummary: Extract<UIBlock, { kind: 'turn_file_summary' }> = {
      kind: 'turn_file_summary',
      files: [
        {
          path: 'apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx',
          changeType: 'modify',
          adds: 124,
          dels: 84,
        },
      ],
      totalAdds: 124,
      totalDels: 84,
      latestCheckpointId: 'cp-1',
    }
    const validation: Extract<UIBlock, { kind: 'validation_suggestion' }> = {
      kind: 'validation_suggestion',
      summary: '建议运行 pnpm typecheck 验证类型',
      changedFiles: ['apps/desktop/src/main.ts'],
      commands: [{ id: 'typecheck', label: '类型检查', command: 'pnpm typecheck', reason: '验证' }],
    }
    const snapshot: Extract<UIBlock, { kind: 'application_snapshot' }> = {
      kind: 'application_snapshot',
      snapshotId: 'snap-1',
      previewUrl: 'safe-file://x/preview',
      appName: '子应用',
      windowTitle: '预览',
      capturedAt: '2026-08-28T10:00:00.000Z',
    }
    const blocks: UIBlock[] = [text('我先梳理实现。'), fileSummary, validation, snapshot, final]

    expect(projectAssistantTurnCollapse('completed', blocks)).toEqual({
      canCollapse: true,
      collapsedBlocks: [final, fileSummary, validation, snapshot],
    })
  })

  it('drops empty delivery summary blocks after collapse', () => {
    const final = text('已完成。', { final: true })
    const blocks: UIBlock[] = [
      {
        kind: 'turn_file_summary',
        files: [],
        totalAdds: 0,
        totalDels: 0,
        latestCheckpointId: undefined,
      },
      {
        kind: 'validation_suggestion',
        summary: '   ',
        changedFiles: [],
        commands: [],
      },
      {
        kind: 'application_snapshot',
        snapshotId: 'snap-1',
        previewUrl: '',
        appName: '子应用',
        windowTitle: '预览',
        capturedAt: '2026-08-28T10:00:00.000Z',
      },
      final,
    ]

    expect(projectAssistantTurnCollapse('completed', blocks).collapsedBlocks).toEqual([final])
  })

  it('uses the trailing member summary when a direct team-member turn has no host answer', () => {
    const memberFinalPartOne: Extract<UIBlock, { kind: 'team_member_message' }> = {
      kind: 'team_member_message',
      dispatchId: 'dispatch-1',
      memberAgentId: 'member-1',
      content: '成员最终结论第一段',
      isStreaming: false,
    }
    const memberFinalPartTwo: Extract<UIBlock, { kind: 'team_member_message' }> = {
      ...memberFinalPartOne,
      content: '成员最终结论第二段',
      isFinalAnswer: true,
    }
    const blocks: UIBlock[] = [
      {
        kind: 'team_dispatch',
        dispatchId: 'dispatch-1',
        hostAgentId: 'host',
        memberAgentId: 'member-1',
        task: {
          taskId: 'task-1',
          hostAgentId: 'host',
          memberAgentId: 'member-1',
          rootTurnId: 'turn-1',
          instruction: '分析问题',
        },
        state: 'completed',
      },
      memberFinalPartOne,
      memberFinalPartTwo,
    ]

    expect(projectAssistantTurnCollapse('completed', blocks)).toEqual({
      canCollapse: true,
      collapsedBlocks: [memberFinalPartOne, memberFinalPartTwo],
    })
  })
})
