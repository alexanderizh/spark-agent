import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const hookPath = resolve('apps/desktop/scripts/notarize.js')
const agreementError =
  'Error: HTTP status code: 403. A required agreement is missing or has expired. ' +
  'This request requires an in-effect agreement that has not been signed or has expired. ' +
  'Ensure your team has signed the necessary legal agreements and that they are not expired.'
const canRunStubs = process.platform !== 'win32'

for (const output of [
  agreementError,
  JSON.stringify({ status: 'Invalid', message: agreementError }),
]) {
  test(
    'agreement failure stops after one submission and explains account recovery',
    {
      skip: !canRunStubs,
    },
    async () => {
      const result = await runHook(output)
      assert.equal(result.status, 1, result.output)
      assert.equal(result.submissions, 1, result.output)
      assert.match(result.output, /Account Holder/)
      assert.match(result.output, /https:\/\/developer\.apple\.com\/account\//)
      assert.doesNotMatch(result.output, /返回临时错误/)
      assert.equal(result.staples, 0)
      assert.equal(result.verified, false)
    },
  )
}

for (const output of [
  'Error: HTTP status code: 401. Invalid credentials; check your network settings.',
  'Error: HTTP 403 Forbidden. Service unavailable for this account.',
  'Error: HTTP status code: 400. Bad request.',
  'Error: HTTP 404. Submission not found.',
  'Error: notarytool returned an unexpected non-JSON response.',
  JSON.stringify({ status: 'Invalid', message: 'The binary uses an invalid network entitlement.' }),
]) {
  test(`does not retry permanent error: ${output}`, { skip: !canRunStubs }, async () => {
    const result = await runHook(output)
    assert.equal(result.status, 1, result.output)
    assert.equal(result.submissions, 1, result.output)
    assert.equal(result.staples, 0)
    assert.equal(result.verified, false)
  })
}

for (const output of [
  'Error: HTTP status code: 503. Service unavailable.',
  'Error: HTTP 500. Internal server error.',
  'Error: HTTP status code: 429. Too many requests.',
  'Error: HTTP 408. Request timeout.',
  'Error: NSURLErrorDomain: The request timed out.',
  'Error: ECONNRESET',
  JSON.stringify({ status: 'In Progress', message: 'Processing submission.' }),
]) {
  test(
    `retries transient error then staples accepted app: ${output}`,
    {
      skip: !canRunStubs,
    },
    async () => {
      const result = await runHook(output)
      assert.equal(result.status, 0, result.output)
      assert.equal(result.submissions, 2, result.output)
      assert.equal(result.staples, 1)
      assert.equal(result.verified, true)
    },
  )
}

test(
  'stops after bounded attempts when Apple remains unavailable',
  {
    skip: !canRunStubs,
  },
  async () => {
    const result = await runHook('Error: HTTP 503. Service unavailable.', true)
    assert.equal(result.status, 1, result.output)
    assert.equal(result.submissions, 3, result.output)
    assert.equal(result.staples, 0)
    assert.equal(result.verified, false)
  },
)

// Execute the real afterSign hook with local command substitutes. No Apple requests,
// signing credentials, or production artifacts are needed for the retry contract.
async function runHook(failureOutput, alwaysFail = false) {
  const directory = await mkdtemp(join(tmpdir(), 'spark-notarize-retry-'))
  const binDirectory = join(directory, 'bin')
  try {
    await mkdir(binDirectory)
    await writeFile(join(directory, 'failure.txt'), failureOutput)
    for (const command of ['codesign', 'ditto']) {
      await writeFile(join(binDirectory, command), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    }
    await writeFile(join(binDirectory, 'xcrun'), xcrunStub, { mode: 0o755 })
    const run = spawnSync(
      process.execPath,
      [
        '-e',
        `
      const afterSign = require(${JSON.stringify(hookPath)});
      afterSign({
        electronPlatformName: 'darwin', arch: 3,
        appOutDir: process.env.NOTARIZE_TEST_DIRECTORY,
        packager: { appInfo: { productFilename: 'Test App' } },
      }, { verifyPackagedMacNativeHost: async () => console.log('TEST_VERIFIED') })
        .catch(() => { process.exitCode = 1; });
    `,
      ],
      {
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
          APPLE_ID: 'test@example.invalid',
          APPLE_APP_SPECIFIC_PASSWORD: 'test-only-password',
          APPLE_TEAM_ID: 'TESTTEAM00',
          NOTARIZE_MAX_ATTEMPTS: '3',
          NOTARIZE_RETRY_DELAY_MS: '1',
          NOTARIZE_TEST_DIRECTORY: directory,
          NOTARIZE_TEST_ALWAYS_FAIL: alwaysFail ? '1' : '0',
        },
      },
    )
    assert.ifError(run.error)
    const trace = await readFile(join(directory, 'trace.txt'), 'utf8')
    return {
      status: run.status,
      output: `${run.stdout}${run.stderr}`,
      submissions: trace.split('\n').filter((line) => line === 'submit').length,
      staples: trace.split('\n').filter((line) => line === 'staple').length,
      verified: run.stdout.includes('TEST_VERIFIED'),
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const xcrunStub = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const directory = process.env.NOTARIZE_TEST_DIRECTORY;
const tracePath = path.join(directory, 'trace.txt');
const command = process.argv[3];
if (command === 'submit') {
  const previous = fs.existsSync(tracePath) ? fs.readFileSync(tracePath, 'utf8') : '';
  fs.appendFileSync(tracePath, 'submit\\n');
  if (!previous.includes('submit') || process.env.NOTARIZE_TEST_ALWAYS_FAIL === '1') {
    process.stderr.write(fs.readFileSync(path.join(directory, 'failure.txt'), 'utf8'));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({status: 'Accepted', id: 'test-submission'}));
  }
} else if (command === 'staple') {
  fs.appendFileSync(tracePath, 'staple\\n');
} else {
  console.error('Unexpected test command');
  process.exitCode = 2;
}
`
