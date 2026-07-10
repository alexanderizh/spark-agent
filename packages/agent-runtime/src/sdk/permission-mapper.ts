/**
 * Maps Spark permission modes ↔ Claude Agent SDK permission modes.
 *
 * Spark has 8 permission modes (claude-* and codex-*).
 * The Claude Agent SDK supports: default, acceptEdits, bypassPermissions, plan, dontAsk, auto.
 *
 * This module converts between the two systems and also builds the
 * allowedTools / disallowedTools arrays the SDK expects.
 */

import type { SparkPermissionMode, SDKPermissionMode } from './types.js'
import { toClaudeReasoningEffort, type SparkReasoningEffort } from './reasoning-effort.js'

export interface SDKPermissionConfig {
  permissionMode: SDKPermissionMode
  allowedTools: string[]
  disallowedTools: string[]
}

const ALWAYS_DENIED_PATTERNS = [
  'Bash(rm -rf /:*)',
  'Bash(:(){ :|:& };::*)',
  'Bash(mkfs:*)',
  'Bash(dd if=/dev/zero:*)',
  // The Claude Code preset registers a built-in `Skill` tool that loads
  // Anthropic-shipped skills from disk. Spark ships its OWN skill system —
  // selected skills are inlined into the system prompt directly. If the LLM
  // calls Skill('builtin:browser-automation') it dispatches to the preset's
  // registry which doesn't know our ids and returns "Unknown skill: ...".
  // Deny outright so the agent never wastes a turn on that dead-end.
  'Skill',
]

// NOTE: claude-plan 不再额外硬禁 Write/Edit/Bash 等工具。
// 新版 Claude Code CLI（0.3.x）的计划模式协议要求 agent 先把计划写到
// ~/.claude/plans/*.md（或项目 .claude/plans/）再调用 ExitPlanMode——把 Write
// 放进 disallowedTools 会连计划文件一起硬拒，导致计划永远产不出来。
// 只读 enforcement 由 SDK 原生 permissionMode:'plan' 接管（CLI 内部只放行
// 计划文件写入，其余变更全部拒绝）；canUseTool 再做一道非计划文件的兜底拦截。
export function mapPermissionMode(sparkMode: SparkPermissionMode): SDKPermissionConfig {
  switch (sparkMode) {
    case 'claude-plan':
      return {
        permissionMode: 'plan',
        allowedTools: [],
        disallowedTools: ALWAYS_DENIED_PATTERNS,
      }

    case 'claude-ask':
    case 'codex-default':
      return {
        permissionMode: 'default',
        allowedTools: [],
        disallowedTools: ALWAYS_DENIED_PATTERNS,
      }

    case 'claude-auto-edits':
    case 'codex-auto-review':
      return {
        permissionMode: 'acceptEdits',
        allowedTools: [],
        disallowedTools: ALWAYS_DENIED_PATTERNS,
      }

    case 'claude-auto':
      return {
        permissionMode: 'auto',
        allowedTools: [],
        disallowedTools: ALWAYS_DENIED_PATTERNS,
      }

    case 'claude-bypass':
    case 'codex-full-access':
      return {
        permissionMode: 'bypassPermissions',
        allowedTools: [],
        disallowedTools: ALWAYS_DENIED_PATTERNS,
      }

    default:
      return {
        permissionMode: 'default',
        allowedTools: [],
        disallowedTools: ALWAYS_DENIED_PATTERNS,
      }
  }
}

export function mergeToolPermissions(
  base: SDKPermissionConfig,
  extraAllowed?: string[],
  extraDisallowed?: string[],
): SDKPermissionConfig {
  const allowed = base.allowedTools.slice()
  const disallowed = base.disallowedTools.slice()

  if (extraAllowed) {
    for (const tool of extraAllowed) {
      if (!allowed.includes(tool)) allowed.push(tool)
    }
  }
  if (extraDisallowed) {
    for (const tool of extraDisallowed) {
      if (!disallowed.includes(tool)) disallowed.push(tool)
    }
  }

  return { ...base, allowedTools: allowed, disallowedTools: disallowed }
}

/**
 * Map Spark reasoning effort levels to Claude SDK effort levels.
 */
export function mapReasoningEffort(
  effort?: SparkReasoningEffort,
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined {
  return toClaudeReasoningEffort(effort)
}
