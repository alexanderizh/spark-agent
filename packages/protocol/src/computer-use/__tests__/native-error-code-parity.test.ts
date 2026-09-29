import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ComputerUseErrorCodeSchema } from '../errors.js'

/**
 * The macOS Native Host emits error codes that the client parses with
 * `ComputerUseErrorCodeSchema`. The two lists live in different languages, so
 * nothing but this test stops them from drifting — and drift is not cosmetic:
 * a host code the client cannot parse fails `NativeHostResponseSchema.parse`
 * on the response frame, which tears down the client instead of surfacing one
 * error. (It happened: `invalid_request` was added host-side and the client
 * would have rejected it.)
 *
 * The Windows host has no allow-list of its own, so this guards the macOS pair.
 */
const HOST_PROTOCOL_SOURCE = fileURLToPath(
  new URL(
    '../../../../../apps/desktop/native/macos/SparkComputerHost/Sources/SparkComputerHostCore/NativeHostProtocol.swift',
    import.meta.url,
  ),
)

function hostErrorCodes(): string[] {
  const source = readFileSync(HOST_PROTOCOL_SOURCE, 'utf8')
  const start = source.indexOf('public let allowedErrorCodes')
  expect(start, 'allowedErrorCodes moved: update this test with it').toBeGreaterThan(-1)
  const end = source.indexOf(']', start)
  expect(end).toBeGreaterThan(start)
  return [...source.slice(start, end).matchAll(/"([a-z_]+)"/g)].map((match) => match[1] ?? '')
}

describe('Native Host error-code contract', () => {
  it('every code the macOS host can emit is parseable by the client', () => {
    const codes = hostErrorCodes()
    expect(codes.length).toBeGreaterThan(20)
    const unknown = codes.filter((code) => !ComputerUseErrorCodeSchema.safeParse(code).success)
    expect(unknown, 'host codes missing from ComputerUseErrorCodeSchema').toEqual([])
  })
})
