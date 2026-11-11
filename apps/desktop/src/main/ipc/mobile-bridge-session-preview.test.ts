import { describe, expect, it } from 'vitest'
import type { SqliteDatabase } from '@spark/storage'
import { readSessionPreviews } from './mobile-bridge-session-preview.js'

describe('readSessionPreviews', () => {
  it('loads all requested previews in one query and keeps the 60-character projection', () => {
    const sessionIds = ['s1', 's2']
    const content = 'x'.repeat(65)
    let sql = ''
    let parameters: unknown[] = []
    const db = {
      prepare: (query: string) => {
        sql = query
        return {
          all: (...values: unknown[]) => {
            parameters = values
            return [
              { session_id: 's1', event_json: JSON.stringify({ content: 'latest   message' }) },
              { session_id: 's2', event_json: JSON.stringify({ content }) },
            ]
          },
        }
      },
    } as unknown as SqliteDatabase

    const previews = readSessionPreviews(db, sessionIds)

    expect(parameters).toEqual(sessionIds)
    expect(sql).toContain('ROW_NUMBER() OVER')
    expect(sql).toContain('PARTITION BY session_id')
    expect(sql).toContain('ORDER BY created_at DESC, rowid DESC')
    expect(sql).toContain("event_type = 'user_message'")
    expect(previews).toEqual(
      new Map([
        ['s1', 'latest message'],
        ['s2', 'x'.repeat(60)],
      ]),
    )
  })

  it('does not query SQLite when there are no sessions', () => {
    let prepared = false
    const db = {
      prepare: () => {
        prepared = true
        throw new Error('unexpected query')
      },
    } as unknown as SqliteDatabase

    expect(readSessionPreviews(db, [])).toEqual(new Map())
    expect(prepared).toBe(false)
  })
})
