import { describe, expect, it } from 'vitest'
import {
  SubAppPackageManifestSchema,
  SubAppProjectPathSchema,
  SubAppV2IpcSchemaRegistry,
} from '../sub-app-v2.js'

const manifest = {
  schemaVersion: 2,
  name: '知识库同步',
  surface: 'content',
  frontend: { entry: 'frontend/index.html' },
  service: {
    runtime: 'node',
    entry: 'service/main.mjs',
    lifecycle: 'application',
  },
  permissions: {
    sparkCapabilities: ['data', 'network', 'backend', 'jobs'],
    osEffects: ['network'],
    connections: ['knowledge'],
  },
  connections: {
    knowledge: {
      kind: 'http-api',
      displayName: '知识库 API',
      allowedOrigins: ['https://api.example.com'],
    },
  },
} as const

describe('SubAppPackageManifestSchema', () => {
  it('accepts a complete fullstack manifest', () => {
    expect(SubAppPackageManifestSchema.parse(manifest)).toMatchObject({ schemaVersion: 2 })
  })

  it.each(['../secret', '/tmp/app', 'C:/app', 'https://example.com/app', 'a//b'])(
    'rejects unsafe package path %s',
    (value) => expect(SubAppProjectPathSchema.safeParse(value).success).toBe(false),
  )

  it('requires origins rather than arbitrary URLs', () => {
    expect(
      SubAppPackageManifestSchema.safeParse({
        ...manifest,
        connections: {
          knowledge: {
            ...manifest.connections.knowledge,
            allowedOrigins: ['https://api.example.com/v1'],
          },
        },
      }).success,
    ).toBe(false)
  })
})

describe('SubAppV2IpcSchemaRegistry', () => {
  it('validates project CAS writes and managed requests', () => {
    const appId = '11111111-1111-4111-8111-111111111111'
    expect(
      SubAppV2IpcSchemaRegistry['sub-app:project:write-file'].parse({
        appId,
        expectedDraftRevision: 2,
        path: 'frontend/app.js',
        content: 'export {}',
      }),
    ).toMatchObject({ appId, expectedDraftRevision: 2 })
    expect(() =>
      SubAppV2IpcSchemaRegistry['sub-app:network:request'].parse({
        appId,
        slot: 'api',
        path: '/data',
        headers: { Authorization: 'must-not-be-accepted-by-runtime' },
        timeoutMs: 99_999,
      }),
    ).toThrow()
  })
})
