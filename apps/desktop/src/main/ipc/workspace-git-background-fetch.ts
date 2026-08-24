import { normalize } from 'node:path'
import { getGitCommandService } from '../services/GitRuntimeService.js'

/** 后台 fetch 节流间隔（毫秒），对齐 VS Code git.autofetch 的默认周期 */
const BACKGROUND_FETCH_INTERVAL_MS = 3 * 60 * 1000

interface BackgroundFetchState {
  fetching: boolean
  lastAttemptAt: number
}

/** 每个仓库根路径一份节流状态；主进程模块级常驻，随轮询懒初始化 */
const backgroundFetchStates = new Map<string, BackgroundFetchState>()

/**
 * git-status 轮询的旁路 fetch。
 *
 * ahead/behind 对比的是本地远端跟踪引用（如 origin/master），该引用只有在
 * `git fetch` 之后才会推进——不 fetch 时远端新提交永远反映不到 behind 计数上。
 * 这里在 status 轮询链路上按仓库节流触发一次 fire-and-forget 的
 * `git fetch --prune`（network 操作自带 GIT_TERMINAL_PROMPT=0 与 60s 超时，
 * 无凭证/断网时快速失败），不阻塞 status 返回；fetch 落库后下一次轮询
 * 自然带上新的 behind 数字。
 */
export function scheduleWorkspaceBackgroundFetch(rootPath: string): void {
  const key = normalize(rootPath)
  const now = Date.now()
  const existing = backgroundFetchStates.get(key)
  if (existing != null) {
    if (existing.fetching || now - existing.lastAttemptAt < BACKGROUND_FETCH_INTERVAL_MS) return
    existing.lastAttemptAt = now
    existing.fetching = true
  } else {
    backgroundFetchStates.set(key, { fetching: true, lastAttemptAt: now })
  }
  void runBackgroundFetch(key)
}

/**
 * 执行一次远端同步：有远端时 `git fetch --prune`。
 * 供节流调度与测试/显式刷新复用；网络失败静默降级，本地状态展示不受影响。
 */
export async function fetchWorkspaceRemotes(rootPath: string): Promise<boolean> {
  const cwd = normalize(rootPath)
  const remotes = await getGitCommandService().execute(['remote'], { cwd })
  if (remotes.stdout.trim().length === 0) return false
  await getGitCommandService().execute(['fetch', '--prune'], { cwd, operation: 'network' })
  return true
}

async function runBackgroundFetch(key: string): Promise<void> {
  const state = backgroundFetchStates.get(key)
  if (state == null) return
  try {
    await fetchWorkspaceRemotes(key)
  } catch {
    // 断网、凭证缺失、超时都属于后台 fetch 的正常降级路径：
    // 引用停留在旧位置，面板继续展示本地视角的 ahead/behind，无需上报。
  } finally {
    state.fetching = false
  }
}
