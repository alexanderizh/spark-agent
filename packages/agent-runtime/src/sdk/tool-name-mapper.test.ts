import { describe, expect, it } from 'vitest'
import { mapSDKToolName } from './tool-name-mapper.js'

describe('mapSDKToolName', () => {
  it.each([
    ['ListMcpResources', 'list_mcp_resources'],
    ['ReadMcpResource', 'read_mcp_resource'],
    ['ReadMcpResourceDir', 'read_mcp_resource_dir'],
    ['REPL', 'repl'],
    ['Workflow', 'workflow'],
    ['CronCreate', 'cron_create'],
    ['CronDelete', 'cron_delete'],
    ['ScheduleWakeup', 'schedule_wakeup'],
    ['RemoteTrigger', 'remote_trigger'],
    ['Monitor', 'monitor'],
    ['Artifact', 'artifact'],
    ['PushNotification', 'push_notification'],
    ['EnterWorktree', 'enter_worktree'],
    ['ExitWorktree', 'exit_worktree'],
    ['ClaudeDesign', 'claude_design'],
    ['Projects', 'projects'],
    ['ReportFindings', 'report_findings'],
  ])('normalizes %s to %s', (sdkName, expected) => {
    expect(mapSDKToolName(sdkName)).toBe(expected)
  })

  it('preserves MCP and future SDK tool names', () => {
    expect(mapSDKToolName('mcp__docs__lookup')).toBe('mcp__docs__lookup')
    expect(mapSDKToolName('FutureTool')).toBe('FutureTool')
  })
})
