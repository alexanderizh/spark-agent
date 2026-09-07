import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SUB_APP_SDK_CONTRACTS } from '../../tools/sub-app-developer-contract.mjs'

const RUNTIME_DOCUMENT = path.resolve(
  '../../apps/desktop/src/renderer/design/sub-app/appRuntimeDocument.ts',
)

describe('sub-app developer contract', () => {
  it('covers every window.sparkApp member exposed by the bootstrap runtime', () => {
    const source = readFileSync(RUNTIME_DOCUMENT, 'utf8')
    const actual = extractBootstrapSymbols(source)
    const documented = new Set(
      SUB_APP_SDK_CONTRACTS.filter(
        (entry) => entry.status === 'implemented' || entry.status === 'legacy',
      ).map((entry) => entry.symbol),
    )

    expect([...documented].sort()).toEqual([...actual].sort())
  })

  it('marks delivered V2 capabilities implemented', () => {
    const statuses = new Map(SUB_APP_SDK_CONTRACTS.map((entry) => [entry.symbol, entry.status]))
    expect(statuses.get('sparkApp.network.request')).toBe('implemented')
    expect(statuses.get('sparkApp.backend.invoke')).toBe('implemented')
    expect(statuses.get('sparkApp.jobs.create')).toBe('implemented')
    expect(statuses.get('sparkApp.backend.on')).toBe('implemented')
    expect(statuses.get('sparkApp.jobs.onProgress')).toBe('implemented')
    expect(statuses.get('sparkApp.clipboard')).toBe('reserved')
    expect(statuses.get('sparkApp.notifications')).toBe('reserved')
  })
})

function extractBootstrapSymbols(source) {
  const start = source.indexOf('  window.sparkApp = {')
  const end = source.indexOf("\n\n  post({ type: 'app/ready'", start)
  if (start < 0 || end < 0) throw new Error('window.sparkApp bootstrap object not found')
  const objectSource = source.slice(start, end)
  const symbols = new Set()
  const rootPattern = /^ {4}([A-Za-z]+): \{/gmu
  const roots = [...objectSource.matchAll(rootPattern)]

  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index][1]
    const blockStart = roots[index].index ?? 0
    const blockEnd = roots[index + 1]?.index ?? objectSource.length
    const block = objectSource.slice(blockStart, blockEnd)
    for (const member of block.matchAll(/^ {6}([A-Za-z]+): function\b/gmu)) {
      symbols.add(`sparkApp.${root}.${member[1]}`)
    }
  }

  if (/^ {4}ipc: privilegedIpc,/mu.test(objectSource)) {
    symbols.add('sparkApp.ipc.invoke')
    symbols.add('sparkApp.ipc.on')
  }
  if (/^ {6}ipc: privilegedIpc,/mu.test(objectSource)) {
    symbols.add('sparkApp.platform.ipc')
  }
  for (const member of objectSource.matchAll(/^ {6}(invoke|on): privilegedIpc\.[a-z]+,/gmu)) {
    symbols.add(`sparkApp.platform.${member[1]}`)
  }
  if (/^ {6}trusted: cfg\.trusted === true,/mu.test(objectSource)) {
    symbols.add('sparkApp.platform.trusted')
  }
  return symbols
}
