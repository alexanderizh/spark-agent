/**
 * 面向模型输出的轻量 JSON 容错层。
 *
 * 这里只修复低风险、可判断的语法瑕疵：代码围栏/前后说明、尾逗号、注释、
 * 智能引号、单引号字符串、未加引号的对象字段名和字符串中的裸换行。
 * 不会为了“成功解析”强行补齐被截断的对象；无法安全修复时仍返回 null，
 * 由上层把模型原文作为普通文本回显。
 */

type QuoteMode = 'double' | 'smart-double' | 'single' | 'smart-single'

const JSON_STRING_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'])

/**
 * 尝试从模型文本中解析 JSON。返回值按“最可能是根 JSON”的顺序排列，
 * 同时兼容 JSON 被适配层多序列化一层的情况。
 */
export function parseCanvasJsonCandidates(text: string): unknown[] {
  const candidates = collectJsonCandidates(text)
  const parsedValues: unknown[] = []
  const seenSyntaxCandidates = new Set<string>()

  for (const candidate of candidates) {
    if (!candidate) continue
    for (const syntaxCandidate of [candidate, repairCanvasJsonText(candidate)]) {
      if (!syntaxCandidate || seenSyntaxCandidates.has(syntaxCandidate)) continue
      seenSyntaxCandidates.add(syntaxCandidate)
      try {
        appendParsedValue(JSON.parse(syntaxCandidate) as unknown, parsedValues, 0)
      } catch {
        // 尝试下一个候选文本；无法修复的内容交给上层原文回显。
      }
    }
  }

  return parsedValues
}

export function parseCanvasJson(text: string): unknown | null {
  return parseCanvasJsonCandidates(text)[0] ?? null
}

/**
 * 只做语法级修复，不负责从一大段自然语言中截取 JSON。
 * 调用方应优先使用 parseCanvasJson / parseCanvasJsonCandidates。
 */
export function repairCanvasJsonText(text: string): string {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  const fenced = trimmed.match(/^```(?:json|jsonc|json5)?\s*([\s\S]*?)\s*```$/i)
  const source = fenced?.[1] ?? trimmed
  const normalized = normalizeJsonSyntax(source)
  return removeTrailingCommas(quoteBareObjectKeys(normalized))
}

function appendParsedValue(value: unknown, values: unknown[], depth: number): void {
  // 适配层偶尔把完整 JSON 再序列化一次。优先加入内层对象，避免调用方拿到
  // 外层 JSON 字符串后误判为“不是结构化结果”。
  if (typeof value === 'string' && depth < 2 && /^[[{]/.test(value.trim())) {
    const nestedText = value.trim()
    const nestedCandidates = [nestedText, repairCanvasJsonText(nestedText)]
    for (const nestedCandidate of nestedCandidates) {
      try {
        appendParsedValue(JSON.parse(nestedCandidate) as unknown, values, depth + 1)
        return
      } catch {
        // Keep the outer string when the nested value is not actually JSON.
      }
    }
  }
  values.push(value)
}

function collectJsonCandidates(text: string): string[] {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return []

  const candidates = [trimmed]
  for (const match of trimmed.matchAll(/```(?:json|jsonc|json5)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) candidates.push(match[1].trim())
  }
  const openFence = trimmed.match(/```(?:json|jsonc|json5)?\s*([\s\S]+)/i)
  if (openFence?.[1]) candidates.push(openFence[1].trim())
  candidates.push(...collectBalancedJsonCandidates(trimmed))
  return candidates
}

/** 从包含解释文字、代码围栏的响应中提取完整的 {} / [] 片段。 */
function collectBalancedJsonCandidates(text: string): string[] {
  const candidates: string[] = []
  let start = -1
  let stack: string[] = []
  let quote: QuoteMode | null = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    const next = text[index + 1]

    if (start < 0) {
      if (char === '{' || char === '[') {
        start = index
        stack = [char === '{' ? '}' : ']']
      }
      continue
    }

    if (lineComment) {
      if (char === '\n' || char === '\r') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (quote === 'double' && (char === '"' || char === '”')) quote = null
      else if (quote === 'smart-double' && char === '”') quote = null
      else if (quote === 'single' && (char === "'" || char === '’')) quote = null
      else if (quote === 'smart-single' && char === '’') quote = null
      continue
    }

    if (char === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (char === '"') {
      quote = 'double'
      continue
    }
    if (char === '“') {
      quote = 'smart-double'
      continue
    }
    if (char === "'") {
      quote = 'single'
      continue
    }
    if (char === '‘') {
      quote = 'smart-single'
      continue
    }
    if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']')
      continue
    }
    if (char !== stack.at(-1)) continue
    stack.pop()
    if (stack.length === 0) {
      candidates.push(text.slice(start, index + 1))
      start = -1
    }
  }

  return candidates
}

function normalizeJsonSyntax(text: string): string {
  const output: string[] = []
  let quote: QuoteMode | null = null
  let escaped = false
  let singleBuffer = ''
  let singleEscaped = false
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    const next = text[index + 1]

    if (lineComment) {
      if (char === '\n' || char === '\r') {
        lineComment = false
        output.push(' ')
      }
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
        output.push(' ')
      }
      continue
    }

    if (quote === 'single' || quote === 'smart-single') {
      const closing = quote === 'smart-single' ? char === '’' : char === "'" || char === '’'
      if (singleEscaped) {
        singleBuffer += decodeSingleEscape(char, text, index)
        if (char === 'u') index += 4
        singleEscaped = false
        continue
      }
      if (char === '\\') {
        singleEscaped = true
        continue
      }
      if (closing) {
        output.push(JSON.stringify(singleBuffer))
        quote = null
        singleBuffer = ''
        continue
      }
      singleBuffer += char
      continue
    }

    if (quote === 'double' || quote === 'smart-double') {
      const closing = quote === 'smart-double' ? char === '”' : char === '"' || char === '”'
      if (escaped) {
        if (char === '\n') output.push('\\n')
        else if (char === '\r') output.push('\\r')
        else output.push(char)
        escaped = false
        continue
      }
      if (char === '\\') {
        const escapedCharacter = next
        output.push(JSON_STRING_ESCAPES.has(escapedCharacter ?? '') ? '\\' : '\\\\')
        escaped = JSON_STRING_ESCAPES.has(escapedCharacter ?? '')
        continue
      }
      if (closing) {
        output.push('"')
        quote = null
        continue
      }
      // 智能引号包裹的值里偶尔混入普通双引号，把它当作内容而不是提前结束。
      if (quote === 'smart-double' && char === '"') {
        output.push('\\"')
        continue
      }
      if (char === '\n') output.push('\\n')
      else if (char === '\r') output.push('\\r')
      else if (char === '\t') output.push('\\t')
      else if (char.charCodeAt(0) < 0x20)
        output.push(`\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
      else output.push(char)
      continue
    }

    if (char === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (char === '"') {
      output.push(char)
      quote = 'double'
      continue
    }
    if (char === '“') {
      output.push('"')
      quote = 'smart-double'
      continue
    }
    if (char === "'") {
      quote = 'single'
      singleBuffer = ''
      singleEscaped = false
      continue
    }
    if (char === '‘') {
      quote = 'smart-single'
      singleBuffer = ''
      singleEscaped = false
      continue
    }
    if (char === '：') output.push(':')
    else if (char === '，') output.push(',')
    else if (char === '\u00A0') output.push(' ')
    else output.push(char)
  }

  // 单引号字符串的闭合缺失仍属于可局部修复的情况；双引号则不自动补闭合，
  // 以免把被截断的 JSON 误当成完整结果。
  if (quote === 'single' || quote === 'smart-single') output.push(JSON.stringify(singleBuffer))
  return output.join('')
}

function decodeSingleEscape(char: string, text: string, index: number): string {
  if (char === 'n') return '\n'
  if (char === 'r') return '\r'
  if (char === 't') return '\t'
  if (char === 'b') return '\b'
  if (char === 'f') return '\f'
  if (char === 'u') {
    const hex = text.slice(index + 1, index + 5)
    if (/^[0-9a-f]{4}$/i.test(hex)) return String.fromCharCode(Number.parseInt(hex, 16))
  }
  return char
}

function quoteBareObjectKeys(text: string): string {
  const output: string[] = []
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (char === '"') {
      const end = copyJsonString(text, index, output)
      index = end
      continue
    }
    if (char !== '{' && char !== ',') {
      output.push(char)
      continue
    }

    const rest = text.slice(index + 1)
    const match = rest.match(
      /^(\s*)([A-Za-z0-9_$\-\u0080-\uFFFF][A-Za-z0-9_$\-\u0080-\uFFFF]*)(\s*):/,
    )
    if (!match) {
      output.push(char)
      continue
    }
    output.push(char, match[1]!, JSON.stringify(match[2]!), match[3]!, ':')
    index += match[0].length
  }
  return output.join('')
}

function removeTrailingCommas(text: string): string {
  const output: string[] = []
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (char === '"') {
      const end = copyJsonString(text, index, output)
      index = end
      continue
    }
    if (char !== ',') {
      output.push(char)
      continue
    }
    let next = index + 1
    while (/\s/.test(text[next] ?? '')) next += 1
    if (text[next] === '}' || text[next] === ']') {
      index = next - 1
      continue
    }
    output.push(char)
  }
  return output.join('')
}

function copyJsonString(text: string, start: number, output: string[]): number {
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!
    output.push(char)
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') return index
  }
  return text.length - 1
}
