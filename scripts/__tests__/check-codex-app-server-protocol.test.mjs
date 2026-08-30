import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assertPackageVersions,
  checkGeneratedProtocol,
  checkSparkProtocolSubset,
} from '../check-codex-app-server-protocol.mjs'

const matrix = {
  lockedSdkVersion: '0.149.0',
  requiredRequests: ['initialize', 'turn/start'],
  requiredNotifications: ['turn/started'],
  requiredTurnStartFields: ['threadId', 'input'],
  requiredThreadFields: ['cwd', 'config'],
  requiredSandboxVariants: ['workspaceWrite'],
}

test('reports only missing consumed App Server contracts', () => {
  const root = mkdtempSync(join(tmpdir(), 'spark-codex-protocol-fixture-'))
  try {
    mkdirSync(join(root, 'v2'), { recursive: true })
    writeFileSync(join(root, 'ClientNotification.ts'), '"method": "initialized"')
    writeFileSync(join(root, 'ClientRequest.ts'), '"method": "initialize"')
    writeFileSync(join(root, 'ServerNotification.ts'), '"method": "turn/started"')
    writeFileSync(join(root, 'v2/TurnStartParams.ts'), 'threadId input')
    writeFileSync(join(root, 'v2/ThreadStartParams.ts'), 'cwd config')
    writeFileSync(join(root, 'v2/ThreadResumeParams.ts'), 'threadId cwd config')
    writeFileSync(join(root, 'v2/SandboxPolicy.ts'), '"workspaceWrite"')

    assert.deepEqual(checkGeneratedProtocol(root, matrix), [
      'ClientRequest.ts: "method": "turn/start"',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('checks package pins and the local Spark protocol subset', () => {
  const root = mkdtempSync(join(tmpdir(), 'spark-codex-package-fixture-'))
  try {
    const packageJson = join(root, 'package.json')
    writeFileSync(packageJson, JSON.stringify({ dependencies: { '@openai/codex-sdk': '0.149.0' } }))
    assert.deepEqual(assertPackageVersions(matrix, [packageJson]), [])
    assert.deepEqual(
      checkSparkProtocolSubset('threadId input cwd config workspaceWrite', matrix),
      [],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
