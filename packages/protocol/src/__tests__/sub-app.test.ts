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
