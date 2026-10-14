import assert from 'node:assert/strict'
import test from 'node:test'

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  buildProjectConfig,
  endpointRefusal,
  loadEvalSettings,
  redactSecrets,
  resolveEndpoint,
} from './lib/config.mjs'
import { renderMarkdown } from './lib/report.mjs'
import { scoreStaticChecks, taskPassed } from './lib/score.mjs'
import { parseSparkStream } from './lib/stream.mjs'
import { parsePrepareOutput } from './lib/tasks.mjs'

test('resolves OpenAI Responses and Anthropic message endpoints the way the CLI does', () => {
  assert.equal(
    resolveEndpoint('https://api.openai.com/v1', 'openai-responses'),
    'https://api.openai.com/v1/responses',
  )
  assert.equal(
    resolveEndpoint('https://example.test', 'openai-responses'),
    'https://example.test/v1/responses',
  )
  assert.equal(
    resolveEndpoint('https://api.anthropic.com', 'anthropic-messages'),
    'https://api.anthropic.com/v1/messages',
  )
  assert.equal(
    resolveEndpoint('https://example.test/v1/messages', 'anthropic-messages'),
    'https://example.test/v1/messages',
  )
})

test('refuses Ark coding and Chat Completions bases instead of rewriting them to /v1/responses', () => {
  const coding = 'https://ark.cn-beijing.volces.com/api/coding'
  const versioned = 'https://ark.cn-beijing.volces.com/api/coding/v3'
  const chat = 'https://ark.cn-beijing.volces.com/api/v3'
  const secret = 'sk-test-secret-value'

  const bare = endpointRefusal(coding, 'openai-responses')
  assert.ok(bare)
  assert.match(bare, /\/v1\/responses/u)
  assert.match(bare, /anthropic-messages/u)
  assert.match(bare, /chat\/completions/u)
  assert.equal(bare.includes(secret), false)

  assert.equal(endpointRefusal(coding, 'anthropic-messages'), null)
  assert.equal(
    resolveEndpoint(coding, 'anthropic-messages'),
    'https://ark.cn-beijing.volces.com/api/coding/v1/messages',
  )

  const v3 = endpointRefusal(versioned, 'openai-responses')
  assert.ok(v3)
  assert.match(v3, /v3\/v1\/responses/u)
  assert.match(endpointRefusal(versioned, 'anthropic-messages') ?? '', /Anthropic Coding Plan/u)

  const standard = endpointRefusal(chat, 'openai-responses')
  assert.ok(standard)
  assert.match(standard, /Chat Completions/u)
  assert.equal(endpointRefusal('https://api.openai.com/v1', 'openai-responses'), null)
  assert.equal(
    endpointRefusal('https://ark.cn-beijing.volces.com/api/coding/v1', 'openai-responses'),
    null,
  )

  assert.throws(
    () =>
      loadEvalSettings({
        ARK_BASE_URL: coding,
        ARK_API_KEY: secret,
        ARK_MODEL: 'demo-model',
      }),
    /Refusing ARK_BASE_URL/u,
  )
})

test('dry-run exits non-zero for an /api/coding base and does not print the key', () => {
  const secret = 'sk-test-secret-value'
  const result = spawnSync(process.execPath, ['evals/run.mjs', '--dry-run'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      ARK_BASE_URL: 'https://ark.cn-beijing.volces.com/api/coding',
      ARK_API_KEY: secret,
      ARK_MODEL: 'demo-model',
    },
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /api\/coding/u)
  assert.match(result.stderr, /anthropic-messages/u)
  assert.equal(`${result.stdout}${result.stderr}`.includes(secret), false)
  assert.doesNotMatch(result.stdout, /base_url = /u)
})

test('project config names the key variable and does not embed the secret', () => {
  const secret = 'sk-test-secret-value'
  const toml = buildProjectConfig({
    baseUrl: 'https://example.test/v1',
    apiKeyEnv: 'ARK_API_KEY',
    model: 'demo-model',
    protocol: 'openai-responses',
    contextWindow: 128000,
    maxTokens: 16000,
  })
  assert.match(toml, /api_key_env = "ARK_API_KEY"/u)
  assert.equal(toml.includes(secret), false)
  assert.throws(
    () =>
      buildProjectConfig({
        baseUrl: 'https://user:pass@example.test/v1',
        apiKeyEnv: 'ARK_API_KEY',
        model: 'demo-model',
        protocol: 'openai-responses',
        contextWindow: 1,
        maxTokens: 1,
      }),
    /credentials/u,
  )
  const settings = loadEvalSettings({
    ARK_BASE_URL: 'https://example.test/v1',
    ARK_API_KEY: secret,
    ARK_MODEL: 'demo-model',
  })
  assert.equal(settings.toml.includes(secret), false)
  assert.equal(redactSecrets(`token ${secret}`, [secret]).includes(secret), false)
})

test('scores frozen files, required tool calls, and the overall pass bit', () => {
  const task = {
    frozen: ['test/sum.test.mjs'],
    requireTools: [{ name: 'bash', argsMatch: 'sum.test.mjs' }],
  }
  const checks = scoreStaticChecks(task, {
    frozenBefore: { 'test/sum.test.mjs': 'abc' },
    frozenAfter: { 'test/sum.test.mjs': 'abc' },
    toolCalls: [{ tool: 'bash', argsText: 'node --test test/sum.test.mjs' }],
  })
  assert.equal(
    checks.every((check) => check.passed),
    true,
  )
  assert.equal(taskPassed({ timedOut: false, cliCode: 0, turnStatus: 'completed', checks }), true)
  assert.equal(taskPassed({ timedOut: true, cliCode: 0, turnStatus: 'completed', checks }), false)
})

test('parses spark stream-json tool calls without keeping raw secrets', () => {
  const secret = 'sk-test-secret-value'
  const stdout = [
    JSON.stringify({
      type: 'tool.call',
      callId: 'c1',
      tool: 'bash',
      args: { command: `echo ${secret}` },
    }),
    JSON.stringify({ type: 'tool.result', callId: 'c1', ok: true, durationMs: 4, content: secret }),
    JSON.stringify({ type: 'turn.completed', turnId: 't1' }),
  ].join('\n')
  const parsed = parseSparkStream(stdout, [secret])
  assert.equal(parsed.turnStatus, 'completed')
  assert.equal(parsed.toolCounts.bash, 1)
  assert.equal(parsed.toolNotes[0].argsPreview.includes(secret), false)
  assert.equal(parsed.toolNotes[0].resultPreview.includes(secret), false)
})

test('markdown report records the endpoint and states that no key is stored', () => {
  const markdown = renderMarkdown({
    generatedAt: '2026-10-14T00:00:00.000Z',
    sparkVersion: '0.7.3',
    sparkBin: '/tmp/spark',
    protocol: 'openai-responses',
    upstreamModel: 'demo-model',
    resolvedEndpoint: 'https://example.test/v1/responses',
    effort: 'off',
    warnings: [],
    summary: { passed: 0, failed: 1, total: 1 },
    tasks: [
      {
        id: '01-file-edit',
        title: 'Fix',
        capability: 'file-edit',
        passed: false,
        latencyMs: 10,
        exitCode: 1,
        turnStatus: 'failed',
        toolCounts: {},
        toolNotes: [],
        checks: [{ name: 'unit-tests', passed: false, detail: 'assertion failed' }],
        error: null,
        stderrTail: '',
      },
    ],
  })
  assert.match(markdown, /https:\/\/example\.test\/v1\/responses/u)
  assert.match(markdown, /not recorded/u)
  assert.match(markdown, /not a comparison/u)
})

test('prepare output exposes the baseline commit', () => {
  assert.equal(parsePrepareOutput('HEAD abcdef1\n').head, 'abcdef1')
  assert.equal(parsePrepareOutput('nope').head, undefined)
})
