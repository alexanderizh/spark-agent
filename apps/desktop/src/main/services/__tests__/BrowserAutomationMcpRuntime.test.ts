import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false },
}))

import { resolveBrowserAutomationMcpServerPath } from '../BrowserAutomationMcpRuntime.js'

describe('resolveBrowserAutomationMcpServerPath', () => {
  it('forces packaged standalone Node to use the real Resources script', () => {
    const checked: string[] = []
    const result = resolveBrowserAutomationMcpServerPath({
      packaged: true,
      resourcesPath: 'C:\\Program Files\\SparkWork\\resources',
      moduleDirectory: 'C:\\Program Files\\SparkWork\\resources\\app.asar\\out\\main',
      cwd: 'C:\\workspace',
      exists: (candidate) => {
        checked.push(candidate)
        return true
      },
    })

    expect(checked).toHaveLength(1)
    expect(result).toContain('resources/tools/browser-automation-mcp-server.mjs')
    expect(result).not.toContain('app.asar')
  })

  it('keeps source-tree fallbacks for development', () => {
    const result = resolveBrowserAutomationMcpServerPath({
      packaged: false,
      resourcesPath: '/unused',
      moduleDirectory: '/repo/apps/desktop/out/main',
      cwd: '/repo',
      exists: (candidate) =>
        candidate === '/repo/packages/agent-runtime/src/tools/browser-automation-mcp-server.mjs',
    })

    expect(result).toBe('/repo/packages/agent-runtime/src/tools/browser-automation-mcp-server.mjs')
  })
})
