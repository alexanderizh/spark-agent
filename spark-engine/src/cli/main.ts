#!/usr/bin/env node

import { createInterface } from 'node:readline/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import {
  inspectConfiguredModels,
  loadCliPreferences,
  loadConfiguredModel,
  type ConfiguredModelCatalog,
  type ConfiguredModelRuntime,
} from '../config/model-config.js'
import { createResilientEnv, defaultSparkHome, type ManagedEnvResult } from '../env.js'
import {
  loadSparkSettings,
  resolveEngineSettings,
  resolvePlatformSettings,
  resolveSessionPermissionMode,
  type ResolvedEngineSettings,
} from '../config/settings.js'
import type { SettingsScope } from '../config/settings.js'
import { runServeCommand } from '../serve/run.js'
import { executeScheduleCommand, runSchedulerHost } from './schedule-command.js'
import { executeAuthCommand } from './auth-command.js'
import { bootstrapPlatformModels } from '../platform/models.js'
import { PlatformAuthExpiredError } from '../platform/edu-server-client.js'
import { PlatformCredentialStore, type StoredPlatformCredentials } from '../platform/credentials.js'
import { executeConfigCommand } from './config-command.js'
import { executeMcpCommand, type McpAddInput } from './mcp-command.js'
import { executeMemoryCommand } from './memory-command.js'
import { executePlanCommand } from './plan-command.js'
import { executeSkillsCommand } from './skills-command.js'
import { executeTodoCommand } from './todo-command.js'
import { JsonlSessionStore, shortSessionId } from '../events/ledger.js'
import type { AgentEvent } from '../events/schema.js'
import type { LlmDelta, ReasoningEffort } from '../llm/types.js'
import { isReasoningEffort } from '../llm/types.js'
import { isPermissionMode, type PermissionMode } from '../permission/types.js'
import type { AgentEnv } from '../seams.js'
import { loadImageFiles, type LoadImageFilesResult } from '../images/files.js'
import { extractAndSaveMemories } from '../memory/extraction.js'
import { FileMemoryStore } from '../memory/store.js'
import type { TurnImageAttachment } from '../images/attachments.js'
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
import { formatModelLimitsTail, installWarnings, renderInstallReport } from './diagnostics.js'
import { executeUpdate } from './update.js'
import { uninstallSparkPackage } from './uninstall-package.js'
import { NOTICE_TIMEOUT_MS, updateNoticeLine } from './update-notice.js'
import type { SparkUpdateRunner } from '../tui/update-runner.js'

interface CliOptions {
  readonly help: boolean
  readonly version: boolean
  readonly plain: boolean
  readonly json: boolean
  /** Machine-readable output contract for a single task invocation. */
  readonly outputFormat: CliOutputFormat
  /** Backward-compatible `--json` event JSONL, which predates output-format. */
  readonly legacyJson: boolean
  readonly prompt?: string
  /** `-i/--image` paths attached to the one-shot prompt, in order. */
  readonly images: readonly string[]
  readonly model?: string
  readonly bin?: string
  readonly base?: string
  readonly target?: string
  readonly force: boolean
  readonly check: boolean
  readonly allowPrerelease: boolean
  readonly package: boolean
  readonly permissionMode: PermissionMode
  readonly permissionModeExplicit: boolean
  readonly reasoningEffort?: ReasoningEffort
  readonly continueSession: boolean
  /** '' = picker sentinel (bare --resume); a concrete session id otherwise. */
  readonly resume?: string
  /** `--global` / `--project` for `spark config` / `spark mcp`, when given. */
  readonly settingsScope?: SettingsScope
  /** `spark mcp add` transport flags. */
  readonly mcpAdd?: McpAddInput
  /** `spark memory` command flags. */
  readonly memoryScope?: string
  readonly memoryLimit?: string
  readonly memoryName?: string
  readonly memoryDescription?: string
  readonly memoryBody?: string
  readonly memoryType?: string
  readonly memoryConfidence?: string
  readonly memoryAgentId?: string
  /** `spark plan` command flags. */
  readonly planBody?: string
  readonly planSessionId?: string
  /** `spark skills` command flags. */
  readonly skillLimit?: string
  /** `spark todo` command flags. */
  readonly todoTitle?: string
  /** `spark models --takeover` */
  readonly takeover?: boolean
  /** `spark serve` flags. */
  readonly port?: string
  readonly host?: string
  readonly todoStatus?: string
  readonly todoPriority?: string
  readonly todoNotes?: string
  readonly todoLimit?: string
  readonly todoAll: boolean
  /** `spark login` flag: print the login url instead of launching a browser. */
  readonly noBrowser: boolean
  readonly positionals: readonly string[]
}

type CliOutputFormat = 'text' | 'json' | 'stream-json'

/** `spark <name>` maintenance commands; they never take a task prompt. */
const SUBCOMMANDS = new Set([
  'serve',
  'models',
  'doctor',
  'update',
  'upgrade',
  'install',
  'uninstall',
  'init',
  'login',
  'logout',
  'whoami',
  'config',
  'mcp',
  'memory',
  'schedule',
  'scheduler',
  'plan',
  'skills',
  'todo',
  'sessions',
])

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
  if (
    options.images.length > 0 &&
    options.positionals[0] !== undefined &&
    SUBCOMMANDS.has(options.positionals[0])
  ) {
    process.stderr.write(
      `--image only applies to a task prompt, not to ${options.positionals[0]}.\n`,
    )
    return 2
  }
  if (options.positionals[0] === 'serve') {
    if (options.positionals.length > 1) {
      process.stderr.write('spark serve does not accept positional arguments.\n')
      return 2
    }
    return runServeCommand({
      ...(options.port === undefined ? {} : { port: Number(options.port) }),
      ...(options.host === undefined ? {} : { host: options.host }),
      ...(options.model === undefined ? {} : { model: options.model }),
      json: options.json,
    })
  }
  if (options.positionals[0] === 'models' || options.positionals[0] === 'doctor') {
    if (options.prompt) {
      process.stderr.write(`${options.positionals[0]} does not accept a task prompt.\n`)
      return 2
    }
    if (options.positionals.length > 1) {
      process.stderr.write(
        `spark ${options.positionals[0]} does not accept extra arguments (use --takeover).\n`,
      )
      return 2
    }
    if (options.takeover === true) {
      const takeoverResult = await runPlatformModelBootstrap(true)
      if (takeoverResult !== 0) return takeoverResult
    }
    return inspectModels(options.positionals[0], options.json)
  }
  if (options.positionals[0] === 'scheduler') {
    if (options.prompt) {
      process.stderr.write('spark scheduler does not accept a task prompt.\n')
      return 2
    }
    return runSchedulerHost({
      ...(options.model === undefined ? {} : { model: options.model }),
    })
  }
  if (options.positionals[0] === 'schedule') {
    return executeScheduleCommand({
      args: options.positionals.slice(1),
      json: options.json,
      cwd: process.cwd(),
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    })
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
  if (maintenance === 'login' || maintenance === 'logout' || maintenance === 'whoami') {
    if (options.positionals.length > 1 || options.prompt) {
      process.stderr.write(`spark ${maintenance} does not accept extra arguments.\n`)
      return 2
    }
    return executeAuthCommand({
      subcommand: maintenance,
      args: [],
      json: options.json,
      cwd: process.cwd(),
      sparkHome: defaultSparkHome(),
      openBrowser: !options.noBrowser,
      stdout: (text) => {
        process.stdout.write(text)
      },
      stderr: (text) => {
        process.stderr.write(text)
      },
    })
  }
  if (maintenance === 'config') {
    if (options.prompt) {
      process.stderr.write('spark config does not accept a task prompt.\n')
      return 2
    }
    return executeConfigCommand({
      subcommand: options.positionals[1] ?? '',
      args: options.positionals.slice(2),
      json: options.json,
      ...(options.settingsScope === undefined ? {} : { scope: options.settingsScope }),
      cwd: process.cwd(),
      sparkHome: defaultSparkHome(),
      stdout: (text) => {
        process.stdout.write(text)
      },
      stderr: (text) => {
        process.stderr.write(text)
      },
    })
  }
  if (maintenance === 'mcp') {
    if (options.prompt) {
      process.stderr.write('spark mcp does not accept a task prompt.\n')
      return 2
    }
    return executeMcpCommand({
      subcommand: options.positionals[1] ?? '',
      args: options.positionals.slice(2),
      json: options.json,
      ...(options.settingsScope === undefined ? {} : { scope: options.settingsScope }),
      ...(options.mcpAdd === undefined ? {} : { add: options.mcpAdd }),
      cwd: process.cwd(),
      sparkHome: defaultSparkHome(),
      stdout: (text) => {
        process.stdout.write(text)
      },
      stderr: (text) => {
        process.stderr.write(text)
      },
    })
  }
  if (maintenance === 'memory') {
    if (options.prompt) {
      process.stderr.write('spark memory does not accept a task prompt.\n')
      return 2
    }
    return executeMemoryCommand({
      subcommand: options.positionals[1] ?? '',
      args: options.positionals.slice(2),
      json: options.json,
      cwd: process.cwd(),
      ...(options.memoryScope === undefined ? {} : { scope: options.memoryScope }),
      ...(options.memoryLimit === undefined ? {} : { limit: options.memoryLimit }),
      ...(options.memoryName === undefined ? {} : { name: options.memoryName }),
      ...(options.memoryDescription === undefined
        ? {}
        : { description: options.memoryDescription }),
      ...(options.memoryBody === undefined ? {} : { body: options.memoryBody }),
      ...(options.memoryType === undefined ? {} : { type: options.memoryType }),
      ...(options.memoryConfidence === undefined ? {} : { confidence: options.memoryConfidence }),
      ...(options.memoryAgentId === undefined ? {} : { agentId: options.memoryAgentId }),
      stdout: (text) => {
        process.stdout.write(text)
      },
      stderr: (text) => {
        process.stderr.write(text)
      },
    })
  }
  if (maintenance === 'todo') {
    if (options.prompt) {
      process.stderr.write('spark todo does not accept a task prompt.\n')
      return 2
    }
    return executeTodoCommand({
      subcommand: options.positionals[1] ?? '',
      args: options.positionals.slice(2),
      json: options.json,
      cwd: process.cwd(),
      ...(options.todoTitle === undefined ? {} : { title: options.todoTitle }),
      ...(options.todoStatus === undefined ? {} : { status: options.todoStatus }),
      ...(options.todoPriority === undefined ? {} : { priority: options.todoPriority }),
      ...(options.todoNotes === undefined ? {} : { notes: options.todoNotes }),
      ...(options.todoLimit === undefined ? {} : { limit: options.todoLimit }),
      all: options.todoAll,
      stdout: (text) => {
        process.stdout.write(text)
      },
      stderr: (text) => {
        process.stderr.write(text)
      },
    })
  }
  if (maintenance === 'plan') {
    if (options.prompt) {
      process.stderr.write('spark plan does not accept a task prompt.\n')
      return 2
    }
    return executePlanCommand({
      subcommand: options.positionals[1] ?? '',
      args: options.positionals.slice(2),
      json: options.json,
      cwd: process.cwd(),
      dataRoot: defaultSparkHome(),
      ...(options.planBody === undefined ? {} : { body: options.planBody }),
      ...(options.planSessionId === undefined ? {} : { sessionId: options.planSessionId }),
      stdout: (text) => {
        process.stdout.write(text)
      },
      stderr: (text) => {
        process.stderr.write(text)
      },
    })
  }
  if (maintenance === 'skills') {
    if (options.prompt) {
      process.stderr.write('spark skills does not accept a task prompt.\n')
      return 2
    }
    return executeSkillsCommand({
      subcommand: options.positionals[1] ?? '',
      args: options.positionals.slice(2),
      json: options.json,
      cwd: process.cwd(),
      ...(options.skillLimit === undefined ? {} : { limit: options.skillLimit }),
      stdout: (text) => {
        process.stdout.write(text)
      },
      stderr: (text) => {
        process.stderr.write(text)
      },
    })
  }
  if (maintenance === 'sessions') {
    if (options.positionals.length > 1 || options.prompt) {
      process.stderr.write('spark sessions does not accept extra arguments.\n')
      return 2
    }
    return listSessionsCommand(options.json)
  }

  let settings: Awaited<ReturnType<typeof loadSparkSettings>>
  let engineSettings: ResolvedEngineSettings
  try {
    settings = await loadSparkSettings({ cwd: process.cwd() })
    engineSettings = resolveEngineSettings(settings)
  } catch (error) {
    process.stderr.write(`${terminalSafe(message(error))}\n`)
    return 2
  }
  const storedPreferences = await loadCliPreferences({ cwd: process.cwd() }).catch(() => undefined)
  // `loadCliPreferences` folds an unset `agent.permission_mode` into `manual`;
  // reading the raw layer keeps a configured `[permissions].mode` effective.
  const configuredDefaultMode = resolveSessionPermissionMode(settings) ?? 'manual'
  const resolvedOptions: CliOptions = {
    ...options,
    permissionMode: options.permissionModeExplicit ? options.permissionMode : configuredDefaultMode,
    reasoningEffort: options.reasoningEffort ?? storedPreferences?.reasoningEffort ?? 'high',
  }

  const positionalPrompt = options.positionals.join(' ').trim()
  let prompt = options.prompt ?? positionalPrompt
  if (!prompt && !process.stdin.isTTY) prompt = (await readStdin()).trim()

  if (options.images.length > 0 && !prompt) {
    process.stderr.write(
      '--image 需要与任务提示词一起使用，例如：spark -p "分析截图" -i shot.png\n',
    )
    return 2
  }
  const attachedImages = await loadPromptImages(options.images)
  if (!attachedImages.ok) {
    process.stderr.write(`${terminalSafe(attachedImages.message)}\n`)
    return 2
  }

  const tuiAvailable =
    !options.plain &&
    !options.json &&
    options.outputFormat === 'text' &&
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
    let resumeSessionId: string | undefined
    try {
      resumeSessionId = await resolveResumeTarget(options)
    } catch (error) {
      process.stderr.write(`${terminalSafe(message(error))}\n`)
      return 2
    }
    await runTui({
      cwd: process.cwd(),
      version: await runningVersion(),
      updateRunner: createTuiUpdateRunner(),
      permissionMode: resolvedOptions.permissionMode,
      permissionModeExplicit: options.permissionModeExplicit,
      ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
      ...(options.resume === '' ? { resumePicker: true } : {}),
      reasoningEffort: resolvedOptions.reasoningEffort,
      engineSettings,
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

  // Usage errors take precedence over model-resolution errors: a bad or
  // non-TTY --resume must be reported even when no model is configured yet.
  let resumeSessionId: string | undefined
  try {
    resumeSessionId = await resolveResumeTarget(options)
  } catch (error) {
    process.stderr.write(`${terminalSafe(message(error))}\n`)
    return 2
  }
  if (resumeSessionId === undefined && options.resume === '') {
    process.stderr.write(
      'Bare --resume opens the interactive session picker; pickers need a TUI.\n',
    )
    return 2
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
  if (prompt) {
    return runOnce(
      prompt,
      resolvedOptions,
      runtime,
      engineSettings,
      resumeSessionId,
      attachedImages.images,
    )
  }

  if (process.stdin.isTTY && process.stdout.isTTY && options.plain) {
    return runPlainRepl(runtime, resolvedOptions, engineSettings, resumeSessionId)
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

/**
 * Re-runs the platform-model bootstrap for the signed-in account. The Spark
 * session comes from the credential store; expiry surfaces as "run spark
 * login" instead of deleting the stored session.
 */
async function runPlatformModelBootstrap(takeover: boolean): Promise<number> {
  const settings = await loadSparkSettings({ cwd: process.cwd() })
  const platform = resolvePlatformSettings(settings)
  const store = new PlatformCredentialStore({ sparkHome: settings.paths.sparkHome })
  let stored: StoredPlatformCredentials | null
  try {
    stored = await store.load()
  } catch (error) {
    process.stderr.write(`${terminalSafe(message(error))}\n`)
    return 1
  }
  if (stored === null) {
    process.stderr.write('Platform models bind to a Spark account; run `spark login` first.\n')
    return 1
  }
  try {
    const status = await bootstrapPlatformModels({
      sparkHome: settings.paths.sparkHome,
      serverUrl: stored.serverUrl || platform.serverUrl,
      session: stored.session,
      ...(takeover ? { forceTakeover: true } : {}),
    })
    if (status.providerReady) {
      process.stdout.write(
        `Platform models bound (${status.models.length} available) via ${status.baseUrl}\n`,
      )
    } else {
      process.stderr.write(`${status.message}\n`)
      return 1
    }
    return 0
  } catch (error) {
    if (error instanceof PlatformAuthExpiredError) {
      process.stderr.write('Your Spark account session expired. Run `spark login` again.\n')
      return 1
    }
    process.stderr.write(`${terminalSafe(message(error))}\n`)
    return 1
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
    const selectedEntry = catalog.entries.find((entry) => entry.selected)
    if (selectedEntry?.contextWindowTokens !== undefined) {
      process.stdout.write(`Context window: ${selectedEntry.contextWindowTokens} tokens\n`)
    }
    if (selectedEntry?.maxOutputTokens !== undefined) {
      process.stdout.write(`Max output: ${selectedEntry.maxOutputTokens} tokens\n`)
    }
    const platformCount = catalog.entries.filter((entry) => entry.source === 'platform').length
    process.stdout.write(
      catalog.platformConnected
        ? `Platform models: bound (${platformCount} available; spark models --takeover to rebind)\n`
        : 'Platform models: not bound (run spark login to bind)\n',
    )
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
      `${marker} ${terminalSafe(entry.model)}  ${terminalSafe(entry.providerName)}  ${entry.protocol}  [${entry.source}]` +
        `${formatModelLimitsTail(entry)}\n`,
    )
  }
  return 0
}

/**
 * node:util parseArgs rejects a valueless `--resume`; users expect
 * `spark --resume` (no id) to open the in-TUI session picker. Rewrite a bare
 * flag into an empty-string value before parsing — '' is the picker sentinel.
 */
function normalizeResumeArgv(argv: readonly string[]): string[] {
  const out = [...argv]
  for (let index = 0; index < out.length; index += 1) {
    const token = out[index]
    if (token === '--resume' || token === '-r') {
      const next = out[index + 1]
      if (next === undefined || next.startsWith('-')) out.splice(index + 1, 0, '')
    }
  }
  return out
}

function parseCli(argv: readonly string[]): CliOptions {
  const parsed = parseArgs({
    args: normalizeResumeArgv(argv),
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'V', default: false },
      plain: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      prompt: { type: 'string', short: 'p' },
      image: { type: 'string', short: 'i', multiple: true },
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
      takeover: { type: 'boolean', default: false },
      port: { type: 'string' },
      host: { type: 'string' },
      'output-format': { type: 'string' },
      continue: { type: 'boolean', short: 'c', default: false },
      resume: { type: 'string', short: 'r' },
      global: { type: 'boolean', default: false },
      project: { type: 'boolean', default: false },
      command: { type: 'string' },
      url: { type: 'string' },
      arg: { type: 'string', multiple: true },
      env: { type: 'string', multiple: true },
      header: { type: 'string', multiple: true },
      scope: { type: 'string' },
      limit: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      body: { type: 'string' },
      session: { type: 'string' },
      type: { type: 'string' },
      confidence: { type: 'string' },
      agent: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'string' },
      priority: { type: 'string' },
      notes: { type: 'string' },
      all: { type: 'boolean', default: false },
      'no-browser': { type: 'boolean', default: false },
    },
  })
  const requestedOutputFormat = parsed.values['output-format']
  if (requestedOutputFormat && !['text', 'json', 'stream-json'].includes(requestedOutputFormat)) {
    throw new Error(`Unsupported --output-format: ${requestedOutputFormat}`)
  }
  if (
    parsed.values.json &&
    requestedOutputFormat !== undefined &&
    requestedOutputFormat !== 'stream-json'
  ) {
    throw new Error('--json conflicts with --output-format text/json; use stream-json explicitly')
  }
  const legacyJson = parsed.values.json && requestedOutputFormat === undefined
  const outputFormat =
    requestedOutputFormat === undefined
      ? legacyJson
        ? 'stream-json'
        : 'text'
      : (requestedOutputFormat as CliOutputFormat)
  const configuredPermissionMode = parsed.values['permission-mode']
  if (configuredPermissionMode !== undefined && !isPermissionMode(configuredPermissionMode)) {
    throw new Error(`Unsupported --permission-mode: ${configuredPermissionMode}`)
  }
  const configuredEffort = parsed.values.effort
  if (configuredEffort !== undefined && !isReasoningEffort(configuredEffort)) {
    throw new Error(`Unsupported --effort: ${configuredEffort} (off | low | medium | high | max)`)
  }
  const dangerousBypass = parsed.values['dangerously-skip-permissions'] ?? false
  if (dangerousBypass && configuredPermissionMode && configuredPermissionMode !== 'bypass') {
    throw new Error('--dangerously-skip-permissions conflicts with --permission-mode')
  }
  const continueLatest = parsed.values.continue ?? false
  const resume = parsed.values.resume
  if (continueLatest && resume !== undefined) {
    throw new Error('--continue and --resume are mutually exclusive')
  }
  const globalScope = parsed.values.global ?? false
  const projectScope = parsed.values.project ?? false
  if (globalScope && projectScope) {
    throw new Error('--global and --project are mutually exclusive')
  }
  return {
    help: parsed.values.help ?? false,
    version: parsed.values.version ?? false,
    plain: parsed.values.plain,
    json: parsed.values.json || outputFormat !== 'text',
    outputFormat,
    legacyJson,
    ...(parsed.values.prompt === undefined ? {} : { prompt: parsed.values.prompt }),
    images: parsed.values.image ?? [],
    ...(parsed.values.model === undefined ? {} : { model: parsed.values.model }),
    ...(parsed.values.bin === undefined ? {} : { bin: parsed.values.bin }),
    ...(parsed.values.base === undefined ? {} : { base: parsed.values.base }),
    ...(parsed.values.target === undefined ? {} : { target: parsed.values.target }),
    force: parsed.values.force ?? false,
    check: parsed.values.check ?? false,
    allowPrerelease: parsed.values['allow-prerelease'] ?? false,
    package: parsed.values.package ?? false,
    permissionMode: dangerousBypass ? 'bypass' : (configuredPermissionMode ?? 'manual'),
    permissionModeExplicit: dangerousBypass || configuredPermissionMode !== undefined,
    ...(configuredEffort === undefined ? {} : { reasoningEffort: configuredEffort }),
    continueSession: continueLatest,
    // '' sentinel = bare --resume → in-TUI session picker; otherwise a concrete id.
    ...(resume === undefined ? {} : { resume }),
    ...(globalScope || projectScope
      ? { settingsScope: globalScope ? ('global' as const) : ('project' as const) }
      : {}),
    ...(parsed.values.command === undefined &&
    parsed.values.url === undefined &&
    (parsed.values.arg?.length ?? 0) === 0 &&
    (parsed.values.env?.length ?? 0) === 0 &&
    (parsed.values.header?.length ?? 0) === 0
      ? {}
      : {
          mcpAdd: {
            ...(parsed.values.command === undefined ? {} : { command: parsed.values.command }),
            ...(parsed.values.url === undefined ? {} : { url: parsed.values.url }),
            args: parsed.values.arg ?? [],
            env: parsed.values.env ?? [],
            headers: parsed.values.header ?? [],
          },
        }),
    ...(parsed.values.scope === undefined ? {} : { memoryScope: parsed.values.scope }),
    ...(parsed.values.limit === undefined ? {} : { memoryLimit: parsed.values.limit }),
    ...(parsed.values.name === undefined ? {} : { memoryName: parsed.values.name }),
    ...(parsed.values.description === undefined
      ? {}
      : { memoryDescription: parsed.values.description }),
    ...(parsed.values.body === undefined ? {} : { memoryBody: parsed.values.body }),
    ...(parsed.values.body === undefined ? {} : { planBody: parsed.values.body }),
    ...(parsed.values.session === undefined ? {} : { planSessionId: parsed.values.session }),
    ...(parsed.values.type === undefined ? {} : { memoryType: parsed.values.type }),
    ...(parsed.values.confidence === undefined
      ? {}
      : { memoryConfidence: parsed.values.confidence }),
    ...(parsed.values.agent === undefined ? {} : { memoryAgentId: parsed.values.agent }),
    ...(parsed.values.title === undefined ? {} : { todoTitle: parsed.values.title }),
    ...(parsed.values.status === undefined ? {} : { todoStatus: parsed.values.status }),
    ...(parsed.values.priority === undefined ? {} : { todoPriority: parsed.values.priority }),
    ...(parsed.values.notes === undefined ? {} : { todoNotes: parsed.values.notes }),
    ...(parsed.values.limit === undefined ? {} : { todoLimit: parsed.values.limit }),
    ...(parsed.values.limit === undefined ? {} : { skillLimit: parsed.values.limit }),
    todoAll: parsed.values.all ?? false,
    noBrowser: parsed.values['no-browser'] ?? false,
    positionals: parsed.positionals,
  }
}

function openProjectSessionStore(): JsonlSessionStore {
  return new JsonlSessionStore({ dataRoot: defaultSparkHome(), projectDir: process.cwd() })
}

/**
 * `--continue` / `--resume <id>` target resolution against the on-disk ledger
 * of the current project. Returns undefined for "start a new session" (no
 * sessions yet, or the bare-`--resume` picker sentinel). Throws when an
 * explicitly requested session id does not exist.
 */
async function resolveResumeTarget(options: CliOptions): Promise<string | undefined> {
  if (!options.continueSession && options.resume === undefined) return undefined
  if (options.resume === '') return undefined // picker sentinel; TUI handles it
  const sessions = await openProjectSessionStore().list(
    null,
    options.continueSession ? {} : { includeSubagents: true },
  )
  if (options.continueSession) {
    const latest = sessions[0]
    if (latest === undefined) {
      process.stderr.write('No sessions recorded here yet; starting a new session.\n')
      return undefined
    }
    return latest.sessionId
  }
  const requested = options.resume ?? ''
  const found = sessions.find((session) => session.sessionId === requested)
  if (found === undefined) {
    const recent = sessions
      .slice(0, 5)
      .map((session) =>
        `  ${shortSessionId(session.sessionId)}  ${session.preview ?? ''}`.trimEnd(),
      )
      .join('\n')
    throw new Error(
      `Session not found: ${requested}${recent === '' ? '' : `\nRecent sessions:\n${recent}`}`,
    )
  }
  return requested
}

/**
 * Resume semantics shared by the TUI, print, and plain-REPL paths: an explicit
 * `--permission-mode` overrides the mode restored from the ledger; without the
 * flag the session keeps whatever mode it ran under before.
 */
async function openOrCreateSession(
  agent: Agent,
  config: Readonly<Record<string, unknown>>,
  resumeSessionId: string | undefined,
  explicitPermissionMode: PermissionMode | undefined,
): Promise<AgentSession> {
  if (resumeSessionId === undefined) return agent.newSession(config)
  const session = await agent.openSession(resumeSessionId)
  if (explicitPermissionMode !== undefined) session.setPermissionMode(explicitPermissionMode)
  return session
}

async function listSessionsCommand(json: boolean): Promise<number> {
  const sessions = await openProjectSessionStore().list(null)
  if (json) {
    for (const session of sessions) process.stdout.write(`${JSON.stringify(session)}\n`)
    return 0
  }
  if (sessions.length === 0) {
    process.stdout.write('No sessions recorded for this directory yet.\n')
    return 0
  }
  for (const session of sessions) {
    const updated = new Date(session.updatedAt).toISOString()
    process.stdout.write(
      `${updated}  #${session.latestSeq}  ${shortSessionId(session.sessionId)}  ${session.preview ?? ''}\n`,
    )
  }
  return 0
}

async function runOnce(
  prompt: string,
  options: CliOptions,
  runtime: ConfiguredModelRuntime,
  engineSettings: ResolvedEngineSettings,
  resumeSessionId?: string,
  images: readonly TurnImageAttachment[] = [],
): Promise<number> {
  const managed = await openConfiguredEnv(runtime, engineSettings)
  try {
    return await runOnceWithEnv(
      prompt,
      options,
      runtime,
      engineSettings,
      managed.env,
      resumeSessionId,
      images,
    )
  } finally {
    await managed.close()
  }
}

/** Reads `-i/--image` files, rejecting the batch before any model work starts. */
async function loadPromptImages(paths: readonly string[]): Promise<LoadImageFilesResult> {
  if (paths.length === 0) return { ok: true, images: [] }
  return loadImageFiles(paths)
}

async function runOnceWithEnv(
  prompt: string,
  options: CliOptions,
  runtime: ConfiguredModelRuntime,
  engineSettings: ResolvedEngineSettings,
  env: AgentEnv,
  resumeSessionId?: string,
  images: readonly TurnImageAttachment[] = [],
): Promise<number> {
  const agent = Agent.open({ cwd: process.cwd(), env })
  warnPermissionBypass(options.permissionMode)
  const session = await openOrCreateSession(
    agent,
    {
      output: options.outputFormat,
      model: runtime.modelId,
      route: runtime.route,
      config: runtime.configSnapshot,
      permissionMode: options.permissionMode,
    },
    resumeSessionId,
    options.permissionModeExplicit ? options.permissionMode : undefined,
  )
  const eventJson = options.legacyJson || options.outputFormat === 'stream-json'
  const finalJson = options.outputFormat === 'json' && !options.legacyJson
  if (eventJson) {
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
  let finalText = ''
  try {
    const result = await session.turn(prompt, {
      signal: controller.signal,
      autoContinue: 3,
      ...(images.length === 0 ? {} : { images }),
      ...(options.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: options.reasoningEffort }),
      onEvent: eventJson
        ? (event) => {
            process.stdout.write(`${JSON.stringify(event)}\n`)
          }
        : (event) => {
            if (event.type === 'assistant.completed' && event.message.text) {
              finalText = event.message.text
            }
            renderPlainEvent(event)
          },
      onDelta:
        eventJson && options.outputFormat === 'stream-json' && !options.legacyJson
          ? (delta) => {
              process.stdout.write(`${JSON.stringify({ type: 'delta', delta })}\n`)
            }
          : eventJson || finalJson
            ? undefined
            : (delta) => {
                if (delta.type === 'text') {
                  wroteText = true
                  process.stdout.write(delta.text)
                } else if (delta.type === 'retry') {
                  renderRetryDelta(delta)
                }
              },
    })
    if (!eventJson && !finalJson && !wroteText && finalText !== '') {
      process.stdout.write(finalText)
      wroteText = true
    }
    if (finalJson) {
      process.stdout.write(
        `${JSON.stringify({
          type: 'result',
          sessionId: session.sessionId,
          turnId: result.turnId,
          status: terminalStatus(result.terminal),
          message: finalText || null,
          terminal: result.terminal,
        })}\n`,
      )
    } else if (!eventJson && wroteText) {
      process.stdout.write('\n')
    }
    if (result.terminal.type === 'turn.completed') {
      if (engineSettings.memoryEnabled && engineSettings.memoryAutoExtract) {
        // Bounded post-turn pass: distills durable facts into the memory
        // store. Failures are logged inside, never surfaced to the caller.
        const events: AgentEvent[] = []
        for await (const event of session.events()) events.push(event)
        await extractAndSaveMemories({
          env,
          store: new FileMemoryStore({
            cwd: process.cwd(),
            agentId: engineSettings.memoryAgentId,
            enabled: true,
          }),
          events,
          sessionId: session.sessionId,
        })
      }
      return 0
    }
    if (result.terminal.type === 'turn.cancelled') return 130
    return 1
  } finally {
    process.removeListener('SIGINT', onSigint)
  }
}

function terminalStatus(terminal: AgentEvent): 'completed' | 'cancelled' | 'failed' {
  switch (terminal.type) {
    case 'turn.completed':
      return 'completed'
    case 'turn.cancelled':
      return 'cancelled'
    case 'turn.failed':
      return 'failed'
    default:
      throw new Error(`Expected terminal event, got ${terminal.type}`)
  }
}

async function runPlainRepl(
  runtime: ConfiguredModelRuntime,
  options: CliOptions,
  engineSettings: ResolvedEngineSettings,
  resumeSessionId?: string,
): Promise<number> {
  const managed = await openConfiguredEnv(runtime, engineSettings)
  try {
    return await runPlainReplWithEnv(runtime, options, managed.env, resumeSessionId)
  } finally {
    await managed.close()
  }
}

async function runPlainReplWithEnv(
  runtime: ConfiguredModelRuntime,
  options: CliOptions,
  env: AgentEnv,
  resumeSessionId?: string,
): Promise<number> {
  const agent = Agent.open({ cwd: process.cwd(), env })
  warnPermissionBypass(options.permissionMode)
  const session = await openOrCreateSession(
    agent,
    {
      output: 'plain-repl',
      model: runtime.modelId,
      route: runtime.route,
      config: runtime.configSnapshot,
      permissionMode: options.permissionMode,
    },
    resumeSessionId,
    options.permissionModeExplicit ? options.permissionMode : undefined,
  )
  const reasoningEffort = options.reasoningEffort
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })
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
  let finalText = ''
  await session.turn(prompt, {
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    onDelta: (delta: LlmDelta) => {
      if (delta.type === 'text') {
        wroteText = true
        process.stdout.write(delta.text)
      } else if (delta.type === 'retry') {
        renderRetryDelta(delta)
      }
    },
    onEvent: (event) => {
      if (event.type === 'assistant.completed' && event.message.text) {
        finalText = event.message.text
      }
      renderPlainEvent(event)
    },
  })
  if (!wroteText && finalText !== '') {
    process.stdout.write(finalText)
    wroteText = true
  }
  if (wroteText) process.stdout.write('\n')
}

function renderPlainEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'tool.call':
      process.stderr.write(
        `[tool ${terminalSafe(event.tool)}] requested ${previewCliValue(event.args)}\n`,
      )
      break
    case 'tool.intent':
      process.stderr.write(`[tool ${event.callId}] running\n`)
      break
    case 'tool.result':
      process.stderr.write(
        `[tool ${event.callId}] ${event.ok ? 'ok' : 'failed'} (${event.durationMs}ms): ${terminalSafe(event.content)}\n`,
      )
      break
    case 'permission.requested':
      process.stderr.write(
        `[permission ${event.risk.tool}] approval required: ${terminalSafe(event.risk.argsPreview)}\n`,
      )
      break
    case 'permission.decided':
      process.stderr.write(
        `[permission ${event.requestId}] ${event.decision}${event.grantScope ? ` (${event.grantScope})` : ''}\n`,
      )
      break
    case 'turn.failed':
      process.stderr.write(
        `${terminalDiagnostic(event.error.code, 256)}: ${terminalDiagnostic(event.error.message)}${errorCauseSuffix(event.error.detail)}\n`,
      )
      break
    case 'turn.cancelled':
      process.stderr.write('Turn cancelled.\n')
      break
    case 'turn.completed':
      if (event.reason === 'budget') {
        process.stderr.write(
          `Turn stopped at budget: ${event.stats.steps} steps, ${event.stats.toolCalls} tool calls.\n`,
        )
      }
      break
    default:
      break
  }
}

function errorCauseSuffix(detail: unknown): string {
  if (typeof detail !== 'object' || detail === null) return ''
  const cause = (detail as Record<string, unknown>).cause
  if (typeof cause !== 'object' || cause === null) return ''
  const causeRecord = cause as Record<string, unknown>
  const code = causeRecord.code
  const causeMessage = causeRecord.message
  const causeDetail =
    typeof causeRecord.detail === 'object' && causeRecord.detail !== null
      ? (causeRecord.detail as Record<string, unknown>)
      : undefined
  const requestId = causeDetail?.requestId
  const responseModel = causeDetail?.responseModel
  if (
    typeof code !== 'string' &&
    typeof causeMessage !== 'string' &&
    typeof requestId !== 'string' &&
    typeof responseModel !== 'string'
  ) {
    return ''
  }
  const root = `cause: ${terminalDiagnostic(typeof code === 'string' ? code : 'stream_error', 256)}: ${terminalDiagnostic(typeof causeMessage === 'string' ? causeMessage : 'unknown error', 1_024)}`
  const request =
    typeof requestId === 'string' ? `; request-id: ${terminalDiagnostic(requestId, 256)}` : ''
  const model =
    typeof responseModel === 'string' ? `; model: ${terminalDiagnostic(responseModel, 256)}` : ''
  return ` (${root}${model}${request})`
}

function renderRetryDelta(delta: Extract<LlmDelta, { type: 'retry' }>): void {
  process.stderr.write(
    `[model] retrying ${delta.attempt}/${delta.maxRetries} in ${(delta.delayMs / 1_000).toFixed(1)}s${delta.resetOutput ? '; discarding the failed attempt output' : ''}: ${terminalSafe(delta.error.code ?? delta.error.message)}\n`,
  )
}

function previewCliValue(value: unknown): string {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    serialized = '[unserializable]'
  }
  return terminalSafe(serialized.length > 240 ? `${serialized.slice(0, 237)}...` : serialized)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function helpText(version?: string): string {
  return `spark ${version === undefined ? '' : `${version} `}— deterministic coding agent

Usage:
  spark                     Interactive TUI
  spark "task"              Run one task
  spark -p "task"           Run one task
  spark --plain             Plain interactive REPL
  spark --json "task"       NDJSON fact events
  spark --output-format json "task"
                            One final JSON result object
  spark --output-format stream-json "task"
                            Event and streaming-delta JSONL
  spark -p "分析截图" -i shot.png -i arch.jpg
                            Attach images (PNG/JPEG/WEBP/GIF) to one task
  spark models              List local, platform, and SparkWork-synced models
  spark models --takeover   Rebind platform models on this device
  spark doctor              Diagnose install, discovery, and model selection
  spark serve [--port n]    Run the loopback App Server (protocol v1); the
                            startup handshake JSON is printed on stdout
  spark schedule add "<prompt>" --every <minutes>
                            Register a recurring local task
  spark schedule list       Show schedules and their last outcomes
  spark scheduler           Run the schedule host loop until interrupted
  spark login               Sign in to your Spark account (browser login)
  spark logout              Remove the stored Spark account session
  spark whoami              Show the signed-in Spark account
  spark sessions            List sessions recorded for the current directory
  spark config [list]       Show the effective layered configuration
  spark config get <key>    Print one value (raw in text mode)
  spark config set <key> <value>
                            Write a value (--global default, or --project)
  spark config unset <key>  Remove a value from one layer
  spark config path         Show the global and project configuration paths
  spark mcp list            List configured MCP servers
  spark mcp add <name> --command <cmd> [--arg v]... [--env K=V]...
  spark mcp add <name> --url <endpoint> [--header K=V]...
  spark mcp status          Start every enabled server and report its tools
  spark mcp remove <name>   Remove a server from its configuration layer
  spark memory list         List user/project/agent long-term memories
  spark memory search <q>   Search memory summaries
  spark memory recall <id>  Read one complete memory entry
  spark memory save ...     Save a durable memory as Markdown
  spark plan show [session]  Show the current session execution plan
  spark plan set [session]   Replace a session plan with --body <markdown>
  spark plan append [session]
                            Append Markdown to a session plan
  spark plan clear [session]
                            Clear a session plan
  spark skills list [query] List local skills by name and description
  spark skills read <id>   Load one complete local SKILL.md instruction body
  spark todo list            List current project tasks
  spark todo add <title>     Add a pending task
  spark todo update <id>     Update task fields
  spark todo remove <id>     Remove one task
  spark todo clear [--all]   Clear completed tasks, or everything with --all
  spark install [--bin dir] Link the spark launcher onto PATH
  spark uninstall [--bin dir]
                            Remove the spark launcher only
  spark uninstall --package
                            Remove the npm package, its shims, and the launcher;
                            ~/.spark config/sessions/caches are kept
  spark update [--check]    Check for or install a release upgrade
  spark upgrade             Alias for spark update
  spark init                Write a starter ~/.spark/config.toml

Update exit codes:
  0 update available / update applied        1 up to date, older remote, or prerelease gated
  2 usage error                               3 check or upgrade failed
  4 another update is in progress

  Configuration:
  ~/.spark/config.toml and <cwd>/.spark/config.toml are merged (project wins).
  Read and edit both through the spark config subcommands: list shows every
  effective key with the layer it came from, get <key> prints one value,
  set <key> <value> and unset <key> mutate a single layer (--global is the
  default, --project the repository file), and path prints both file
  locations together with whether each one exists yet.
  Every write is schema-validated and applied atomically. Values are
  true/false, numbers, plain strings, or JSON for arrays/objects. Setting
  SPARK_HOME moves the ~/.spark data root.
  Sections: [agent] [providers] [models] (model channels),
            [permissions] mode/allow/deny/ask, [tools] enabled/disabled,
            [mcp.servers.<name>] command|url,
            [memory] enabled/max_inject_tokens/agent_id,
            [platform] server_url/web_login_url.

  Channel credentials:
  A provider reads its key from api_key_env (any variable name). For
  anthropic-messages providers the default name is ANTHROPIC_API_KEY and
  ANTHROPIC_AUTH_TOKEN is accepted as a fallback, so a provider whose docs
  only mention one of the two still works; naming a variable explicitly
  disables the fallback. Requests always carry exactly one /v1/messages, so
  base_url may be a root, a …/v1 URL, or the full messages URL.

  Custom commands:
  Markdown files under ~/.spark/commands (user) and <cwd>/.spark/commands
  (project, wins on a shared name) each become a /<name> command in the
  interactive TUI: Tab completes it, /help lists it, and its body is sent as
  the task prompt. Subdirectories namespace the name (review/api.md becomes
  /review/api); an optional description: frontmatter line is the /help
  summary; the body may use $ARGUMENTS (the whole argument string) or
  $1..$9 (whitespace-split words). Built-in command names stay reserved, and
  non-TUI runs (-p, --json, --plain) never expand custom commands.

  Account:
  spark login stores the session in ~/.spark/credentials.json (0600).
  SPARK_EDUGEN_BASE_URL and SPARK_WEB_LOGIN_URL override [platform].

Options:
  -p, --prompt <text>       Task prompt
  -i, --image <file>        Attach an image file to the prompt (repeatable)
  -m, --model <id>          Select a local id, SparkWork route id, or unique model name
      --no-browser          Print the login url instead of opening a browser (spark login)
  -c, --continue            Continue the most recent session in this directory
  -r, --resume [<id>]       Resume a session; without an id pick one in the TUI
      --global              With 'spark config': use ~/.spark/config.toml (default)
      --project             With 'spark config': use <cwd>/.spark/config.toml
      --bin <dir>           Launcher directory for install/uninstall (default ~/.spark/bin)
      --base <url>          Release base for update (default SPARK_RELEASE_BASE, SPARK_INSTALL_BASE,
                            [update] base_url in config.toml, then the built-in release host)
      --target <semver>     Pin an exact version for update (checksum via the .sha256 sidecar)
      --check               Only report the update status; apply nothing
      --allow-prerelease    Consider prerelease releases for update
      --package             With uninstall: remove the installed npm package too
      --force               Replace a foreign launcher during install
      --plain               Disable color and terminal redraw
      --json                Backward-compatible persisted-event NDJSON output
      --output-format <fmt> text | json | stream-json
                            json emits one final result; stream-json emits events and deltas
      --permission-mode <m> manual | auto | bypass (default: manual)
      --effort <level>      Reasoning effort: off | low | medium | high | max (default: high)
      --dangerously-skip-permissions
                             Alias for --permission-mode bypass
      --scope <scope>       With 'spark memory': user | project | agent
      --name <name>         With 'spark memory save': memory title
      --description <text>  With 'spark memory save': compact summary
      --body <markdown>     With 'spark memory save': complete memory body
      --session <id>        With 'spark plan': session id (defaults to latest session)
      --type <type>         With 'spark memory save': user | feedback | project | reference
      --confidence <0..1>   With 'spark memory save': confidence score
      --agent <id>          With 'spark memory': agent scope profile id
      --limit <n>           With 'spark memory search', 'spark skills list', or 'spark todo list': max results
      --title <text>        With 'spark todo add|update': task title
      --status <status>     With 'spark todo': pending | in_progress | completed | cancelled
      --priority <level>    With 'spark todo': low | normal | high
      --notes <text>        With 'spark todo add|update': task notes
      --all                 With 'spark todo clear': remove pending tasks too
  -h, --help                Show help
  -V, --version             Show version
`
}

async function runningVersion(): Promise<string> {
  try {
    return (await resolveSparkInstall()).version
  } catch {
    return 'unknown'
  }
}

/**
 * Bridges the TUI /update command onto the same transactional `spark update`
 * path the shell command uses. Output is buffered and surfaced by the TUI as
 * a notice; exit-code semantics stay in update-runner's describe mapping.
 */
function createTuiUpdateRunner(): SparkUpdateRunner {
  return {
    run: async ({ checkOnly }) => {
      let output = ''
      const io = {
        stdout: (text: string) => {
          output += text
        },
        stderr: (text: string) => {
          output += text
        },
      }
      const exitCode = await executeUpdate(
        {
          checkOnly,
          allowPrerelease: false,
          json: false,
          sparkHome: defaultSparkHome(),
        },
        io,
      )
      return { exitCode, output }
    },
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

function terminalDiagnostic(value: string, maxLength = 2_048): string {
  const safe = terminalSafe(value)
  return safe.length <= maxLength ? safe : `${safe.slice(0, Math.max(0, maxLength - 1))}…`
}

/**
 * Builds the session env from the layered `[permissions]` / `[tools]` / `[mcp]`
 * configuration. A broken MCP entry degrades to built-in tools with a
 * diagnostic instead of aborting the run.
 */
async function openConfiguredEnv(
  runtime: ConfiguredModelRuntime,
  engineSettings: ResolvedEngineSettings,
): Promise<ManagedEnvResult> {
  const managed = await createResilientEnv({
    cwd: process.cwd(),
    llm: runtime.service,
    skillsEnabled: true,
    ...engineSettings,
  })
  if (managed.mcpError !== undefined) {
    process.stderr.write(
      `MCP servers were not connected: ${terminalDiagnostic(managed.mcpError)}\n` +
        'Continuing without MCP tools. Review the [mcp] section with `spark config list`.\n',
    )
  }
  return managed
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
