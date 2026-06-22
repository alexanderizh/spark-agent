/**
 * ToolIcon — 渲染 IDE / Terminal 工具的图标
 *
 * 优先级：
 *  1) @lobehub/icons 提供的彩色/单色图标（Cursor / Trae / CodeBuddy / Windsurf /
 *     Kiro / Qoder / Amp / Cline / Codex / Devin / Replit / Antigravity /
 *     ClaudeCode / Copilot / GithubCopilot / RooCode / KiloCode / OpenCode 等）
 *  2) 本地 PNG/SVG 资源（VSCode 等 lobe 没有收录的）
 *  3) 本地 inline Icons（WebStorm / IntelliJ / PyCharm / Zed / Sublime /
 *     Vim / Neovim / iTerm2 / Terminal.app / Warp / Alacritty / Kitty / Hyper /
 *     Tabby / PowerShell / WindowsTerminal / GitBash / CMD / Android Studio /
 *     WezTerm / Fish 等）
 *  4) 兜底图标（kind=ide → Code；kind=terminal → Terminal；kind=document → FileText）
 */
import {
  Amp,
  Antigravity,
  ClaudeCode,
  Cline,
  CodeBuddy,
  Codex,
  Copilot,
  Cursor,
  Devin,
  GithubCopilot,
  KiloCode,
  Kiro,
  OpenCode,
  Qoder,
  Replit,
  RooCode,
  Trae,
  Windsurf,
} from '@lobehub/icons'
import type { FC } from 'react'
import { Icons } from '../Icons'

type Size = number

const SIZE = 16

// Lobe Icons props are `{ size?: string | number; className?: string }` with
// `exactOptionalPropertyTypes` — they don't accept `undefined`. We pass an
// empty string by default and let the caller spread additional props if needed.
type LobeIconProps = {
  size?: number | string
  className?: string
}

type IconComp = FC<LobeIconProps>

// ─── Lobe Icons 映射（按 iconHint 优先匹配） ────────────────────────────────

const LOBE_AVATAR_MAP: Record<string, IconComp> = {
  Cursor: Cursor.Avatar as unknown as IconComp,
  Trae: Trae.Avatar as unknown as IconComp,
  CodeBuddy: CodeBuddy.Avatar as unknown as IconComp,
  Windsurf: Windsurf.Avatar as unknown as IconComp,
  Kiro: Kiro.Avatar as unknown as IconComp,
  Qoder: Qoder.Avatar as unknown as IconComp,
  Cline: Cline.Avatar as unknown as IconComp,
  Amp: Amp.Avatar as unknown as IconComp,
  Codex: Codex.Avatar as unknown as IconComp,
  Devin: Devin.Avatar as unknown as IconComp,
  Replit: Replit.Avatar as unknown as IconComp,
  Antigravity: Antigravity.Avatar as unknown as IconComp,
  ClaudeCode: ClaudeCode.Avatar as unknown as IconComp,
  GithubCopilot: GithubCopilot.Avatar as unknown as IconComp,
  Copilot: Copilot.Avatar as unknown as IconComp,
  RooCode: RooCode.Avatar as unknown as IconComp,
  KiloCode: KiloCode.Avatar as unknown as IconComp,
  OpenCode: OpenCode.Avatar as unknown as IconComp,
}

const LOBE_MONO_MAP: Record<string, IconComp> = {
  Cursor: Cursor as unknown as IconComp,
  Trae: Trae as unknown as IconComp,
  CodeBuddy: CodeBuddy as unknown as IconComp,
  Windsurf: Windsurf as unknown as IconComp,
  Kiro: Kiro as unknown as IconComp,
  Qoder: Qoder as unknown as IconComp,
  Cline: Cline as unknown as IconComp,
  Amp: Amp as unknown as IconComp,
  Codex: Codex as unknown as IconComp,
  Devin: Devin as unknown as IconComp,
  Replit: Replit as unknown as IconComp,
  Antigravity: Antigravity as unknown as IconComp,
  ClaudeCode: ClaudeCode as unknown as IconComp,
  GithubCopilot: GithubCopilot as unknown as IconComp,
  Copilot: Copilot as unknown as IconComp,
  RooCode: RooCode as unknown as IconComp,
  KiloCode: KiloCode as unknown as IconComp,
  OpenCode: OpenCode as unknown as IconComp,
}

// ─── 本地资源兜底（VSCode 等 lobe 没有收录的） ─────────────────────────────

const LOCAL_ASSET_MODULES = import.meta.glob<string>('../../assets/tools/*.{svg,png}', {
  eager: true,
  query: '?url',
  import: 'default',
})

/** iconHint -> 文件名（不含后缀，自动匹配 svg/png） */
const LOCAL_ASSET_MAP: Record<string, string> = {
  VSCode: 'vscode',
}

function resolveLocalAsset(name: string): string | null {
  for (const ext of ['svg', 'png']) {
    const key = `../../assets/tools/${name}.${ext}`
    const url = LOCAL_ASSET_MODULES[key]
    if (url) return url
  }
  return null
}

// ─── 本地 inline Icons 兜底映射 ────────────────────────────────────────────

type InlineKey = keyof typeof Icons

const INLINE_FALLBACK: Record<string, InlineKey> = {
  // IDEs (lobe 没有的传统编辑器)
  WebStorm: 'WebStorm',
  IntelliJ: 'IntelliJ',
  PyCharm: 'PyCharm',
  PhpStorm: 'Code',
  GoLand: 'Code',
  RubyMine: 'Code',
  Rider: 'Code',
  CLion: 'Code',
  AndroidStudio: 'Code',
  Zed: 'Zed',
  Sublime: 'Sublime',
  Vim: 'Vim',
  Neovim: 'Neovim',
  // 终端
  ITerm2: 'ITerm2',
  TerminalApp: 'TerminalApp',
  Warp: 'Warp',
  Alacritty: 'Alacritty',
  Kitty: 'Kitty',
  Hyper: 'Hyper',
  Tabby: 'Tabby',
  PowerShell: 'PowerShell',
  WindowsTerminal: 'WindowsTerminal',
  GitBash: 'GitBash',
  CMD: 'CMD',
  Wezterm: 'Terminal',
  Fish: 'Terminal',
  Foot: 'Terminal',
  Contour: 'Terminal',
  Rio: 'Terminal',
  // 文档应用
  WPS: 'FileText',
  Word: 'FileText',
  Excel: 'FileText',
  PowerPoint: 'FileText',
  Office: 'FileText',
}

export type ToolIconProps = {
  /** iconHint（来自 ExternalToolInfo.iconHint） */
  iconHint?: string | undefined
  /** 工具种类，用于兜底 */
  kind?: 'ide' | 'terminal' | 'document' | undefined
  /** 渲染尺寸（默认 16） */
  size?: Size
  /** true 时使用 Lobe 彩色 Avatar（默认 true，彩色更易辨识） */
  color?: boolean
  className?: string | undefined
}

export function ToolIcon({ iconHint, kind, size = SIZE, color = true, className }: ToolIconProps) {
  const cls = className ?? ''
  // 1) Lobe Avatar（彩色）
  if (color && iconHint && LOBE_AVATAR_MAP[iconHint]) {
    const C = LOBE_AVATAR_MAP[iconHint]
    return <C size={size} className={cls} />
  }

  // 2) Lobe Mono（单色）
  if (!color && iconHint && LOBE_MONO_MAP[iconHint]) {
    const C = LOBE_MONO_MAP[iconHint]
    return <C size={size} className={cls} />
  }

  // 3) 本地 PNG/SVG 资源（VSCode 等）
  // 这些资源是"满画布"实拍图标，视觉上比 Lobe 的 24x24 viewBox 图标更"重"，
  // 所以渲染时整体缩两号（×0.75），跟 Lobe 图标的视觉重量对齐。
  if (iconHint && LOCAL_ASSET_MAP[iconHint]) {
    const url = resolveLocalAsset(LOCAL_ASSET_MAP[iconHint])
    if (url) {
      const visualSize = Math.max(10, Math.round(size * 0.75))
      return (
        <img
          src={url}
          alt={iconHint}
          className={cls}
          width={visualSize}
          height={visualSize}
          draggable={false}
          style={{
            width: visualSize,
            height: visualSize,
            objectFit: 'contain',
          }}
        />
      )
    }
  }

  // 4) 本地 inline Icons 兜底
  if (iconHint && INLINE_FALLBACK[iconHint]) {
    const Comp = Icons[INLINE_FALLBACK[iconHint]]
    return <Comp size={size} className={cls} />
  }

  // 5) 最终兜底
  const Fallback =
    kind === 'ide' ? Icons.Code : kind === 'terminal' ? Icons.Terminal : Icons.FileText
  return <Fallback size={size} className={cls} />
}

export default ToolIcon
