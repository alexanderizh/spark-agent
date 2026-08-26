#!/usr/bin/env node

import { createInterface } from 'node:readline/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import {
  inspectConfiguredModels,
  loadConfiguredModel,
  type ConfiguredModelCatalog,
  type ConfiguredModelRuntime,
} from '../config/model-config.js'
import { createDefaultEnv, defaultSparkHome } from '../env.js'
import type { AgentEvent } from '../events/schema.js'
import type { LlmDelta, ReasoningEffort } from '../llm/types.js'
import { isReasoningEffort } from '../llm/types.js'
import { isPermissionMode, type PermissionMode } from '../permission/types.js'
import { Agent, type AgentSession } from '../sdk/agent.js'
import {
  buildInstallReport,
  findSparkOnPath,
  initSparkConfig,
  installLauncher,
  launcherPathFor,
  resolveSparkInstall,
  uninstallLauncher,
  type InstallReport,
} from './install.js'
import { installWarnings, renderInstallReport } from './diagnostics.js'
import { executeUpdate } from './update.js'
import { uninstallSparkPackage } from './uninstall-package.js'
import { NOTICE_TIMEOUT_MS, updateNoticeLine } from './update-notice.js'

interface CliOptions {
  readonly help: boolean
  readonly version: boolean
  readonly plain: boolean
  readonly json: boolean
  readonly prompt?: string
  readonly model?: string
  readonly bin?: string
  readonly base?: string
  readonly target?: string
  readonly force: boolean
  readonly check: boolean
  readonly allowPrerelease: boolean
  readonly package: boolean
  readonly permissionMode: PermissionMode
  readonly reasoningEffort?: ReasoningEffort
  readonly positionals: readonly string[]
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let options: CliOptions
  try {
    options = parseCli(argv)
  } catch (error) {
    process.stderr.write(`${terminalSafe(message(error))}\n\n${helpText()}`)
    return 2
  }
  if (options.help) {
    process.stdout.write(helpText(await runningVersion()))
    return 0
  }
  if (options.version) {
    process.stdout.write(`${await runningVersion()}\n`)
    return 0
  }
  if (options.positionals[0] === 'serve') {
    process.stderr.write(
      'spark serve is not part of the M1 kernel slice; the versioned App Server lands in M3.\n',
    )
    return 2
  }
  if (options.positionals[0] === 'models' || options.positionals[0] === 'doctor') {
    if (options.positionals.length > 1 || options.prompt) {
      process.stderr.write(`${options.positionals[0]} does not accept a task prompt.\n`)
      return 2
    }
    return inspectModels(options.positionals[0], options.json)
  }
  const maintenance = options.positionals[0]
  if (maintenance === 'update' || maintenance === 'upgrade') {
    if (options.positionals.length > 1 || options.prompt) {
      process.stderr.write(`spark ${maintenance} does not accept extra arguments.\n`)
      return 2
    }
    return executeUpdate(
      {
        checkOnly: options.check,
        ...(options.base === undefined ? {} : { base: options.base }),
        ...(options.target === undefined ? {} : { target: options.target }),
        allowPrerelease: options.allowPrerelease,
        json: options.json,
        sparkHome: defaultSparkHome(),
      },
      {
        stdout: (text) => {
          process.stdout.write(text)
        },
        stderr: (text) => {
          process.stderr.write(text)
        },
      },
    )
  }
  if (maintenance === 'install' || maintenance === 'uninstall' || maintenance === 'init') {
    if (options.positionals.length > 1 || options.prompt) {
      process.stderr.write(`spark ${maintenance} does not accept extra arguments.\n`)
      return 2
    }
    return runMaintenanceCommand(maintenance, options)
  }

  const positionalPrompt = options.positionals.join(' ').trim()
  let prompt = options.prompt ?? positionalPrompt
  if (!prompt && !process.stdin.isTTY) prompt = (await readStdin()).trim()

  const tuiAvailable =
    !options.plain &&
    !options.json &&
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    process.env.CI !== 'true' &&
    process.env.TERM !== 'dumb'
  if (tuiAvailable && !prompt) {
    // Interactive first-run contract: enter the TUI even without a configured
    // model — the onboarding picker resolves or configures one in-terminal.
    // The daily update notice check starts here and is awaited with a hard
    // budget after the TUI exits, so a slow release host never blocks startup.
    const noticePromise = updateNoticeLine({
      sparkHome: defaultSparkHome(),
      cwd: process.cwd(),
      currentVersion: await runningVersion(),
    }).catch(() => undefined)
    const { runTui } = await import('../tui/index.js')
    let runtime: ConfiguredModelRuntime | undefined
    let startupError: string | undefined
    try {
      runtime = await loadConfiguredModel({
        cwd: process.cwd(),
        ...(options.model === undefined ? {} : { model: options.model }),
      })
    } catch (error) {
      startupError = terminalSafe(message(error))
    }
    await runTui({
      cwd: process.cwd(),
      version: await runningVersion(),
      permissionMode: options.permissionMode,
      ...(options.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: options.reasoningEffort }),
      ...(runtime ? { llm: runtime.service, model: runtime.modelId } : { startupError }),
    })
    const notice = await Promise.race([
      noticePromise,
      new Promise<undefined>((resolveNotice) => {
        setTimeout(resolveNotice, NOTICE_TIMEOUT_MS, undefined)
      }),
    ])
    if (notice !== undefined) process.stderr.write(`${notice}\n`)
    return 0
  }

  let runtime: ConfiguredModelRuntime
  try {
    runtime = await loadConfiguredModel({
      cwd: process.cwd(),
      ...(options.model === undefined ? {} : { model: options.model }),
    })
  } catch (error) {
    process.stderr.write(`${terminalSafe(message(error))}\n`)
    return 2
  }
  if (prompt) return runOnce(prompt, options, runtime)

  if (process.stdin.isTTY && process.stdout.isTTY && options.plain) {
    return runPlainRepl(runtime, options.permissionMode, options.reasoningEffort)
  }
  process.stderr.write(
    'No task was provided. Pass a prompt, pipe stdin, or run spark in an interactive TTY.\n',
  )
  return 2
}

async function runMaintenanceCommand(
  command: 'install' | 'uninstall' | 'init',
  options: CliOptions,
): Promise<number> {
  const binDir = resolve(options.bin ?? join(defaultSparkHome(), 'bin'))
  try {
    if (command === 'init') {
      const result = await initSparkConfig(defaultSparkHome())
      if (result.created) {
        process.stdout.write(
          `Created ${result.path} with a starter configuration.\n` +
            'Next: export your provider credential (see api_key_env in the file), then run `spark models`.\n',
        )
      } else {
        process.stdout.write(`${result.path} already exists; leaving it unchanged.\n`)
      }
      return 0
    }
    if (command === 'uninstall') {
      if (options.package) {
        return await uninstallSparkPackage(
          { sparkHome: defaultSparkHome(), binDir },
          {
            stdout: (text) => {
              process.stdout.write(text)
            },
            stderr: (text) => {
              process.stderr.write(text)
            },
          },
          options.json,
        )
      }
      const result = await uninstallLauncher({ binDir })
      const launcher = launcherPathFor(binDir, process.platform)
      process.stdout.write(
        result === 'removed'
          ? `Removed launcher ${launcher}.\n`
          : `No spark launcher found at ${launcher}.\n`,
      )
      return 0
    }
    const install = await resolveSparkInstall()
    const result = await installLauncher({ install, binDir, force: options.force })
    const candidates = await findSparkOnPath()
    process.stdout.write(
      `Spark v${install.version} at ${install.root}\n` +
        (result.replaced ? 'Replaced existing launcher:\n' : 'Installed launcher:\n') +
        `  ${result.launcherPath} -> ${install.entry}\n`,
    )
    for (const warning of installWarnings(binDir, candidates, process.env.PATH)) {
      process.stdout.write(`${warning}\n`)
    }
    process.stdout.write('Verify with: spark doctor\n')
    return 0
  } catch (error) {
    process.stderr.write(`${terminalSafe(message(error))}\n`)
    return 2
  }
}

async function inspectModels(command: 'models' | 'doctor', json: boolean): Promise<number> {
  let catalog: ConfiguredModelCatalog
  try {
    catalog = await inspectConfiguredModels({ cwd: process.cwd() })
  } catch (error) {
    process.stderr.write(`${terminalSafe(message(error))}\n`)
    return 2
  }
  let configurationError: string | undefined
  if (command === 'doctor') {
    try {
      await loadConfiguredModel({ cwd: process.cwd() })
    } catch (error) {
      configurationError = terminalSafe(message(error))
    }
  }
  let report: InstallReport | undefined
  let reportError: string | undefined
  if (command === 'doctor') {
    try {
      report = await buildInstallReport({
        install: await resolveSparkInstall(),
        sparkHome: defaultSparkHome(),
      })
    } catch (error) {
      reportError = terminalSafe(message(error))
    }
  }
  const exitCode = catalog.entries.length > 0 && !configurationError ? 0 : 1
  if (json) {
    process.stdout.write(
      `${JSON.stringify({
        ...catalog,
        configurationReady: !configurationError,
        ...(configurationError ? { configurationError } : {}),
        ...(report ? { install: report } : reportError ? { installError: reportError } : {}),
      })}\n`,
    )
    return exitCode
  }
  if (command === 'doctor') {
    process.stdout.write(
      `SparkWork bridge: ${catalog.sparkWorkConnected ? 'connected' : 'not connected'}\n`,
    )
    if (catalog.sparkWorkDiagnostic) {
      process.stdout.write(`Diagnostic: ${terminalSafe(catalog.sparkWorkDiagnostic)}\n`)
    }
    if (catalog.sparkWorkStaleBridgeDescriptors > 0) {
      process.stdout.write(
        `Stale bridge descriptors: ${catalog.sparkWorkStaleBridgeDescriptors} (left by SparkWork instances that are no longer running; ignored)\n`,
      )
    }
    process.stdout.write(`Selected model: ${terminalSafe(catalog.selectedModel ?? 'none')}\n`)
    process.stdout.write(`Available models: ${catalog.entries.length}\n`)
    process.stdout.write(
      `Configuration: ${configurationError ? `error — ${configurationError}` : 'ready'}\n`,
    )
    if (report) process.stdout.write(renderInstallReport(report))
    else if (reportError) process.stdout.write(`Install: unavailable — ${reportError}\n`)
    return exitCode
  }
  if (catalog.entries.length === 0) {
    process.stdout.write(
      'No models are available. Open SparkWork, or run `spark init` to configure ~/.spark/config.toml.\n',
    )
    if (catalog.sparkWorkDiagnostic) {
      process.stdout.write(`${terminalSafe(catalog.sparkWorkDiagnostic)}\n`)
    }
    return 1
  }
  for (const entry of catalog.entries) {
    const marker = entry.selected ? '*' : ' '
    process.stdout.write(
      `${marker} ${terminalSafe(entry.model)}  ${terminalSafe(entry.providerName)}  ${entry.protocol}  [${entry.source}]\n`,
    )
  }
  return 0
}

function parseCli(argv: readonly string[]): CliOptions {
  const parsed = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'V', default: false },
      plain: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      prompt: { type: 'string', short: 'p' },
      model: { type: 'string', short: 'm' },
      bin: { type: 'string' },
      base: { type: 'string' },
      target: { type: 'string' },
      check: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'allow-prerelease': { type: 'boolean', default: false },
      package: { type: 'boolean', default: false },
      effort: { type: 'string' },
      'permission-mode': { type: 'string' },
      'dangerously-skip-permissions': { type: 'boolean', default: false },
      'output-format': { type: 'string' },
    },
  })
  const outputFormat = parsed.values['output-format']
  if (outputFormat && !['text', 'json', 'stream-json'].includes(outputFormat)) {
    throw new Error(`Unsupported --output-format: ${outputFormat}`)
  }
  const configuredPermissionMode = parsed.values['permission-mode']
  if (configuredPermissionMode !== undefined && !isPermissionMode(configuredPermissionMode)) {
    throw new Error(`Unsupported --permission-mode: ${configuredPermissionMode}`)
  }
  const configuredEffort = parsed.values.effort
  if (configuredEffort !== undefined && !isReasoningEffort(configuredEffort)) {
    throw new Error(`Unsupported --effort: ${configuredEffort} (off | low | medium | high)`)
  }
  const dangerousBypass = parsed.values['dangerously-skip-permissions'] ?? false
  if (dangerousBypass && configuredPermissionMode && configuredPermissionMode !== 'bypass') {
    throw new Error('--dangerously-skip-permissions conflicts with --permission-mode')
  }
  return {
    help: parsed.values.help ?? false,
    version: parsed.values.version ?? false,
    plain: parsed.values.plain ?? outputFormat === 'text',
    json: parsed.values.json ?? (outputFormat === 'json' || outputFormat === 'stream-json'),
    ...(parsed.values.prompt === undefined ? {} : { prompt: parsed.values.prompt }),
    ...(parsed.values.model === undefined ? {} : { model: parsed.values.model }),
    ...(parsed.values.bin === undefined ? {} : { bin: parsed.values.bin }),
    ...(parsed.values.base === undefined ? {} : { base: parsed.values.base }),
    ...(parsed.values.target === undefined ? {} : { target: parsed.values.target }),
    force: parsed.values.force ?? false,
    check: parsed.values.check ?? false,
    allowPrerelease: parsed.values['allow-prerelease'] ?? false,
    package: parsed.values.package ?? false,
    permissionMode: dangerousBypass ? 'bypass' : (configuredPermissionMode ?? 'default'),
    ...(configuredEffort === undefined ? {} : { reasoningEffort: configuredEffort }),
    positionals: parsed.positionals,
  }
}

async function runOnce(
  prompt: string,
  options: CliOptions,
  runtime: ConfiguredModelRuntime,
): Promise<number> {
  const agent = createConfiguredAgent(runtime)
  warnPermissionBypass(options.permissionMode)
  const session = await agent.newSession({
    output: options.json ? 'json' : 'text',
    model: runtime.modelId,
    route: runtime.route,
    config: runtime.configSnapshot,
    permissionMode: options.permissionMode,
  })
  if (options.json) {
    for await (const event of session.events()) {
      process.stdout.write(`${JSON.stringify(event)}\n`)
    }
  }
  const controller = new AbortController()
  const onSigint = () => {
    controller.abort('SIGINT')
  }
  process.once('SIGINT', onSigint)
  let wroteText = false
  try {
    const result = await session.turn(prompt, {
      signal: controller.signal,
      ...(options.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: options.reasoningEffort }),
      onEvent: options.json
        ? (event) => {
            process.stdout.write(`${JSON.stringify(event)}\n`)
          }
        : (event) => {
            renderPlainEvent(event)
          },
      onDelta: options.json
        ? undefined
        : (delta) => {
            if (delta.type === 'text') {
              wroteText = true
              process.stdout.write(delta.text)
            }
          },
    })
    if (!options.json && wroteText) process.stdout.write('\n')
    if (result.terminal.type === 'turn.completed') return 0
    if (result.terminal.type === 'turn.cancelled') return 130
    return 1
  } finally {
    process.removeListener('SIGINT', onSigint)
  }
}

async function runPlainRepl(
  runtime: ConfiguredModelRuntime,
  permissionMode: PermissionMode,
  reasoningEffort: ReasoningEffort | undefined,
): Promise<number> {
  const agent = createConfiguredAgent(runtime)
  warnPermissionBypass(permissionMode)
  const session = await agent.newSession({
    output: 'plain-repl',
    model: runtime.modelId,
    route: runtime.route,
    config: runtime.configSnapshot,
    permissionMode,
  })
  const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  process.stdout.write('spark plain REPL · /exit 退出\n> ')
  try {
    for await (const line of terminal) {
      if (line.trim() === '/exit' || line.trim() === '/quit') break
      if (line.trim()) await runPlainTurn(session, line, reasoningEffort)
      process.stdout.write('> ')
    }
    return 0
  } finally {
    terminal.close()
  }
}

async function runPlainTurn(
  session: AgentSession,
  prompt: string,
  reasoningEffort: ReasoningEffort | undefined,
): Promise<void> {
  let wroteText = false
  await session.turn(prompt, {
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    onDelta: (delta: LlmDelta) => {
      if (delta.type === 'text') {
        wroteText = true
        process.stdout.write(delta.text)
      }
    },
    onEvent: renderPlainEvent,
  })
  if (wroteText) process.stdout.write('\n')
}

function renderPlainEvent(event: AgentEvent): void {
  if (event.type === 'tool.result') {
    process.stderr.write(`[tool ${event.callId}] ${event.ok ? 'ok' : 'failed'}: ${event.content}\n`)
  } else if (event.type === 'turn.failed') {
    process.stderr.write(`${event.error.code}: ${event.error.message}\n`)
  } else if (event.type === 'turn.cancelled') {
    process.stderr.write('Turn cancelled.\n')
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function helpText(version?: string): string {
  return `spark ${version === undefined ? '' : `${version} `}— deterministic coding agent\n\nUsage:\n  spark                     Interactive TUI\n  spark "task"              Run one task\n  spark -p "task"           Run one task\n  spark --plain             Plain interactive REPL\n  spark --json "task"       NDJSON fact events\n  spark models              List local and SparkWork-synced models\n  spark doctor              Diagnose install, discovery, and model selection\n  spark install [--bin dir] Link the spark launcher onto PATH\n  spark uninstall [--bin dir]\n                            Remove the spark launcher only\n  spark uninstall --package\n                            Remove the npm package, its shims, and the launcher;\n                            ~/.spark config/sessions/caches are kept\n  spark update [--check]    Check for or install a release upgrade\n  spark upgrade             Alias for spark update\n  spark init                Write a starter ~/.spark/config.toml\n\nUpdate exit codes:\n  0 update available / update applied        1 up to date, older remote, or prerelease gated\n  2 usage error                               3 check or upgrade failed\n  4 another update is in progress\n\nOptions:\n  -p, --prompt <text>       Task prompt\n  -m, --model <id>          Select a local id, SparkWork route id, or unique model name\n      --bin <dir>           Launcher directory for install/uninstall (default ~/.spark/bin)\n      --base <url>          Release base for update (default SPARK_RELEASE_BASE, SPARK_INSTALL_BASE,\n                            [update] base_url in config.toml, then the built-in release host)\n      --target <semver>     Pin an exact version for update (checksum via the .sha256 sidecar)\n      --check               Only report the update status; apply nothing\n      --allow-prerelease    Consider prerelease releases for update\n      --package             With uninstall: remove the installed npm package too\n      --force               Replace a foreign launcher during install\n      --plain               Disable color and terminal redraw\n      --json                Emit persisted events as NDJSON; structured update results\n      --output-format <fmt> text | json | stream-json\n      --permission-mode <m> default | acceptEdits | plan | bypass
      --effort <level>      Reasoning effort: off | low | medium | high (default: provider default)\n      --dangerously-skip-permissions\n                             Alias for --permission-mode bypass\n  -h, --help                Show help\n  -V, --version             Show version\n`
}

async function runningVersion(): Promise<string> {
  try {
    return (await resolveSparkInstall()).version
  } catch {
    return 'unknown'
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function terminalSafe(value: string): string {
  const safe: string[] = []
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    safe.push(codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? '�' : character)
  }
  return safe.join('')
}

function createConfiguredAgent(runtime: ConfiguredModelRuntime): Agent {
  const cwd = process.cwd()
  return Agent.open({ cwd, env: createDefaultEnv({ cwd, llm: runtime.service }) })
}

function warnPermissionBypass(mode: PermissionMode): void {
  if (mode === 'bypass') {
    process.stderr.write(
      'DANGER: permission bypass is active; registered tools may execute without approval.\n',
    )
  }
}

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exitCode = 0
  else throw error
})

process.exitCode = await main()
