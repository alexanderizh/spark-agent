import { describe, expect, it } from 'vitest'

import { appendRemoteContextSummary, formatRemoteContextSummary } from './remote-context-summary.js'

describe('remote context summary', () => {
  it('shows the effective project, session, provider, and model', () => {
    expect(
      formatRemoteContextSummary({
        workspaceName: 'Spark-Agent',
        workspaceId: 'workspace-1',
        sessionTitle: '修复远程交互',
        sessionId: 'session-1',
        providerName: 'OpenAI',
        providerKind: 'openai',
        modelId: 'gpt-5',
      }),
    ).toBe(
      '当前上下文\n工作区：Spark-Agent（workspace-1）\n会话：修复远程交互（session-1）\n渠道：OpenAI（openai）\n模型：gpt-5',
    )
  })

  it('uses clear fallbacks when no project or session is selected', () => {
    expect(appendRemoteContextSummary('切换完成', {})).toContain(
      '切换完成\n\n当前上下文\n工作区：不使用项目\n会话：未设置\n渠道：未设置\n模型：未设置',
    )
  })
})
