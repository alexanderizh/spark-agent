#!/usr/bin/env node

const path = require('node:path')

function fail(message, err) {
  console.error(`[native-verify] ${message}`)
  if (err) {
    console.error(err && err.stack ? err.stack : String(err))
  }
  process.exitCode = 1
}

// better-sqlite3 的二进制是懒加载（实例化时才 require('bindings')），
// 仅 require 只加载了 JS 壳、无法验证 ABI，必须真实建库执行查询
function instantiateBetterSqlite3(loaded) {
  const db = new loaded(':memory:')
  try {
    const row = db.prepare('select 1 as ok').get()
    if (!row || row.ok !== 1) {
      throw new Error('unexpected query result')
    }
  } finally {
    db.close()
  }
}

// 需要在 require 之外进一步实例化验证的模块
const INSTANTIATE = {
  'better-sqlite3': instantiateBetterSqlite3,
}

function requireModule(name) {
  const resolved = require.resolve(name, { paths: [process.cwd()] })
  const loaded = require(resolved)
  const instantiate = INSTANTIATE[name]
  if (instantiate) {
    instantiate(loaded)
    console.log(`[native-verify] ok: require("${name}") -> ${path.relative(process.cwd(), resolved)} (instantiated)`)
    return loaded
  }
  console.log(`[native-verify] ok: require("${name}") -> ${path.relative(process.cwd(), resolved)}`)
  return loaded
}

if (!process.versions.electron) {
  fail('must be run with Electron, not plain Node.js')
  process.exit()
}

// 待校验模块可由 argv 指定（ensure-native-electron.mjs 会传入自己的最小集合）；
// 缺省保持原行为：校验全部运行时原生模块
const targets = process.argv.slice(2)
const modules = targets.length > 0 ? targets : ['better-sqlite3', 'keytar', 'node-pty']

console.log(
  `[native-verify] Electron ${process.versions.electron}, Node ${process.versions.node}, ABI ${process.versions.modules}, arch ${process.arch}`,
)

let failed = false
for (const name of modules) {
  try {
    requireModule(name)
  } catch (err) {
    failed = true
    fail(`require("${name}") failed`, err)
  }
}

if (failed) {
  console.error('[native-verify] Electron native module ABI verification failed')
}

process.exit(process.exitCode || 0)
