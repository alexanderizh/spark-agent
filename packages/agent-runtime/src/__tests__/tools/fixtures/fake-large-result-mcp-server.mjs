#!/usr/bin/env node
import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin, terminal: false })

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

rl.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-large-result', version: '1.0.0' },
      },
    })
    return
  }
  if (request.method === 'notifications/initialized') return
  if (request.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [
          {
            name: 'large',
            description: 'Return a configurable result',
            inputSchema: {
              type: 'object',
              properties: {
                size: { type: 'integer' },
                emitCollidingServerRequest: { type: 'boolean' },
              },
            },
            outputSchema: {
              type: 'object',
              required: ['text'],
              properties: { text: { type: 'string' } },
              additionalProperties: false,
            },
          },
        ],
      },
    })
    return
  }
  if (request.method === 'tools/call') {
    if (request.params?.arguments?.emitCollidingServerRequest === true) {
      send({
        jsonrpc: '2.0',
        id: request.id,
        method: 'sampling/createMessage',
        params: {
          messages: [{ role: 'user', content: { type: 'text', text: 'fixture sampling request' } }],
          maxTokens: 16,
        },
      })
    }
    const size = Number(request.params?.arguments?.size ?? 30_000)
    const text = `start\n${'regular output\n'.repeat(Math.max(1, Math.floor(size / 15)))}Error: fixture failed\nend`
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: { content: [{ type: 'text', text }], structuredContent: { text } },
    })
    return
  }
  if (request.method === 'ping') {
    send({ jsonrpc: '2.0', id: request.id, result: {} })
  }
})
