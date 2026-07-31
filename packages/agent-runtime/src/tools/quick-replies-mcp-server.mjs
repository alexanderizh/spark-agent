import readline from 'node:readline'

const MAX_REPLIES = 4
const MAX_REPLY_LENGTH = 40

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
    result(message.id, { tools: [tool] })
  } else if (message.method === 'tools/call') {
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
