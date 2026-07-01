import { describe, expect, it } from 'vitest'

import { CODING_AGENT_TOOLS } from '../design/data/available-tools'

describe('CODING_AGENT_TOOLS', () => {
  it('includes the full built-in coding agent toolset shown in the inspector', () => {
    expect(CODING_AGENT_TOOLS.map((tool) => tool.name)).toEqual([
      'Read',
      'Write',
      'Edit',
      'MultiEdit',
      'NotebookEdit',
      'Grep',
      'Glob',
      'Bash',
      'TodoWrite',
      'AskUserQuestion',
      'ExitPlanMode',
      'WebFetch',
      'WebSearch',
      'mcp_tools',
      'lsp_diagnostics',
      'browser',
    ])
  })

  it('groups tools by capability area', () => {
    expect(new Set(CODING_AGENT_TOOLS.map((tool) => tool.group))).toEqual(new Set([
      '文件',
      '搜索',
      '执行',
      '协作',
      '网络',
      '扩展',
      '诊断',
      '浏览器',
    ]))
  })

  it('every built-in tool name matches a real Claude Agent SDK tool (no invented display names)', () => {
    const invented = ['read_file', 'write_file', 'edit_file', 'multi_edit', 'apply_patch', 'list_directory', 'search_files', 'grep_files', 'run_command', 'monitor', 'git', 'todo_write', 'task_create', 'task_update', 'web_fetch', 'web_search', 'exit_plan_mode']
    const names = CODING_AGENT_TOOLS.filter((tool) => tool.status === 'built-in').map((tool) => tool.name)
    for (const name of names) {
      expect(invented).not.toContain(name)
    }
  })

  it('marks runtime tools and extension entry points separately', () => {
    expect(CODING_AGENT_TOOLS.filter((tool) => tool.status === 'extension').map((tool) => tool.name)).toEqual([
      'mcp_tools',
      'lsp_diagnostics',
      'browser',
    ])
  })
})
