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
 *         任务列表 - [ ]/- [x]、分割线 ---、图片行 ![alt](url)、
 *         表格 |a|b|（列对齐 :---/:---:/---:、列宽按内容权重自适应、斑马纹在样式层）
 *   行内：**粗体**、*斜体*、`行内代码`、~~删除线~~、[文本](链接)、自动链接 http(s)://…、
 *         行内图片 ![alt](url)（按链接样式降级）、段内换行（\n → br）
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

// ─── 链接分段（链接可点：rich-text 内部节点收不到点击事件，需拆出独立 text 节点） ──

/** 段落内分段：正文走 rich-text，链接拆为可点 text */
export type MdSegment =
  | { kind: 'text'; nodes: InlineNode[] }
  | { kind: 'link'; url: string; label: string }

/** 抽取节点树的纯文本（链接 label / 表格列宽估算用） */
export function plainTextOf(nodes: (InlineNode | InlineTextNode)[] | undefined): string {
  if (nodes == null) return ''
  let out = ''
  for (const node of nodes) {
    // InlineNode 无 type 字段，用 in 守卫收窄（type === 'text' 单独判别不了联合）
    if ('type' in node && node.type === 'text') {
      out += node.text
    } else if (!('type' in node) && node.children != null) {
      out += plainTextOf(node.children)
    }
  }
  return out
}

/** 顶层拆出链接段：md-link 节点 → 可点链接段，其余并入正文段（保持单 rich-text 渲染路径） */
export function splitLinkSegments(nodes: InlineNode[]): MdSegment[] {
  const segments: MdSegment[] = []
  let buffer: InlineNode[] = []
  const flushBuffer = () => {
    if (buffer.length > 0) {
      segments.push({ kind: 'text', nodes: buffer })
      buffer = []
    }
  }
  for (const node of nodes) {
    const url = node.attrs?.['data-href']
    const isLink = node.name === 'span' && node.attrs?.class === 'md-link' && url != null
    if (isLink) {
      flushBuffer()
      segments.push({ kind: 'link', url: url ?? '', label: plainTextOf(node.children) })
    } else {
      buffer.push(node)
    }
  }
  flushBuffer()
  return segments
}

// ─── 块级节点 ─────────────────────────────────────────────────────────────────

/** 列表项：checked=null 普通项；true/false 任务项（- [x] / - [ ]） */
export interface MdListItem {
  nodes: InlineNode[]
  checked: boolean | null
}

export type MdTableAlign = 'left' | 'center' | 'right'

export type MdBlock =
  | { type: 'p'; segments: MdSegment[] }
  | { type: 'h'; level: number; nodes: InlineNode[] }
  | { type: 'code'; lang: string; text: string }
  /** 引用拍平为段落序列（WXML 模板不可递归，移动端引用内嵌结构极罕见） */
  | { type: 'quote'; paragraphs: MdSegment[][] }
  | { type: 'list'; ordered: boolean; items: MdListItem[] }
  | { type: 'hr' }
  /** 独立成行的图片（块级 image 组件渲染，可点击全屏预览） */
  | { type: 'image'; url: string; alt: string }
  | {
      type: 'table'
      header: InlineNode[][]
      rows: InlineNode[][][]
      /** 各列对齐（分隔行 :---/:---:/---: 解析；缺省 left） */
      aligns: MdTableAlign[]
      /** 各列宽度权重（内容长度估算，flex-grow；长列更宽，短列更窄） */
      weights: number[]
    }

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

    // 段内换行：单换行渲染为 <br/>（rich-text 文本节点里的 \n 会被折叠成空格）
    if (ch === '\n') {
      flush()
      out.push({ name: 'br' })
      i += 1
      continue
    }

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

    // 行内图片 ![alt](url)：rich-text 无法交互预览，按链接样式降级（独立成行的图片在块级解析中单独成块）
    if (ch === '!' && text[i + 1] === '[') {
      const closeBracket = text.indexOf(']', i + 2)
      if (closeBracket > i + 1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2)
        if (closeParen > closeBracket + 1) {
          flush()
          const label = text.slice(i + 2, closeBracket)
          const url = text.slice(closeBracket + 2, closeParen)
          out.push({
            name: 'span',
            attrs: { class: 'md-link', 'data-href': url },
            children: [{ type: 'text', text: label || '图片' }],
          })
          i = closeParen + 1
          continue
        }
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
/** 独立成行的图片 ![alt](url)（允许可选标题） */
const IMAGE_LINE_RE = /^\s{0,3}!\[([^\]]*)\]\(\s*[^)\s]+(?:\s+"[^"]*")?\s*\)\s*$/
const IMAGE_URL_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/
/** 任务列表项前缀 - [ ] / - [x]（匹配在 UL/OL 内容之上） */
const TASK_ITEM_RE = /^\[([ xX])\]\s+(.*)$/

/** 表格分隔行 |---|---| */
function isTableSeparator(line: string): boolean {
  return TABLE_ROW_RE.test(line) && /^[\s|:-]+$/.test(line)
}

function splitTableRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map((cell) => cell.trim())
}

/** 分隔行 → 各列对齐（:---: 居中 / ---: 右对齐 / 其余左对齐；列数不足补 left） */
function parseTableAligns(line: string, columnCount: number): MdTableAlign[] {
  const aligns: MdTableAlign[] = splitTableRow(line).map((cell) => {
    const t = cell.trim()
    const startsColon = t.startsWith(':')
    const endsColon = t.endsWith(':')
    if (startsColon && endsColon) return 'center'
    if (endsColon) return 'right'
    return 'left'
  })
  while (aligns.length < columnCount) aligns.push('left')
  return aligns.slice(0, columnCount)
}

/**
 * 列宽权重（flex-grow）：按各列最大内容长度估算，长列更宽、短列更窄，
 * 避免现在「死板等宽」把一列表格压成竖条。单列权重 1~8，超长内容（URL 等）截断到 48 字符。
 */
function columnWeights(
  header: InlineNode[][],
  rows: InlineNode[][][],
  columnCount: number,
): number[] {
  const lens = new Array<number>(columnCount).fill(6)
  const consider = (cells: InlineNode[][]): void => {
    cells.forEach((cell, index) => {
      if (index >= columnCount) return
      const len = Math.min(plainTextOf(cell).length, 48)
      lens[index] = Math.max(lens[index] ?? 6, len)
    })
  }
  consider(header)
  for (const row of rows) consider(row)
  return lens.map((len) => Math.min(8, Math.max(1, Math.round(len / 6))))
}

/**
 * 把 markdown 文本解析成块级数组。
 * 流式容错：未闭合的 ``` 代码块按已收集内容输出；最后一行未完成的段落正常输出。
 */
export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  // 段落聚合缓冲（连续非空行合并为一段，段内换行解析为 <br/>）
  let para: string[] = []

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ type: 'p', segments: splitLinkSegments(parseInline(para.join('\n'))) })
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
      blocks.push({
        type: 'h',
        level: heading[1]?.length ?? 1,
        nodes: parseInline(heading[2] ?? ''),
      })
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

    // 独立成行的图片：块级渲染（可点击全屏预览）
    if (IMAGE_LINE_RE.test(line)) {
      flushPara()
      const match = line.match(IMAGE_URL_RE)
      if (match != null) {
        blocks.push({ type: 'image', url: match[2] ?? '', alt: match[1] ?? '' })
      }
      i += 1
      continue
    }

    // 表格：当前行 |xx| 下一行分隔行
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1] ?? '')) {
      flushPara()
      const header = splitTableRow(line).map((cell) => parseInline(cell))
      const columnCount = header.length
      const aligns = parseTableAligns(lines[i + 1] ?? '', columnCount)
      i += 2
      const rows: InlineNode[][][] = []
      while (i < lines.length && TABLE_ROW_RE.test(lines[i] ?? '')) {
        rows.push(splitTableRow(lines[i] ?? '').map((cell) => parseInline(cell)))
        i += 1
      }
      blocks.push({
        type: 'table',
        header,
        rows,
        aligns,
        weights: columnWeights(header, rows, columnCount),
      })
      continue
    }

    // 引用（连续 > 行合并，拍平为段落序列）
    if (/^\s{0,3}>/.test(line)) {
      flushPara()
      const paragraphs: MdSegment[][] = []
      while (i < lines.length && /^\s{0,3}>/.test(lines[i] ?? '')) {
        const inner = (lines[i] ?? '').replace(/^\s{0,3}>\s?/, '')
        if (inner.trim()) paragraphs.push(splitLinkSegments(parseInline(inner)))
        i += 1
      }
      blocks.push({ type: 'quote', paragraphs })
      continue
    }

    // 列表（连续同类型列表项聚合；有序/无序切换即分段；任务项 - [ ]/- [x] 识别勾选态）
    const ul = line.match(UL_RE)
    const ol = line.match(OL_RE)
    if (ul || ol) {
      flushPara()
      const ordered = ol != null
      const items: MdListItem[] = []
      const itemRe = ordered ? OL_RE : UL_RE
      while (i < lines.length) {
        const current = lines[i] ?? ''
        const matched = current.match(itemRe)
        if (matched) {
          const raw = matched[1] ?? ''
          const task = raw.match(TASK_ITEM_RE)
          items.push(
            task != null
              ? {
                  nodes: parseInline(task[2] ?? ''),
                  checked: task[1] === 'x' || task[1] === 'X',
                }
              : { nodes: parseInline(raw), checked: null },
          )
          i += 1
          continue
        }
        // 列表项的续行（缩进的普通行）并入上一项
        if (/^\s{2,}\S/.test(current) && items.length > 0) {
          const prev = items[items.length - 1]
          if (prev != null) prev.nodes.push(...parseInline(` ${current.trim()}`))
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
