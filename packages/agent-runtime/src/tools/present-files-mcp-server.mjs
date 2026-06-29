import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

const MAX_FILES = 20
const workspaceRoot = await realpath(process.env.SPARK_WORKSPACE_ROOT || process.cwd())

function result(id, value) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: value })}\n`)
}

function error(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}

function isInsideWorkspace(candidate) {
  const relative = path.relative(workspaceRoot, candidate)
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

async function validateFiles(input) {
  const requested = Array.isArray(input?.files) ? input.files.slice(0, MAX_FILES) : []
  const accepted = []
  const rejected = []
  const seen = new Set()

  for (const item of requested) {
    const rawPath = typeof item?.path === 'string' ? item.path.trim() : ''
    if (!rawPath) {
      rejected.push({ path: rawPath, reason: 'path is required' })
      continue
    }
    try {
      const resolved = await realpath(path.isAbsolute(rawPath) ? rawPath : path.resolve(workspaceRoot, rawPath))
      const fileStat = await stat(resolved)
      if (!isInsideWorkspace(resolved)) throw new Error('path is outside the workspace')
      if (!fileStat.isFile()) throw new Error('path is not a file')
      if (seen.has(resolved)) continue
      seen.add(resolved)
      const title = typeof item?.title === 'string' ? item.title.trim().slice(0, 120) : ''
      accepted.push({ path: resolved, ...(title ? { title } : {}) })
    } catch (err) {
      rejected.push({ path: rawPath, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  return { files: accepted, rejected, truncated: requested.length < (input?.files?.length ?? 0) }
}

const tool = {
  name: 'present_files',
  description: 'Select the user-facing files that should appear as file cards for this turn. Call immediately before the final response only when there are deliverable files.',
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        maxItems: MAX_FILES,
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Workspace-relative or absolute path to an existing file.' },
            title: { type: 'string', description: 'Optional concise user-facing title.' },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
    },
    required: ['files'],
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
      serverInfo: { name: 'spark-files', version: '1.0.0' },
    })
  } else if (message.method === 'tools/list') {
    result(message.id, { tools: [tool] })
  } else if (message.method === 'tools/call') {
    if (message.params?.name !== tool.name) {
      error(message.id, -32601, `Unknown tool: ${message.params?.name ?? ''}`)
      return
    }
    validateFiles(message.params?.arguments)
      .then((value) => result(message.id, { content: [{ type: 'text', text: JSON.stringify(value) }] }))
      .catch((err) => error(message.id, -32603, err instanceof Error ? err.message : String(err)))
  } else if (message.method === 'ping') {
    result(message.id, {})
  }
})
