import Foundation

public final class FileHandleChunkStream: @unchecked Sendable {
  public let chunks: AsyncStream<Data>

  private let handle: FileHandle
  private let continuation: AsyncStream<Data>.Continuation
  private let lock = NSLock()
  private var finished = false

  public init(handle: FileHandle) {
    self.handle = handle
    let stream = AsyncStream<Data>.makeStream(bufferingPolicy: .unbounded)
    self.chunks = stream.stream
    self.continuation = stream.continuation
    self.continuation.onTermination = { [weak self] _ in self?.cancel() }
    self.handle.readabilityHandler = { [weak self] readable in
      self?.receive(readable.availableData)
    }
  }

  public func cancel() {
    lock.lock()
    guard !finished else {
      lock.unlock()
      return
    }
    finished = true
    handle.readabilityHandler = nil
    lock.unlock()
    continuation.finish()
  }

  private func receive(_ data: Data) {
    if data.isEmpty {
      cancel()
      return
    }
    lock.lock()
    let shouldYield = !finished
    lock.unlock()
    if shouldYield { continuation.yield(data) }
  }
}
