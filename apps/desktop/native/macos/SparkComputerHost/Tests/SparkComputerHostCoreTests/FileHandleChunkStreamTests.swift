import Foundation
import XCTest

@testable import SparkComputerHostCore

final class FileHandleChunkStreamTests: XCTestCase {
  func testYieldsAvailablePipeBytesWithoutWaitingForEOF() async throws {
    let pipe = Pipe()
    let stream = FileHandleChunkStream(handle: pipe.fileHandleForReading)
    let expected = Data("long-lived-pipe-frame".utf8)

    pipe.fileHandleForWriting.write(expected)
    let received = try await firstChunk(from: stream, timeoutNanoseconds: 1_000_000_000)

    XCTAssertEqual(received, expected)
    stream.cancel()
    try pipe.fileHandleForWriting.close()
  }

  private func firstChunk(
    from stream: FileHandleChunkStream,
    timeoutNanoseconds: UInt64
  ) async throws -> Data {
    try await withThrowingTaskGroup(of: Data.self) { group in
      group.addTask {
        for await chunk in stream.chunks {
          return chunk
        }
        throw CocoaError(.fileReadUnknown)
      }
      group.addTask {
        try await Task.sleep(nanoseconds: timeoutNanoseconds)
        throw CocoaError(.fileReadTooLarge)
      }
      let result = try await group.next()!
      group.cancelAll()
      return result
    }
  }
}
