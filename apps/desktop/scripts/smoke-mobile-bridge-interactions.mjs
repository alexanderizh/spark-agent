#!/usr/bin/env node
/**
 * 挂起交互端点回归（不依赖 Electron / edu-server）：
 * 用 mock deps 驱动真实 MobileBridgeService 路由，验证
 *   GET  /v1/sessions/:id/interactions        挂起审批 + 问答快照
 *   POST /v1/sessions/:id/approvals/:rid/resolve  decision 白名单 + 404
 *   POST /v1/sessions/:id/questions/:qid/answer   answers 必填 + 404
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const outputPath = join(scriptDir, `.smoke-mobile-bridge-interactions-${process.pid}.mjs`)

try {
  await build({
    entryPoints: [join(desktopRoot, 'src/main/services/MobileBridgeService.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: outputPath,
    plugins: [
      {
        name: 'mobile-bridge-interactions-smoke-logger',
        setup(buildApi) {
          buildApi.onResolve({ filter: /^@spark\/shared$/ }, () => ({
            path: 'shared-logger',
            namespace: 'smoke',
          }))
          buildApi.onLoad({ filter: /.*/, namespace: 'smoke' }, () => ({
            contents: [
              'export const createLogger = () => ({ debug() {}, info() {}, warn() {}, error() {} })',
              'export class SparkError extends Error { constructor(code, message, context) { super(message); this.name = "SparkError"; this.code = code; if (context !== undefined) this.context = context } }',
            ].join('\n'),
            loader: 'js',
          }))
        },
      },
    ],
  })
  const { MobileBridgeService } = await import(pathToFileURL(outputPath).href)

  const service = new MobileBridgeService()
  service.setDeps({
    listPendingInteractions: async (sessionId) => ({
      approvals:
        sessionId === 's1'
          ? [
              {
                requestId: 'req-1',
                sessionId,
                toolName: 'Bash',
                action: 'command_exec',
                riskLevel: 'high',
                toolInput: { command: 'pnpm test' },
                createdAt: '2026-10-16T00:00:00Z',
                defaultToNo: true,
              },
            ]
          : [],
      questions:
        sessionId === 's1'
          ? [
              {
                questionId: 'q-1',
                sessionId,
                createdAt: '2026-10-16T00:00:00Z',
                questions: [
                  {
                    question: '用哪种方案？',
                    header: '方案',
                    type: 'single_choice',
                    options: [{ label: 'A' }, { label: 'B' }],
                  },
                ],
              },
            ]
          : [],
    }),
    resolveApproval: async (sessionId, requestId, decision) =>
      sessionId === 's1' && requestId === 'req-1' && decision === 'allow-once',
    answerQuestion: async (sessionId, questionId, answers) =>
      sessionId === 's1' && questionId === 'q-1' && answers?.answers?.length === 1,
    // 其余 deps 本冒烟不触达；留占位以满足结构
    listProjects: async () => ({ projects: [], total: 0 }),
    listSessions: async () => ({ sessions: [], total: 0 }),
    createSession: async () => {
      throw new Error('not used')
    },
    updateSession: async () => {
      throw new Error('not used')
    },
    deleteSession: async () => ({ deleted: true }),
    getHistory: async () => ({ events: [], running: false }),
    getStreamEvents: async () => ({ events: [], nextSeq: 0 }),
    submitTurn: async () => ({ turnId: 't' }),
    cancelTurn: async () => undefined,
    getCatalog: async () => ({
      agents: [],
      workflows: [],
      providers: [],
      permissionModes: {},
      reasoningEfforts: [],
    }),
    getSessionRuntime: async () => null,
    getWorkflowBinding: async () => ({
      binding: null,
      effectiveName: null,
      canChange: true,
      error: null,
    }),
    setWorkflowBinding: async () => ({
      binding: null,
      effectiveName: null,
      canChange: true,
      error: null,
    }),
    saveAttachments: async () => [],
    readAttachmentContent: async () => null,
    transcribeAudio: async () => ({ kind: 'failed', message: 'not used' }),
    listSessionTasks: async () => [],
    createSessionTask: async () => {
      throw new Error('not used')
    },
    updateSessionTask: async () => null,
    deleteSessionTask: async () => true,
    toggleSessionTask: async () => null,
    runSessionTaskNow: async () => ({ started: true }),
    listCommands: async () => [],
    executeCommand: async () => ({ isCommand: false, forwardToAgent: false }),
  })

  const call = (method, urlPath, body) => service.invokeRelay(method, urlPath, body)

  // 1) 挂起交互快照
  const snapshot = await call('GET', '/v1/sessions/s1/interactions')
  assert.equal(snapshot.status, 200)
  assert.equal(snapshot.body.approvals.length, 1)
  assert.equal(snapshot.body.approvals[0].toolInput.command, 'pnpm test')
  assert.equal(snapshot.body.approvals[0].defaultToNo, true)
  assert.equal(snapshot.body.questions.length, 1)
  assert.equal(snapshot.body.questions[0].questions[0].options.length, 2)

  // 其他会话为空（挂起按会话隔离）
  const empty = await call('GET', '/v1/sessions/s2/interactions')
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.body.approvals, [])
  assert.deepEqual(empty.body.questions, [])

  // 2) 审批应答：decision 白名单
  const badDecision = await call('POST', '/v1/sessions/s1/approvals/req-1/resolve', {
    decision: 'allow-global',
  })
  assert.equal(badDecision.status, 400)
  const missingDecision = await call('POST', '/v1/sessions/s1/approvals/req-1/resolve', {})
  assert.equal(missingDecision.status, 400)

  // 3) 审批应答：不存在 → 404
  const notFoundApproval = await call('POST', '/v1/sessions/s1/approvals/req-404/resolve', {
    decision: 'allow-once',
  })
  assert.equal(notFoundApproval.status, 404)
  const notFoundCrossSession = await call('POST', '/v1/sessions/s2/approvals/req-1/resolve', {
    decision: 'allow-once',
  })
  assert.equal(notFoundCrossSession.status, 404, '跨会话 requestId 必须拒绝')

  // 4) 审批应答：成功
  const resolved = await call('POST', '/v1/sessions/s1/approvals/req-1/resolve', {
    decision: 'allow-once',
  })
  assert.equal(resolved.status, 200)
  assert.equal(resolved.body.ok, true)

  // 5) 问答应答：answers 必填
  const missingAnswers = await call('POST', '/v1/sessions/s1/questions/q-1/answer', {})
  assert.equal(missingAnswers.status, 400)
  const notFoundQuestion = await call('POST', '/v1/sessions/s1/questions/q-404/answer', {
    answers: { answers: [] },
  })
  assert.equal(notFoundQuestion.status, 404)

  // 6) 问答应答：成功（载荷形状由端上构造，服务端只透传）
  const answered = await call('POST', '/v1/sessions/s1/questions/q-1/answer', {
    answers: {
      answers: [{ index: 0, question: '用哪种方案？', type: 'single_choice', answer: 'A' }],
      questionCount: 1,
      answeredCount: 1,
    },
  })
  assert.equal(answered.status, 200)
  assert.equal(answered.body.ok, true)

  console.log('smoke:mobile-bridge-interactions 通过：挂起快照 / 审批应答 / 问答应答 / 越权与 404')
} finally {
  rm(outputPath, { force: true }).catch(() => undefined)
}
