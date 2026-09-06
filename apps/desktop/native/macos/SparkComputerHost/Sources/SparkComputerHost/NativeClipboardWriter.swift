import AppKit
import Foundation

/// Writes text into the system pasteboard for the `paste_text` action
/// (Codex `paste` parity). The write is synchronous: `clearContents` +
/// `setString` take effect before the subsequent cmd+V chord is synthesized,
/// so the target application always reads the fresh value.
///
/// The pasteboard is a user-global resource — writing it replaces whatever
/// the user had copied. That is the accepted contract of an explicit paste
/// action (the agent decides between `type_text` and `paste_text`); we never
/// restore the previous contents because doing so races with the target app's
/// own asynchronous pasteboard read.
enum NativeClipboardWriter {
  enum ClipboardWriteError: Error {
    case writeFailed
  }

  static func write(_ text: String) throws {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    guard pasteboard.setString(text, forType: .string) else {
      throw ClipboardWriteError.writeFailed
    }
  }
}
