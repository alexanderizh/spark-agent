/**
 * ExternalToolService — Detect and launch external tools (IDEs & Terminals)
 *
 * Supports macOS and Windows. Detects installed tools by checking:
 *   - macOS: /Applications, ~/Applications, and CLI `which`
 *   - Windows: Program Files, AppData/Local/Programs, and CLI `where`
 */
import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createLogger } from '@spark/shared'
import type { ExternalToolInfo, ExternalToolKind } from '@spark/protocol'

const log = createLogger('external-tools')
const execFileAsync = promisify(execFile)

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

// ─── Tool Definitions ────────────────────────────────────────────────────────

interface ToolDef {
  id: string
  name: string
  kind: ExternalToolKind
  /** macOS detection: path suffixes under /Applications or ~/Applications */
  macAppPaths?: string[]
  /** macOS CLI binary name to `which` */
  macCli?: string
  /** macOS launch command (first element is the CLI or app path template) */
  macOpen?: string[]
  /** Windows detection: path suffixes under Program Files / AppData */
  winPaths?: string[]
  /** Windows CLI binary name to `where` */
  winCli?: string
  /** Windows launch command */
  winOpen?: string[]
}

const TOOL_DEFS: ToolDef[] = [
  // ─── IDEs ────────────────────────────────────────────────────────────
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    kind: 'ide',
    macAppPaths: ['Visual Studio Code.app'],
    macCli: 'code',
    macOpen: ['code', '{path}'],
    winCli: 'code',
    winOpen: ['code', '{path}'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    kind: 'ide',
    macAppPaths: ['Cursor.app'],
    macCli: 'cursor',
    macOpen: ['cursor', '{path}'],
    winCli: 'cursor',
    winOpen: ['cursor', '{path}'],
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    kind: 'ide',
    macAppPaths: ['CodeBuddy.app'],
    macCli: 'codebuddy',
    macOpen: ['codebuddy', '{path}'],
    winCli: 'codebuddy',
    winOpen: ['codebuddy', '{path}'],
  },
  {
    id: 'qoder',
    name: 'Qoder',
    kind: 'ide',
    macAppPaths: ['Qoder.app'],
    macCli: 'qoder',
    macOpen: ['qoder', '{path}'],
    winCli: 'qoder',
    winOpen: ['qoder', '{path}'],
  },
  {
    id: 'trae',
    name: 'Trae',
    kind: 'ide',
    macAppPaths: ['Trae.app'],
    macCli: 'trae',
    macOpen: ['trae', '{path}'],
    winCli: 'trae',
    winOpen: ['trae', '{path}'],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    kind: 'ide',
    macAppPaths: ['Windsurf.app'],
    macCli: 'windsurf',
    macOpen: ['windsurf', '{path}'],
    winCli: 'windsurf',
    winOpen: ['windsurf', '{path}'],
  },
  {
    id: 'zed',
    name: 'Zed',
    kind: 'ide',
    macAppPaths: ['Zed.app'],
    macCli: 'zed',
    macOpen: ['zed', '{path}'],
    winCli: 'zed',
    winOpen: ['zed', '{path}'],
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    kind: 'ide',
    macAppPaths: ['WebStorm.app'],
    macOpen: ['open', '-a', 'WebStorm', '{path}'],
    winPaths: ['JetBrains/WebStorm'],
    winOpen: ['webstorm64.exe', '{path}'],
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    kind: 'ide',
    macAppPaths: ['Sublime Text.app'],
    macCli: 'subl',
    macOpen: ['subl', '{path}'],
    winCli: 'subl',
    winOpen: ['subl', '{path}'],
  },
  {
    id: 'vim',
    name: 'Vim',
    kind: 'ide',
    macCli: 'vim',
    macOpen: ['vim', '{path}'],
    winCli: 'vim',
    winOpen: ['vim', '{path}'],
  },
  {
    id: 'neovim',
    name: 'Neovim',
    kind: 'ide',
    macCli: 'nvim',
    macOpen: ['nvim', '{path}'],
    winCli: 'nvim',
    winOpen: ['nvim', '{path}'],
  },
  // ─── Terminals ────────────────────────────────────────────────────────
  {
    id: 'iterm2',
    name: 'iTerm2',
    kind: 'terminal',
    macAppPaths: ['iTerm.app'],
    macOpen: ['open', '-a', 'iTerm', '{path}'],
    winOpen: [],
  },
  {
    id: 'terminal-app',
    name: 'Terminal',
    kind: 'terminal',
    macAppPaths: ['Terminal.app'],
    macOpen: ['open', '-a', 'Terminal', '{path}'],
    winOpen: [],
  },
  {
    id: 'warp',
    name: 'Warp',
    kind: 'terminal',
    macAppPaths: ['Warp.app'],
    macOpen: ['open', '-a', 'Warp', '{path}'],
    winOpen: [],
  },
  {
    id: 'alacritty',
    name: 'Alacritty',
    kind: 'terminal',
    macAppPaths: ['Alacritty.app'],
    macCli: 'alacritty',
    macOpen: ['open', '-a', 'Alacritty'],
    winCli: 'alacritty',
    winOpen: ['alacritty'],
  },
  {
    id: 'kitty',
    name: 'Kitty',
    kind: 'terminal',
    macCli: 'kitty',
    macOpen: ['kitty', '--directory', '{path}'],
    winCli: 'kitty',
    winOpen: ['kitty', '--directory', '{path}'],
  },
  {
    id: 'hyper',
    name: 'Hyper',
    kind: 'terminal',
    macAppPaths: ['Hyper.app'],
    macCli: 'hyper',
    macOpen: ['open', '-a', 'Hyper', '{path}'],
    winCli: 'hyper',
    winOpen: ['hyper', '{path}'],
  },
  {
    id: 'tabby',
    name: 'Tabby',
    kind: 'terminal',
    macAppPaths: ['Tabby.app'],
    macOpen: ['open', '-a', 'Tabby', '{path}'],
    winPaths: ['Tabby'],
    winOpen: ['Tabby.exe'],
  },
  {
    id: 'powershell',
    name: 'PowerShell',
    kind: 'terminal',
    macCli: 'pwsh',
    macOpen: ['open', '-a', 'Terminal', '{path}'],
    winCli: 'pwsh',
    winOpen: ['pwsh', '-NoExit', '-Command', 'cd "{path}"'],
  },
  {
    id: 'cmd',
    name: 'Command Prompt',
    kind: 'terminal',
    winCli: 'cmd',
    winOpen: ['cmd', '/K', 'cd /d "{path}"'],
    macCli: 'Terminal',
    macOpen: ['open', '-a', 'Terminal', '{path}'],
  },
  {
    id: 'windows-terminal',
    name: 'Windows Terminal',
    kind: 'terminal',
    winCli: 'wt',
    winOpen: ['wt', '-d', '{path}'],
    macOpen: [],
  },
  {
    id: 'git-bash',
    name: 'Git Bash',
    kind: 'terminal',
    winPaths: ['Git/git-bash.exe'],
    winOpen: ['git-bash.exe', '--cd={path}'],
    macOpen: [],
  },
]

// ─── Detection ───────────────────────────────────────────────────────────────

async function cliExists(command: string): Promise<boolean> {
  try {
    const cmd = isWin ? 'where' : 'which'
    await execFileAsync(cmd, [command], { timeout: 3000 })
    return true
  } catch {
    return false
  }
}

async function macAppExists(appName: string): Promise<boolean> {
  const paths = [
    `/Applications/${appName}`,
    join(homedir(), 'Applications', appName),
  ]
  for (const p of paths) {
    try {
      await access(p, constants.F_OK)
      return true
    } catch {
      // continue
    }
  }
  return false
}

async function winAppExists(pathSuffixes: string[]): Promise<boolean> {
  const bases = [
    process.env['ProgramFiles'] ?? 'C:\\Program Files',
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'),
  ]
  for (const base of bases) {
    for (const suffix of pathSuffixes) {
      try {
        await access(join(base, suffix), constants.F_OK)
        return true
      } catch {
        // continue
      }
    }
  }
  return false
}

async function detectTool(tool: ToolDef): Promise<ExternalToolInfo> {
  let available = false

  if (isMac) {
    if (tool.macCli) {
      available = await cliExists(tool.macCli)
    }
    if (!available && tool.macAppPaths) {
      for (const appPath of tool.macAppPaths) {
        if (await macAppExists(appPath)) {
          available = true
          break
        }
      }
    }
  } else if (isWin) {
    if (tool.winCli) {
      available = await cliExists(tool.winCli)
    }
    if (!available && tool.winPaths) {
      available = await winAppExists(tool.winPaths)
    }
  } else {
    // Linux: try CLI only
    const cli = tool.macCli ?? tool.winCli
    if (cli) {
      available = await cliExists(cli)
    }
  }

  return {
    id: tool.id,
    name: tool.name,
    kind: tool.kind,
    available,
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

let _cachedTools: ExternalToolInfo[] | null = null

export async function detectExternalTools(kind?: ExternalToolKind): Promise<ExternalToolInfo[]> {
  // Re-detect each time to catch newly installed tools
  const filtered = kind ? TOOL_DEFS.filter(t => t.kind === kind) : TOOL_DEFS
  const results = await Promise.all(filtered.map(detectTool))
  _cachedTools = results
  log.info(`Detected ${results.filter(t => t.available).length}/${results.length} external tools`)
  return results
}

export function getToolDef(toolId: string): ToolDef | undefined {
  return TOOL_DEFS.find(t => t.id === toolId)
}

export async function openProjectInTool(toolId: string, rootPath: string): Promise<boolean> {
  const tool = getToolDef(toolId)
  if (!tool) {
    throw new Error(`Unknown tool: ${toolId}`)
  }

  const template = isMac ? (tool.macOpen ?? []) : isWin ? (tool.winOpen ?? []) : (tool.macOpen ?? [])
  if (template.length === 0) {
    throw new Error(`No launch command for tool ${toolId} on platform ${process.platform}`)
  }

  const args = template.map(s => s.replace('{path}', rootPath))
  const command = args[0]
  if (command == null) {
    throw new Error(`Empty launch command for tool ${toolId}`)
  }
  const commandArgs = args.slice(1)

  log.info(`Opening project in ${tool.name}: ${command} ${commandArgs.join(' ')}`)

  if (isMac && command === 'open') {
    if (tool.kind === 'terminal') {
      const appName = tool.macAppPaths?.[0]?.replace('.app', '') ?? tool.name
      const script = `tell application "${appName}"
  activate
end tell
tell application "System Events"
  keystroke "n" using command down
  delay 0.3
  keystroke "cd '${rootPath.replace(/'/g, "'\\''")}'"
  keystroke return
end tell`
      await execFileAsync('osascript', ['-e', script], { timeout: 5000 })
    } else {
      await execFileAsync(command, commandArgs, { timeout: 5000 })
    }
  } else if (isWin && tool.kind === 'terminal') {
    const { spawn } = await import('node:child_process')
    const child = spawn(command, commandArgs, {
      detached: true,
      stdio: 'ignore',
      shell: true,
      cwd: rootPath,
    })
    child.unref()
  } else {
    await execFileAsync(command, commandArgs, { timeout: 5000 })
  }

  return true
}
