import AppKit
import Darwin
import Foundation
import SparkComputerHostCore

@main
struct SparkComputerHostMain {
  static func main() {
    do {
      try ParentProcessAuthorizer.authorize()
    } catch {
      writeDiagnostic("parent process authorization failed: \(error)")
      exit(EX_NOPERM)
    }

    signal(SIGPIPE, SIG_IGN)

    // AppKit must own the main thread and its run loop for the virtual-cursor
    // overlay windows. The stdio protocol loop therefore runs detached; when
    // stdin closes (parent went away) it terminates the whole process, which
    // also stops the run loop — identical lifecycle to the pre-AppKit host.
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    Task.detached(priority: .userInitiated) {
      do {
        try await run()
      } catch {
        // Carry the underlying error: a bare "protocol failure" line told the
        // caller nothing about which request or which check failed.
        writeDiagnostic("fatal native host protocol failure: \(error)")
        exit(EX_PROTOCOL)
      }
      exit(0)
    }
    app.run()
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
        let request: NativeHostRequest
        do {
          request = try requestDecoder.decode(frame.payload)
        } catch let error as NativeHostProtocolError {
          // One malformed request must not end the session: the frame boundary
          // was honored, so the stream is still in sync. Answer and keep going
          // (see NativeHostRequestDecoding).
          try output.write(
            contentsOf: NativeFrameCodec.encode(
              kind: .json,
              payload: try NativeHostRequestDecoding.errorReply(
                for: frame.payload, error: error)))
          continue
        }
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
