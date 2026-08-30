import Foundation

public let maxNativeHostFramePayloadBytes = 67_108_864

public enum NativeFrameKind: UInt8, Sendable {
  case json = 1
  case binary = 2
}

public struct NativeFrame: Equatable, Sendable {
  public let kind: NativeFrameKind
  public let payload: Data

  public init(kind: NativeFrameKind, payload: Data) {
    self.kind = kind
    self.payload = payload
  }
}

public enum NativeFrameCodecError: Error, Equatable, Sendable {
  case invalidLimit
  case emptyPayload
  case oversizedPayload
  case unknownKind(UInt8)
  case truncatedFrame
}

public enum NativeFrameCodec {
  public static func encode(
    kind: NativeFrameKind,
    payload: Data,
    maxPayloadBytes: Int = maxNativeHostFramePayloadBytes
  ) throws -> Data {
    guard maxPayloadBytes > 0 else { throw NativeFrameCodecError.invalidLimit }
    guard !payload.isEmpty else { throw NativeFrameCodecError.emptyPayload }
    guard payload.count <= maxPayloadBytes, payload.count <= Int(UInt32.max) else {
      throw NativeFrameCodecError.oversizedPayload
    }

    var payloadLength = UInt32(payload.count).bigEndian
    var frame = Data(bytes: &payloadLength, count: MemoryLayout<UInt32>.size)
    frame.append(kind.rawValue)
    frame.append(payload)
    return frame
  }
}

public final class NativeFrameDecoder: @unchecked Sendable {
  private static let headerBytes = 5
  private let maxPayloadBytes: Int
  private var buffered = Data()

  public init(maxPayloadBytes: Int = maxNativeHostFramePayloadBytes) throws {
    guard maxPayloadBytes > 0 else { throw NativeFrameCodecError.invalidLimit }
    self.maxPayloadBytes = maxPayloadBytes
  }

  public func append<Chunk: DataProtocol>(_ chunk: Chunk) throws -> [NativeFrame] {
    buffered.append(contentsOf: chunk)
    var frames: [NativeFrame] = []

    while buffered.count >= Self.headerBytes {
      let header = Array(buffered.prefix(Self.headerBytes))
      let payloadLength =
        (Int(header[0]) << 24) | (Int(header[1]) << 16) | (Int(header[2]) << 8) | Int(header[3])
      guard payloadLength > 0 else { throw NativeFrameCodecError.emptyPayload }
      guard payloadLength <= maxPayloadBytes else {
        throw NativeFrameCodecError.oversizedPayload
      }
      guard let kind = NativeFrameKind(rawValue: header[4]) else {
        throw NativeFrameCodecError.unknownKind(header[4])
      }
      let frameLength = Self.headerBytes + payloadLength
      guard buffered.count >= frameLength else { break }
      let payload = Data(buffered.dropFirst(Self.headerBytes).prefix(payloadLength))
      frames.append(NativeFrame(kind: kind, payload: payload))
      buffered.removeFirst(frameLength)
    }

    return frames
  }

  public func finish() throws {
    guard buffered.isEmpty else { throw NativeFrameCodecError.truncatedFrame }
  }
}
