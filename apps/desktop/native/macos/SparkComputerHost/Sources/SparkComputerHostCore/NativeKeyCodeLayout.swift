import Carbon.HIToolbox
import CoreGraphics
import Foundation

/// Resolves a key name / character to a macOS virtual keycode honouring the
/// *current* keyboard layout.
///
/// The previous implementation hardcoded a US-ANSI table, so every non-US
/// layout (German, French, AZERTY, Dvorak, …) typed the wrong characters for
/// anything outside the letters row. This resolver asks the system's Unicode
/// keyboard-layout data (UCKeyTranslate) which keycode produces the character
/// with and without Shift, caches the resulting map for the process lifetime,
/// and falls back to the classic US-ANSI table when the layout cannot answer
/// (dead keys, non-printable, no layout data).
public enum NativeKeyCodeLayout {
  public struct Resolution: Equatable, Sendable {
    public let code: CGKeyCode
    public let shift: Bool

    init(code: CGKeyCode, shift: Bool) {
      self.code = code
      self.shift = shift
    }
  }

  /// Lock-guarded lazy cache. A static `let` holder keeps the mutable state
  /// off the Swift-6 global-shared-mutable radar while behaving like a memo.
  private static let cache = LayoutCache()

  private final class LayoutCache: @unchecked Sendable {
    private let lock = NSLock()
    private var map: [Character: Resolution]?

    func get() -> [Character: Resolution]? {
      lock.withLock { map }
    }

    func set(_ value: [Character: Resolution]) {
      lock.withLock { map = value }
    }
  }

  /// Resolve a single ASCII character through the current layout, then the
  /// US-ANSI fallback table.
  public static func resolve(character: Character) -> Resolution? {
    guard let scalar = character.unicodeScalars.first, character.unicodeScalars.count == 1,
      scalar.value < 0x80
    else { return usANSITable[character] }
    return layoutMap()[character] ?? usANSITable[character]
  }

  /// Layout-derived map, built once per process.
  static func layoutMap() -> [Character: Resolution] {
    if let cached = cache.get() { return cached }
    let built = buildMap(fromCurrentLayout: true)
    cache.set(built)
    return built
  }

  /// Pure translation of a Unicode keyboard-layout blob into a character map.
  /// `nil` data yields an empty map (callers then use the fallback table), so
  /// tests can exercise the merge without a real layout.
  static func buildMap(fromLayoutData data: Data?) -> [Character: Resolution] {
    guard let data, !data.isEmpty else { return [:] }
    return data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> [Character: Resolution] in
      guard let base = raw.baseAddress else { return [:] }
      let layout = base.assumingMemoryBound(to: UCKeyboardLayout.self)
      var map: [Character: Resolution] = [:]
      for code: CGKeyCode in 0..<128 {
        for (shift, modifiers) in [(false, UInt32(0)), (true, UInt32(shiftKey >> 8))] {
          var deadKeyState: UInt32 = 0
          var length = 0
          var characters = [UniChar](repeating: 0, count: 4)
          let status = UCKeyTranslate(
            layout,
            UInt16(code),
            UInt16(kUCKeyActionDown),
            modifiers,
            UInt32(LMGetKbdType()),
            OptionBits(kUCKeyTranslateNoDeadKeysBit),
            &deadKeyState,
            characters.count,
            &length,
            &characters
          )
          guard status == noErr, length == 1 else { continue }
          guard let scalar = UnicodeScalar(characters[0]) else { continue }
          // ASCII printable only: control/whitespace keycodes are not typed
          // through the character path (Space etc. use named keys).
          guard scalar.value > 0x20, scalar.value < 0x7F else { continue }
          let character = Character(scalar)
          // Unshifted binding wins; only add the shifted one when the slot is
          // still free (mirrors how a typist would produce the character).
          if map[character] == nil || !shift {
            map[character] = Resolution(code: code, shift: shift)
          }
        }
      }
      return map
    }
  }

  private static func buildMap(fromCurrentLayout: Bool) -> [Character: Resolution] {
    guard fromCurrentLayout,
      let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
      let layoutPointer = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData)
    else { return [:] }
    let data = Unmanaged<CFData>.fromOpaque(layoutPointer).takeUnretainedValue() as Data
    return buildMap(fromLayoutData: data)
  }

  /// Classic US-ANSI bindings — the fallback for layouts without Unicode data
  /// and for characters the current layout cannot produce.
  static let usANSITable: [Character: Resolution] = {
    var table: [Character: Resolution] = [:]
    let plain: [Character: CGKeyCode] = [
      "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7,
      "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16,
      "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
      "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30,
      "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
      "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45,
      "m": 46, ".": 47, "`": 50,
    ]
    for (character, code) in plain {
      table[character] = Resolution(code: code, shift: false)
      // Uppercase letter on the same physical key.
      if character.isLetter {
        table[Character(character.uppercased())] = Resolution(code: code, shift: true)
      }
    }
    let shifted: [Character: CGKeyCode] = [
      "!": 18, "@": 19, "#": 20, "$": 21, "^": 22, "%": 23, "+": 24,
      "(": 25, "&": 26, "_": 27, "*": 28, ")": 29, "{": 33, "}": 30,
      ":": 41, "\"": 39, "<": 43, ">": 46, "?": 44, "~": 50, "|": 42,
    ]
    for (character, code) in shifted {
      table[character] = Resolution(code: code, shift: true)
    }
    return table
  }()
}
