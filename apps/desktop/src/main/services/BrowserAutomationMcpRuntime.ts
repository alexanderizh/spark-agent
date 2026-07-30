import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

interface BrowserAutomationMcpRuntimeInput {
  packaged: boolean
  resourcesPath: string
  moduleDirectory: string
  cwd: string
  exists: (candidate: string) => boolean
}

/**
 * Resolve the stdio bridge script for a plain standalone Node process.
 *
 * Electron can report files inside app.asar as existing, but the standalone
 * Node runtime cannot traverse that virtual filesystem. Packaged builds must
 * therefore use only the real file copied to Resources/tools.
 */
export function resolveBrowserAutomationMcpServerPath(
  input?: BrowserAutomationMcpRuntimeInput,
): string | null {
  const runtime = input ?? {
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath ?? '',
    moduleDirectory: path.dirname(fileURLToPath(import.meta.url)),
    cwd: process.cwd(),
    exists: existsSync,
  }
  const candidates = runtime.packaged
    ? [path.resolve(runtime.resourcesPath, 'tools/browser-automation-mcp-server.mjs')]
    : [
        path.resolve(runtime.moduleDirectory, 'tools/browser-automation-mcp-server.mjs'),
        path.resolve(runtime.moduleDirectory, '../tools/browser-automation-mcp-server.mjs'),
        path.resolve(
          runtime.moduleDirectory,
          '../../../../packages/agent-runtime/src/tools/browser-automation-mcp-server.mjs',
        ),
        path.resolve(
          runtime.cwd,
          'packages/agent-runtime/src/tools/browser-automation-mcp-server.mjs',
        ),
        path.resolve(
          runtime.cwd,
          '../packages/agent-runtime/src/tools/browser-automation-mcp-server.mjs',
        ),
      ]
  return candidates.find((candidate) => runtime.exists(candidate)) ?? null
}
