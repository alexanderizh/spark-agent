#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const blockedSuffix = '@byteplan.com'
const zeroOid = '0'.repeat(40)
const checkedOids = new Set()
const rejectedRefs = []

const updates = readFileSync(0, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)

for (const update of updates) {
  const [localRef, localOid] = update.split(/\s+/, 2)

  if (!localOid || localOid === zeroOid || checkedOids.has(localOid)) continue
  checkedOids.add(localOid)

  const identities = execFileSync('git', ['log', localOid, '--format=%ae%x00%ce%x00'], {
    encoding: 'utf8',
  })

  const usesBlockedEmail = identities
    .split('\0')
    .some((email) => email.trim().toLowerCase().endsWith(blockedSuffix))

  if (usesBlockedEmail) rejectedRefs.push(localRef)
}

if (rejectedRefs.length > 0) {
  console.error('Push rejected: corporate email found in commit metadata.')
  console.error('Affected refs:')
  for (const ref of rejectedRefs) console.error(`- ${ref}`)
  console.error('Rewrite or recreate these commits with a GitHub noreply email before pushing.')
  process.exit(1)
}
