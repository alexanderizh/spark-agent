import { loadConfiguredModel } from '../config/model-config.js'
import { loadSparkSettings, resolveEngineSettings } from '../config/settings.js'
import { errorMessage } from '../config/config-file.js'
import { createResilientEnv } from '../env.js'
import { SPARK_ENGINE_VERSION } from '../version.js'
import { Agent } from '../sdk/agent.js'
import { startServeServer, type ServeHandshake } from './server.js'

/**
 * `spark serve` entry point: wires the configured model runtime into a
 * loopback App Server and blocks until the process is signaled.
 *
 * The startup handshake is the only stdout line: one JSON object with the
 * bearer token, bound port, and protocol version. Everything else (request
 * logs, warnings) goes to stderr so hosts can machine-parse the handshake.
 */
export interface ServeCommandOptions {
  readonly port?: number
  readonly host?: string
  readonly model?: string
  readonly json: boolean
}

export async function runServeCommand(options: ServeCommandOptions): Promise<number> {
  const cwd = process.cwd()
  const settings = await loadSparkSettings({ cwd })
  const engineSettings = resolveEngineSettings(settings)
  const runtime = await loadConfiguredModel({
    cwd,
    ...(options.model === undefined ? {} : { model: options.model }),
  })
  const managed = await createResilientEnv({
    cwd,
    llm: runtime.service,
    skillsEnabled: true,
    ...engineSettings,
  })
  if (managed.mcpError !== undefined) {
    process.stderr.write(
      `MCP servers were not connected: ${errorMessage(new Error(managed.mcpError))}\n` +
        'Continuing without MCP tools.\n',
    )
  }

  const agent = Agent.open({ cwd, env: managed.env })
  const handle = await startServeServer({
    agent,
    engineVersion: SPARK_ENGINE_VERSION,
    model: runtime.modelId,
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.port === undefined ? {} : { port: options.port }),
    log: (line) => process.stderr.write(`spark serve: ${line}\n`),
  })

  const handshake: ServeHandshake = handle.handshake
  process.stdout.write(`${JSON.stringify(handshake)}\n`)
  process.stderr.write(
    `spark serve ${SPARK_ENGINE_VERSION} listening on ${options.host ?? '127.0.0.1'}:${handshake.port} ` +
      `model=${runtime.modelId}\n`,
  )

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    process.stderr.write('spark serve: shutting down\n')
    await handle.close().catch(() => undefined)
    await managed.close().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGINT', () => {
    void shutdown()
  })
  process.on('SIGTERM', () => {
    void shutdown()
  })
  // The server keeps the process alive; this promise never resolves normally.
  return new Promise<number>(() => {
    /* resolved only by shutdown() calling process.exit */
  })
}
