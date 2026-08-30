#!/usr/bin/env node
/**
 * verify-migrations.mjs — 打包前的 migration 体检
 *
 * 目的：在交付前把 migration 的常见问题暴露在开发期，而不是用户机器上。
 * 运行时（app 启动）会自动按序执行 migration，因此这里只做"干跑校验"，
 * 不触碰任何真实数据库。
 *
 * 校验内容：
 *  1. 文件名格式合法（{数字}_{描述}.sql）。
 *  2. version（文件名前缀数字）唯一——撞号会导致同号 migration 被静默跳过，
 *     历史上 028 撞号曾让 media 表没被创建。这是本脚本的核心防线，无需任何原生依赖。
 *  3. 若本机的 better-sqlite3 能以当前 ABI 加载，则把全部 migration 依次跑到
 *     一个内存库里，捕获 SQL 语法/顺序错误。ABI 不匹配（例如已为 Electron 重建）
 *     时跳过这一步并告警，但绝不让构建因 ABI 问题失败。
 *
 * 退出码：发现真实问题（格式/撞号/SQL 错误）时非 0，构建中止。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', 'migrations')

const fail = (msg) => {
  console.error(`\n❌ migration 校验失败：${msg}\n`)
  process.exit(1)
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

if (files.length === 0) fail(`${migrationsDir} 下没有任何 .sql migration`)

// 1 + 2：文件名格式 & version 唯一
const seen = new Map()
for (const name of files) {
  const match = name.match(/^(\d+)_.*\.sql$/)
  if (match == null) fail(`文件名不符合 {数字}_{描述}.sql：${name}`)
  const version = parseInt(match[1], 10)
  const dup = seen.get(version)
  if (dup != null) {
    fail(`version ${version} 撞号："${dup}" 与 "${name}"。请把其中一个重命名为未使用的序号。`)
  }
  seen.set(version, name)
}
console.log(`✓ ${files.length} 个 migration 文件名合法、version 无撞号`)

// 3：尽力跑一次真实 SQL（原生模块可加载时）
// better-sqlite3 的原生绑定是懒加载的——require 能过，但 ABI 不匹配会在 new Database()
// 时以 ERR_DLOPEN_FAILED / NODE_MODULE_VERSION 报错。这类环境问题只跳过、不让构建失败。
let db
try {
  const require = createRequire(import.meta.url)
  const Database = require('better-sqlite3')
  db = new Database(':memory:')
} catch (err) {
  const msg = String(err)
  const isAbi = /ERR_DLOPEN_FAILED|NODE_MODULE_VERSION|Cannot find module/.test(msg)
  if (!isAbi) fail(`加载 better-sqlite3 失败：${msg}`)
  console.warn(
    `⚠ 跳过 SQL 干跑：better-sqlite3 当前 ABI 与本机 Node 不匹配（构建时常见，运行时会用 Electron ABI）。\n  原因：${msg.split('\n')[0]}`,
  )
  console.log('✓ 静态校验通过')
  process.exit(0)
}

db.pragma('foreign_keys = ON')
try {
  for (const name of files) {
    const sql = readFileSync(join(migrationsDir, name), 'utf-8')
    const run = db.transaction(() => db.exec(sql))
    try {
      run()
    } catch (err) {
      fail(`执行 ${name} 时出错：${String(err)}`)
    }
  }
} finally {
  db.close()
}
console.log(`✓ 全部 ${files.length} 个 migration 在内存库里干跑通过`)
console.log('✓ migration 校验通过')
