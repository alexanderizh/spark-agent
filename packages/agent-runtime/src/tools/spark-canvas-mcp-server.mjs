#!/usr/bin/env node
/**
 * spark_canvas MCP server — infinite canvas agent tool bridge for CLI/Codex paths.
 *
 * Claude SDK can consume the in-process spark_canvas MCP server directly. Codex
 * and CLI-style executors run as child processes, so this stdio server exposes
 * the renderer-registered canvas tool schemas and proxies calls back to the
 * Electron main process through PlatformBridgeService.
 *
 * Environment:
 *   SPARK_PLATFORM_BRIDGE_PORT       PlatformBridgeService port
 *   SPARK_CANVAS_SID                 Spark session id attached to a canvas window
 *   SPARK_CANVAS_TOOL_SCHEMAS_JSON   JSON array of CanvasToolSchema
 */
import readline from 'node:readline'

const env = process.env
const PORT = Number.parseInt(env.SPARK_PLATFORM_BRIDGE_PORT || '', 10) || 0
const SID = (env.SPARK_CANVAS_SID || '').trim()
const BASE = PORT ? `http://127.0.0.1:${PORT}` : ''

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}
function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}
function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function loadToolSchemas() {
  const raw = env.SPARK_CANVAS_TOOL_SCHEMAS_JSON || '[]'
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((schema) => schema && typeof schema === 'object')
    .map((schema) => ({
      name: typeof schema.name === 'string' ? schema.name : '',
      description: typeof schema.description === 'string' ? schema.description : '',
      inputSchema:
        schema.inputSchema && typeof schema.inputSchema === 'object'
          ? schema.inputSchema
          : { type: 'object', properties: {} },
    }))
    .filter((schema) => schema.name.length > 0)
}

const TOOLS = loadToolSchemas()

async function rpc(method, params) {
  if (!BASE)
    throw new Error('Platform bridge port not configured (SPARK_PLATFORM_BRIDGE_PORT missing)')
  if (!SID) throw new Error('Session id not configured (SPARK_CANVAS_SID missing)')
  const res = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Bad response from platform bridge: ${text.slice(0, 200)}`)
  }
  if (!json || json.ok === false) throw new Error(json?.error || 'platform bridge error')
  return json.data
}

async function callCanvasTool(name, args) {
  return rpc('canvas.call_tool', {
    sessionId: SID,
    toolName: name,
    args,
  })
}

function summarize(data) {
  if (typeof data === 'string') return data
  return JSON.stringify(data, null, 2)
}

async function handle(request) {
  const id = request.id
  try {
    if (request.method === 'initialize') {
      result(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'spark_canvas', version: '0.1.0' },
      })
      return
    }
    if (request.method === 'tools/list') {
      result(id, { tools: TOOLS })
      return
    }
    if (request.method === 'tools/call') {
      const name = request.params?.name
      const args = request.params?.arguments || {}
      if (!TOOLS.some((tool) => tool.name === name)) throw new Error(`Unknown tool: ${name}`)
      const data = await callCanvasTool(name, args)
      result(id, {
        content: [{ type: 'text', text: summarize(data) }],
        structuredContent: data,
      })
      return
    }
    if (id !== undefined) result(id, {})
  } catch (err) {
    error(id, -32000, err instanceof Error ? err.message : String(err))
  }
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  try {
    void handle(JSON.parse(line))
  } catch (err) {
    error(null, -32700, err instanceof Error ? err.message : String(err))
  }
})
