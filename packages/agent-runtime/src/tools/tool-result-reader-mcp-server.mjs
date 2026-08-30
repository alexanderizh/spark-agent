#!/usr/bin/env node
import readline from 'node:readline'
import {
  listToolResultArtifacts,
  readToolResultArtifact,
  searchToolResultArtifact,
} from './tool-result-artifact-store.mjs'

const WORKSPACE_ROOT = process.env.SPARK_WORKSPACE_ROOT || ''

const TOOLS = [
  {
    name: 'list',
    description:
      '列出当前工作区最近归档的超长工具结果。原生 Bash 输出被截断且没有 artifactId 时，先调用本工具找到最新制品。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    },
  },
  {
    name: 'read',
    description:
      '按字符范围读取一个工具结果制品。使用 envelope 或 list 返回的完整 SHA-256 artifactId；根据 nextOffset 继续分页。',
    inputSchema: {
      type: 'object',
      required: ['artifactId'],
      properties: {
        artifactId: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        offset: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 40000, default: 8000 },
      },
    },
  },
  {
    name: 'search',
    description:
      '在完整工具结果制品中搜索普通文本，返回命中偏移和上下文片段；不把整份结果重新塞回上下文。',
    inputSchema: {
      type: 'object',
      required: ['artifactId', 'query'],
      properties: {
        artifactId: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        query: { type: 'string', minLength: 1, maxLength: 500 },
        caseSensitive: { type: 'boolean', default: false },
        maxMatches: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        contextChars: { type: 'integer', minimum: 0, maximum: 2000, default: 240 },
      },
    },
  },
]

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}

function rpcError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function handleTool(name, args) {
  switch (name) {
    case 'list':
      return {
        artifacts: listToolResultArtifacts(WORKSPACE_ROOT, { limit: integer(args.limit) }),
      }
    case 'read':
      return readToolResultArtifact(WORKSPACE_ROOT, string(args.artifactId), {
        offset: integer(args.offset),
        limit: integer(args.limit),
      })
    case 'search':
      return searchToolResultArtifact(WORKSPACE_ROOT, string(args.artifactId), string(args.query), {
        caseSensitive: args.caseSensitive === true,
        maxMatches: integer(args.maxMatches),
        contextChars: integer(args.contextChars),
      })
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false })
  rl.on('line', (line) => {
    let request
    try {
      request = JSON.parse(line)
    } catch {
      return
    }
    if (request.method === 'initialize') {
      result(request.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'spark_tool_results', version: '1.0.0' },
      })
      return
    }
    if (request.method === 'notifications/initialized') return
    if (request.method === 'tools/list') {
      result(request.id, { tools: TOOLS })
      return
    }
    if (request.method === 'tools/call') {
      try {
        const value = handleTool(request.params?.name, request.params?.arguments ?? {})
        result(request.id, {
          content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
          structuredContent: value,
        })
      } catch (error) {
        result(request.id, {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        })
      }
      return
    }
    if (request.method === 'resources/list') {
      result(request.id, { resources: [] })
      return
    }
    if (request.method === 'resources/templates/list') {
      result(request.id, { resourceTemplates: [] })
      return
    }
    if (request.method === 'prompts/list') {
      result(request.id, { prompts: [] })
      return
    }
    if (request.method === 'ping') {
      result(request.id, {})
      return
    }
    if (request.id != null) rpcError(request.id, -32601, `Method not found: ${request.method}`)
  })
}

function string(value) {
  return typeof value === 'string' ? value : ''
}

function integer(value) {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

main()
