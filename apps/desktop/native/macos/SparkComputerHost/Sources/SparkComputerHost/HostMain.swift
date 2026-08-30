import Darwin
import Foundation
import SparkComputerHostCore

@main
struct SparkComputerHostMain {
  static func main() async {
    do {
      try ParentProcessAuthorizer.authorize()
    } catch {
      writeDiagnostic("parent process authorization failed")
      exit(EX_NOPERM)
    }

    signal(SIGPIPE, SIG_IGN)
    do {
      try await run()
    } catch {
      writeDiagnostic("fatal native host protocol failure")
      exit(EX_PROTOCOL)
    }
  }

  private static func run() async throws {
    let decoder = try NativeFrameDecoder()
    let requestDecoder = NativeHostRequestDecoder()
    let handler = NativeHostRequestHandler(provider: MacScreenCaptureProvider())
    let input = FileHandle.standardInput
    let output = FileHandle.standardOutput
    let inputChunks = FileHandleChunkStream(handle: input)
    defer { inputChunks.cancel() }

    for await chunk in inputChunks.chunks {
      for frame in try decoder.append(chunk) {
        guard frame.kind == .json else { throw NativeHostProtocolError.invalidJSON }
        let request = try requestDecoder.decode(frame.payload)
        let reply = try await handler.handle(request)
        try output.write(contentsOf: NativeFrameCodec.encode(kind: .json, payload: reply.json))
        if let binary = reply.binary {
          try output.write(
            contentsOf: NativeFrameCodec.encode(kind: .binary, payload: binary)
          )
        }
      }
    }
    try decoder.finish()
  }
}

private func writeDiagnostic(_ message: String) {
  FileHandle.standardError.write(Data("[spark-computer-host] \(message)\n".utf8))
}
