import { describe, expect, it, vi } from 'vitest'
import {
  NativeHostFrameCodecError,
  NativeHostFrameDecoder,
  encodeNativeHostFrame,
  encodeNativeHostJsonFrame,
} from './NativeHostFrameCodec.js'

describe('NativeHostFrameCodec', () => {
  it('encodes a JSON message with a big-endian length and explicit frame kind', () => {
    const frame = encodeNativeHostJsonFrame({ protocolVersion: 1, type: 'ping' })

    expect(frame.readUInt32BE(0)).toBe(frame.length - 5)
    expect(frame[4]).toBe(1)
    expect(JSON.parse(frame.subarray(5).toString('utf8'))).toEqual({
      protocolVersion: 1,
      type: 'ping',
    })
  })

  it('decodes fragmented and adjacent JSON and binary frames without losing boundaries', () => {
    const decoder = new NativeHostFrameDecoder({ maxPayloadBytes: 1_024 })
    const json = encodeNativeHostJsonFrame({ type: 'pong' })
    const binary = encodeNativeHostFrame('binary', Buffer.from([0, 1, 2, 255]))
    const stream = Buffer.concat([json, binary])

    expect(decoder.push(stream.subarray(0, 3))).toEqual([])
    expect(decoder.push(stream.subarray(3, json.length + 2))).toEqual([
      { kind: 'json', payload: json.subarray(5) },
    ])
    expect(decoder.push(stream.subarray(json.length + 2))).toEqual([
      { kind: 'binary', payload: Buffer.from([0, 1, 2, 255]) },
    ])
    expect(() => decoder.end()).not.toThrow()
  })

  it.each([
    ['zero-length', Buffer.from([0, 0, 0, 0, 1])],
    ['unknown-kind', Buffer.from([0, 0, 0, 1, 9, 0])],
    ['oversized', Buffer.from([0, 0, 4, 1, 1])],
  ])('rejects a %s frame before buffering its body', (_name, bytes) => {
    const decoder = new NativeHostFrameDecoder({ maxPayloadBytes: 1_024 })

    expect(() => decoder.push(bytes)).toThrow(NativeHostFrameCodecError)
  })

  it('rejects a truncated frame when the stream ends', () => {
    const decoder = new NativeHostFrameDecoder({ maxPayloadBytes: 1_024 })
    decoder.push(Buffer.from([0, 0, 0, 3, 1, 123]))

    expect(() => decoder.end()).toThrowError('Native Host stream ended inside a frame')
  })

  it('keeps fragmented large frames in a segmented queue instead of reallocating per chunk', () => {
    const payload = Buffer.alloc(4_096, 7)
    const encoded = encodeNativeHostFrame('binary', payload)
    const concat = vi.spyOn(Buffer, 'concat')
    try {
      const decoder = new NativeHostFrameDecoder({ maxPayloadBytes: 8_192 })
      const frames = encoded
        .subarray(0, encoded.length - 1)
        .reduce<ReturnType<NativeHostFrameDecoder['push']>>((all, byte) => {
          all.push(...decoder.push(Uint8Array.of(byte)))
          return all
        }, [])
      frames.push(...decoder.push(encoded.subarray(encoded.length - 1)))

      expect(frames).toEqual([{ kind: 'binary', payload }])
      expect(concat).toHaveBeenCalledTimes(0)
    } finally {
      concat.mockRestore()
    }
  })
})
