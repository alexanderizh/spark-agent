#!/usr/bin/env node

// Launch the normal application: the Native Host smoke intentionally exits before IPC/window setup.
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import {
  createSmokeEnvironment,
  SMOKE_CLEANUP_OPTIONS,
  summarizeOutput,
} from './verify-packaged-native-host.js'

export async function verifyAppStartup(options) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-app-startup-'))
  try {
    for (const stage of ['fresh installation', 'existing profile restart']) {
      await verifyProfileStartup({ ...options, userDataPath })
      console.log(
        `[release-verify] Normal startup passed: ${stage}, visible interface and Remote Agent IPC`,
      )
    }
  } finally {
    await fs.rm(userDataPath, SMOKE_CLEANUP_OPTIONS)
  }
}

async function verifyProfileStartup({
  appExecutable,
  args = [],
  userDataPath,
  timeoutMs = 120_000,
}) {
  let child
  let browser
  let timer
  let output = ''
  const deadline = Date.now() + timeoutMs
  const remaining = () => Math.max(1, deadline - Date.now())
  try {
    const endpoint = await new Promise((resolve, reject) => {
      child = spawn(
        appExecutable,
        [...args, `--user-data-dir=${userDataPath}`, '--remote-debugging-port=0'],
        {
          env: {
            ...createSmokeEnvironment(process.env),
            NODE_ENV: 'production',
            // Dev Electron must also use the exact disposable directory, without a sibling -dev.
            SPARK_DATA_PROFILE: 'production',
            SPARK_ALLOW_MULTIPLE_INSTANCES: '1',
            SPARK_SKIP_PROTOCOL_REGISTRATION: '1',
            SPARK_AUTH_KEYTAR_SERVICE: `SparkAgent.CloudAuth.StartupSmoke.${process.pid}`,
            SPARK_DISABLE_DEVTOOLS: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: false,
        },
      )
      const collect = (chunk) => {
        output = (output + chunk.toString()).slice(-32_000)
        const match = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)
        if (match) resolve(match[1])
      }
      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
      child.once('error', reject)
      child.once('exit', (code, signal) =>
        reject(new Error(`Application exited before startup: code=${code}, signal=${signal}`)),
      )
      timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('Application startup timed out'))
      }, remaining())
    })
    browser = await chromium.connectOverCDP(endpoint, { timeout: remaining() })
    let shell
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Application exited before showing its interface: ${child.exitCode}`)
      }
      for (const context of browser.contexts()) {
        for (const page of context.pages()) {
          if (await page.locator('.onboarding-shell, .floating-sidebar').first().isVisible()) {
            shell = page
            break
          }
        }
        if (shell) break
      }
      if (shell) break
      await delay(250)
    }
    if (!shell) throw new Error('Application did not render onboarding or the primary sidebar')
    if ((await shell.title()) !== 'SparkWork') throw new Error('Unexpected main window title')
    const state = await shell.evaluate(async () => {
      if (globalThis.document.visibilityState !== 'visible')
        throw new Error('Main window is not visible')
      // Exercise real preload → main IPC without network or account credentials.
      return await globalThis.spark.invoke('remote-agent:relay:get-status', {})
    })
    if (typeof state?.connected !== 'boolean') throw new Error('Remote Agent IPC is not ready')
  } catch (error) {
    throw new Error(
      `Normal application startup failed: ${error instanceof Error ? error.message : error}; output=${summarizeOutput(output)}`,
      { cause: error },
    )
  } finally {
    clearTimeout(timer)
    await browser?.close().catch(() => {})
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise((resolve) => child.once('close', resolve))
      child.kill('SIGKILL')
      await Promise.race([closed, delay(5_000, undefined, { ref: false })])
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [appExecutable, ...args] = process.argv.slice(2)
  if (!appExecutable)
    throw new Error('Usage: verify-app-startup.mjs <executable> [entry arguments]')
  verifyAppStartup({ appExecutable: path.resolve(appExecutable), args }).catch((error) => {
    console.error(`[release-verify] ${error.message}`)
    process.exitCode = 1
  })
}
