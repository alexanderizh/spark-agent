#!/usr/bin/env node
/**
 * 历史孤儿记忆一次性迁移脚本。
 *
 * 背景：曾因 resolveScopeRef 未归一空串，会话未绑 workspace 时 LLM 产出 scope=project
 * 候选会写入 scope_ref=''（非 NULL 的第三态），DB 里既不是 NULL 也不是合法 UUID，
 * 永远查不到（listByScope 用 scope_ref IS ? 精确匹配）。
 * 该 bug 已在 79ac770b3 修复（resolveScopeRef 空串归一 null + manualWrite 校验），
 * 本脚本清理历史存量：把 scope_ref='' 的孤儿降级为 user scope（跨项目通用），
 * 比删除安全 —— 内容往往本就是用户偏好（LLM 在无项目上下文时误判 project）。
 *
 * 用法（从仓库根）：
 *   node packages/agent-runtime/scripts/migrate-orphan-memories.mjs <dbPath> [--dry-run]
 *
 *   dbPath    SparkDatabase 文件路径（必填）
 *   --dry-run 只打印将迁移的行，不实际改库
 *
 * 注意：better-sqlite3 的 ABI 必须匹配当前 Node（rebuild 见 memory storage-tests-better-sqlite3-abi）。
 */
const dbPath = process.argv[2]
const dryRun = process.argv.includes('--dry-run')

if (!dbPath) {
  console.error('用法: node migrate-orphan-memories.mjs <dbPath> [--dry-run]')
  console.error('  dbPath 从主进程日志或 app 数据目录找（生产 spark.db / 开发 spark-dev.db）')
  process.exit(1)
}

console.log(`[migrate] dbPath = ${dbPath}`)
console.log(`[migrate] mode = ${dryRun ? 'DRY-RUN（只查不改）' : '实际迁移'}`)

const Database = (await import('better-sqlite3')).default
const db = new Database(dbPath)

try {
  // 找孤儿：project/agent scope + scope_ref 为空串或 NULL（NULL 理论上不该有，顺手清）
  const orphans = db.prepare(
    `SELECT id, scope, scope_ref, name, description FROM memory_entry
     WHERE scope IN ('project', 'agent') AND (scope_ref IS NULL OR scope_ref = '')`,
  ).all()

  console.log(`[migrate] 找到 ${orphans.length} 条孤儿 project/agent 记忆`)
  if (orphans.length === 0) {
    console.log('[migrate] 无需迁移，退出')
    process.exit(0)
  }

  for (const o of orphans) {
    console.log(`  · ${o.id} [${o.scope}/scope_ref="${o.scope_ref ?? 'NULL'}"] ${o.name}: ${o.description?.slice(0, 60)}`)
  }

  if (dryRun) {
    console.log(`[migrate] DRY-RUN 完成，未改动数据库。去掉 --dry-run 实际迁移。`)
    process.exit(0)
  }

  // 降级为 user scope（scope_ref = NULL），保留 id/name/body 不动
  const tx = db.transaction(() => {
    const result = db.prepare(
      `UPDATE memory_entry SET scope = 'user', scope_ref = NULL
       WHERE scope IN ('project', 'agent') AND (scope_ref IS NULL OR scope_ref = '')`,
    ).run()
    console.log(`[migrate] 已迁移 ${result.changes} 条 → user scope`)
  })
  tx()

  console.log('[migrate] 完成。这些记忆现在在 user scope 可见（跨项目通用）。')
  console.log('         如果某条其实是项目专属，可在记忆面板手动编辑改回 project scope（选对应项目）。')
} catch (err) {
  console.error('[migrate] 失败：', err instanceof Error ? err.message : String(err))
  if (err instanceof Error && 'code' in err && err.code === 'ERR_DLOPEN_FAILED') {
    console.error('\nbetter-sqlite3 ABI 不匹配。rebuild：')
    console.error('  cd node_modules/better-sqlite3 && npx node-gyp rebuild --runtime=node --target=v22.18.0 --abi=127')
  }
  process.exit(99)
} finally {
  db.close()
}
