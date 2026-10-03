/**
 * speechify — markdown → 可朗读文本 + 流式句切分（纯函数，便于单测）
 *
 * 语音播报不能直接念 markdown 源码。这里做两层处理：
 *
 * 1. speechifyText(text, maxChars?)：整段清洗（用于最终全文兜底）
 *    - 代码块 / 表格 → 「（代码已省略，请在应用中查看）」等占位
 *    - 链接保留文字剥语法；裸 URL 移除
 *    - 标题/列表/引用标记剥除
 *    - 超长文本截断 + 「完整内容请在应用中查看」（maxChars 可调，默认 800）
 *
 * 2. SentenceSplitter：面向 TTS 逐句流水线的增量切分器
 *    - delta 到达时喂入，遇到句末边界（。！？；\n 与英文 .?! 后接空白）即出句
 *    - 代码块围栏感知：``` 之间的内容不朗读，整块替换为一句省略提示
 *    - 每句经行内 markdown 清洗（剥 `**`、链接语法等）后返回
 *
 * 设计约束：切分器只做「尽快出句」的乐观清洗；isFinal 后调用方应以全文
 * speechifyText 的结果作为权威文本（用于会话展示），已朗读句子不做撤回。
 *
 * 纯函数、零依赖：语音助手主进程（流式播报）与渲染端（消息语音播报按钮）共用。
 */

/** 单句最短字符数（含句末标点；低于此长度并入下一句，避免「好。」「嗯。」碎片化触发 TTS） */
const MIN_SENTENCE_CHARS = 6
/** 最短句长保护的强制放行：连续等待超过该边界数仍未达标则出句（防极端碎句无限合并） */
const MAX_SHORT_SENTENCE_WAITS = 2
/** 最短句长保护的总长兜底：pending 达该长度强制出句 */
const MIN_GUARD_FORCE_FLUSH_CHARS = 60
/** 长句软切阈值：无句末边界累计超过该长度时在最近的逗号/顿号处切 */
const SOFT_CUT_CHARS = 80
/** 长句硬切阈值：无任何边界超过该长度强制切（对齐 TTS 单句合成时长上限） */
const HARD_CUT_CHARS = 120
/** 软切可用的次级边界字符（逗号/顿号/冒号/分号——软切断点） */
const SOFT_CUT_BOUNDARY_CHARS = '，、；;:'

/** speechify 整段清洗后的默认最大朗读长度；超出截断并提示 */
const MAX_SPEAKABLE_CHARS = 800

const CODE_BLOCK_PLACEHOLDER = '（代码已省略，请在应用中查看）'
const TABLE_PLACEHOLDER = '（表格已省略，请在应用中查看）'
const IMAGE_PLACEHOLDER = '（图片）'
const TRUNCATION_SUFFIX = '。内容较长，完整回复请在应用中查看'

/** 行内 markdown 清洗：保留可朗读的文字，剥除语法标记 */
export function cleanInlineMarkdown(text: string): string {
  let out = text
  // 行内代码 `x` / 双反引号 → 内容保留（念得出）
  out = out.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1/g, '$2')
  // 图片 ![alt](url) → （图片）或 alt
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) =>
    alt.trim().length > 0 ? alt.trim() : IMAGE_PLACEHOLDER,
  )
  // 链接 [text](url) → text（空文本链接整体移除）
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  // 粗斜体标记
  out = out.replace(/(\*{1,3})([^*]+)\1/g, '$2')
  out = out.replace(/(^|\s)_{1,3}([^_]+)_{1,3}/g, '$1$2')
  // 标题/引用/列表标记（行首）
  out = out.replace(/^\s{0,3}(#{1,6})\s+/gm, '')
  out = out.replace(/^\s{0,3}>\s?/gm, '')
  out = out.replace(/^\s{0,3}[-*+]\s+/gm, '')
  out = out.replace(/^\s{0,3}\d+[.)]\s+/gm, '')
  // 水平分割线
  out = out.replace(/^\s{0,3}([-*_]\s*){3,}$/gm, '')
  // 裸 URL（前面不是 ] 或 ）的 http(s) 链接）
  out = out.replace(/(^|[^)\]])(https?:\/\/[^\s<>()]+)/g, '$1（链接见应用）')
  // 多余空白收敛（保留单个换行供切分，之后由切分器消费）
  out = out.replace(/[ \t]{2,}/g, ' ')
  return out
}

/**
 * 整段 markdown → 朗读文本。代码块/表格整体替换为占位句，行内语法清洗，
 * 超长截断（maxChars 可调；语音助手流式路径保持默认 800，消息语音播报等
 * 整段场景可放宽）。返回可直接进入句切分的纯文本。
 */
export function speechifyText(text: string, maxChars: number = MAX_SPEAKABLE_CHARS): string {
  if (text.length === 0) return ''
  const budget = Math.max(MIN_SENTENCE_CHARS, Math.floor(maxChars))
  let out = text
  // 围栏代码块（``` 或 ~~~，可带语言标注）
  out = out.replace(
    /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(\n```|\n~~~)/g,
    `$1${CODE_BLOCK_PLACEHOLDER}\n`,
  )
  // 表格：连续 >=2 行的 |...| 行（含分隔行）
  out = out.replace(/(^\|.+\|\s*\n)+/gm, `${TABLE_PLACEHOLDER}\n`)
  out = cleanInlineMarkdown(out)
  // 清洗后可能残留连续占位句，收敛为一个
  const collapsed = out
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, arr) => line.length > 0 && line !== arr[index - 1])
    .join('\n')
  if (collapsed.length <= budget) return collapsed
  // 截断尽量落在句末边界
  const head = collapsed.slice(0, budget)
  const lastBoundary = Math.max(
    head.lastIndexOf('。'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？'),
    head.lastIndexOf('\n'),
  )
  const cut = lastBoundary > MIN_SENTENCE_CHARS ? head.slice(0, lastBoundary + 1) : head
  return cut + TRUNCATION_SUFFIX
}

/** 句末边界字符集（中文全角 + 英文半角 + 换行） */
function isSentenceEndChar(ch: string): boolean {
  return '。！？；!?;\n'.includes(ch)
}

/**
 * 增量句切分器。
 *
 * push(delta) 返回本次新切出的完整句（已行内清洗；代码块整体替换为省略句）。
 * flush() 返回缓冲区中剩余文本作为最后一句（可为空串）。
 * forceTake() 把当前缓冲整体出一句（首句快切用：不等自然边界，尾部补句号防语气悬置）。
 *
 * 切分规则（按优先级）：
 * - 句末边界（。！？；与换行，英文 .?! 后接空白）出句；叠标点（！！/？！/。。。/…）
 *   归一为单一边界，不在中间断句
 * - 最短句长保护：边界命中但累计 <6 字并入下一句；连续等待超过 2 个边界或累计
 *   60 字仍未达标则强制出句（防碎句无限合并，也防短行内容被丢）
 * - 长句软切：无句末边界累计 >80 字在最近逗号/顿号处切；>120 字强制切
 *
 * 英文句点规则：'.' 仅在后随空白/行尾/引号时视为边界（避免 3.14、e.g 被切）。
 */
export class SentenceSplitter {
  private buffer = ''
  private insideCodeFence = false
  /** 因低于最短句长而连续等待的边界数（强制放行判定用） */
  private shortSentenceWaits = 0

  /** 当前缓冲的原始字符数（首句快切的凑字判断用） */
  get bufferedChars(): number {
    return this.buffer.length
  }

  push(delta: string): string[] {
    this.buffer += delta
    return this.drainBoundarySentences()
  }

  flush(): string {
    if (this.insideCodeFence) {
      // 残留未闭合围栏：按省略句收尾
      this.insideCodeFence = false
      this.buffer = ''
      return CODE_BLOCK_PLACEHOLDER
    }
    const rest = cleanInlineMarkdown(this.buffer).trim()
    this.buffer = ''
    return rest
  }

  /**
   * 强制取句（首句快切）：不等自然边界，把当前缓冲整体作为一句切出。
   * 清洗后无正文返回 null（不产生空句）；尾部无终止符时补「。」防 TTS 语气悬置。
   * 围栏未闭合时返回 null 跳过快切——此处若清掉围栏状态，后续到达的闭合围栏
   * 会被误判为新开围栏，把围栏之后的全部正文当代码吞掉；等围栏自然闭合后
   * 走正常切句路径（占位句）更安全。
   */
  forceTake(): string | null {
    if (this.insideCodeFence) return null
    const rest = cleanInlineMarkdown(this.buffer).trim()
    this.buffer = ''
    this.shortSentenceWaits = 0
    if (rest.length === 0) return null
    const sentence = /[。！？；!?;]$/.test(rest) ? rest : `${rest}。`
    return /[\p{L}\p{N}]/u.test(sentence) ? sentence : null
  }

  /** 丢弃当前缓冲（用于打断/重置） */
  reset(): void {
    this.buffer = ''
    this.insideCodeFence = false
    this.shortSentenceWaits = 0
  }

  private drainBoundarySentences(): string[] {
    const sentences: string[] = []
    let pending = ''
    let text = this.buffer
    let index = 0
    // 上一轮未闭合的围栏：先找闭合点，围栏内内容丢弃并补一个占位句
    if (this.insideCodeFence) {
      const closeIdx = this.findFenceClose(text, 0)
      if (closeIdx < 0) {
        // 仍在围栏内：整段缓冲保留，等待后续 delta
        return this.finalizeSentences(sentences)
      }
      sentences.push(CODE_BLOCK_PLACEHOLDER)
      text = text.slice(closeIdx + 4)
      this.insideCodeFence = false
      index = 0
    }
    while (index < text.length) {
      const ch = text[index] as string
      // 代码围栏感知：进入后跳过全部内容直到闭合围栏
      if (ch === '`' && this.startsWithFence(text, index)) {
        if (pending.trim().length > 0) sentences.push(cleanInlineMarkdown(pending).trim())
        pending = ''
        this.shortSentenceWaits = 0
        const closeIdx = this.findFenceClose(text, index + 3)
        if (closeIdx < 0) {
          // 围栏未闭合：剩余内容全部留在缓冲等待后续 delta
          this.insideCodeFence = true
          this.buffer = text.slice(index)
          return this.finalizeSentences(sentences)
        }
        sentences.push(CODE_BLOCK_PLACEHOLDER)
        index = closeIdx + 4
        continue
      }
      pending += ch
      const isBoundary =
        isSentenceEndChar(ch) || (ch === '.' && this.isEnglishSentenceEnd(text, index))
      if (isBoundary) {
        // 叠标点归一：连续终止符（含省略号 …）吸收为单一边界，不在中间断句
        while (index + 1 < text.length && isSentenceEndChar(text[index + 1] as string)) {
          index += 1
          pending += text[index] as string
        }
        const candidate = cleanInlineMarkdown(pending).trim()
        const meetsMin =
          candidate.length >= MIN_SENTENCE_CHARS ||
          candidate === CODE_BLOCK_PLACEHOLDER ||
          pending.length >= MIN_GUARD_FORCE_FLUSH_CHARS
        if (meetsMin || this.shortSentenceWaits >= MAX_SHORT_SENTENCE_WAITS) {
          sentences.push(candidate)
          pending = ''
          this.shortSentenceWaits = 0
        } else if (!meetsMin) {
          // 低于最短句长：内容保留与后续拼接（换行只贡献断点语义，剥掉换行符本身）
          this.shortSentenceWaits += 1
          if (pending.endsWith('\n')) pending = pending.slice(0, -1)
        }
      } else if (pending.length >= HARD_CUT_CHARS) {
        // 长句硬切：无任何边界的超长串（常见于中英混杂无标点输出）
        sentences.push(cleanInlineMarkdown(pending).trim())
        pending = ''
        this.shortSentenceWaits = 0
      } else if (pending.length >= SOFT_CUT_CHARS) {
        // 长句软切：在最近的逗号/顿号等次级边界处切
        let softCutIndex = -1
        for (let i = pending.length - 1; i >= 0; i -= 1) {
          if (SOFT_CUT_BOUNDARY_CHARS.includes(pending[i] as string)) {
            softCutIndex = i
            break
          }
        }
        if (softCutIndex >= SOFT_CUT_CHARS / 2) {
          const head = pending.slice(0, softCutIndex + 1)
          pending = pending.slice(softCutIndex + 1)
          sentences.push(cleanInlineMarkdown(head).trim())
          this.shortSentenceWaits = 0
        }
        // 无次级边界：继续攒，等 HARD_CUT 强制切
      }
      index += 1
    }
    this.buffer = pending
    return this.finalizeSentences(sentences)
  }

  private finalizeSentences(sentences: string[]): string[] {
    // 过滤纯符号/空白句
    return sentences.filter((s) => /[\p{L}\p{N}]/u.test(s))
  }

  private startsWithFence(text: string, index: number): boolean {
    return (
      text.slice(index, index + 3) === '```' &&
      // 行首围栏才算代码块（行内出现三个反引号已被行内清洗处理）
      (index === 0 || text[index - 1] === '\n')
    )
  }

  private findFenceClose(text: string, from: number): number {
    return text.indexOf('\n```', from)
  }

  private isEnglishSentenceEnd(text: string, index: number): boolean {
    const next = text[index + 1]
    if (next == null) return false // 结尾留待 flush，避免末尾小数点误切
    return /[\s"')\]]/.test(next)
  }
}

/** 便捷入口：整段文本 → 句子数组（isFinal 后的权威切分） */
export function splitSentences(text: string): string[] {
  const splitter = new SentenceSplitter()
  const sentences = splitter.push(speechifyText(text))
  const tail = splitter.flush()
  return tail.length > 0 ? [...sentences, tail] : sentences
}

/**
 * 转写文本是否含有效正文（字母/数字/文字）。
 * 环境噪音经 ASR 硬解常产出「。」「，」等纯标点——无正文的转写不是用户输入，
 * 不应提交给 agent，也不应触发收口。
 */
export function hasMeaningfulVoiceText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}
