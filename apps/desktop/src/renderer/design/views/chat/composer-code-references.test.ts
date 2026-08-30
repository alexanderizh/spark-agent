import { describe, expect, it } from 'vitest'
import {
  clearComposerCodeReferenceBuckets,
  updateComposerCodeReferenceBucket,
  type ComposerCodeReferenceMap,
} from './composer-code-references'

const reference = (path: string, startLine: number) => ({
  path,
  name: path.split('/').pop() ?? path,
  startLine,
  endLine: startLine,
})

describe('composer code reference buckets', () => {
  it('keeps unsent references isolated between sessions', () => {
    let state: ComposerCodeReferenceMap = {}
    state = updateComposerCodeReferenceBucket(state, 'session-a', [reference('/a.ts', 10)])
    state = updateComposerCodeReferenceBucket(state, 'session-b', [reference('/b.ts', 20)])

    expect(state['session-a']).toEqual([reference('/a.ts', 10)])
    expect(state['session-b']).toEqual([reference('/b.ts', 20)])
  })

  it('clears only the buckets that are sent or reset', () => {
    const state: ComposerCodeReferenceMap = {
      'session-a': [reference('/a.ts', 10)],
      'session-b': [reference('/b.ts', 20)],
    }

    const next = clearComposerCodeReferenceBuckets(state, ['session-b'])

    expect(next).toEqual({ 'session-a': [reference('/a.ts', 10)] })
    expect(state['session-b']).toEqual([reference('/b.ts', 20)])
  })
})
