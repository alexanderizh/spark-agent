import type { UIMessage } from './event-mapper'
import { hydrateTurnFileStats, type TurnFileGitStats } from './turn-file-summary'

/**
 * 过滤 messages 中所有 turn_file_summary 块里被 .gitignore 忽略的文件路径。
 *
 * 调用主进程 `workspace:git-check-ignore`（内部跑 `git check-ignore`）做权威判断。
 * 非 git 仓库 / git 未安装 / IPC 失败 → 跳过对应的过滤或统计兜底（保持向后兼容）。
 *
 * 返回值语义：若没有任何变化，返回原 messages 引用（避免无谓 re-render）；
 * 否则返回浅拷贝（messages 数组浅拷贝，改动的 block 用新对象，其它块引用保持）。
 */
export async function filterTurnSummaryIgnoredPaths(
  messages: UIMessage[],
  workspaceId: string,
): Promise<UIMessage[]> {
  const allPaths: string[] = []
  for (const msg of messages) {
    for (const block of msg.blocks) {
      if (block.kind === 'turn_file_summary') {
        for (const f of block.files) allPaths.push(f.path)
      }
    }
  }
  if (allPaths.length === 0) return messages

  let ignoredPaths: string[]
  try {
    const res = await window.spark.invoke('workspace:git-check-ignore', {
      workspaceId,
      paths: allPaths,
    })
    ignoredPaths = Array.isArray(res?.ignoredPaths) ? res.ignoredPaths : []
  } catch {
    // Ignore filtering is optional; continue so line statistics can still be hydrated.
    ignoredPaths = []
  }

  const ignoredSet = new Set(ignoredPaths)
  let gitStats: TurnFileGitStats[] = []
  try {
    const status = await window.spark.invoke('workspace:git-status', { workspaceId })
    gitStats = Array.isArray(status?.files)
      ? status.files
          .filter((file) => file.staged || file.unstaged || file.untracked)
          .map((file) => ({
            path: file.path,
            additions: file.additions,
            deletions: file.deletions,
          }))
      : []
  } catch {
    // Git status is only a statistics fallback; filtering still works without it.
  }

  let mutated = false
  const nextMessages = messages.map((msg) => {
    let msgTouched = false
    const nextBlocks = msg.blocks.map((block) => {
      if (block.kind !== 'turn_file_summary') return block
      const keptFiles = block.files.filter((f) => !ignoredSet.has(f.path))
      const hydratedFiles = hydrateTurnFileStats(keptFiles, gitStats)
      const filesChanged = keptFiles.length !== block.files.length || hydratedFiles !== keptFiles
      if (!filesChanged) return block
      msgTouched = true
      mutated = true
      const totalAdds = hydratedFiles.reduce((s, f) => s + f.adds, 0)
      const totalDels = hydratedFiles.reduce((s, f) => s + f.dels, 0)
      return {
        ...block,
        files: hydratedFiles,
        totalAdds,
        totalDels,
      }
    })
    return msgTouched ? { ...msg, blocks: nextBlocks } : msg
  })

  return mutated ? nextMessages : messages
}
