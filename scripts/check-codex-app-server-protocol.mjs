import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

export function checkGeneratedProtocol(generatedRoot, matrix) {
  const checks = [
    ['ClientNotification.ts', ['"method": "initialized"']],
    ['ClientRequest.ts', matrix.requiredRequests.map((method) => `"method": "${method}"`)],
    [
      'ServerNotification.ts',
      matrix.requiredNotifications.map((method) => `"method": "${method}"`),
    ],
    ['v2/TurnStartParams.ts', matrix.requiredTurnStartFields],
    ['v2/ThreadStartParams.ts', matrix.requiredThreadFields],
    ['v2/ThreadResumeParams.ts', [...matrix.requiredThreadFields, 'threadId']],
    ['v2/SandboxPolicy.ts', matrix.requiredSandboxVariants.map((variant) => `"${variant}"`)],
  ]
  const missing = []
  for (const [relativePath, tokens] of checks) {
    const target = join(generatedRoot, relativePath)
    if (!existsSync(target)) {
      missing.push(`${relativePath}: file missing`)
      continue
    }
    const source = readFileSync(target, 'utf8')
    for (const token of tokens) {
      if (!source.includes(token)) missing.push(`${relativePath}: ${token}`)
    }
  }
  return missing
}

export function checkSparkProtocolSubset(source, matrix) {
  const tokens = [
    ...matrix.requiredTurnStartFields,
    ...matrix.requiredThreadFields,
    ...matrix.requiredSandboxVariants,
  ]
  return tokens.filter((token) => !source.includes(token))
}

export function assertPackageVersions(matrix, packageJsonPaths) {
  const mismatches = []
  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    const version = packageJson.dependencies?.['@openai/codex-sdk']
    if (version !== matrix.lockedSdkVersion) {
      mismatches.push(
        `${packageJsonPath}: expected ${matrix.lockedSdkVersion}, received ${version}`,
      )
    }
  }
  return mismatches
}

export function runCodexProtocolCheck() {
  const matrixPath = join(scriptDir, 'codex-app-server-compatibility.json')
  const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'))
  const packageErrors = assertPackageVersions(matrix, [
    join(repoRoot, 'packages/agent-runtime/package.json'),
    join(repoRoot, 'apps/desktop/package.json'),
  ])
  const localProtocol = readFileSync(
    join(repoRoot, 'packages/agent-runtime/src/sdk/codex-app-server/app-server-protocol.ts'),
    'utf8',
  )
  const localErrors = checkSparkProtocolSubset(localProtocol, matrix).map(
    (token) => `Spark protocol subset: ${token}`,
  )
  const codexCli = join(repoRoot, 'node_modules/@openai/codex/bin/codex.js')
  if (!existsSync(codexCli)) throw new Error('Official @openai/codex CLI is not installed')
  const versionOutput = execFileSync(process.execPath, [codexCli, '--version'], {
    encoding: 'utf8',
  }).trim()
  if (!versionOutput.includes(matrix.lockedSdkVersion)) {
    packageErrors.push(
      `Official Codex CLI version mismatch: expected ${matrix.lockedSdkVersion}, received ${versionOutput}`,
    )
  }

  const generatedRoot = mkdtempSync(join(tmpdir(), 'spark-codex-protocol-'))
  try {
    execFileSync(
      process.execPath,
      [codexCli, 'app-server', 'generate-ts', '--out', generatedRoot],
      { stdio: 'pipe' },
    )
    const generatedErrors = checkGeneratedProtocol(generatedRoot, matrix)
    const errors = [...packageErrors, ...localErrors, ...generatedErrors]
    if (errors.length > 0) {
      throw new Error(`Codex App Server protocol drift detected:\n- ${errors.join('\n- ')}`)
    }
  } finally {
    rmSync(generatedRoot, { recursive: true, force: true })
  }
  process.stdout.write(
    `Codex App Server protocol compatible: SDK ${matrix.lockedSdkVersion}, runtime >= ${matrix.minimumRuntimeVersion}\n`,
  )
}

if (process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCodexProtocolCheck()
}
