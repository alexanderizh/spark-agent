import readline from 'node:readline'

const MAX_REPLIES = 4
const MAX_REPLY_LENGTH = 40
const MAX_HTML_LENGTH = 200_000
const MAX_HTML_TITLE_LENGTH = 60
const MIN_HTML_HEIGHT = 120
const MAX_HTML_HEIGHT = 640
const DEFAULT_HTML_HEIGHT = 320

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
    'Render a bounded HTML fragment in the conversation. Use for diagrams, visual comparisons, compact interactive demos, and layouts that Markdown cannot express. Only inline CSS/JS and data/blob media are allowed; the host applies a sandbox and CSP.',
  inputSchema: {
    type: 'object',
    properties: {
      html: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_HTML_LENGTH,
        description:
          'HTML document or fragment. Keep all styles/scripts inline and use data: media only.',
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
    ? ['检测到外部资源引用，沙盒 CSP 将阻止网络加载']
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
    result(message.id, { tools: [tool, htmlTool] })
  } else if (message.method === 'tools/call') {
    if (message.params?.name === htmlTool.name) {
      renderHtmlResult(message.id, message.params?.arguments)
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
