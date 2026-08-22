import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import {
  DEBUG_MODE_SYSTEM_PROMPT,
  extractReportedFileChanges,
  isNestedAgentWorktreePath,
  PRESENT_FILES_SYSTEM_PROMPT,
  resolveMediaGenerationMcpServerPath,
  resolveRuntimeToolPath,
  resolveToolResultProxyMcpServerPath,
  QUICK_REPLIES_SYSTEM_PROMPT,
  RENDER_HTML_SYSTEM_PROMPT,
  TOOL_RESULT_SYSTEM_PROMPT,
  TOOL_RESULT_TOOL_NAMES,
  WEB_SEARCH_SYSTEM_PROMPT,
} from './session-mcp-tooling-helpers.js'
import { SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT } from './session-schedule-agent-tools.js'

describe('DEBUG_MODE_SYSTEM_PROMPT', () => {
  it('forces bug reports to enter the interactive loop before code edits', () => {
    expect(DEBUG_MODE_SYSTEM_PROMPT).toContain('MUST call `mcp__spark_debug__begin`')
    expect(DEBUG_MODE_SYSTEM_PROMPT).toContain('before editing code')
    expect(DEBUG_MODE_SYSTEM_PROMPT).toContain('explicitly asks')
  })
})

describe('resolveRuntimeToolPath', () => {
  let root = ''

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('prefers the packaged Resources/tools copy that standalone Node can execute', () => {
    root = mkdtempSync(join(tmpdir(), 'spark-runtime-tools-'))
    const resourcesPath = join(root, 'Resources')
    const packagedTool = join(resourcesPath, 'tools', 'spark-canvas-mcp-server.mjs')
    mkdirSync(join(resourcesPath, 'tools'), { recursive: true })
    writeFileSync(packagedTool, '#!/usr/bin/env node\n')

    expect(
      resolveRuntimeToolPath('spark-canvas-mcp-server.mjs', {
        resourcesPath,
        moduleDirectory: join(root, 'app.asar', 'out', 'main'),
        cwd: root,
      }),
    ).toBe(packagedTool)
  })

  it('never returns an app.asar path to the standalone Node runtime', () => {
    root = mkdtempSync(join(tmpdir(), 'spark-runtime-tools-asar-'))
    const archivedTools = join(root, 'app.asar', 'out', 'main', 'tools')
    mkdirSync(archivedTools, { recursive: true })
    writeFileSync(join(archivedTools, 'spark-canvas-mcp-server.mjs'), '# archived\n')

    expect(
      resolveRuntimeToolPath('spark-canvas-mcp-server.mjs', {
        resourcesPath: null,
        moduleDirectory: join(root, 'app.asar', 'out', 'main'),
        cwd: root,
      }),
    ).toBeNull()
  })

  it('keeps the monorepo source fallback for development', () => {
    root = mkdtempSync(join(tmpdir(), 'spark-runtime-tools-dev-'))
    const sourceTool = join(
      root,
      'packages',
      'agent-runtime',
      'src',
      'tools',
      'spark-canvas-mcp-server.mjs',
    )
    mkdirSync(join(sourceTool, '..'), { recursive: true })
    writeFileSync(sourceTool, '#!/usr/bin/env node\n')

    expect(
      resolveRuntimeToolPath('spark-canvas-mcp-server.mjs', {
        resourcesPath: null,
        moduleDirectory: join(root, 'apps', 'desktop', 'out', 'main'),
        cwd: root,
      }),
    ).toBe(sourceTool)
  })

  it('only resolves packaged spark_media when its standalone runtime dependencies exist', () => {
    root = mkdtempSync(join(tmpdir(), 'spark-runtime-media-'))
    const resourcesPath = join(root, 'Resources')
    const packagedTool = join(resourcesPath, 'tools', 'media-generation-mcp-server.mjs')
    const mediaServices = join(resourcesPath, 'services', 'media')
    mkdirSync(join(resourcesPath, 'tools'), { recursive: true })
    mkdirSync(mediaServices, { recursive: true })
    writeFileSync(packagedTool, '#!/usr/bin/env node\n')
    writeFileSync(join(resourcesPath, 'tools', 'official-media-mcp-helpers.mjs'), 'export {}\n')
    writeFileSync(join(mediaServices, 'media-extract.mjs'), 'export {}\n')

    const options = {
      resourcesPath,
      moduleDirectory: join(root, 'app.asar', 'out', 'main'),
      cwd: root,
    }
    expect(resolveMediaGenerationMcpServerPath(options)).toBeNull()

    writeFileSync(join(mediaServices, 'media-request-compiler.mjs'), 'export {}\n')
    expect(resolveMediaGenerationMcpServerPath(options)).toBe(packagedTool)
  })

  it('only resolves the packaged tool-result proxy with its local runtime dependencies', () => {
    root = mkdtempSync(join(tmpdir(), 'spark-runtime-tool-result-'))
    const resourcesPath = join(root, 'Resources')
    const toolsPath = join(resourcesPath, 'tools')
    const proxyPath = join(toolsPath, 'tool-result-governance-mcp-proxy.mjs')
    mkdirSync(toolsPath, { recursive: true })
    writeFileSync(proxyPath, '#!/usr/bin/env node\n')
    const options = {
      resourcesPath,
      moduleDirectory: join(root, 'app.asar', 'out', 'main'),
      cwd: root,
    }

    expect(resolveToolResultProxyMcpServerPath(options)).toBeNull()
    writeFileSync(join(toolsPath, 'tool-result-artifact-store.mjs'), 'export {}\n')
    writeFileSync(join(toolsPath, 'workspace-content-store.mjs'), 'export {}\n')
    expect(resolveToolResultProxyMcpServerPath(options)).toBe(proxyPath)
  })
})

describe('TOOL_RESULT_SYSTEM_PROMPT', () => {
  it('teaches range reads and search without treating archived output as a user artifact', () => {
    expect(TOOL_RESULT_TOOL_NAMES).toEqual([
      'mcp__spark_tool_results__list',
      'mcp__spark_tool_results__read',
      'mcp__spark_tool_results__search',
    ])
    expect(TOOL_RESULT_SYSTEM_PROMPT).toContain('spark.tool_result_envelope')
    expect(TOOL_RESULT_SYSTEM_PROMPT).toContain('offset/limit')
    expect(TOOL_RESULT_SYSTEM_PROMPT).toContain('search')
    expect(TOOL_RESULT_SYSTEM_PROMPT).toContain('not user-facing deliverables')
  })
})

describe('WEB_SEARCH_SYSTEM_PROMPT', () => {
  it('routes changing claims to search and stable knowledge to direct answers', () => {
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('Search based on how quickly the answer can change')
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('software versions')
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('Stable concepts')
  })

  it('requires source quality, page inspection, conflict handling, and calibrated absence claims', () => {
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('primary and authoritative sources')
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('Fetch the underlying page')
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('reconcile material conflicts')
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('absence of a search result')
  })
})

describe('QUICK_REPLIES_SYSTEM_PROMPT', () => {
  it('keeps the tool optional, short, capped, and mutually exclusive with question tools', () => {
    expect(QUICK_REPLIES_SYSTEM_PROMPT).toContain('You decide whether the tool is useful')
    expect(QUICK_REPLIES_SYSTEM_PROMPT).toContain('1-4')
    expect(QUICK_REPLIES_SYSTEM_PROMPT).toContain('at most 40 characters')
    expect(QUICK_REPLIES_SYSTEM_PROMPT).toContain('mutually exclusive')
    expect(QUICK_REPLIES_SYSTEM_PROMPT).toContain('AskUserQuestion')
    expect(QUICK_REPLIES_SYSTEM_PROMPT).toContain('request_user_input')
  })
})

describe('RENDER_HTML_SYSTEM_PROMPT', () => {
  it('teaches the agent when and how to render bounded sandboxed HTML', () => {
    expect(RENDER_HTML_SYSTEM_PROMPT).toContain('mcp__spark_ui__render_html')
    expect(RENDER_HTML_SYSTEM_PROMPT).toContain('ordinary text')
    expect(RENDER_HTML_SYSTEM_PROMPT).toContain('200,000')
    expect(RENDER_HTML_SYSTEM_PROMPT).toContain('inline CSS/JS')
    expect(RENDER_HTML_SYSTEM_PROMPT).toContain('data:')
    expect(RENDER_HTML_SYSTEM_PROMPT).toContain('iframe')
    expect(RENDER_HTML_SYSTEM_PROMPT).toContain('data visualizations')
    expect(RENDER_HTML_SYSTEM_PROMPT).toContain('ECharts')
    expect(RENDER_HTML_SYSTEM_PROMPT).toContain('network-enabled sandbox')
    expect(RENDER_HTML_SYSTEM_PROMPT).toContain('trusted HTTPS')
    expect(RENDER_HTML_SYSTEM_PROMPT).toContain('inline SVG/CSS/Canvas')
    expect(RENDER_HTML_SYSTEM_PROMPT).not.toContain('networkless sandbox')
    expect(RENDER_HTML_SYSTEM_PROMPT.length).toBeLessThan(1800)
  })
})

describe('SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT', () => {
  it('teaches the create-wait-wake-check-delete lifecycle', () => {
    expect(SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT).toContain('session_schedule_list')
    expect(SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT).toContain('session_schedule_create')
    expect(SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT).toContain('end the current turn')
    expect(SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT).toContain('Scheduled Task Context')
    expect(SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT).toContain('session_schedule_delete')
    expect(SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT).toContain('current session only')
    expect(SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT).toContain('`interval` requires `intervalSeconds`')
    expect(SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT).toContain(
      '`cron` requires a valid five-field `cronExpression`',
    )
    expect(SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT).toContain(
      '`once` requires a future ISO-8601 `runAt`',
    )
  })
})

describe('turn-scoped file change journal', () => {
  let root = ''

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('validates reported changes and rejects nested worktree pollution', () => {
    root = mkdtempSync(join(tmpdir(), 'spark-change-journal-'))
    const changedFile = join(root, 'src', 'app.ts')
    const nestedWorktreeFile = join(root, '.claude', 'worktrees', 'agent-1', 'src', 'app.ts')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(dirname(nestedWorktreeFile), { recursive: true })
    writeFileSync(changedFile, 'changed\n')
    writeFileSync(nestedWorktreeFile, 'copy\n')

    const event = {
      id: 'tool-result-1',
      type: 'tool_result',
      sessionId: 'session-1',
      turnId: 'turn-1',
      timestamp: new Date().toISOString(),
      seq: 1,
      toolCallId: 'tool-1',
      toolName: 'mcp__spark_files__report_file_changes',
      status: 'success',
      output: {
        changes: [
          { path: changedFile, changeType: 'modify' },
          { path: join(root, 'removed.ts'), changeType: 'delete' },
          { path: nestedWorktreeFile, changeType: 'modify' },
        ],
      },
    } as AgentEvent

    expect(extractReportedFileChanges(event, root)).toEqual([
      { path: realpathSync(changedFile), changeType: 'modify' },
      { path: join(realpathSync(root), 'removed.ts'), changeType: 'delete' },
    ])
    expect(isNestedAgentWorktreePath(root, nestedWorktreeFile)).toBe(true)
  })

  it('instructs agents to report only current-turn owned files', () => {
    expect(PRESENT_FILES_SYSTEM_PROMPT).toContain('report_file_changes')
    expect(PRESENT_FILES_SYSTEM_PROMPT).toContain('another session')
    expect(PRESENT_FILES_SYSTEM_PROMPT).toContain('nested agent worktrees')
  })
})
