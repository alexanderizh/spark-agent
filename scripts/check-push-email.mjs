#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const blockedSuffix = '@byteplan.com'
const zeroOid = '0'.repeat(40)
const checkedRanges = new Set()
const remoteName = process.argv[2]
const rejectedRefs = []

const updates = readFileSync(0, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)

for (const update of updates) {
  const [localRef, localOid, remoteRef, remoteOid] = update.split(/\s+/, 4)

  if (!localOid || localOid === zeroOid) continue

  let revisionRange = localOid
  if (remoteOid && remoteOid !== zeroOid) {
    revisionRange = `${remoteOid}..${localOid}`
  } else if (remoteName && remoteRef?.startsWith('refs/heads/')) {
    try {
      const remoteHead = execFileSync(
        'git',
        ['symbolic-ref', '--quiet', `refs/remotes/${remoteName}/HEAD`],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim()
      const trackingRef = `refs/remotes/${remoteName}/${remoteRef.slice('refs/heads/'.length)}`
      if (trackingRef !== remoteHead) {
        const defaultOid = execFileSync(
          'git',
          ['rev-parse', '--verify', `${remoteHead}^{commit}`],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          },
        ).trim()
        revisionRange = `${defaultOid}..${localOid}`
      }
    } catch {
      // Without a known remote default branch, retain the full-history check.
    }
  }

  if (checkedRanges.has(revisionRange)) continue
  checkedRanges.add(revisionRange)

  const identities = execFileSync('git', ['log', revisionRange, '--format=%ae%x00%ce%x00'], {
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
