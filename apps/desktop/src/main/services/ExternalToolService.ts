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
  /** Icon hint for UI (maps to Icons component name) */
  iconHint?: string
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
    iconHint: 'VSCode',
    macAppPaths: ['Visual Studio Code.app'],
    macCli: 'code',
    macOpen: ['code', '{path}'],
    winPaths: [
      'Microsoft VS Code/Code.exe',
      'VSCode/bin/code.cmd',
      'Programs/Microsoft VS Code/Code.exe',
    ],
    winCli: 'code',
    winOpen: ['code', '{path}'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    kind: 'ide',
    iconHint: 'Cursor',
    macAppPaths: ['Cursor.app'],
    macCli: 'cursor',
    macOpen: ['cursor', '{path}'],
    winPaths: ['Cursor/Cursor.exe', 'Programs/Cursor/Cursor.exe', 'App/Cursor/Cursor.exe'],
    winCli: 'cursor',
    winOpen: ['cursor', '{path}'],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    kind: 'ide',
    iconHint: 'Windsurf',
    macAppPaths: ['Windsurf.app'],
    macCli: 'windsurf',
    macOpen: ['windsurf', '{path}'],
    winPaths: ['Windsurf/Windsurf.exe', 'Programs/Windsurf/Windsurf.exe'],
    winCli: 'windsurf',
    winOpen: ['windsurf', '{path}'],
  },
  {
    id: 'trae',
    name: 'Trae',
    kind: 'ide',
    iconHint: 'Trae',
    macAppPaths: ['Trae.app'],
    macCli: 'trae',
    macOpen: ['trae', '{path}'],
    winPaths: ['Trae/Trae.exe', 'Programs/Trae/Trae.exe', 'ByteDance/Trae/Trae.exe'],
    winCli: 'trae',
    winOpen: ['trae', '{path}'],
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    kind: 'ide',
    iconHint: 'CodeBuddy',
    macAppPaths: ['CodeBuddy.app'],
    macCli: 'codebuddy',
    macOpen: ['codebuddy', '{path}'],
    winPaths: [
      'CodeBuddy/CodeBuddy.exe',
      'Programs/CodeBuddy/CodeBuddy.exe',
      'Tencent/CodeBuddy/CodeBuddy.exe',
    ],
    winCli: 'codebuddy',
    winOpen: ['codebuddy', '{path}'],
  },
  {
    id: 'kiro',
    name: 'Kiro',
    kind: 'ide',
    iconHint: 'Kiro',
    macAppPaths: ['Kiro.app'],
    macCli: 'kiro',
    macOpen: ['kiro', '{path}'],
    winPaths: ['Kiro/Kiro.exe', 'Programs/Kiro/Kiro.exe', 'Amazon/Kiro/Kiro.exe'],
    winCli: 'kiro',
    winOpen: ['kiro', '{path}'],
  },
  {
    id: 'qoder',
    name: 'Qoder',
    kind: 'ide',
    iconHint: 'Qoder',
    macAppPaths: ['Qoder.app'],
    macCli: 'qoder',
    macOpen: ['qoder', '{path}'],
    winPaths: ['Qoder/Qoder.exe', 'Programs/Qoder/Qoder.exe'],
    winCli: 'qoder',
    winOpen: ['qoder', '{path}'],
  },
  {
    id: 'zed',
    name: 'Zed',
    kind: 'ide',
    iconHint: 'Zed',
    macAppPaths: ['Zed.app'],
    macCli: 'zed',
    macOpen: ['zed', '{path}'],
    winPaths: ['Zed/zed.exe', 'Programs/Zed/zed.exe'],
    winCli: 'zed',
    winOpen: ['zed', '{path}'],
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    kind: 'ide',
    iconHint: 'WebStorm',
    macAppPaths: ['WebStorm.app', 'JetBrains Toolbox/WebStorm.app'],
    macOpen: ['open', '-a', 'WebStorm', '{path}'],
    winPaths: [
      'JetBrains/WebStorm',
      'JetBrains/Toolbox/apps/WebStorm',
      'Programs/JetBrains/WebStorm',
    ],
    winOpen: ['webstorm64.exe', '{path}'],
  },
  {
    id: 'intellij',
    name: 'IntelliJ IDEA',
    kind: 'ide',
    iconHint: 'IntelliJ',
    macAppPaths: [
      'IntelliJ IDEA.app',
      'IntelliJ IDEA CE.app',
      'JetBrains Toolbox/IntelliJ IDEA.app',
    ],
    macOpen: ['open', '-a', 'IntelliJ IDEA', '{path}'],
    winPaths: [
      'JetBrains/IntelliJ IDEA',
      'JetBrains/IntelliJ IDEA Community Edition',
      'JetBrains/Toolbox/apps/IntelliJ IDEA',
    ],
    winOpen: ['idea64.exe', '{path}'],
  },
  {
    id: 'pycharm',
    name: 'PyCharm',
    kind: 'ide',
    iconHint: 'PyCharm',
    macAppPaths: ['PyCharm.app', 'PyCharm CE.app', 'JetBrains Toolbox/PyCharm.app'],
    macOpen: ['open', '-a', 'PyCharm', '{path}'],
    winPaths: [
      'JetBrains/PyCharm',
      'JetBrains/PyCharm Community Edition',
      'JetBrains/Toolbox/apps/PyCharm',
    ],
    winOpen: ['pycharm64.exe', '{path}'],
  },
  {
    id: 'phpstorm',
    name: 'PhpStorm',
    kind: 'ide',
    iconHint: 'PhpStorm',
    macAppPaths: ['PhpStorm.app', 'JetBrains Toolbox/PhpStorm.app'],
    macOpen: ['open', '-a', 'PhpStorm', '{path}'],
    winPaths: ['JetBrains/PhpStorm', 'JetBrains/Toolbox/apps/PhpStorm'],
    winOpen: ['phpstorm64.exe', '{path}'],
  },
  {
    id: 'goland',
    name: 'GoLand',
    kind: 'ide',
    iconHint: 'GoLand',
    macAppPaths: ['GoLand.app', 'JetBrains Toolbox/GoLand.app'],
    macOpen: ['open', '-a', 'GoLand', '{path}'],
    winPaths: ['JetBrains/GoLand', 'JetBrains/Toolbox/apps/GoLand'],
    winOpen: ['goland64.exe', '{path}'],
  },
  {
    id: 'rubymine',
    name: 'RubyMine',
    kind: 'ide',
    iconHint: 'RubyMine',
    macAppPaths: ['RubyMine.app', 'JetBrains Toolbox/RubyMine.app'],
    macOpen: ['open', '-a', 'RubyMine', '{path}'],
    winPaths: ['JetBrains/RubyMine', 'JetBrains/Toolbox/apps/RubyMine'],
    winOpen: ['rubymine64.exe', '{path}'],
  },
  {
    id: 'rider',
    name: 'Rider',
    kind: 'ide',
    iconHint: 'Rider',
    macAppPaths: ['Rider.app', 'JetBrains Toolbox/Rider.app'],
    macOpen: ['open', '-a', 'Rider', '{path}'],
    winPaths: ['JetBrains/Rider', 'JetBrains/Toolbox/apps/Rider'],
    winOpen: ['rider64.exe', '{path}'],
  },
  {
    id: 'clion',
    name: 'CLion',
    kind: 'ide',
    iconHint: 'CLion',
    macAppPaths: ['CLion.app', 'JetBrains Toolbox/CLion.app'],
    macOpen: ['open', '-a', 'CLion', '{path}'],
    winPaths: ['JetBrains/CLion', 'JetBrains/Toolbox/apps/CLion'],
    winOpen: ['clion64.exe', '{path}'],
  },
  {
    id: 'androidstudio',
    name: 'Android Studio',
    kind: 'ide',
    iconHint: 'AndroidStudio',
    macAppPaths: ['Android Studio.app', 'JetBrains Toolbox/Android Studio.app'],
    macOpen: ['open', '-a', 'Android Studio', '{path}'],
    winPaths: [
      'JetBrains/Android Studio',
      'Android/Android Studio/studio64.exe',
      'JetBrains/Toolbox/apps/Android Studio',
    ],
    winOpen: ['studio64.exe', '{path}'],
    winCli: 'studio',
    macCli: 'studio',
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    kind: 'ide',
    iconHint: 'Sublime',
    macAppPaths: ['Sublime Text.app', 'Sublime Text 4.app'],
    macCli: 'subl',
    macOpen: ['subl', '{path}'],
    winPaths: ['Sublime Text/subl.exe', 'Sublime Text 3/subl.exe', 'Sublime Text 4/subl.exe'],
    winCli: 'subl',
    winOpen: ['subl', '{path}'],
  },
  {
    id: 'vim',
    name: 'Vim',
    kind: 'ide',
    iconHint: 'Vim',
    macCli: 'vim',
    macOpen: ['vim', '{path}'],
    winPaths: ['Vim/vim90/vim.exe', 'Git/usr/bin/vim.exe'],
    winCli: 'vim',
    winOpen: ['vim', '{path}'],
  },
  {
    id: 'neovim',
    name: 'Neovim',
    kind: 'ide',
    iconHint: 'Neovim',
    macCli: 'nvim',
    macOpen: ['nvim', '{path}'],
    winPaths: ['Neovim/bin/nvim.exe'],
    winCli: 'nvim',
    winOpen: ['nvim', '{path}'],
  },
  // ─── Document apps ───────────────────────────────────────────────────
  {
    id: 'wps-office',
    name: 'WPS Office',
    kind: 'document',
    iconHint: 'WPS',
    macAppPaths: ['WPS Office.app', 'WPS Office 2019.app'],
    macOpen: ['open', '-a', 'WPS Office', '{path}'],
    winPaths: [
      'Kingsoft/WPS Office/office6/wps.exe',
      'Kingsoft/WPS Office/office6/et.exe',
      'Kingsoft/WPS Office/office6/wpp.exe',
      'Programs/Kingsoft/WPS Office/office6/wps.exe',
    ],
    winOpen: ['wps.exe', '{path}'],
  },
  {
    id: 'microsoft-word',
    name: 'Microsoft Word',
    kind: 'document',
    iconHint: 'Word',
    macAppPaths: ['Microsoft Word.app'],
    macOpen: ['open', '-a', 'Microsoft Word', '{path}'],
    winPaths: [
      'Microsoft Office/root/Office16/WINWORD.EXE',
      'Microsoft Office/Office16/WINWORD.EXE',
      'Microsoft Office/Office15/WINWORD.EXE',
    ],
    winOpen: ['WINWORD.EXE', '{path}'],
  },
  {
    id: 'microsoft-excel',
    name: 'Microsoft Excel',
    kind: 'document',
    iconHint: 'Excel',
    macAppPaths: ['Microsoft Excel.app'],
    macOpen: ['open', '-a', 'Microsoft Excel', '{path}'],
    winPaths: [
      'Microsoft Office/root/Office16/EXCEL.EXE',
      'Microsoft Office/Office16/EXCEL.EXE',
      'Microsoft Office/Office15/EXCEL.EXE',
    ],
    winOpen: ['EXCEL.EXE', '{path}'],
  },
  {
    id: 'microsoft-powerpoint',
    name: 'Microsoft PowerPoint',
    kind: 'document',
    iconHint: 'PowerPoint',
    macAppPaths: ['Microsoft PowerPoint.app'],
    macOpen: ['open', '-a', 'Microsoft PowerPoint', '{path}'],
    winPaths: [
      'Microsoft Office/root/Office16/POWERPNT.EXE',
      'Microsoft Office/Office16/POWERPNT.EXE',
      'Microsoft Office/Office15/POWERPNT.EXE',
    ],
    winOpen: ['POWERPNT.EXE', '{path}'],
  },
  {
    id: 'microsoft-office',
    name: 'Microsoft Office',
    kind: 'document',
    iconHint: 'Office',
    macAppPaths: ['Microsoft Word.app', 'Microsoft Excel.app', 'Microsoft PowerPoint.app'],
    macOpen: ['open', '{path}'],
    winPaths: [
      'Microsoft Office/root/Office16/WINWORD.EXE',
      'Microsoft Office/root/Office16/EXCEL.EXE',
      'Microsoft Office/root/Office16/POWERPNT.EXE',
    ],
    winOpen: ['start', '""', '{path}'],
  },
  // ─── Terminals ────────────────────────────────────────────────────────
  {
    id: 'iterm2',
    name: 'iTerm2',
    kind: 'terminal',
    iconHint: 'ITerm2',
    macAppPaths: ['iTerm.app', 'iTerm2.app'],
    macOpen: ['open', '-a', 'iTerm', '{path}'],
    winOpen: [],
  },
  {
    id: 'terminal-app',
    name: 'Terminal',
    kind: 'terminal',
    iconHint: 'TerminalApp',
    macAppPaths: ['Terminal.app'],
    macOpen: ['open', '-a', 'Terminal', '{path}'],
    winOpen: [],
  },
  {
    id: 'warp',
    name: 'Warp',
    kind: 'terminal',
    iconHint: 'Warp',
    macAppPaths: ['Warp.app'],
    macOpen: ['open', '-a', 'Warp', '{path}'],
    winPaths: ['Warp/Warp.exe', 'Programs/Warp/Warp.exe'],
    winOpen: ['warp', '{path}'],
  },
  {
    id: 'ghostty',
    name: 'Ghostty',
    kind: 'terminal',
    macAppPaths: ['Ghostty.app'],
    macCli: 'ghostty',
    macOpen: ['open', '-a', 'Ghostty', '{path}'],
    winOpen: [],
  },
  {
    id: 'alacritty',
    name: 'Alacritty',
    kind: 'terminal',
    iconHint: 'Alacritty',
    macAppPaths: ['Alacritty.app'],
    macCli: 'alacritty',
    macOpen: ['open', '-a', 'Alacritty'],
    winPaths: ['Alacritty/alacritty.exe'],
    winCli: 'alacritty',
    winOpen: ['alacritty'],
  },
  {
    id: 'kitty',
    name: 'Kitty',
    kind: 'terminal',
    iconHint: 'Kitty',
    macCli: 'kitty',
    macOpen: ['kitty', '--directory', '{path}'],
    winPaths: ['kitty/kitty.exe'],
    winCli: 'kitty',
    winOpen: ['kitty', '--directory', '{path}'],
  },
  {
    id: 'hyper',
    name: 'Hyper',
    kind: 'terminal',
    iconHint: 'Hyper',
    macAppPaths: ['Hyper.app'],
    macCli: 'hyper',
    macOpen: ['open', '-a', 'Hyper', '{path}'],
    winPaths: ['Hyper/Hyper.exe', 'Programs/Hyper/Hyper.exe'],
    winCli: 'hyper',
    winOpen: ['hyper', '{path}'],
  },
  {
    id: 'tabby',
    name: 'Tabby',
    kind: 'terminal',
    iconHint: 'Tabby',
    macAppPaths: ['Tabby.app'],
    macOpen: ['open', '-a', 'Tabby', '{path}'],
    winPaths: ['Tabby/Tabby.exe', 'Programs/Tabby/Tabby.exe'],
    winOpen: ['Tabby.exe'],
  },
  {
    id: 'powershell',
    name: 'PowerShell',
    kind: 'terminal',
    iconHint: 'PowerShell',
    macCli: 'pwsh',
    macOpen: ['open', '-a', 'Terminal', '{path}'],
    winCli: 'pwsh',
    winPaths: ['PowerShell/7/pwsh.exe', 'WindowsPowerShell/v1.0/powershell.exe'],
    winOpen: ['pwsh', '-NoExit', '-Command', 'cd "{path}"'],
  },
  {
    id: 'cmd',
    name: 'Command Prompt',
    kind: 'terminal',
    iconHint: 'CMD',
    winCli: 'cmd',
    winOpen: ['cmd', '/K', 'cd /d "{path}"'],
    macCli: 'Terminal',
    macOpen: ['open', '-a', 'Terminal', '{path}'],
  },
  {
    id: 'windows-terminal',
    name: 'Windows Terminal',
    kind: 'terminal',
    iconHint: 'WindowsTerminal',
    winCli: 'wt',
    winPaths: ['WindowsApps/Microsoft.WindowsTerminal_8wekyb3d8bbwe/wt.exe'],
    winOpen: ['wt', '-d', '{path}'],
    macOpen: [],
  },
  {
    id: 'git-bash',
    name: 'Git Bash',
    kind: 'terminal',
    iconHint: 'GitBash',
    winPaths: ['Git/git-bash.exe', 'Git/bin/bash.exe', 'Programs/Git/git-bash.exe'],
    winOpen: ['git-bash.exe', '--cd={path}'],
    macOpen: [],
  },
  {
    id: 'fluentterminal',
    name: 'FluentTerminal',
    kind: 'terminal',
    iconHint: 'Terminal',
    winPaths: ['FluentTerminal/FluentTerminal.exe'],
    winOpen: ['fluentterminal.exe', '{path}'],
    macOpen: [],
  },
  {
    id: 'terminus',
    name: 'Terminus',
    kind: 'terminal',
    iconHint: 'Terminal',
    macAppPaths: ['Terminus.app'],
    macOpen: ['open', '-a', 'Terminus', '{path}'],
    winPaths: ['Terminus/Terminus.exe'],
    winOpen: ['terminus.exe', '{path}'],
  },
  {
    id: 'moba-xterm',
    name: 'MobaXterm',
    kind: 'terminal',
    iconHint: 'Terminal',
    winPaths: ['Mobatek/MobaXterm/MobaXterm.exe'],
    winOpen: ['MobaXterm.exe', '{path}'],
    macOpen: [],
  },
  {
    id: 'conemu',
    name: 'ConEmu',
    kind: 'terminal',
    iconHint: 'CMD',
    winPaths: ['ConEmu/ConEmu64.exe', 'ConEmu/ConEmu.exe'],
    winOpen: ['ConEmu64.exe', '-dir', '{path}'],
    macOpen: [],
  },
  {
    id: 'wezterm',
    name: 'WezTerm',
    kind: 'terminal',
    iconHint: 'Wezterm',
    macAppPaths: ['WezTerm.app'],
    macCli: 'wezterm',
    macOpen: ['open', '-a', 'WezTerm'],
    winCli: 'wezterm',
    winPaths: ['wezterm/wezterm.exe', 'Programs/wezterm/wezterm.exe'],
    winOpen: ['wezterm.exe', 'start', '--cwd', '{path}'],
  },
  {
    id: 'fish',
    name: 'Fish Shell',
    kind: 'terminal',
    iconHint: 'Fish',
    macCli: 'fish',
    macOpen: ['open', '-a', 'Terminal', '{path}'],
    winCli: 'fish',
    winPaths: [
      'Fish/fish.exe',
      'Programs/Fish/fish.exe',
      'msys64/usr/bin/fish.exe',
      'Git/usr/bin/fish.exe',
    ],
    winOpen: ['fish.exe'],
  },
  {
    id: 'foot',
    name: 'Foot',
    kind: 'terminal',
    iconHint: 'Foot',
    macCli: 'foot',
    winCli: 'foot',
    macOpen: ['foot', '--working-directory={path}'],
    winPaths: ['foot/foot.exe'],
    winOpen: ['foot.exe', '--working-directory={path}'],
  },
  {
    id: 'contour',
    name: 'Contour',
    kind: 'terminal',
    iconHint: 'Contour',
    macCli: 'contour',
    winCli: 'contour',
    macOpen: ['contour', '{path}'],
    winPaths: ['Contour/contour.exe'],
    winOpen: ['contour.exe', '{path}'],
  },
  {
    id: 'rio',
    name: 'Rio',
    kind: 'terminal',
    iconHint: 'Rio',
    macAppPaths: ['Rio.app'],
    macCli: 'rio',
    macOpen: ['open', '-a', 'Rio', '{path}'],
    winCli: 'rio',
    winPaths: ['Rio/rio.exe', 'Programs/Rio/rio.exe'],
    winOpen: ['rio.exe', '{path}'],
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
  const normalizedName = appName.endsWith('.app') ? appName : `${appName}.app`
  const paths = [
    `/Applications/${normalizedName}`,
    join(homedir(), 'Applications', normalizedName),
    `/System/Applications/${normalizedName}`,
    `/System/Applications/Utilities/${normalizedName}`,
  ]
  for (const p of paths) {
    try {
      await access(p, constants.F_OK)
      return true
    } catch {
      // continue
    }
  }
  try {
    const { stdout } = await execFileAsync(
      'mdfind',
      [
        `kMDItemContentType == "com.apple.application-bundle" && kMDItemFSName == "${normalizedName}"`,
      ],
      { timeout: 3000 },
    )
    return stdout.trim().length > 0
  } catch {
    // Spotlight may be unavailable or still indexing; path probes above remain the primary signal.
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
    // Windows: first try CLI, then try multiple path locations
    if (tool.winCli) {
      available = await cliExists(tool.winCli)
    }
    if (!available && tool.winPaths) {
      available = await winAppExists(tool.winPaths)
    }
    // Also check common LocalAppData locations for Electron-based apps
    if (!available) {
      const localAppData = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
      const electronPaths = [join(localAppData, 'Programs'), join(localAppData, 'App')]
      for (const basePath of electronPaths) {
        if (tool.winPaths) {
          for (const suffix of tool.winPaths) {
            try {
              await access(join(basePath, suffix), constants.F_OK)
              available = true
              break
            } catch {
              // continue
            }
          }
        }
        if (available) break
      }
    }
  } else {
    // Linux: try CLI only
    const cli = tool.macCli ?? tool.winCli
    if (cli) {
      available = await cliExists(cli)
    }
  }

  const result: ExternalToolInfo = {
    id: tool.id,
    name: tool.name,
    kind: tool.kind,
    available,
  }
  if (tool.iconHint) {
    result.iconHint = tool.iconHint
  }
  return result
}

// ─── Public API ──────────────────────────────────────────────────────────────

let _cachedTools: ExternalToolInfo[] | null = null

export async function detectExternalTools(kind?: ExternalToolKind): Promise<ExternalToolInfo[]> {
  // Re-detect each time to catch newly installed tools
  const filtered = kind ? TOOL_DEFS.filter((t) => t.kind === kind) : TOOL_DEFS
  const results = await Promise.all(filtered.map(detectTool))
  _cachedTools = results
  log.info(`Detected ${results.filter((t) => t.available).length}/${results.length} external tools`)
  return results
}

export function getToolDef(toolId: string): ToolDef | undefined {
  return TOOL_DEFS.find((t) => t.id === toolId)
}

/**
 * Escape a path for Windows command line.
 * - If the path contains spaces or special chars, wrap it in double quotes
 * - Escape existing double quotes and backslashes properly
 */
function escapeWinPath(path: string): string {
  if (!path.includes(' ') && !path.includes('"') && !path.includes('&') && !path.includes('|')) {
    return path
  }
  // Escape backslashes and double quotes for Windows shell
  const escaped = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}

export async function openProjectInTool(toolId: string, rootPath: string): Promise<boolean> {
  const tool = getToolDef(toolId)
  if (!tool) {
    throw new Error(`Unknown tool: ${toolId}`)
  }

  const template = isMac
    ? (tool.macOpen ?? [])
    : isWin
      ? (tool.winOpen ?? [])
      : (tool.macOpen ?? [])
  if (template.length === 0) {
    throw new Error(`No launch command for tool ${toolId} on platform ${process.platform}`)
  }

  // On Windows, properly escape the path for shell commands
  const escapedPath = isWin ? escapeWinPath(rootPath) : rootPath
  const args = template.map((s) => s.replace('{path}', escapedPath))
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
    // Build the full command string for shell execution
    const fullCommand = [command, ...commandArgs].join(' ')
    const child = spawn(fullCommand, [], {
      detached: true,
      stdio: 'ignore',
      shell: true,
      cwd: rootPath,
    })
    child.unref()
  } else if (isWin) {
    // For Windows IDEs, use shell to ensure CLI commands like 'code' work
    const { spawn } = await import('node:child_process')
    const fullCommand = [command, ...commandArgs].join(' ')
    const child = spawn(fullCommand, [], {
      detached: true,
      stdio: 'ignore',
      shell: true,
    })
    child.unref()
  } else {
    await execFileAsync(command, commandArgs, { timeout: 5000 })
  }

  return true
}
