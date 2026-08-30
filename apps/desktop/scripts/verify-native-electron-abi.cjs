#!/usr/bin/env node

const path = require('node:path')

function fail(message, err) {
  console.error(`[native-verify] ${message}`)
  if (err) {
    console.error(err && err.stack ? err.stack : String(err))
  }
  process.exitCode = 1
}

function requireModule(name) {
  const resolved = require.resolve(name, { paths: [process.cwd()] })
  const loaded = require(resolved)
  console.log(`[native-verify] ok: require("${name}") -> ${path.relative(process.cwd(), resolved)}`)
  return loaded
}

function verifyRequireOnly(name) {
  requireModule(name)
}

if (!process.versions.electron) {
  fail('must be run with Electron, not plain Node.js')
  process.exit()
}

console.log(
  `[native-verify] Electron ${process.versions.electron}, Node ${process.versions.node}, ABI ${process.versions.modules}, arch ${process.arch}`,
)

try {
  verifyRequireOnly('better-sqlite3')
  verifyRequireOnly('keytar')
  verifyRequireOnly('node-pty')
} catch (err) {
  fail('Electron native module ABI verification failed', err)
}

process.exit(process.exitCode || 0)
