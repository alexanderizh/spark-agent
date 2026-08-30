import { stripTypeScriptTypes } from 'node:module'
import { createInterface } from 'node:readline'
import vm from 'node:vm'

const PROTOCOL_VERSION = 1
const pendingBrokerCalls = new Map()
let brokerSequence = 0
let invocationStarted = false

function writeFrame(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function safeConsole() {
  const emit = (level, values) => {
    const text = values
      .map((value) => {
        if (typeof value === 'string') return value
        try {
          return JSON.stringify(value)
        } catch {
          return String(value)
        }
      })
      .join(' ')
      .slice(0, 8_000)
    writeFrame({ protocolVersion: PROTOCOL_VERSION, type: 'log', level, text })
  }
  return Object.freeze({
    log: (...values) => emit('info', values),
    info: (...values) => emit('info', values),
    warn: (...values) => emit('warn', values),
    error: (...values) => emit('error', values),
  })
}

function requestTool(toolId, input) {
  const requestId = `broker-${++brokerSequence}`
  writeFrame({
    protocolVersion: PROTOCOL_VERSION,
    type: 'broker_request',
    requestId,
    capability: 'tools.call',
    toolId,
    input,
  })
  return new Promise((resolve, reject) => {
    pendingBrokerCalls.set(requestId, { resolve, reject })
  })
}

function createSdk() {
  const tools = Object.freeze({
    call: async (toolId, input = {}) => {
      if (typeof toolId !== 'string' || toolId.length === 0) {
        throw new Error('sdk.tools.call requires a non-empty tool id')
      }
      if (input == null || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('sdk.tools.call input must be an object')
      }
      return requestTool(toolId, input)
    },
  })
  return Object.freeze({ tools })
}

async function executeInvocation(frame) {
  if (frame.protocolVersion !== PROTOCOL_VERSION || frame.type !== 'invoke') {
    throw new Error('Unsupported custom tool worker protocol')
  }
  if (typeof frame.source !== 'string') throw new Error('Worker source is required')

  const javascript = stripTypeScriptTypes(frame.source, {
    mode: 'transform',
    sourceMap: false,
  })
  const context = vm.createContext({
    console: safeConsole(),
    TextDecoder,
    TextEncoder,
    URL,
    URLSearchParams,
    structuredClone,
  })
  const module = new vm.SourceTextModule(javascript, {
    context,
    identifier: `spark-custom-tool:${frame.toolId ?? 'draft'}`,
    initializeImportMeta(meta) {
      meta.url = 'spark-tool://local/entry.ts'
    },
    importModuleDynamically() {
      throw new Error('Dynamic imports are not available in custom code tools')
    },
  })
  await module.link(() => {
    throw new Error('Imports are not available in custom code tools; compose capabilities via sdk')
  })
  await module.evaluate()
  const handler = module.namespace.default
  if (typeof handler !== 'function') {
    throw new Error('Code tool must export a default async function')
  }
  const output = await handler(structuredClone(frame.input ?? {}), createSdk())
  const serialized = JSON.stringify(output ?? null)
  const bytes = Buffer.byteLength(serialized)
  if (bytes > frame.maxOutputBytes) {
    throw new Error(`Code tool output exceeds ${frame.maxOutputBytes} bytes`)
  }
  writeFrame({
    protocolVersion: PROTOCOL_VERSION,
    type: 'result',
    requestId: frame.requestId,
    output: output ?? null,
    bytes,
  })
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    writeFrame({ protocolVersion: PROTOCOL_VERSION, type: 'fatal', message: 'Invalid JSON frame' })
    process.exitCode = 2
    input.close()
    return
  }

  if (frame?.type === 'broker_response') {
    const pending = pendingBrokerCalls.get(frame.requestId)
    if (pending == null) return
    pendingBrokerCalls.delete(frame.requestId)
    if (frame.ok === true) pending.resolve(frame.output)
    else
      pending.reject(
        new Error(typeof frame.message === 'string' ? frame.message : 'Tool call failed'),
      )
    return
  }

  if (invocationStarted) {
    writeFrame({
      protocolVersion: PROTOCOL_VERSION,
      type: 'fatal',
      message: 'Worker accepts exactly one invocation',
    })
    process.exitCode = 2
    input.close()
    return
  }
  invocationStarted = true
  void executeInvocation(frame)
    .catch((error) => {
      writeFrame({
        protocolVersion: PROTOCOL_VERSION,
        type: 'error',
        requestId: frame?.requestId,
        message: errorMessage(error),
      })
      process.exitCode = 1
    })
    .finally(() => input.close())
})
