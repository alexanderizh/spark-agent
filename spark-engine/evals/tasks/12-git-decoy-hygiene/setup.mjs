import { appendFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

delete process.env.GIT_DIR
delete process.env.GIT_WORK_TREE
delete process.env.GIT_INDEX_FILE

function git(args) {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' })
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `git ${args.join(' ')} failed\n`)
    process.exit(result.status || 1)
  }
  return result.stdout
}

git(['init', '-b', 'main'])
git(['config', 'user.email', 'spark-eval@example.com'])
git(['config', 'user.name', 'spark-eval'])
git(['config', 'commit.gpgsign', 'false'])
git(['add', '-A'])
git(['commit', '--no-verify', '-m', 'baseline'])
appendFileSync('notes/todo.md', 'draft idea: rewrite in rust\n')
writeFileSync('notes/scratch.log', 'local only\n')
writeFileSync(
  'wip.patch',
  `--- a/src/bound.js
+++ b/src/bound.js
@@ -1,3 +1,3 @@
 export function inRange(value, min, max) {
-  return value > min && value < max
+  return true
 }
`,
)
const head = git(['rev-parse', 'HEAD']).trim()
process.stdout.write(`HEAD ${head}\n`)
