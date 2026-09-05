#!/usr/bin/env node
/**
 * Spark 引擎 M0 冒烟：在当前运行时（纯 Node 或 Electron 主进程）加载 @spark/agent，
 * 用 FakeModel 跑通三段链路：
 *   1. 纯文本 turn（流式 delta + 事件账本）
 *   2. read 工具 turn（真实工作区文件读取，工具循环 + usage）
 *   3. 跨 Agent 实例 openSession 续跑（事件重放 + 崩溃恢复扫描）
 *
 * dataRoot 与 cwd 全部落在临时目录，不触碰 ~/.spark。
 *
 * 用法：
 *   node scripts/spark-engine-smoke.mjs
 *   pnpm --filter desktop exec electron ../../scripts/spark-engine-smoke.mjs
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runtimeLabel = process.versions.electron
  ? `electron ${process.versions.electron} (bundled node ${process.versions.node})`
  : `node ${process.versions.node}`
console.log(`[smoke] runtime: ${runtimeLabel}`)

let exitCode = 0
let root = ''

async function main() {
  // 优先按包名解析（依赖方包内运行时）；从仓库根 scripts/ 直跑时按 hoisted 布局
  // 根 node_modules 不含 workspace 包，回退直连构建产物（与 dist 入口等价）。
  let sdk
  try {
    sdk = await import('@spark/agent')
  } catch {
    sdk = await import(new URL('../spark-engine/dist/index.js', import.meta.url).href)
  }
  const { Agent, FakeModel, createDefaultEnv, text, toolCall } = sdk

  root = mkdtempSync(join(tmpdir(), 'spark-engine-smoke-'))
  const cwd = join(root, 'workspace')
  const dataRoot = join(root, 'data')
  mkdirSync(cwd, { recursive: true })
  const FILE_BODY = 'export const smoke = true;\n'
  writeFileSync(join(cwd, 'a.ts'), FILE_BODY)

  // 共享脚本按 LLM 调用顺序依次消费：turn1 文本 → turn2 工具+总结 → turn3 续跑文本。
  const scriptFor = (items) => () => createDefaultEnv({ cwd, dataRoot, llm: new FakeModel(items) })

  // ---- 第一/二轮：同一 Agent 实例 ----
  const scripted = scriptFor([
    text('第一轮：spark 引擎冒烟回复。'),
    toolCall('smoke-read-1', 'read', { path: 'a.ts' }, { text: '我先读取工作区文件。' }),
    text('第二轮：已读取 a.ts。'),
  ])
  const env1 = scripted()
  const agent1 = Agent.open({ cwd, env: env1 })
  const session = await agent1.newSession({ permissionMode: 'default' })

  const seenEvents = []
  const collect = (label) => (event) => {
    seenEvents.push(`${label}:${event.type}`)
  }

  // turn 1：纯文本
  let deltas = []
  const r1 = await session.turn('第一轮：请直接回复一句话。', {
    onEvent: collect('t1'),
    onDelta: (delta) => {
      if (delta.type === 'text') deltas.push(delta.text)
    },
  })
  assert(r1.terminal.type === 'turn.completed', `turn1 终态=${r1.terminal.type}`)
  const streamed = deltas.join('')
  assert(streamed === '第一轮：spark 引擎冒烟回复。', `turn1 流式文本="${streamed}"`)

  // turn 2：read 工具循环
  const r2 = await session.turn('第二轮：请读取 a.ts 并告诉我内容。', { onEvent: collect('t2') })
  assert(r2.terminal.type === 'turn.completed', `turn2 终态=${r2.terminal.type}`)
  const t2Events = []
  for await (const event of session.events()) t2Events.push(event)
  const toolCallEvent = t2Events.find((event) => event.type === 'tool.call')
  const toolResultEvent = t2Events.find(
    (event) => event.type === 'tool.result' && event.callId === 'smoke-read-1',
  )
  assert(toolCallEvent !== undefined, 'turn2 缺少 tool.call 事件')
  assert(toolResultEvent !== undefined, 'turn2 缺少 tool.result 事件')
  const content = toolResultEvent?.content
  assert(
    typeof content === 'string' && content.includes('export const smoke = true'),
    `turn2 read 工具未读到文件内容: ${JSON.stringify(content)?.slice(0, 120)}`,
  )
  assert(
    t2Events.some((event) => event.type === 'assistant.completed'),
    '事件账本缺少 assistant.completed 记录',
  )

  // ---- 第三轮：全新 Agent 实例 openSession 续跑（resume + 事件重放）----
  const env2 = createDefaultEnv({
    cwd,
    dataRoot,
    llm: new FakeModel([text('第三轮：续跑成功。')]),
  })
  const agent2 = Agent.open({ cwd, env: env2 })
  const resumed = await agent2.openSession(session.sessionId)
  const replayed = []
  for await (const event of resumed.events()) replayed.push(event)
  assert(
    replayed.length >= t2Events.length,
    `重放事件数 ${replayed.length} < 账本 ${t2Events.length}`,
  )
  assert(
    resumed.recovery.interruptedTurnId === undefined,
    `不应存在中断 turn，实际 ${String(resumed.recovery.interruptedTurnId)}`,
  )
  const r3 = await resumed.turn('第三轮：继续。', { onEvent: collect('t3') })
  assert(r3.terminal.type === 'turn.completed', `turn3 终态=${r3.terminal.type}`)

  console.log(`[smoke] 事件账本合计 ${replayed.length}+ 条；spark sessionId=${session.sessionId}`)
  console.log('[smoke] PASS — @spark/agent 在当前运行时可完整跑通 turn/工具/续跑')
}

function assert(condition, message) {
  if (!condition) throw new Error(`[smoke] FAIL: ${message}`)
  console.log(`[smoke] ok — ${message}`)
}

try {
  await main()
} catch (error) {
  exitCode = 1
  console.error(`[smoke] FAILED (${runtimeLabel}):`, error)
} finally {
  if (root) rmSync(root, { recursive: true, force: true })
}

process.exit(exitCode)
