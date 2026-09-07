import { describe, expect, it } from 'vitest'
import { collectMissingSecretPaths, redactMcpConfig } from './secret-redact.js'

describe('workflow bundle MCP secret redaction', () => {
  it('redacts credential-shaped keys outside headers and env', () => {
    const result = redactMcpConfig(
      JSON.stringify({
        privateKey: 'private-value',
        credentials: { access_key: 'access-value' },
        clientId: 'public-value',
      }),
    )

    expect(result.config).toMatchObject({ clientId: 'public-value' })
    expect(result.secrets.map((secret) => secret.path)).toEqual(
      expect.arrayContaining(['privateKey', 'credentials.access_key']),
    )
    expect(collectMissingSecretPaths(JSON.stringify(result.config))).toEqual(
      expect.arrayContaining(['privateKey', 'credentials.access_key']),
    )
  })

  it('keeps existing placeholders registered when exporting again', () => {
    const result = redactMcpConfig('{"headers":{"X-API-Key":"{{secret:headers.X-API-Key}}"}}')

    expect(result.secrets.map((secret) => secret.path)).toEqual(['headers.X-API-Key'])
  })
})
