#!/usr/bin/env node
import readline from 'node:readline'

const PORT = Number.parseInt(process.env.SPARK_CUSTOM_TOOLS_BRIDGE_PORT || '', 10) || 0
const TOKEN = (process.env.SPARK_CUSTOM_TOOLS_BRIDGE_TOKEN || '').trim()
const SESSION_ID = (process.env.SPARK_CUSTOM_TOOLS_SID || '').trim()

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}

function rpcError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function bridge(method, params) {
  if (!PORT || !TOKEN) throw new Error('Custom tools bridge is not configured')
  const response = await fetch(`http://127.0.0.1:${PORT}/rpc`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
  })
  const payload = await response.json()
  if (!response.ok || payload?.ok !== true)
    throw new Error(payload?.error || 'Custom tools bridge error')
  return payload.data
}

async function handle(request) {
  const id = request.id
  try {
    if (request.method === 'initialize') {
      result(id, {
        protocolVersion: '2024-11-05',
        // The desktop runtime restarts this stdio process after CRUD changes,
        // so it does not emit in-process tools/list_changed notifications.
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'spark_custom_tools', version: '1.0.0' },
      })
      return
    }
    if (request.method === 'tools/list') {
      result(id, await bridge('customTools.list', {}))
      return
    }
    if (request.method === 'tools/call') {
      const toolId = typeof request.params?.name === 'string' ? request.params.name : ''
      const input = request.params?.arguments ?? {}
      const execution = await bridge('customTools.call', {
        toolId,
        input,
        ...(SESSION_ID ? { sessionId: SESSION_ID } : {}),
      })
      result(id, {
        content: [{ type: 'text', text: execution.text }],
        structuredContent: { meta: execution.meta },
      })
      return
    }
    if (id !== undefined) result(id, {})
  } catch (error) {
    rpcError(id, -32000, error instanceof Error ? error.message : String(error))
  }
}

const lines = readline.createInterface({ input: process.stdin })
lines.on('line', (line) => {
  if (!line.trim()) return
  try {
    void handle(JSON.parse(line))
  } catch (error) {
    rpcError(null, -32700, error instanceof Error ? error.message : String(error))
  }
})
