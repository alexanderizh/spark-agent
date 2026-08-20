/**
 * codex app-server 测试替身（NDJSON JSON-RPC over stdio）。
 *
 * 用法：node fake-codex-app-server.mjs <scenario.json> <journal.log>
 * 由 codex-app-server-executor.test.ts 经 CodexAppServerExecutor 的
 * executablePath/args 注入点 spawn（executablePath=node、args=[本脚本,…]）。
 *
 * 剧本（scenario.json）：
 * {
 *   "resumeFails": true,                  // thread/resume 回 JSON-RPC 错误
 *   "serverRequests": [                   // turn/start 后先发的 server→client 请求
 *     { "method": "item/commandExecution/requestApproval", "params": {...} }
 *   ],
 *   "steps": [                            // 通知序列
 *     { "kind": "notify", "method": "item/agentMessage/delta", "params": {...} },
 *     { "kind": "serverRequest", "method": "...", "params": {...} }, // 发一个 server→client 请求（等响应或 3s 超时）
 *     { "kind": "waitInterrupt" },        // 挂起直到收到 turn/interrupt
 *     { "kind": "exit", "code": 1 },      // 模拟进程崩溃
 *     { "kind": "delay", "ms": 50 }
 *   ],
 *   "postTurnSteps": [                    // turn/completed 之后的迟到通知序列
 *     { "kind": "delay", "ms": 50 },
 *     { "kind": "notify", ... },          // 详见下方「迟到通知」说明
 *   ],
 *   "finalStatus": "completed"            // turn/completed 的状态
 * }
 *
 * 迟到通知（postTurnSteps）：客户端在 turn/completed 后会 dispose（SIGTERM），
 * 替身默认会被立即杀死——postTurnSteps 模式下挂一个空 SIGTERM handler 让进程
 * 存活到迟到通知发完再 exit(0)，模拟真实进程关闭期间 flush 残留输出的竞态。
 *
 * journal.log：逐行 JSON，记录收到的每个客户端请求（method+params）与
 * 客户端对 server 请求的响应（approvalDecision），供测试断言。
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const [, , scenarioPath, journalPath] = process.argv
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'))
const THREAD_ID = 'fake-thread-1'
const TURN_ID = 'fake-turn-1'

function journal(entry) {
  appendFileSync(journalPath, `${JSON.stringify(entry)}\n`)
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params })
}

let waitInterruptResolve = null

// server→client 请求（审批）的响应屏障：真实 codex 发审批后阻塞等待决策，
// 替身对齐此行为——等客户端响应（或 3s 超时兜底）再继续后续步骤，
// 否则 turn 快速结束时客户端响应可能在进程退出后才送达（测试竞态）。
const approvalBarriers = []

async function runSteps(steps) {
  for (const step of steps ?? []) {
    if (step.kind === 'notify') {
      notify(step.method, step.params ?? {})
    } else if (step.kind === 'serverRequest') {
      // 与 serverRequests 数组同款响应屏障：等客户端响应（或 3s 超时）再继续，
      // 保证替身存活到响应被 journal 记录（否则进程退出会静默丢掉迟到响应）。
      const requestId = Math.floor(Math.random() * 1_000_000) + 100
      let releaseBarrier
      const barrier = new Promise((resolve) => {
        releaseBarrier = resolve
      })
      approvalBarriers.push(() => releaseBarrier())
      send({ jsonrpc: '2.0', id: requestId, method: step.method, params: step.params ?? {} })
      await Promise.race([barrier, new Promise((resolve) => setTimeout(resolve, 3_000))])
    } else if (step.kind === 'delay') {
      await new Promise((resolve) => setTimeout(resolve, step.ms ?? 20))
    } else if (step.kind === 'waitInterrupt') {
      await new Promise((resolve) => {
        waitInterruptResolve = resolve
      })
      // interrupt 处理器已发 turn/completed(interrupted)
      return true
    } else if (step.kind === 'exit') {
      process.exit(step.code ?? 1)
    }
  }
  return false
}

async function runScript() {
  for (const request of scenario.serverRequests ?? []) {
    const requestId = Math.floor(Math.random() * 1_000_000) + 100
    journal({ kind: 'serverRequestSent', method: request.method })
    let releaseBarrier
    const barrier = new Promise((resolve) => {
      releaseBarrier = resolve
    })
    approvalBarriers.push(() => releaseBarrier())
    send({ jsonrpc: '2.0', id: requestId, method: request.method, params: request.params ?? {} })
    await Promise.race([barrier, new Promise((resolve) => setTimeout(resolve, 3_000))])
  }
  if (await runSteps(scenario.steps)) return
  // SIGTERM handler 必须注册在写出 turn/completed 之前：客户端收到终态即
  // dispose（SIGTERM），若注册晚于写出，信号可能在同步 journal 写盘期间到达，
  // 彼时进程尚无 handler、内核默认动作直接终止，迟到通知一发不出。
  const hasPostTurnSteps = Array.isArray(scenario.postTurnSteps)
  if (hasPostTurnSteps) process.on('SIGTERM', () => {})
  const finalStatus = scenario.finalStatus ?? 'completed'
  notify('turn/completed', {
    threadId: THREAD_ID,
    turn: {
      id: TURN_ID,
      status: finalStatus,
      ...(finalStatus === 'failed'
        ? { error: { message: scenario.failureMessage ?? 'fake turn failure' } }
        : {}),
    },
  })
  if (hasPostTurnSteps) {
    // 存活到迟到通知发完再自行退出。
    await runSteps(scenario.postTurnSteps)
    process.exit(0)
  }
}

function handleClientRequest(message) {
  const { id, method, params } = message
  journal({ kind: 'request', method, params: params ?? null })
  switch (method) {
    case 'initialize':
      respond(id, {})
      return
    case 'thread/start':
      respond(id, { thread: { id: THREAD_ID } })
      return
    case 'thread/resume':
      if (scenario.resumeFails === true) {
        respondError(id, -32000, `thread not found: ${params?.threadId ?? 'unknown'}`)
      } else {
        respond(id, { thread: { id: THREAD_ID } })
      }
      return
    case 'turn/start':
      respond(id, { turn: { id: TURN_ID } })
      void runScript()
      return
    case 'turn/steer':
      respond(id, {})
      return
    case 'thread/compact/start':
      respond(id, {})
      return
    case 'turn/interrupt':
      journal({ kind: 'interrupt' })
      void (async () => {
        // 真实 codex 中断会作废挂起的审批：先放行屏障给客户端响应让路，
        // 再补 interrupted 终态（与取消竞态下响应仍可被记录/送达）。
        for (const release of approvalBarriers.splice(0)) release()
        await new Promise((resolve) => setTimeout(resolve, 50))
        if (waitInterruptResolve != null) {
          waitInterruptResolve()
          waitInterruptResolve = null
        }
        notify('turn/completed', {
          threadId: THREAD_ID,
          turn: { id: TURN_ID, status: 'interrupted' },
        })
        respond(id, {})
      })()
      return
    default:
      respondError(id, -32601, `fake server does not implement ${method}`)
  }
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const text = line.trim()
  if (text.length === 0) return
  let message
  try {
    message = JSON.parse(text)
  } catch {
    return
  }
  if (message.method != null && message.id != null) {
    handleClientRequest(message)
    return
  }
  if (message.method != null) {
    journal({ kind: 'notification', method: message.method, params: message.params ?? null })
    return
  }
  if (message.result != null || message.error != null) {
    // 客户端对我们 server→client 请求（审批）的响应。
    journal({
      kind: 'clientResponse',
      result: message.result ?? null,
      error: message.error ?? null,
    })
    approvalBarriers.shift()?.()
  }
})

journal({ kind: 'started', pid: process.pid })
