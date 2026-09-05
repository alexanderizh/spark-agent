import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineTool, serveTools } from './index.js'

describe('serveTools', () => {
  it('handles initialize, typed invoke, logs and progress without handwritten frames', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let output = ''
    stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    const server = serveTools({
      stdin,
      stdout,
      tools: {
        echo: defineTool({
          input: z.object({ text: z.string() }),
          run: ({ text }, context) => {
            context.log('info', 'echo started')
            context.progress(0.5, 'halfway')
            return { text }
          },
        }) as never,
      },
    })
    stdin.write(
      `${JSON.stringify({ protocolVersion: 'spark-tool-process-v1', requestId: 'init', sequence: 0, type: 'initialize', packageId: 'acme.echo', packageVersion: '1.0.0', capabilityProtocolVersion: 1 })}\n`,
    )
    stdin.write(
      `${JSON.stringify({ protocolVersion: 'spark-tool-process-v1', requestId: 'invoke', invocationId: 'inv-1', sequence: 1, type: 'invoke', toolName: 'echo', input: { text: 'hello' }, context: {} })}\n`,
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    const frames = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(frames.map((frame) => frame.type)).toEqual(['ready', 'log', 'progress', 'result'])
    expect(frames.at(-1)?.result).toEqual({ text: 'hello' })
    server.close()
  })
})
