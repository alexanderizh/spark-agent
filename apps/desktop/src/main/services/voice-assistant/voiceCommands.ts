/**
 * 语音命令匹配（纯函数）
 *
 * 转写文本先过本地命令匹配，命中则不进入 submitTurn，直接执行会话管理动作。
 * M1 仅开放「新开会话」；M2 扩展「会话列表选择 / 切换工作区」。
 * 命令必须是明确的祈使句，避免与普通对话撞车（如「帮我看看会话列表」不算命令）。
 */

export type VoiceCommand =
  | { kind: 'new-session' }
  | { kind: 'switch-session' }
  | { kind: 'select-session'; index: number | null; name: string | null }
  | { kind: 'switch-workspace'; name: string | null }
  | { kind: 'stop-listening' }

/** 「新开会话」类祈使句（「切换会话」语义属于 M2 的会话选择，不在此拦截） */
const NEW_SESSION_PATTERNS: RegExp[] = [
  /^(新开|新建|开)(一个|个|一条|新的)?(对话|会话|聊天)[吧了。!！?？\s]*$/u,
  /^换(一个|个|新的)?(对话|会话|聊天)[吧了。!！?？\s]*$/u,
  /^(咱们|我们)?(重新)?(开|换)个?(新)?(话题|对话|会话)[吧了。!！?？\s]*$/u,
]

/** 「列出会话」类（M2 生效，M1 先不注册） */
const SWITCH_SESSION_PATTERNS: RegExp[] = [
  /^(列出|看看|显示|切换)(一下)?(最近的)?会话(列表)?[吧了。!！?？\s]*$/u,
  /^会话列表[吧了。!！?？\s]*$/u,
]

/** 「第 N 个 / 选 N」会话选择（仅在挂起选择态时由上层调用） */
const SELECT_INDEX_PATTERN = /^[第选换用]?\s*([0-9一二三四五六七八九十]{1,3})\s*(个|号)?[吧了。!！?？\s]*$/u

/** 「切换到 XX 工作区/项目」（M2 生效） */
const SWITCH_WORKSPACE_PATTERN =
  /^(切换|换|打开|进入)到?(到)?(.{1,40}?)(工作区|项目)[吧了。!！?？\s]*$/u

const STOP_LISTENING_PATTERNS: RegExp[] = [
  /^(取消|算了|不用了|闭嘴|停止|停下|别说了)[吧了。!！?？\s]*$/u,
]

const CHINESE_DIGITS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

function normalizeTranscript(text: string): string {
  // ASR 可能带前后空白与标点；中文数字统一半角处理仅在选择序号场景做
  return text.trim()
}

export function parseVoiceCommand(
  text: string,
  options: { awaitingSessionSelection?: boolean; enableSessionCommands?: boolean } = {},
): VoiceCommand | null {
  const normalized = normalizeTranscript(text)
  if (normalized.length === 0 || normalized.length > 60) return null

  for (const pattern of STOP_LISTENING_PATTERNS) {
    if (pattern.test(normalized)) return { kind: 'stop-listening' }
  }
  for (const pattern of NEW_SESSION_PATTERNS) {
    if (pattern.test(normalized)) return { kind: 'new-session' }
  }
  if (options.awaitingSessionSelection === true) {
    const indexMatch = SELECT_INDEX_PATTERN.exec(normalized)
    if (indexMatch != null) {
      const raw = indexMatch[1] ?? ''
      const numeric = Number.parseInt(raw, 10)
      const index = Number.isFinite(numeric) ? numeric : (CHINESE_DIGITS[raw] ?? null)
      if (index != null && index >= 1 && index <= 50) return { kind: 'select-session', index, name: null }
    }
    // 选择态下说会话名称：短文本且非其他命令 → 按名称匹配
    return { kind: 'select-session', index: null, name: normalized }
  }
  if (options.enableSessionCommands === true) {
    for (const pattern of SWITCH_SESSION_PATTERNS) {
      if (pattern.test(normalized)) return { kind: 'switch-session' }
    }
    const workspaceMatch = SWITCH_WORKSPACE_PATTERN.exec(normalized)
    if (workspaceMatch != null) {
      const name = (workspaceMatch[3] ?? '').trim()
      return { kind: 'switch-workspace', name: name.length > 0 ? name : null }
    }
  }
  return null
}

/** 把会话标题列表念成选择提示文本（M2 挂起选择态用） */
export function buildSessionSelectionSpeech(titles: string[]): string {
  const head = titles
    .slice(0, 5)
    .map((title, index) => `${index + 1}，${title.length > 20 ? `${title.slice(0, 20)}…` : title}`)
    .join('；')
  return `最近的会话有：${head}。请说序号或会话名称。`
}

// ─── M3 语音审批：同意/拒绝口语匹配 ─────────────────────────────────────────

const APPROVAL_ALLOW_PATTERN = /^(同意|允许|可以|批准|是的?|好的?|继续|没问题|同意执行)[吧了。!！?？\s]*$/u
const APPROVAL_DENY_PATTERN = /^(拒绝|不同意|不行|不要|不可以|否|算了|别|拒绝执行)[吧了。!！?？\s]*$/u

/** 语音审批决策匹配：明确祈使才算命中，模糊表述返回 null（追问一次） */
export function parseApprovalDecision(text: string): 'allow' | 'deny' | null {
  const normalized = text.trim()
  if (normalized.length === 0 || normalized.length > 20) return null
  if (APPROVAL_ALLOW_PATTERN.test(normalized)) return 'allow'
  if (APPROVAL_DENY_PATTERN.test(normalized)) return 'deny'
  return null
}

/** 审批请求念读文本（工具名 + 动作 + 风险） */
export function buildApprovalSpeech(toolName: string, action: string, riskLevel: string): string {
  const tool = toolName.length > 30 ? `${toolName.slice(0, 30)}…` : toolName
  const risk =
    riskLevel === 'high' ? '高风险' : riskLevel === 'medium' ? '中风险' : '低风险'
  const act = action.length > 0 && action !== toolName ? `，动作 ${action}` : ''
  return `语音会话需要你的批准：${tool}${act}，${risk}。请说「同意」或「拒绝」。`
}
