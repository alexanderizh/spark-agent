import { describe, expect, it } from 'vitest'
import type { PermissionApprovalRequest } from '@spark/protocol'
import { buildPermissionSummary } from '../design/components/permissionRequestSummary'

function request(overrides: Partial<PermissionApprovalRequest>): PermissionApprovalRequest {
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    toolName: 'Edit',
    action: 'edit',
    toolInput: {},
    riskLevel: 'medium',
    persistentScopes: [],
    ...overrides,
  }
}

describe('permission request summary', () => {
  it('describes file edits without exposing source replacements in the default summary', () => {
    const summary = buildPermissionSummary(request({
      toolInput: {
        file_path: '/workspace/src/SettingsView.tsx',
        old_string: 'const oldValue = true',
        new_string: 'const newValue = false',
      },
    }))

    expect(summary.heading).toBe('修改文件')
    expect(summary.items).toEqual([{ label: '文件', value: '/workspace/src/SettingsView.tsx' }])
    expect(JSON.stringify(summary)).not.toContain('oldValue')
    expect(JSON.stringify(summary)).not.toContain('newValue')
  })

  it('shows the command when asking to execute a shell tool', () => {
    const summary = buildPermissionSummary(request({
      toolName: 'Bash',
      toolInput: { command: 'pnpm test' },
    }))

    expect(summary.heading).toBe('运行命令')
    expect(summary.items).toEqual([{ label: '将要运行', value: 'pnpm test' }])
  })

  it('keeps the risk-bearing end of long commands available for review', () => {
    const command = `${'echo safe && '.repeat(20)}rm -rf ./output`
    const summary = buildPermissionSummary(request({ toolName: 'Bash', toolInput: { command } }))

    expect(summary.items[0]?.value).toBe(command)
    expect(summary.items[0]?.value).toContain('rm -rf ./output')
  })
})
