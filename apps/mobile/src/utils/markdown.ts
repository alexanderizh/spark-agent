/**
 * 轻量 Markdown → 小程序渲染结构解析器。
 *
 * 为什么不用 towxml 等现成库：包体与依赖考虑（移动端要求零第三方运行时依赖）。
 * 为什么块级不用 rich-text 整包渲染：代码块需要横向滚动 + 复制按钮 + 语言标签，
 *   rich-text 内部无法承载交互组件，因此块级用 view 循环、行内用 rich-text nodes。
 *
 * 设计要点：
 *   - 流式容错：AI 回复是逐 delta 追加的，解析必须对未闭合语法（``` 未闭合、** 未配对）
 *     优雅降级而不是丢弃尾部内容。
 *   - 无第三方依赖、纯函数、可单测。
 *
 * 支持语法（移动端阅读够用的子集）：
 *   块级：标题 #~######、段落、围栏代码块 ```（带语言）、引用 >、无序/有序列表、
 *         分割线 ---、表格 |a|b|（简单两行以上识别）
 *   行内：**粗体**、*斜体*、`行内代码`、~~删除线~~、[文本](链接)、自动链接 http(s)://…
 */

// ─── 行内节点（rich-text nodes 格式，文本直接放 text 节点，无 HTML 注入风险） ──

/** rich-text children 叶子：纯文本节点 */
export interface InlineTextNode {
  type: 'text'
  text: string
}

export interface InlineNode {
  name: string
  attrs?: Record<string, string>
  children?: (InlineNode | InlineTextNode)[]
}

function textNode(text: string): InlineNode {
  return { name: 'span', children: [{ type: 'text', text }] }
}

// ─── 块级节点 ─────────────────────────────────────────────────────────────────

export type MdBlock =
  | { type: 'p'; nodes: InlineNode[] }
  | { type: 'h'; level: number; nodes: InlineNode[] }
  | { type: 'code'; lang: string; text: string }
  /** 引用拍平为段落序列（WXML 模板不可递归，移动端引用内嵌结构极罕见） */
  | { type: 'quote'; paragraphs: InlineNode[][] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'hr' }
  | { type: 'table'; header: InlineNode[][]; rows: InlineNode[][][] }

// ─── 行内解析 ─────────────────────────────────────────────────────────────────

/**
 * 行内标记解析：逐字符扫描，遇到标记符号时尝试闭合。
 * 未闭合的标记按字面文本输出（流式中途的 **、` 不会丢字）。
 */
export function parseInline(text: string): InlineNode[] {
  const out: InlineNode[] = []
  let plain = ''
  const flush = () => {
    if (plain) {
      out.push(textNode(plain))
      plain = ''
    }
  }

  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]

    // 行内代码 `code` —— 优先级最高，内部不再解析其他标记
    if (ch === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i) {
        flush()
        out.push({
          name: 'code',
          attrs: { class: 'md-inline-code' },
          children: [{ type: 'text', text: text.slice(i + 1, end) }],
        })
        i = end + 1
        continue
      }
    }

    // 链接 [text](url)
    if (ch === '[') {
      const closeBracket = text.indexOf(']', i + 1)
      if (closeBracket > i && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2)
        if (closeParen > closeBracket + 1) {
          flush()
          const label = text.slice(i + 1, closeBracket)
          const url = text.slice(closeBracket + 2, closeParen)
          out.push({
            name: 'span',
            attrs: { class: 'md-link', 'data-href': url },
            children: [{ type: 'text', text: label || url }],
          })
          i = closeParen + 1
          continue
        }
      }
    }

    // 粗体 **b** / 斜体加粗 ***b***
    if ((ch === '*' && text[i + 1] === '*') || (ch === '_' && text[i + 1] === '_')) {
      const marker = text.slice(i, i + 2)
      const end = text.indexOf(marker, i + 2)
      if (end > i + 1) {
        flush()
        out.push({
          name: 'strong',
          attrs: { class: 'md-strong' },
          children: parseInline(text.slice(i + 2, end)),
        })
        i = end + 2
        continue
      }
    }

    // 删除线 ~~s~~
    if (ch === '~' && text[i + 1] === '~') {
      const end = text.indexOf('~~', i + 2)
      if (end > i + 1) {
        flush()
        out.push({
          name: 'span',
          attrs: { class: 'md-del' },
          children: parseInline(text.slice(i + 2, end)),
        })
        i = end + 2
        continue
      }
    }

    // 斜体 *i*（避免吃掉已成对的 **：走到这里说明后面不是连续 ** 或未闭合）
    if (ch === '*' && text[i + 1] !== '*' && text[i - 1] !== '*') {
      const end = text.indexOf('*', i + 1)
      if (end > i + 1 && text[end - 1] !== '*' && text[end + 1] !== '*') {
        flush()
        out.push({
          name: 'em',
          attrs: { class: 'md-em' },
          children: parseInline(text.slice(i + 1, end)),
        })
        i = end + 1
        continue
      }
    }

    // 自动链接 http(s)://…
    if (
      (ch === 'h' && text.startsWith('http://', i)) ||
      (ch === 'h' && text.startsWith('https://', i))
    ) {
      let end = i
      while (end < n && !/\s/.test(text[end] ?? ' ')) end += 1
      const url = text.slice(i, end).replace(/[),.!?;，。！？；』」）]+$/, '')
      flush()
      out.push({
        name: 'span',
        attrs: { class: 'md-link', 'data-href': url },
        children: [{ type: 'text', text: url }],
      })
      i = i + url.length
      continue
    }

    plain += ch
    i += 1
  }
  flush()
  return out
}

// ─── 块级解析 ─────────────────────────────────────────────────────────────────

const HR_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*)$/
const UL_RE = /^\s{0,3}[-*+]\s+(.*)$/
const OL_RE = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/

/** 表格分隔行 |---|---| */
function isTableSeparator(line: string): boolean {
  return TABLE_ROW_RE.test(line) && /^[\s|:-]+$/.test(line)
}

function splitTableRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map((cell) => cell.trim())
}

/**
 * 把 markdown 文本解析成块级数组。
 * 流式容错：未闭合的 ``` 代码块按已收集内容输出；最后一行未完成的段落正常输出。
 */
export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  // 段落聚合缓冲（连续非空行合并为一段，段内换行输出为空格）
  let para: string[] = []

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ type: 'p', nodes: parseInline(para.join('\n')) })
      para = []
    }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''

    // 围栏代码块（含未闭合容错）
    const fence = line.match(/^\s{0,3}```\s*([\w+-]*)\s*$/)
    if (fence) {
      flushPara()
      const lang = fence[1] ?? ''
      const code: string[] = []
      i += 1
      while (i < lines.length && !/^\s{0,3}```\s*$/.test(lines[i] ?? '')) {
        code.push(lines[i] ?? '')
        i += 1
      }
      i += 1 // 跳过闭合 ```（或越界结束）
      blocks.push({ type: 'code', lang, text: code.join('\n') })
      continue
    }

    // 空行 → 段落结束
    if (!line.trim()) {
      flushPara()
      i += 1
      continue
    }

    // 标题
    const heading = line.match(HEADING_RE)
    if (heading) {
      flushPara()
      blocks.push({ type: 'h', level: heading[1]?.length ?? 1, nodes: parseInline(heading[2] ?? '') })
      i += 1
      continue
    }

    // 分割线
    if (HR_RE.test(line)) {
      flushPara()
      blocks.push({ type: 'hr' })
      i += 1
      continue
    }

    // 表格：当前行 |xx| 下一行分隔行
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1] ?? '')) {
      flushPara()
      const header = splitTableRow(line).map((cell) => parseInline(cell))
      i += 2
      const rows: InlineNode[][][] = []
      while (i < lines.length && TABLE_ROW_RE.test(lines[i] ?? '')) {
        rows.push(splitTableRow(lines[i] ?? '').map((cell) => parseInline(cell)))
        i += 1
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    // 引用（连续 > 行合并，拍平为段落序列）
    if (/^\s{0,3}>/.test(line)) {
      flushPara()
      const paragraphs: InlineNode[][] = []
      while (i < lines.length && /^\s{0,3}>/.test(lines[i] ?? '')) {
        const inner = (lines[i] ?? '').replace(/^\s{0,3}>\s?/, '')
        if (inner.trim()) paragraphs.push(parseInline(inner))
        i += 1
      }
      blocks.push({ type: 'quote', paragraphs })
      continue
    }

    // 列表（连续同类型列表项聚合；有序/无序切换即分段）
    const ul = line.match(UL_RE)
    const ol = line.match(OL_RE)
    if (ul || ol) {
      flushPara()
      const ordered = ol != null
      const items: InlineNode[][] = []
      const itemRe = ordered ? OL_RE : UL_RE
      while (i < lines.length) {
        const current = lines[i] ?? ''
        const matched = current.match(itemRe)
        if (matched) {
          items.push(parseInline(matched[1] ?? ''))
          i += 1
          continue
        }
        // 列表项的续行（缩进的普通行）并入上一项
        if (/^\s{2,}\S/.test(current) && items.length > 0) {
          const prev = items[items.length - 1]
          if (prev) prev.push(...parseInline(` ${current.trim()}`))
          i += 1
          continue
        }
        break
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // 普通行 → 段落缓冲
    para.push(line.trim())
    i += 1
  }
  flushPara()
  return blocks
}
