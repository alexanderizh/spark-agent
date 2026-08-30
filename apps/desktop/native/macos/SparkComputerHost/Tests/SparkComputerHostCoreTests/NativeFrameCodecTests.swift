import Foundation
import XCTest

@testable import SparkComputerHostCore

final class NativeFrameCodecTests: XCTestCase {
  func testEncodesBigEndianLengthAndExplicitFrameKind() throws {
    let payload = Data(#"{"type":"ping"}"#.utf8)
    let frame = try NativeFrameCodec.encode(kind: .json, payload: payload)

    XCTAssertEqual(Array(frame.prefix(4)), [0, 0, 0, UInt8(payload.count)])
    XCTAssertEqual(frame[4], NativeFrameKind.json.rawValue)
    XCTAssertEqual(frame.dropFirst(5), payload)
  }

  func testDecodesFragmentedAndAdjacentFrames() throws {
    let decoder = try NativeFrameDecoder(maxPayloadBytes: 1_024)
    let json = try NativeFrameCodec.encode(kind: .json, payload: Data("{}".utf8))
    let binary = try NativeFrameCodec.encode(kind: .binary, payload: Data([0, 1, 2, 255]))
    let stream = json + binary

    XCTAssertEqual(try decoder.append(stream.prefix(3)), [])
    XCTAssertEqual(
      try decoder.append(stream.dropFirst(3).prefix(json.count - 1)),
      [NativeFrame(kind: .json, payload: Data("{}".utf8))]
    )
    XCTAssertEqual(
      try decoder.append(stream.dropFirst(json.count + 2)),
      [NativeFrame(kind: .binary, payload: Data([0, 1, 2, 255]))]
    )
    XCTAssertNoThrow(try decoder.finish())
  }

  func testRejectsUnknownEmptyOversizedAndTruncatedFrames() throws {
    let decoder = try NativeFrameDecoder(maxPayloadBytes: 1_024)
    XCTAssertThrowsError(try decoder.append(Data([0, 0, 0, 0, 1])))

    let unknown = try NativeFrameDecoder(maxPayloadBytes: 1_024)
    XCTAssertThrowsError(try unknown.append(Data([0, 0, 0, 1, 9, 0])))

    let oversized = try NativeFrameDecoder(maxPayloadBytes: 1_024)
    XCTAssertThrowsError(try oversized.append(Data([0, 0, 4, 1, 1])))

    let truncated = try NativeFrameDecoder(maxPayloadBytes: 1_024)
    _ = try truncated.append(Data([0, 0, 0, 3, 1, 123]))
    XCTAssertThrowsError(try truncated.finish())
  }
}
