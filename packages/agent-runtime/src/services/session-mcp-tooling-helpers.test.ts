import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveMediaGenerationMcpServerPath,
  resolveRuntimeToolPath,
  WEB_SEARCH_SYSTEM_PROMPT,
} from './session-mcp-tooling-helpers.js'

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
