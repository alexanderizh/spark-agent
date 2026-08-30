import type { UIBlock, UIMessage } from './event-mapper'

const INTERNAL_WORKTREE_PREFIXES = ['.claude/worktrees', '.worktrees', '.spark/worktrees']

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:\//.test(value)
}

export function isNestedAgentWorktreeSummaryPath(
  filePath: string,
  workspaceRootPath: string | null,
): boolean {
  const normalizedPath = normalizePath(filePath)
  const normalizedRoot = workspaceRootPath == null ? '' : normalizePath(workspaceRootPath)
  let relativePath = normalizedPath.replace(/^\.\//, '')

  if (normalizedRoot.length > 0 && isAbsolutePath(normalizedPath)) {
    if (normalizedPath === normalizedRoot) return false
    if (!normalizedPath.startsWith(`${normalizedRoot}/`)) return false
    relativePath = normalizedPath.slice(normalizedRoot.length + 1)
  }

  return INTERNAL_WORKTREE_PREFIXES.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
  )
}

/**
 * 清理旧历史中由全工作区快照/Git fallback 误收集的嵌套 Agent worktree。
 * 新事件由 turn-scoped journal 保证归属；这里不再查询 Git，避免并发会话互相污染。
 * 当会话本身以某个 worktree 为 workspace root 时，合法文件相对该 root 计算，不会被过滤。
 */
export async function sanitizeTurnFileSummaries(
  messages: UIMessage[],
  workspaceRootPath: string | null,
): Promise<UIMessage[]> {
  let mutated = false
  const nextMessages = messages.map((message) => {
    let messageTouched = false
    const nextBlocks = message.blocks.flatMap<UIBlock>((block): UIBlock[] => {
      if (block.kind !== 'turn_file_summary') return [block]

      const files = block.files.filter(
        (file) => !isNestedAgentWorktreeSummaryPath(file.path, workspaceRootPath),
      )
      const generatedGroups = block.generatedGroups?.filter(
        (group) => !isNestedAgentWorktreeSummaryPath(group.directory, workspaceRootPath),
      )
      const filesChanged = files.length !== block.files.length
      const groupsChanged = generatedGroups?.length !== block.generatedGroups?.length
      if (!filesChanged && !groupsChanged) return [block]

      mutated = true
      messageTouched = true
      if (files.length === 0 && (generatedGroups?.length ?? 0) === 0) return []
      return [
        {
          ...block,
          files,
          totalAdds: files.reduce((sum, file) => sum + file.adds, 0),
          totalDels: files.reduce((sum, file) => sum + file.dels, 0),
          ...(generatedGroups != null ? { generatedGroups } : {}),
        },
      ]
    })
    return messageTouched ? { ...message, blocks: nextBlocks } : message
  })

  return mutated ? nextMessages : messages
}
