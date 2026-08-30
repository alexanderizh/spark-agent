import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

const MAX_FILES = 20
const MAX_CHANGES = 200
const CHANGE_TYPES = new Set(['create', 'modify', 'delete', 'rename'])
const INTERNAL_WORKTREE_PREFIXES = ['.claude/worktrees', '.worktrees', '.spark/worktrees']
const workspaceRoot = await realpath(process.env.SPARK_WORKSPACE_ROOT || process.cwd())

function result(id, value) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: value })}\n`)
}

function error(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}

function isInsideWorkspace(candidate) {
  const relative = path.relative(workspaceRoot, candidate)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

function isInternalWorktreePath(candidate) {
  const relative = path.relative(workspaceRoot, candidate).replaceAll(path.sep, '/')
  return INTERNAL_WORKTREE_PREFIXES.some(
    (prefix) => relative === prefix || relative.startsWith(`${prefix}/`),
  )
}

function resolveWorkspacePath(rawPath) {
  const resolved = path.resolve(workspaceRoot, rawPath)
  if (!isInsideWorkspace(resolved)) throw new Error('path is outside the workspace')
  if (isInternalWorktreePath(resolved)) throw new Error('nested agent worktrees are not reportable')
  return resolved
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
      const resolved = await realpath(
        path.isAbsolute(rawPath) ? rawPath : path.resolve(workspaceRoot, rawPath),
      )
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

async function validateChanges(input) {
  const requested = Array.isArray(input?.changes) ? input.changes.slice(0, MAX_CHANGES) : []
  const accepted = []
  const rejected = []
  const seen = new Set()

  for (const item of requested) {
    const rawPath = typeof item?.path === 'string' ? item.path.trim() : ''
    const changeType = typeof item?.changeType === 'string' ? item.changeType : ''
    if (!rawPath || !CHANGE_TYPES.has(changeType)) {
      rejected.push({ path: rawPath, reason: 'path and a valid changeType are required' })
      continue
    }
    try {
      let resolved = resolveWorkspacePath(rawPath)
      if (changeType !== 'delete') {
        resolved = await realpath(resolved)
        if (!isInsideWorkspace(resolved)) throw new Error('path is outside the workspace')
        if (isInternalWorktreePath(resolved))
          throw new Error('nested agent worktrees are not reportable')
        if (!(await stat(resolved)).isFile()) throw new Error('path is not a file')
      }

      let oldPath
      if (changeType === 'rename') {
        const rawOldPath = typeof item?.oldPath === 'string' ? item.oldPath.trim() : ''
        if (!rawOldPath) throw new Error('oldPath is required for rename')
        oldPath = resolveWorkspacePath(rawOldPath)
      }

      const key = `${changeType}:${resolved}:${oldPath ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      accepted.push({ path: resolved, changeType, ...(oldPath ? { oldPath } : {}) })
    } catch (err) {
      rejected.push({ path: rawPath, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  return {
    changes: accepted,
    rejected,
    truncated: requested.length < (input?.changes?.length ?? 0),
  }
}

const presentFilesTool = {
  name: 'present_files',
  description:
    'Select the user-facing files that should appear as file cards for this turn. Call immediately before the final response only when there are deliverable files.',
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        maxItems: MAX_FILES,
        items: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Workspace-relative or absolute path to an existing file.',
            },
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

const reportFileChangesTool = {
  name: 'report_file_changes',
  description:
    'Report the exact workspace files created, modified, deleted, or renamed by this agent during the current turn. This drives the turn change summary and must exclude pre-existing changes, other sessions, dependencies, caches, build output, and nested agent worktrees.',
  inputSchema: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        maxItems: MAX_CHANGES,
        items: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Workspace-relative or absolute path changed during this turn.',
            },
            changeType: { type: 'string', enum: ['create', 'modify', 'delete', 'rename'] },
            oldPath: {
              type: 'string',
              description: 'Previous workspace path; required only for rename.',
            },
          },
          required: ['path', 'changeType'],
          additionalProperties: false,
        },
      },
    },
    required: ['changes'],
    additionalProperties: false,
  },
}

const tools = [presentFilesTool, reportFileChangesTool]

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
    result(message.id, { tools })
  } else if (message.method === 'tools/call') {
    const toolName = message.params?.name
    if (!tools.some((candidate) => candidate.name === toolName)) {
      error(message.id, -32601, `Unknown tool: ${message.params?.name ?? ''}`)
      return
    }
    const operation = toolName === reportFileChangesTool.name ? validateChanges : validateFiles
    operation(message.params?.arguments)
      .then((value) =>
        result(message.id, { content: [{ type: 'text', text: JSON.stringify(value) }] }),
      )
      .catch((err) => error(message.id, -32603, err instanceof Error ? err.message : String(err)))
  } else if (message.method === 'ping') {
    result(message.id, {})
  }
})
