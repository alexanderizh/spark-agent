/**
 * 语音命令匹配（纯函数）
 *
 * 转写文本先过本地命令匹配，命中则不进入 submitTurn，直接执行会话管理动作。
 * M1 仅开放「新开会话」；M2 扩展「会话列表选择 / 切换工作区」；
 * M4 扩展「切换模型 / 切换项目 / 切换会话（带名直选）」：各支持列出候选、
 * 按名称选择、按序号选择，并对 ASR 口语化表述做容错（礼貌前缀、量词、全角数字）。
 * 命令必须是明确的祈使句，避免与普通对话撞车（如「帮我看看会话列表」不算命令）。
 */

export type VoiceCommand =
  | { kind: 'new-session' }
  | { kind: 'switch-session'; name: string | null }
  | { kind: 'select-session'; index: number | null; name: string | null }
  | { kind: 'switch-model'; name: string | null }
  | { kind: 'select-model'; index: number | null; name: string | null }
  | { kind: 'switch-workspace'; name: string | null }
  | { kind: 'select-project'; index: number | null; name: string | null }
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
  /^切个(会话|对话)[吧了。!！?？\s]*$/u,
]

/** 礼貌前缀 + 祈使「切换会话」（M4）：比列表语义更窄，避免吞掉「帮我看看会话列表」类普通聊天 */
const POLITE_SWITCH_SESSION_PATTERN = /^(切换|切|换)(一下)?(会话|对话)[吧了。!！?？\s]*$/u

/** 「切换到 XX 会话」（M4 带名直选；未命中候选时上层回落为念列表） */
const SWITCH_SESSION_NAMED_PATTERN = /^(切换|切|换)到?(成|到)?(.{1,40}?)的?会话[吧了。!！?？\s]*$/u

/** 「切换模型」类（M4：无名称时念候选列表） */
const SWITCH_MODEL_PATTERNS: RegExp[] = [
  /^(切换|切|换|用)(一下|下|个|一个)?模型[吧了。!！?？\s]*$/u,
  /^(列出|看看|显示|查)(一下)?(可用的?|所有?)?模型(列表)?[吧了。!！?？\s]*$/u,
  /^模型列表[吧了。!！?？\s]*$/u,
  /^(有哪些|有什么)(可用的?)?模型[吧了。!！?？\s]*$/u,
]

/** 「切换到 XX 模型 / 换成 XX 模型」（M4 带名直选） */
const SWITCH_MODEL_NAMED_PATTERN = /^(切换|切|换|用)到?(成|到)?(.{1,60}?)的?模型[吧了。!！?？\s]*$/u

/**
 * 裸「换成 XX」（M4 口语直选）：仅当 XX 含字母/数字（形如模型 ID）才命中，
 * 「换成表格」这类纯中文目标一律放行走聊天，避免拦截普通对话。
 */
const SWITCH_MODEL_BARE_HUAN_PATTERN = /^换成(.{1,60}?)[吧了。!！?？\s]*$/u

/** 「切换项目」类（M4：无名称时念候选列表；带名直选沿用既有 SWITCH_WORKSPACE_PATTERN） */
const SWITCH_PROJECT_PATTERNS: RegExp[] = [
  /^(切换|切|换)(一下|下|个|一个)?(项目|工作区)[吧了。!！?？\s]*$/u,
  /^(列出|看看|显示|查)(一下)?(所有|全部)?的?(项目|工作区)(列表)?[吧了。!！?？\s]*$/u,
  /^(项目|工作区)列表[吧了。!！?？\s]*$/u,
  /^(有哪些|有什么)(项目|工作区)[吧了。!！?？\s]*$/u,
]

/** 「切换到 XX 工作区/项目」（M2 生效） */
const SWITCH_WORKSPACE_PATTERN =
  /^(切换|换|打开|进入)到?(到)?(.{1,40}?)(工作区|项目)[吧了。!！?？\s]*$/u

/**
 * 礼貌前缀剥离（M4 新意图专用）：「帮我切换模型」→「切换模型」。
 * 只作用于新增切换类意图；M2 既有会话列表语义保持原样
 * （「帮我看看会话列表」不算命令的约定不破坏）。
 */
const POLITENESS_PREFIX_PATTERN = /^(请|麻烦你?|帮我|给我)+/u

/** 量词误捕防护：「切换个会话」的「个」不应成为名称（按无名称的列表语义处理） */
const MEASURE_WORD_NAMES = new Set(['个', '一个', '这个', '那个', '一下'])

const STOP_LISTENING_PATTERNS: RegExp[] = [
  /^(取消|算了|不用了|闭嘴|停止|停下|别说了)[吧了。!！?？\s]*$/u,
]

const CHINESE_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}

function normalizeTranscript(text: string): string {
  // ASR 可能带前后空白与标点；全角数字统一折半角（「第２个」选择序号场景）
  return text
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .trim()
}

/**
 * 从带名直选模式提取目标名称。
 * 返回 undefined 表示模式未命中；null 表示命中但名称无效（量词误捕 → 按列表语义处理）；
 * guard 校验不过同样返回 undefined（该文本放行给其他模式/聊天）。
 */
function extractPatternName(
  pattern: RegExp,
  text: string,
  guard?: RegExp,
): string | null | undefined {
  const match = pattern.exec(text)
  if (match == null) return undefined
  const name = (match[3] ?? match[1] ?? '').trim()
  if (name.length === 0) return null
  if (MEASURE_WORD_NAMES.has(name)) return null
  if (guard != null && !guard.test(name)) return undefined
  return name
}

export function parseVoiceCommand(
  text: string,
  options: {
    awaitingSessionSelection?: boolean
    awaitingModelSelection?: boolean
    awaitingProjectSelection?: boolean
    enableSessionCommands?: boolean
  } = {},
): VoiceCommand | null {
  const normalized = normalizeTranscript(text)
  if (normalized.length === 0 || normalized.length > 60) return null

  for (const pattern of STOP_LISTENING_PATTERNS) {
    if (pattern.test(normalized)) return { kind: 'stop-listening' }
  }
  for (const pattern of NEW_SESSION_PATTERNS) {
    if (pattern.test(normalized)) return { kind: 'new-session' }
  }
  // 三类挂起选择态互斥（同一时刻只挂起一类候选），命中序号/名称即选择
  if (options.awaitingSessionSelection === true) {
    const index = parseSelectionIndex(normalized)
    if (index != null) return { kind: 'select-session', index, name: null }
    // 选择态下说会话名称：短文本且非其他命令 → 按名称匹配
    return { kind: 'select-session', index: null, name: normalized }
  }
  if (options.awaitingModelSelection === true) {
    const index = parseSelectionIndex(normalized)
    if (index != null) return { kind: 'select-model', index, name: null }
    return { kind: 'select-model', index: null, name: normalized }
  }
  if (options.awaitingProjectSelection === true) {
    const index = parseSelectionIndex(normalized)
    if (index != null) return { kind: 'select-project', index, name: null }
    return { kind: 'select-project', index: null, name: normalized }
  }
  if (options.enableSessionCommands === true) {
    // M2 既有会话列表：原始文本匹配（不剥礼貌前缀，维持「帮我看看会话列表」不算命令）
    for (const pattern of SWITCH_SESSION_PATTERNS) {
      if (pattern.test(normalized)) return { kind: 'switch-session', name: null }
    }
    // M4 新意图：剥礼貌前缀后的口语容错（请/帮我/给我/麻烦…）。
    // 会话列表的「看看/列出」类不剥前缀（维持 M2「帮我看看会话列表」不算命令的约定），
    // 仅祈使「切换会话」允许礼貌前缀（「帮我切换会话」→ 念候选列表）。
    const polite = normalizeTranscript(normalized.replace(POLITENESS_PREFIX_PATTERN, ''))
    const subject = polite.length > 0 ? polite : normalized
    if (polite !== normalized && POLITE_SWITCH_SESSION_PATTERN.test(polite)) {
      return { kind: 'switch-session', name: null }
    }
    const sessionName = extractPatternName(SWITCH_SESSION_NAMED_PATTERN, subject)
    if (sessionName !== undefined) return { kind: 'switch-session', name: sessionName }
    for (const pattern of SWITCH_MODEL_PATTERNS) {
      if (pattern.test(subject)) return { kind: 'switch-model', name: null }
    }
    const modelName = extractPatternName(SWITCH_MODEL_NAMED_PATTERN, subject)
    if (modelName !== undefined) return { kind: 'switch-model', name: modelName }
    const bareModelName = extractPatternName(SWITCH_MODEL_BARE_HUAN_PATTERN, subject, /[a-z0-9]/i)
    if (bareModelName !== undefined) return { kind: 'switch-model', name: bareModelName }
    for (const pattern of SWITCH_PROJECT_PATTERNS) {
      if (pattern.test(subject)) return { kind: 'switch-workspace', name: null }
    }
    const workspaceMatch = SWITCH_WORKSPACE_PATTERN.exec(normalized)
    if (workspaceMatch != null) {
      const name = (workspaceMatch[3] ?? '').trim()
      return { kind: 'switch-workspace', name: name.length > 0 ? name : null }
    }
  }
  return null
}

/** 「第 N 个 / 选 N」序号解析（挂起选择态共用；无效返回 null） */
const SELECT_INDEX_PATTERN =
  /^[第选换用]?\s*([0-9一二三四五六七八九十]{1,3})\s*(个|号)?[吧了。!！?？\s]*$/u

function parseSelectionIndex(normalized: string): number | null {
  const indexMatch = SELECT_INDEX_PATTERN.exec(normalized)
  if (indexMatch == null) return null
  const raw = indexMatch[1] ?? ''
  const numeric = Number.parseInt(raw, 10)
  const index = Number.isFinite(numeric) ? numeric : (CHINESE_DIGITS[raw] ?? null)
  if (index != null && index >= 1 && index <= 50) return index
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

/**
 * 候选列表播报（M4 通用，模型/项目挂起选择态用；风格对齐 buildSessionSelectionSpeech）。
 * 念前 5 个并带序号，超长条目截断。
 */
export function buildCandidateSelectionSpeech(kindLabel: string, items: string[]): string {
  const head = items
    .slice(0, 5)
    .map((item, index) => `${index + 1}，${item.length > 20 ? `${item.slice(0, 20)}…` : item}`)
    .join('；')
  return `${kindLabel}有：${head}。请说序号或名称。`
}

/**
 * 按名称匹配候选（双向包含、忽略大小写）：返回命中下标，未命中返回 null。
 * 会话/模型/项目三类选择共用（与 M2 会话名称匹配同一语义）。
 */
export function matchCandidateIndexByName(items: string[], name: string): number | null {
  const needle = name.trim().toLowerCase()
  if (needle.length === 0) return null
  const index = items.findIndex(
    (item) => item.toLowerCase().includes(needle) || needle.includes(item.toLowerCase()),
  )
  return index >= 0 ? index : null
}

// ─── M3 语音审批：同意/拒绝口语匹配 ─────────────────────────────────────────

const APPROVAL_ALLOW_PATTERN =
  /^(同意|允许|可以|批准|是的?|好的?|继续|没问题|同意执行)[吧了。!！?？\s]*$/u
const APPROVAL_DENY_PATTERN =
  /^(拒绝|不同意|不行|不要|不可以|否|算了|别|拒绝执行)[吧了。!！?？\s]*$/u

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
  const risk = riskLevel === 'high' ? '高风险' : riskLevel === 'medium' ? '中风险' : '低风险'
  const act = action.length > 0 && action !== toolName ? `，动作 ${action}` : ''
  return `语音会话需要你的批准：${tool}${act}，${risk}。请说「同意」或「拒绝」。`
}
