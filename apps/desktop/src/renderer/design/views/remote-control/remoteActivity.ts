/**
 * 活动段：把连续的「思考 / 工具调用」收成一条摘要行。
 *
 * 远端一次 turn 常连着十几次 bash，逐条铺开会把正文完全冲散（旧渲染就是这样：
 * 一排等宽描边盒子）。这里对齐桌面端对话区的做法——折叠成一行
 * 「运行了 8 条命令 · 进行了思考」，点开才逐条列出，每条还能单独展开结果。
 *
 * 只做数据整形，不碰渲染，便于单测。
 */
import type { RemoteActivityStep, RemoteTimelineItem } from './remoteEventMerge'

/** 视为「命令行」的工具名（小写比较），摘要文案据此区分命令与普通工具 */
const SHELL_TOOL_NAMES = new Set([
  'bash',
  'shell',
  'sh',
  'zsh',
  'terminal',
  'exec',
  'execute',
  'run_command',
  'runcommand',
  'command',
  'bashcommand',
  'powershell',
  'cmd',
])

export function isShellTool(toolName: string): boolean {
  return SHELL_TOOL_NAMES.has(toolName.trim().toLowerCase())
}

function toStep(item: RemoteTimelineItem): RemoteActivityStep | null {
  if (item.kind === 'thinking') {
    return {
      kind: 'thinking',
      id: item.id,
      seq: item.seq,
      text: item.text,
      streaming: item.streaming,
    }
  }
  if (item.kind === 'tool') {
    return {
      kind: 'tool',
      id: item.id,
      seq: item.seq,
      toolName: item.toolName,
      status: item.status,
      result: item.result,
    }
  }
  return null
}

/**
 * 相邻的 thinking / tool 合并为一段 activity；其余条目原样返回。
 * 顺序不变，活动段取首步的 id 与 seq 作为位置锚点。
 */
export function groupRemoteActivity(items: RemoteTimelineItem[]): RemoteTimelineItem[] {
  const result: RemoteTimelineItem[] = []
  let pending: RemoteActivityStep[] = []

  const flush = () => {
    if (pending.length === 0) return
    const first = pending[0]
    if (first == null) {
      pending = []
      return
    }
    result.push({
      kind: 'activity',
      id: `activity:${first.id}`,
      seq: first.seq,
      steps: pending,
    })
    pending = []
  }

  for (const item of items) {
    const step = toStep(item)
    if (step != null) {
      pending.push(step)
      continue
    }
    flush()
    result.push(item)
  }
  flush()
  return result
}

/** 活动段是否还在进行（有流式思考或运行中的工具） */
export function isActivityRunning(steps: RemoteActivityStep[]): boolean {
  return steps.some((step) =>
    step.kind === 'thinking' ? step.streaming : step.status === 'running',
  )
}

/**
 * 这一段活动是否「真的还在跑」。
 *
 * 只靠 streaming / status 判断会误报：目标端的历史事件里不一定写全 终态，
 * 丢了 tool_result 的工具会永远停在 running，思考分段也没有 isFinal。
 * 已结束的会话因此整屏都是「进行中」。这里加两个硬条件：
 *   - 会话本身还在运行（宿主从 agent_status 得出的 running）；
 *   - 这是时间线上的**最后一段**（后面还有正文/产物，说明这段早就结束了）。
 */
export function isActivityLive(
  steps: RemoteActivityStep[],
  options: { live: boolean; isLast: boolean },
): boolean {
  return options.live && options.isLast && isActivityRunning(steps)
}

/**
 * 会话不再运行时把「仍在进行」的痕迹抹掉：思考不再流式，没拿到结果的工具
 * 由渲染层显示「未完成」而不是永久「执行中」。
 */
export function settleActivitySteps(
  steps: RemoteActivityStep[],
  live: boolean,
): RemoteActivityStep[] {
  if (live) return steps
  return steps.map((step) =>
    step.kind === 'thinking' && step.streaming ? { ...step, streaming: false } : step,
  )
}

/** 活动段内失败的工具数 */
export function countActivityErrors(steps: RemoteActivityStep[]): number {
  return steps.filter((step) => step.kind === 'tool' && step.status === 'error').length
}

/**
 * 摘要文案：按桌面对话区的口径分桶统计，命令与普通工具分开说。
 * 例：`进行了思考 · 运行了 8 条命令`、`调用了 3 个工具`。
 */
export function summarizeActivity(steps: RemoteActivityStep[]): string {
  let thinking = 0
  let commands = 0
  let tools = 0

  for (const step of steps) {
    if (step.kind === 'thinking') {
      thinking += 1
      continue
    }
    if (isShellTool(step.toolName)) commands += 1
    else tools += 1
  }

  const parts = [
    thinking > 0 ? '进行了思考' : '',
    commands > 0 ? `运行了 ${commands} 条命令` : '',
    tools > 0 ? `调用了 ${tools} 个工具` : '',
  ].filter(Boolean)

  return parts.join(' · ') || '活动记录'
}
