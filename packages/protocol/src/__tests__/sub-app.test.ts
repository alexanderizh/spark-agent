import { describe, expect, it } from 'vitest'
import { SPARK_APP_BRIDGE_INBOUND_SCHEMA, SubAppIpcSchemaRegistry } from '../sub-app.js'

const appId = '11111111-1111-4111-8111-111111111111'

describe('SubApp IPC schemas', () => {
  it('validates explicit app targets and structured draft updates', () => {
    expect(
      SubAppIpcSchemaRegistry['sub-app:update-draft'].parse({
        appId,
        expectedDraftRevision: 3,
        patch: {
          source: '<main>hello</main>',
          surface: 'overlay',
          config: { placement: 'bottom-right' },
        },
      }),
    ).toMatchObject({ appId, expectedDraftRevision: 3 })

    expect(() =>
      SubAppIpcSchemaRegistry['sub-app:update-draft'].parse({
        appId,
        expectedDraftRevision: 3,
        patch: { source: '<main />', unknownField: true },
      }),
    ).toThrow()
  })

  it('rejects invalid targets, oversized source and unbounded data pages', () => {
    expect(() => SubAppIpcSchemaRegistry['sub-app:get'].parse({ appId: 'not-an-uuid' })).toThrow()
    expect(() =>
      SubAppIpcSchemaRegistry['sub-app:create'].parse({
        name: '应用',
        source: 'x'.repeat(200_001),
      }),
    ).toThrow()
    expect(() =>
      SubAppIpcSchemaRegistry['sub-app:data:list'].parse({
        appId,
        namespace: 'default',
        limit: 201,
      }),
    ).toThrow()
  })

  it('release history, delete and data delete carry explicit identities', () => {
    expect(
      SubAppIpcSchemaRegistry['sub-app:releases:list'].parse({ appId, limit: 20 }),
    ).toMatchObject({ appId })
    expect(() =>
      SubAppIpcSchemaRegistry['sub-app:delete'].parse({ appId: 'not-an-uuid' }),
    ).toThrow()
    expect(() =>
      SubAppIpcSchemaRegistry['sub-app:data:delete'].parse({
        appId,
        namespace: 'default',
        key: 'k',
      }),
    ).toThrow()
    expect(
      SubAppIpcSchemaRegistry['sub-app:data:delete'].parse({
        appId,
        namespace: 'default',
        key: 'k',
        expectedRevision: 3,
      }),
    ).toMatchObject({ expectedRevision: 3 })
  })

  it('file channel schemas accept relative paths and reject escapes', () => {
    // 合法相对路径（含子目录）
    expect(
      SubAppIpcSchemaRegistry['sub-app:file:read'].parse({ appId, path: 'notes/a.md' }),
    ).toMatchObject({ path: 'notes/a.md' })
    expect(
      SubAppIpcSchemaRegistry['sub-app:file:write'].parse({
        appId,
        path: 'snapshots/2026.json',
        content: '{"v":1}',
      }),
    ).toMatchObject({ content: '{"v":1}' })
    expect(SubAppIpcSchemaRegistry['sub-app:file:list'].parse({ appId })).toMatchObject({ appId })
    // 逃逸与绝对路径拒绝
    for (const bad of ['../escape', '/etc/passwd', 'a/../b', 'C:\\x', 'a//b']) {
      expect(() =>
        SubAppIpcSchemaRegistry['sub-app:file:read'].parse({ appId, path: bad }),
      ).toThrow()
    }
    // content 上限 2MB
    expect(() =>
      SubAppIpcSchemaRegistry['sub-app:file:write'].parse({
        appId,
        path: 'big.txt',
        content: 'x'.repeat(2_000_001),
      }),
    ).toThrow()
  })

  it('runtime doc registration uses capped tokens and bounded documents', () => {
    expect(
      SubAppIpcSchemaRegistry['sub-app:runtime:put-doc'].parse({
        token: '0123456789abcdef',
        document: '<!doctype html><html></html>',
      }),
    ).toMatchObject({ token: '0123456789abcdef' })
    // token 格式（长度、字符集）非法必须拒绝
    expect(() =>
      SubAppIpcSchemaRegistry['sub-app:runtime:put-doc'].parse({
        token: 'short',
        document: '<html></html>',
      }),
    ).toThrow()
    expect(() =>
      SubAppIpcSchemaRegistry['sub-app:runtime:put-doc'].parse({
        token: '0123456789abcdef',
        document: 'x'.repeat(260_001),
      }),
    ).toThrow()
    expect(
      SubAppIpcSchemaRegistry['sub-app:runtime:release-doc'].parse({
        token: '0123456789abcdef',
      }),
    ).toMatchObject({ token: '0123456789abcdef' })
    expect(() =>
      SubAppIpcSchemaRegistry['sub-app:runtime:release-doc'].parse({ token: '../escape' }),
    ).toThrow()
  })
})

describe('Spark App Bridge inbound schema', () => {
  const identity = {
    appId,
    versionId: 'draft-11111111',
    instanceId: 'inst-1',
  }

  it('accepts well-formed ready and request messages', () => {
    expect(
      SPARK_APP_BRIDGE_INBOUND_SCHEMA.parse({
        type: 'app/ready',
        instanceId: identity.instanceId,
        protocolVersion: 1,
      }),
    ).toMatchObject({ type: 'app/ready' })

    expect(
      SPARK_APP_BRIDGE_INBOUND_SCHEMA.parse({
        type: 'app/request',
        instanceId: identity.instanceId,
        request: {
          protocolVersion: 1,
          ...identity,
          requestId: 'req-1',
          capability: 'data',
          operation: 'get',
          payload: { namespace: 'default', key: 'k' },
        },
      }),
    ).toMatchObject({ type: 'app/request' })
  })

  it('lets future protocol versions through so the host can answer with a mismatch', () => {
    expect(() =>
      SPARK_APP_BRIDGE_INBOUND_SCHEMA.parse({
        type: 'app/ready',
        instanceId: identity.instanceId,
        protocolVersion: 99,
      }),
    ).not.toThrow()
  })

  it('rejects unknown message types and unknown capabilities', () => {
    expect(() =>
      SPARK_APP_BRIDGE_INBOUND_SCHEMA.parse({
        type: 'app/exit',
        instanceId: identity.instanceId,
      }),
    ).toThrow()
    expect(() =>
      SPARK_APP_BRIDGE_INBOUND_SCHEMA.parse({
        type: 'app/request',
        instanceId: identity.instanceId,
        request: {
          protocolVersion: 1,
          ...identity,
          requestId: 'req-1',
          capability: 'shell',
          operation: 'exec',
          payload: null,
        },
      }),
    ).toThrow()
  })
})
