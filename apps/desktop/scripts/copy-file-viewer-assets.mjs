#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(here, '..')
const target = resolve(desktopRoot, 'public/file-viewer')

const result = spawnSync('pnpm', ['exec', 'file-viewer-copy-assets', target], {
  cwd: desktopRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error != null) {
  console.error(`[file-viewer-assets] failed to run file-viewer-copy-assets: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
