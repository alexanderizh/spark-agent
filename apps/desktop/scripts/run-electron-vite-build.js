/**
 * Run electron-vite with a renderer-safe V8 heap on every platform.
 *
 * The renderer currently transforms more than 16k modules. Node 22's default
 * heap limit is about 4 GiB, which is too small during Rollup chunk rendering.
 * Keeping this in a Node wrapper makes local macOS/Linux, Windows and CI use
 * the same setting without relying on shell-specific environment syntax.
 */
const { spawnSync } = require('child_process')
const path = require('path')

const MIN_BUILD_HEAP_MB = 8192
const HEAP_OPTION_PATTERN = /(?:^|\s)--max[-_]old[-_]space[-_]size(?:=(\d+)|\s+(\d+))(?=\s|$)/g

function buildNodeOptions(current = '') {
  const values = []
  for (const match of current.matchAll(HEAP_OPTION_PATTERN)) {
    const value = Number.parseInt(match[1] || match[2] || '', 10)
    if (Number.isFinite(value)) values.push(value)
  }
  const heapMb = Math.max(MIN_BUILD_HEAP_MB, ...values)
  const remaining = current.replace(HEAP_OPTION_PATTERN, ' ').trim().replace(/\s+/g, ' ')
  return [remaining, `--max-old-space-size=${heapMb}`].filter(Boolean).join(' ')
}

function runElectronViteBuild() {
  const packageJson = require.resolve('electron-vite/package.json', { paths: [__dirname] })
  const cliPath = path.join(path.dirname(packageJson), 'bin', 'electron-vite.js')
  const nodeOptions = buildNodeOptions(process.env.NODE_OPTIONS || '')
  console.log(`[build] NODE_OPTIONS=${nodeOptions}`)

  const result = spawnSync(process.execPath, [cliPath, 'build'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exitCode = result.status == null ? 1 : result.status
}

if (require.main === module) runElectronViteBuild()

module.exports = { MIN_BUILD_HEAP_MB, buildNodeOptions, runElectronViteBuild }
