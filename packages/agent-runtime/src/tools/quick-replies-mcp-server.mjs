import readline from 'node:readline'

const MAX_REPLIES = 4
const MAX_REPLY_LENGTH = 40
const MAX_HTML_LENGTH = 200_000
const MAX_HTML_TITLE_LENGTH = 60
const MIN_HTML_HEIGHT = 120
const MAX_HTML_HEIGHT = 640
const DEFAULT_HTML_HEIGHT = 320
const MAX_DIAGRAM_SOURCE_LENGTH = 50_000
const MAX_DIAGRAM_TITLE_LENGTH = 60
const MIN_DIAGRAM_HEIGHT = 120
const MAX_DIAGRAM_HEIGHT = 800
const DEFAULT_DIAGRAM_HEIGHT = 400
const DIAGRAM_TYPES = new Set(['markmap', 'mermaid'])
// 'mindmap' 作为 'markmap' 的友好别名：模型/用户常把思维导图称作 mindmap
const DIAGRAM_TYPE_ALIASES = { mindmap: 'markmap' }

function result(id, value) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: value })}\n`)
}

function error(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}

function normalizeReplies(input) {
  const requested = Array.isArray(input?.replies) ? input.replies : []
  const replies = []
  const seen = new Set()

  for (const item of requested) {
    if (typeof item !== 'string') continue
    const reply = item.trim().slice(0, MAX_REPLY_LENGTH)
    if (!reply || seen.has(reply)) continue
    seen.add(reply)
    replies.push(reply)
    if (replies.length >= MAX_REPLIES) break
  }

  return { replies }
}

const tool = {
  name: 'suggest_replies',
  description:
    'Optionally show 1-4 concise reply buttons above the chat input. The user can click one to immediately send that exact text as their next message. Use only for simple ordinary-text replies, immediately before a final response that asks the user to choose or confirm. Never use together with AskUserQuestion or request_user_input, and never use for permissions or destructive-action approval.',
  inputSchema: {
    type: 'object',
    properties: {
      replies: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_REPLIES,
        description: 'Distinct, self-contained user replies shown and sent verbatim.',
        items: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_REPLY_LENGTH,
        },
      },
    },
    required: ['replies'],
    additionalProperties: false,
  },
}

const htmlTool = {
  name: 'render_html',
  description:
    'Render a bounded HTML fragment in the conversation. Use for diagrams, visual comparisons, compact interactive demos, and layouts that Markdown cannot express. Inline CSS/JS, HTTP(S) external resources, and data/blob media are supported; the host still applies a sandbox and CSP.',
  inputSchema: {
    type: 'object',
    properties: {
      html: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_HTML_LENGTH,
        description:
          'HTML document or fragment. Inline styles/scripts and trusted HTTP(S) resources are supported; use data: or blob: media where appropriate.',
      },
      title: { type: 'string', maxLength: MAX_HTML_TITLE_LENGTH },
      height: {
        type: 'integer',
        minimum: MIN_HTML_HEIGHT,
        maximum: MAX_HTML_HEIGHT,
        default: DEFAULT_HTML_HEIGHT,
      },
    },
    required: ['html'],
    additionalProperties: false,
  },
}

const diagramTool = {
  name: 'render_diagram',
  description:
    "Render a mind map or a structured chart inline in the conversation. Output is SVG. Two types: 'markmap' for mind maps (source = a Markdown heading outline, e.g. `# Topic\\n## Branch\\n### Leaf`); 'mermaid' for flowcharts / sequence / ER / state / gantt / class / pie / journey and other standard charts (source = Mermaid DSL, declare the diagram type on the first line such as `flowchart TD` or `sequenceDiagram`). Prefer this tool over render_html for mind maps and standard chart types — the input is plain text (Markdown/DSL), cheaper and more reliable than hand-written HTML/SVG. One diagram per call.",
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['markmap', 'mermaid', 'mindmap'],
        description:
          "'markmap' (or alias 'mindmap') renders a mind map from a Markdown outline. 'mermaid' renders any Mermaid-supported chart from DSL.",
      },
      source: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_DIAGRAM_SOURCE_LENGTH,
        description:
          "For type='markmap': a Markdown heading outline. For type='mermaid': Mermaid DSL with the diagram type declared on the first line.",
      },
      title: { type: 'string', maxLength: MAX_DIAGRAM_TITLE_LENGTH },
      height: {
        type: 'integer',
        minimum: MIN_DIAGRAM_HEIGHT,
        maximum: MAX_DIAGRAM_HEIGHT,
        default: DEFAULT_DIAGRAM_HEIGHT,
      },
    },
    required: ['type', 'source'],
    additionalProperties: false,
  },
}

function normalizeHtml(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { accepted: false, reason: 'HTML content must be a non-empty string' }
  }
  const html = input.html
  if (typeof html !== 'string' || html.trim().length === 0) {
    return { accepted: false, reason: 'HTML content must be a non-empty string' }
  }
  if (html.length > MAX_HTML_LENGTH) {
    return { accepted: false, reason: `HTML content must not exceed ${MAX_HTML_LENGTH} characters` }
  }
  if (
    typeof input.title !== 'undefined' &&
    (typeof input.title !== 'string' || input.title.length > MAX_HTML_TITLE_LENGTH)
  ) {
    return {
      accepted: false,
      reason: `HTML title must not exceed ${MAX_HTML_TITLE_LENGTH} characters`,
    }
  }
  if (
    typeof input.height !== 'undefined' &&
    (!Number.isInteger(input.height) ||
      input.height < MIN_HTML_HEIGHT ||
      input.height > MAX_HTML_HEIGHT)
  ) {
    return {
      accepted: false,
      reason: `HTML height must be an integer between ${MIN_HTML_HEIGHT} and ${MAX_HTML_HEIGHT}`,
    }
  }
  const forbidden = html.match(/<(iframe|form|object|embed|base)\b/i)
  if (forbidden != null) {
    return { accepted: false, reason: `HTML content cannot contain ${forbidden[1]} tags` }
  }
  const warnings = /(?:src|href)\s*=\s*["']\s*https?:\/\//i.test(html)
    ? ['检测到外部资源引用，沙盒 CSP 将允许网络加载；请确认来源可信']
    : []
  return {
    accepted: true,
    html,
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : 'HTML 内容',
    height: input.height ?? DEFAULT_HTML_HEIGHT,
    warnings,
  }
}

function renderHtmlResult(id, input) {
  result(id, {
    content: [{ type: 'text', text: JSON.stringify(normalizeHtml(input)) }],
  })
}

function normalizeDiagramType(value) {
  if (typeof value !== 'string') return null
  const key = value.trim().toLowerCase()
  const aliased = DIAGRAM_TYPE_ALIASES[key] ?? key
  return DIAGRAM_TYPES.has(aliased) ? aliased : null
}

function normalizeDiagram(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { accepted: false, reason: 'Diagram payload must be an object' }
  }
  const diagramType = normalizeDiagramType(input.type)
  if (diagramType == null) {
    return { accepted: false, reason: 'type must be one of: markmap, mermaid' }
  }
  const source = input.source
  if (typeof source !== 'string' || source.trim().length === 0) {
    return {
      accepted: false,
      reason: 'source must be a non-empty Markdown outline or Mermaid DSL string',
    }
  }
  if (source.length > MAX_DIAGRAM_SOURCE_LENGTH) {
    return {
      accepted: false,
      reason: `source must not exceed ${MAX_DIAGRAM_SOURCE_LENGTH} characters`,
    }
  }
  if (
    typeof input.title !== 'undefined' &&
    (typeof input.title !== 'string' || input.title.length > MAX_DIAGRAM_TITLE_LENGTH)
  ) {
    return {
      accepted: false,
      reason: `Diagram title must not exceed ${MAX_DIAGRAM_TITLE_LENGTH} characters`,
    }
  }
  if (
    typeof input.height !== 'undefined' &&
    (!Number.isInteger(input.height) ||
      input.height < MIN_DIAGRAM_HEIGHT ||
      input.height > MAX_DIAGRAM_HEIGHT)
  ) {
    return {
      accepted: false,
      reason: `Diagram height must be an integer between ${MIN_DIAGRAM_HEIGHT} and ${MAX_DIAGRAM_HEIGHT}`,
    }
  }
  // Mermaid DSL / Markdown outline 理论上不应包含这些标签；保险起见拦截。
  const forbidden = source.match(/<(iframe|form|object|embed|base)\b/i)
  if (forbidden != null) {
    return { accepted: false, reason: `source cannot contain ${forbidden[1]} tags` }
  }
  const title =
    typeof input.title === 'string' && input.title.trim()
      ? input.title.trim()
      : diagramType === 'markmap'
        ? '思维导图'
        : '图表'
  return {
    accepted: true,
    type: diagramType,
    source,
    title,
    height: input.height ?? DEFAULT_DIAGRAM_HEIGHT,
    warnings: [],
  }
}

function renderDiagramResult(id, input) {
  result(id, {
    content: [{ type: 'text', text: JSON.stringify(normalizeDiagram(input)) }],
  })
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.method === 'initialize') {
    result(message.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'spark-ui', version: '1.0.0' },
    })
  } else if (message.method === 'tools/list') {
    result(message.id, { tools: [tool, htmlTool, diagramTool] })
  } else if (message.method === 'tools/call') {
    if (message.params?.name === htmlTool.name) {
      renderHtmlResult(message.id, message.params?.arguments)
      return
    }
    if (message.params?.name === diagramTool.name) {
      renderDiagramResult(message.id, message.params?.arguments)
      return
    }
    if (message.params?.name !== tool.name) {
      error(message.id, -32601, `Unknown tool: ${message.params?.name ?? ''}`)
      return
    }
    const payload = normalizeReplies(message.params?.arguments)
    if (payload.replies.length === 0) {
      error(message.id, -32602, 'At least one non-empty reply is required')
      return
    }
    result(message.id, {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    })
  } else if (message.method === 'ping') {
    result(message.id, {})
  }
})
