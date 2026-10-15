#!/usr/bin/env node
/**
 * 桌面中继事件流回归：思考/正文 delta 按 seq 增量发送，慢轮询不重叠。
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const outputPath = join(scriptDir, `.smoke-mobile-bridge-stream-${process.pid}.mjs`)
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

try {
  await build({
    entryPoints: [join(desktopRoot, 'src/main/services/MobileBridgeService.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: outputPath,
    plugins: [
      {
        name: 'mobile-bridge-stream-smoke-logger',
        setup(buildApi) {
          buildApi.onResolve({ filter: /^@spark\/shared$/ }, () => ({
            path: 'shared-logger',
            namespace: 'smoke',
          }))
          buildApi.onLoad({ filter: /.*/, namespace: 'smoke' }, () => ({
            contents:
              'export const createLogger = () => ({ debug() {}, info() {}, warn() {}, error() {} })',
            loader: 'js',
          }))
        },
      },
    ],
  })
  const { MobileBridgeService } = await import(pathToFileURL(outputPath).href)
  const service = new MobileBridgeService()
  const userEvent = {
    id: 'evt-user',
    seq: 1,
    turnId: 'turn-1',
    type: 'user_message',
    timestamp: '2026-10-16T00:00:00.000Z',
    content: 'hello',
  }
  const events = [
    {
      id: 'evt-assistant',
      seq: 2,
      turnId: 'turn-1',
      type: 'assistant_message',
      timestamp: userEvent.timestamp,
      content: 'reply delta',
      mode: 'delta',
      segmentId: 'assistant-segment',
    },
    {
      id: 'evt-thinking',
      seq: 3,
      turnId: 'turn-1',
      type: 'agent_thinking',
      timestamp: userEvent.timestamp,
      content: 'thought delta',
      mode: 'delta',
      segmentId: 'thinking-segment',
    },
  ]

  let inFlight = 0
  let maxInFlight = 0
  const afterSeqCalls = []
  service.setDeps({
    getHistory: async () => ({ events: [userEvent], running: true }),
    getStreamEvents: async (_sessionId, afterSeq) => {
      afterSeqCalls.push(afterSeq)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await sleep(650)
      inFlight -= 1
      return afterSeq < 3
        ? { events: events.filter((event) => event.seq > afterSeq), nextSeq: 3 }
        : { events: [], nextSeq: afterSeq }
    },
  })

  const received = []
  const unsubscribe = service.addRelaySubscriber('session-1', (batch) => received.push(...batch))
  await sleep(2_250)
  unsubscribe()

  assert.deepEqual(
    received.map((event) => event.type),
    ['assistant_message', 'agent_thinking'],
  )
  assert.deepEqual(
    received.map((event) => event.seq),
    [2, 3],
  )
  assert.equal(maxInFlight, 1, 'stream queries must not overlap')
  assert.ok(afterSeqCalls.includes(1), 'active turn must start after its user event')
  assert.ok(afterSeqCalls.includes(3), 'poll cursor must advance after delivering deltas')

  console.log('smoke:mobile-bridge-stream 通过：思考/正文 delta、seq 游标、轮询互斥')
} finally {
  await rm(outputPath, { force: true })
}
