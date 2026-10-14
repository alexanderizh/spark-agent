#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { loadEvalSettings, preview, redactSecrets } from './lib/config.mjs'
import { hashFiles } from './lib/files.mjs'
import { renderMarkdown } from './lib/report.mjs'
import { scoreStaticChecks, taskPassed } from './lib/score.mjs'
import { runCommand } from './lib/spawn.mjs'
import { parseSparkStream } from './lib/stream.mjs'
import { loadTasks, parsePrepareOutput, selectTasks } from './lib/tasks.mjs'

const evalsRoot = fileURLToPath(new URL('.', import.meta.url))
const defaultSparkBin = join(evalsRoot, '..', 'dist', 'cli', 'main.js')

function helpText() {
  return `spark-engine programming evals

Usage:
  node evals/run.mjs --list
  node evals/run.mjs --self-test
  node evals/run.mjs --dry-run
  node evals/run.mjs [--task <id>]... [--timeout <ms>] [--out <dir>]

Required environment for a live run or --dry-run:
  ARK_BASE_URL   Responses root ending in /v1, or the Anthropic Coding Plan root
                 with SPARK_EVAL_PROTOCOL=anthropic-messages.
                 https://ark.cn-beijing.volces.com/api/coding is rejected on the
                 default openai-responses protocol (it would be mis-routed).
  ARK_API_KEY    credential; referenced by name in the temp config, never stored
  ARK_MODEL      upstream model id

Optional:
  SPARK_EVAL_PROTOCOL          openai-responses (default) | anthropic-messages
  SPARK_EVAL_EFFORT            off (default) | low | medium | high | max
  SPARK_EVAL_TIMEOUT_MS        overrides every task timeout
  SPARK_EVAL_CONTEXT_WINDOW    default 128000
  SPARK_EVAL_MAX_TOKENS        default 16000
  SPARK_BIN                    spark CLI entry (default spark-engine/dist/cli/main.js)
  SPARK_EVAL_OUT               report directory
  SPARK_EVAL_KEEP=1            keep per-task workspace copies under the report

The runner copies each fixture to a temp directory and invokes:
  spark --model ark --permission-mode bypass --effort <effort> \\
        --output-format stream-json -p <prompt>
`
}

function parseRunnerArgs(argv) {
  const parsed = parseArgs({
    args: argv,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      list: { type: 'boolean', default: false },
      'self-test': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      task: { type: 'string', multiple: true },
      timeout: { type: 'string' },
      out: { type: 'string' },
    },
  })
  const timeoutMs = parsed.values.timeout === undefined ? undefined : Number(parsed.values.timeout)
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
    throw new Error('--timeout must be a positive integer number of milliseconds')
  }
  return {
    help: parsed.values.help ?? false,
    list: parsed.values.list ?? false,
    selfTest: parsed.values['self-test'] ?? false,
    dryRun: parsed.values['dry-run'] ?? false,
    tasks: parsed.values.task ?? [],
    timeoutMs,
    out: parsed.values.out,
  }
}

async function main() {
  const args = parseRunnerArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(helpText())
    return 0
  }
  const tasks = selectTasks(await loadTasks(evalsRoot), args.tasks)
  if (args.list) {
    for (const task of tasks) {
      process.stdout.write(`${task.id}\t${task.capability}\t${task.title}\n`)
    }
    return 0
  }
  if (args.selfTest) return selfTest(tasks)
  const settings = loadEvalSettings(process.env)
  const sparkBin = process.env.SPARK_BIN?.trim() || defaultSparkBin
  const sparkBuilt = existsSync(sparkBin)
  if (!sparkBuilt && !args.dryRun) {
    throw new Error(
      `spark CLI is not built at ${sparkBin}. From spark-engine/: npm install && npm run build`,
    )
  }
  if (args.dryRun) {
    if (!sparkBuilt) {
      process.stderr.write(
        `warning: spark CLI is not built at ${sparkBin}. A live run needs npm install && npm run build.\n`,
      )
    }
    printDryRun(settings, sparkBin, tasks)
    return 0
  }
  const outDir =
    args.out ||
    process.env.SPARK_EVAL_OUT ||
    join(evalsRoot, 'reports', new Date().toISOString().replace(/[:.]/gu, '-'))
  await mkdir(outDir, { recursive: true })
  const keepDir = process.env.SPARK_EVAL_KEEP === '1' ? join(outDir, 'workspaces') : undefined
  if (keepDir) await mkdir(keepDir, { recursive: true })
  const report = await runLive(settings, sparkBin, tasks, { ...args, keepDir })
  await writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(join(outDir, 'report.md'), renderMarkdown(report))
  process.stdout.write(
    `report ${join(outDir, 'report.md')}\npassed ${report.summary.passed}/${report.summary.total}\n`,
  )
  return report.summary.failed === 0 ? 0 : 1
}

function printDryRun(settings, sparkBin, tasks) {
  process.stdout.write(
    [
      'spark eval dry-run',
      `protocol: ${settings.protocol}`,
      `upstream model: ${settings.model}`,
      `base url: ${settings.baseUrl}`,
      `resolved endpoint: ${settings.endpoint}`,
      `effort: ${settings.effort}`,
      'api key: set (value hidden)',
      `spark: ${process.execPath} ${sparkBin} --model ark --permission-mode bypass --effort ${settings.effort} --output-format stream-json -p <prompt>`,
      `tasks: ${tasks.map((task) => task.id).join(', ')}`,
      '',
      settings.toml,
      '',
    ].join('\n'),
  )
  for (const warning of settings.warnings) process.stderr.write(`warning: ${warning}\n`)
}

async function runLive(settings, sparkBin, tasks, args) {
  const version = await runCommand(process.execPath, [sparkBin, '--version'], { timeoutMs: 15_000 })
  const sparkVersion = version.stdout.trim() || 'unknown'
  const results = []
  for (const task of tasks) {
    results.push(await runTask(task, settings, sparkBin, args))
  }
  const passed = results.filter((task) => task.passed).length
  return {
    generatedAt: new Date().toISOString(),
    sparkBin,
    sparkVersion,
    protocol: settings.protocol,
    upstreamModel: settings.model,
    resolvedEndpoint: settings.endpoint,
    effort: settings.effort,
    warnings: settings.warnings,
    summary: { passed, failed: results.length - passed, total: results.length },
    tasks: results,
    note: 'spark-engine CLI only; not a comparison against Cursor CLI, Codex CLI, or Claude Code',
  }
}

async function runTask(task, settings, sparkBin, args) {
  const root = await mkdtemp(join(tmpdir(), `spark-eval-${task.id}-`))
  const workspace = join(root, 'workspace')
  const sparkHome = join(root, 'home')
  await mkdir(sparkHome, { recursive: true })
  const secrets = [settings.apiKey]
  try {
    await cp(join(task.dir, 'workspace'), workspace, { recursive: true })
    const prepared = await runScript(task, 'prepare', workspace, {})
    if (prepared && prepared.code !== 0) {
      return failedTask(task, `prepare exited ${prepared.code}: ${preview(prepared.stderr, 400)}`)
    }
    const head = prepared ? parsePrepareOutput(prepared.stdout).head : undefined
    const frozenBefore = await hashFiles(workspace, task.frozen)
    await mkdir(join(workspace, '.spark'), { recursive: true, mode: 0o700 })
    await writeFile(join(workspace, '.spark', 'config.toml'), settings.toml, { mode: 0o600 })
    const prompt = await readFile(join(task.dir, task.promptFile), 'utf8')
    const timeoutMs = args.timeoutMs ?? envTimeout() ?? task.timeoutMs
    const started = Date.now()
    const cli = await runCommand(
      process.execPath,
      [
        sparkBin,
        '--model',
        'ark',
        '--permission-mode',
        'bypass',
        '--effort',
        settings.effort,
        '--output-format',
        'stream-json',
        '--prompt',
        prompt,
      ],
      {
        cwd: workspace,
        timeoutMs,
        env: agentEnv(sparkHome),
      },
    )
    const latencyMs = Date.now() - started
    const stream = parseSparkStream(redactSecrets(cli.stdout, secrets), secrets)
    const frozenAfter = await hashFiles(workspace, task.frozen)
    const staticChecks = scoreStaticChecks(task, {
      frozenBefore,
      frozenAfter,
      toolCalls: stream.toolNotes,
    })
    const gradeEnv = { ...process.env }
    if (head) gradeEnv.SPARK_EVAL_GIT_HEAD = head
    const grade = await runScript(task, 'grade', workspace, gradeEnv)
    const graderChecks = parseGrader(grade, secrets)
    const checks = [...staticChecks, ...graderChecks]
    const turnStatus = cli.timedOut ? 'timeout' : stream.turnStatus
    const passed = taskPassed({
      timedOut: cli.timedOut,
      cliCode: cli.code,
      turnStatus: cli.timedOut ? 'timeout' : stream.turnStatus,
      checks,
    })
    if (args.keepDir) await cp(workspace, join(args.keepDir, task.id), { recursive: true })
    return {
      id: task.id,
      title: task.title,
      capability: task.capability,
      passed,
      latencyMs,
      exitCode: cli.code,
      timedOut: cli.timedOut,
      turnStatus,
      toolCounts: stream.toolCounts,
      toolNotes: stream.toolNotes.map(publicNote),
      checks,
      error: stream.turnError,
      stderrTail: preview(redactSecrets(cli.stderr, secrets), 2000),
      stdoutTruncated: cli.truncated,
    }
  } catch (error) {
    return failedTask(task, error instanceof Error ? error.message : String(error))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function publicNote(note) {
  return {
    tool: note.tool,
    ok: note.ok,
    durationMs: note.durationMs,
    argsPreview: note.argsPreview,
    resultPreview: note.resultPreview,
  }
}

function failedTask(task, error) {
  return {
    id: task.id,
    title: task.title,
    capability: task.capability,
    passed: false,
    latencyMs: 0,
    exitCode: null,
    timedOut: false,
    turnStatus: 'error',
    toolCounts: {},
    toolNotes: [],
    checks: [],
    error,
    stderrTail: '',
    stdoutTruncated: false,
  }
}

function agentEnv(sparkHome) {
  const env = {
    ...process.env,
    HOME: sparkHome,
    SPARK_HOME: sparkHome,
    SPARK_UPDATE_CHECK: '0',
    CI: '1',
  }
  delete env.SPARK_FAILOVER_MODELS
  delete env.SPARK_EVAL_GIT_HEAD
  return env
}

function envTimeout() {
  if (!process.env.SPARK_EVAL_TIMEOUT_MS) return undefined
  const value = Number(process.env.SPARK_EVAL_TIMEOUT_MS)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('SPARK_EVAL_TIMEOUT_MS must be a positive integer')
  }
  return value
}

async function runScript(task, field, cwd, env) {
  const script = task[field]
  if (!script) return null
  return runCommand(process.execPath, [join(task.dir, script)], {
    cwd,
    env: { ...process.env, ...env },
    timeoutMs: 30_000,
  })
}

function parseGrader(grade, secrets) {
  if (!grade) return [{ name: 'grade', passed: false, detail: 'task has no grader' }]
  const stdout = redactSecrets(grade.stdout, secrets)
  try {
    const parsed = JSON.parse(stdout)
    if (!Array.isArray(parsed.checks)) throw new Error('checks missing')
    return parsed.checks.map((check) => ({
      name: String(check.name),
      passed: check.passed === true,
      detail: redactSecrets(String(check.detail ?? ''), secrets),
    }))
  } catch (error) {
    return [
      {
        name: 'grade',
        passed: false,
        detail: `grader output was not JSON (${error instanceof Error ? error.message : error}); stderr ${preview(redactSecrets(grade.stderr, secrets), 300)}`,
      },
    ]
  }
}

async function selfTest(tasks) {
  let failed = 0
  for (const task of tasks) {
    const outcome = await selfTestTask(task)
    process.stdout.write(
      `${outcome.ok ? 'ok' : 'FAIL'} ${task.id}${outcome.detail ? ` ${outcome.detail}` : ''}\n`,
    )
    if (!outcome.ok) failed += 1
  }
  process.stdout.write(`self-test ${tasks.length - failed}/${tasks.length}\n`)
  return failed === 0 ? 0 : 1
}

async function selfTestTask(task) {
  if (!task.oracle) return { ok: false, detail: 'missing oracle' }
  const root = await mkdtemp(join(tmpdir(), `spark-eval-self-${task.id}-`))
  const workspace = join(root, 'workspace')
  try {
    await cp(join(task.dir, 'workspace'), workspace, { recursive: true })
    const prepared = await runScript(task, 'prepare', workspace, {})
    if (prepared && prepared.code !== 0) {
      return { ok: false, detail: `prepare failed: ${preview(prepared.stderr, 300)}` }
    }
    const head = prepared ? parsePrepareOutput(prepared.stdout).head : undefined
    const negative = await gradeWorkspace(task, workspace, head)
    if (negative.ok) return { ok: false, detail: 'grader passed on the unfixed fixture' }
    const frozenBefore = await hashFiles(workspace, task.frozen)
    const oracle = await runScript(task, 'oracle', workspace, {})
    if (!oracle || oracle.code !== 0) {
      return { ok: false, detail: `oracle failed: ${preview(oracle?.stderr ?? '', 300)}` }
    }
    const frozenAfter = await hashFiles(workspace, task.frozen)
    const drift = scoreStaticChecks(task, {
      frozenBefore,
      frozenAfter,
      toolCalls: [],
    }).filter((check) => check.name.startsWith('frozen:') && !check.passed)
    if (drift.length > 0)
      return {
        ok: false,
        detail: `oracle edited frozen files: ${drift.map((item) => item.name).join(', ')}`,
      }
    const positive = await gradeWorkspace(task, workspace, head)
    if (!positive.ok)
      return {
        ok: false,
        detail: `oracle did not satisfy grader: ${preview(positive.detail, 400)}`,
      }
    return { ok: true, detail: '' }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function gradeWorkspace(task, workspace, head) {
  const env = {}
  if (head) env.SPARK_EVAL_GIT_HEAD = head
  const grade = await runScript(task, 'grade', workspace, env)
  if (!grade) return { ok: false, detail: 'missing grade' }
  try {
    const parsed = JSON.parse(grade.stdout)
    return { ok: grade.code === 0 && parsed.ok === true, detail: grade.stdout }
  } catch {
    return { ok: false, detail: grade.stderr || grade.stdout }
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 2
    })
}
