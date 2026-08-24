import { describe, expect, it } from 'vitest'
import { IpcSchemaRegistry } from './schemas/index.js'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'

describe('workspace search IPC schemas', () => {
  it('accepts a renderer-generated request id for content search and cancellation', () => {
    expect(
      IpcSchemaRegistry['workspace-search:content'].parse({
        workspaceId,
        requestId,
        query: 'needle',
        caseSensitive: true,
      }),
    ).toMatchObject({ workspaceId, requestId, query: 'needle', caseSensitive: true })

    expect(IpcSchemaRegistry['workspace-search:cancel'].parse({ requestId })).toEqual({ requestId })
  })

  it('rejects missing or malformed content-search request ids', () => {
    expect(() =>
      IpcSchemaRegistry['workspace-search:content'].parse({ workspaceId, query: 'needle' }),
    ).toThrow()
    expect(() =>
      IpcSchemaRegistry['workspace-search:content'].parse({
        workspaceId,
        requestId: 'not-a-uuid',
        query: 'needle',
      }),
    ).toThrow()
  })

  it('enforces query and result limits', () => {
    expect(() =>
      IpcSchemaRegistry['workspace-search:content'].parse({
        workspaceId,
        requestId,
        query: '',
      }),
    ).toThrow()
    expect(() =>
      IpcSchemaRegistry['workspace-search:files'].parse({
        workspaceId,
        query: 'a',
        limit: 501,
      }),
    ).toThrow()
  })
})
