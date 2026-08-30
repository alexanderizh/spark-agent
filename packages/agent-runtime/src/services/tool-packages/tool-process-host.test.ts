import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolPackageManifest } from '@spark/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolHostCapabilityBroker } from './tool-host-capability-broker.js'
import { ToolProcessHost } from './tool-process-host.js'

const roots: string[] = []

const runnerSource = `
import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
let sequence = 0
const pending = new Map()
function send(frame) {
  process.stdout.write(JSON.stringify({
    protocolVersion: 'spark-tool-process-v1',
    sequence: sequence++,
    ...frame,
  }) + '\\n')
}
rl.on('line', (line) => {
  const frame = JSON.parse(line)
  if (frame.type === 'initialize') {
    if (process.env.INIT_MODE === 'hang') return
    if (process.env.INIT_MODE === 'delay') {
      setTimeout(() => send({ type: 'ready', requestId: frame.requestId }), 50)
      return
    }
    if (process.env.INIT_MODE === 'wrong-response') {
      send({
        type: 'result', requestId: frame.requestId,
        invocationId: 'wrong-initialize-response', result: null,
      })
      return
    }
    send({ type: 'ready', requestId: frame.requestId })
    return
  }
  if (frame.type === 'invoke') {
    if (frame.input?.oversize) {
      process.stdout.write('x'.repeat(4 * 1024 * 1024 + 1))
      return
    }
    if (frame.input?.capability) {
      const capabilityRequestId = 'cap-' + frame.requestId
      pending.set(capabilityRequestId, frame)
      send({
        type: 'capability.request',
        requestId: capabilityRequestId,
        invocationId: frame.invocationId,
        capability: frame.input.capability,
        input: frame.input.payload,
      })
      return
    }
    send({
      type: 'result',
      requestId: frame.requestId,
      invocationId: frame.invocationId,
      result: { pid: process.pid, input: frame.input, env: process.env.TOOL_FIXTURE_VALUE },
    })
    return
  }
  if (frame.type === 'capability.result' || frame.type === 'capability.error') {
    const original = pending.get(frame.requestId)
    pending.delete(frame.requestId)
    if (frame.type === 'capability.error') {
      send({
        type: 'error',
        requestId: original.requestId,
        invocationId: original.invocationId,
        code: frame.code,
        message: frame.message,
      })
    } else {
      send({
        type: 'result',
        requestId: original.requestId,
        invocationId: original.invocationId,
        result: frame.result,
      })
    }
    return
  }
  if (frame.type === 'shutdown') process.exit(0)
})
`

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-tool-process-host-'))
  roots.push(root)
  await writeFile(join(root, 'runner.mjs'), runnerSource, 'utf8')
  return root
}

function manifest(
  lifecycle: 'per-call' | 'persistent',
  capabilities: string[] = [],
): ToolPackageManifest {
  return {
    schemaVersion: 1,
    id: 'acme.process-fixture',
    version: '1.0.0',
    name: 'Process fixture',
    description: 'Tool process host fixture',
    runtime: {
      adapter: 'process',
      protocol: 'spark-tool-process-v1',
      command: process.execPath,
      args: ['runner.mjs'],
      lifecycle,
    },
    tools: [
      {
        name: 'echo_value',
        title: 'Echo value',
        description: 'Echo a value through a standalone process',
        inputSchema: { type: 'object', properties: {} },
        risk: 'read',
        effect: 'read',
        idempotency: 'safe',
      },
    ],
    environment: [],
    permissions: {
      declaredOsEffects: ['process.spawn'],
      requiredSparkCapabilities: capabilities,
      optionalSparkCapabilities: [],
    },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ToolProcessHost', () => {
  it('executes arbitrary package code out of process with declared environment', async () => {
    const root = await fixture()
    const host = new ToolProcessHost()
    const result = await host.invoke({
      manifest: manifest('per-call'),
      installPath: root,
      toolName: 'echo_value',
      input: { value: 42 },
      context: { environment: { TOOL_FIXTURE_VALUE: 'configured' } },
    })
    expect(result).toMatchObject({ input: { value: 42 }, env: 'configured' })
    await host.dispose()
  })

  it('reuses persistent package processes across invocations', async () => {
    const root = await fixture()
    const host = new ToolProcessHost()
    const request = {
      manifest: manifest('persistent'),
      installPath: root,
      toolName: 'echo_value',
    }
    const first = (await host.invoke({ ...request, input: { call: 1 } })) as { pid: number }
    const second = (await host.invoke({ ...request, input: { call: 2 } })) as { pid: number }
    expect(second.pid).toBe(first.pid)
    await host.dispose()
  })

  it('shares one persistent process while initialization is still in flight', async () => {
    const root = await fixture()
    const host = new ToolProcessHost()
    const request = {
      manifest: manifest('persistent'),
      installPath: root,
      toolName: 'echo_value',
      context: { environment: { INIT_MODE: 'delay' } },
    }
    const [first, second] = (await Promise.all([
      host.invoke({ ...request, input: { call: 1 } }),
      host.invoke({ ...request, input: { call: 2 } }),
    ])) as [{ pid: number }, { pid: number }]
    expect(second.pid).toBe(first.pid)
    await host.dispose()
  })

  it('invalidates persistent package processes after runtime configuration changes', async () => {
    const root = await fixture()
    const host = new ToolProcessHost()
    const request = {
      manifest: manifest('persistent'),
      installPath: root,
      toolName: 'echo_value',
      input: {},
    }
    const first = (await host.invoke(request)) as { pid: number }
    await host.invalidatePackage('acme.process-fixture')
    const second = (await host.invoke(request)) as { pid: number }
    expect(second.pid).not.toBe(first.pid)
    await host.dispose()
  })

  it('terminates a process that never completes initialization', async () => {
    const root = await fixture()
    const host = new ToolProcessHost(undefined, undefined, 50)
    await expect(
      host.invoke({
        manifest: manifest('persistent'),
        installPath: root,
        toolName: 'echo_value',
        input: {},
        context: { environment: { INIT_MODE: 'hang' } },
      }),
    ).rejects.toThrow(/timed out: initialize/)
    await host.dispose()
  })

  it('rejects a response frame that does not match the pending request type', async () => {
    const root = await fixture()
    const host = new ToolProcessHost()
    await expect(
      host.invoke({
        manifest: manifest('per-call'),
        installPath: root,
        toolName: 'echo_value',
        input: {},
        context: { environment: { INIT_MODE: 'wrong-response' } },
      }),
    ).rejects.toThrow(/response type mismatch/)
    await host.dispose()
  })

  it('validates nested tool input at the process execution boundary', async () => {
    const root = await fixture()
    const host = new ToolProcessHost()
    const packageManifest = manifest('per-call')
    packageManifest.tools[0]!.inputSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        options: {
          type: 'object',
          properties: { retries: { type: 'integer' } },
          required: ['retries'],
        },
      },
      required: ['options'],
    }
    await expect(
      host.invoke({
        manifest: packageManifest,
        installPath: root,
        toolName: 'echo_value',
        input: { options: { retries: 'invalid' } },
      }),
    ).rejects.toThrow(/Invalid Tool Package input/)
    await host.dispose()
  })

  it('brokers only manifest-declared Spark capabilities', async () => {
    const root = await fixture()
    const broker = new ToolHostCapabilityBroker()
    broker.register({
      name: 'files.upload',
      invoke: async (context, input) => ({ packageId: context.packageId, uploaded: input }),
    })
    const host = new ToolProcessHost(broker)
    await expect(
      host.invoke({
        manifest: manifest('per-call', ['files.upload']),
        installPath: root,
        toolName: 'echo_value',
        input: { capability: 'files.upload', payload: { path: 'report.csv' } },
        grantedCapabilities: new Set(['files.upload']),
      }),
    ).resolves.toEqual({
      packageId: 'acme.process-fixture',
      uploaded: { path: 'report.csv' },
    })
    await expect(
      host.invoke({
        manifest: manifest('per-call'),
        installPath: root,
        toolName: 'echo_value',
        input: { capability: 'files.upload', payload: {} },
      }),
    ).rejects.toThrow(/CAPABILITY_NOT_DECLARED/)
    await host.dispose()
  })

  it('rejects declared but ungranted Spark capabilities', async () => {
    const root = await fixture()
    const broker = new ToolHostCapabilityBroker()
    broker.register({ name: 'files.upload', invoke: async () => ({ ok: true }) })
    const host = new ToolProcessHost(broker)
    await expect(
      host.invoke({
        manifest: manifest('per-call', ['files.upload']),
        installPath: root,
        toolName: 'echo_value',
        input: { capability: 'files.upload', payload: {} },
      }),
    ).rejects.toThrow(/CAPABILITY_NOT_AUTHORIZED/)
    await host.dispose()
  })

  it('kills a process that emits an oversized unterminated protocol frame', async () => {
    const root = await fixture()
    const host = new ToolProcessHost()
    await expect(
      host.invoke({
        manifest: manifest('per-call'),
        installPath: root,
        toolName: 'echo_value',
        input: { oversize: true },
      }),
    ).rejects.toThrow(/larger than 4 MB/)
    await host.dispose()
  })
})
