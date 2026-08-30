import Foundation

public enum NativeWindowIDParser {
  public static func parse(_ value: String) -> UInt32? {
    guard let parsed = UInt64(value), parsed <= UInt64(UInt32.max) else { return nil }
    return UInt32(parsed)
  }
}

public struct RawNativeDisplay: Equatable, Sendable {
  public let id: String
  public let pixelWidth: Int
  public let pixelHeight: Int
  public let frame: NativeRect

  public init(id: String, pixelWidth: Int, pixelHeight: Int, frame: NativeRect) {
    self.id = id
    self.pixelWidth = pixelWidth
    self.pixelHeight = pixelHeight
    self.frame = frame
  }
}

public struct RawNativeWindow: Equatable, Sendable {
  public let id: String
  public let title: String
  public let frame: NativeRect
  public let isOnScreen: Bool
  public let processID: Int32
  public let applicationName: String
  public let bundleID: String?
  public let executableIdentity: String?
  public let signingIdentity: String?

  public init(
    id: String,
    title: String,
    frame: NativeRect,
    isOnScreen: Bool,
    processID: Int32,
    applicationName: String,
    bundleID: String?,
    executableIdentity: String?,
    signingIdentity: String?
  ) {
    self.id = id
    self.title = title
    self.frame = frame
    self.isOnScreen = isOnScreen
    self.processID = processID
    self.applicationName = applicationName
    self.bundleID = bundleID
    self.executableIdentity = executableIdentity
    self.signingIdentity = signingIdentity
  }
}

public enum NativeWindowInventoryMapper {
  public static func map(
    windows: [RawNativeWindow],
    displays: [RawNativeDisplay],
    focusedWindowID: String?
  ) throws -> [NativeWindowDescriptor] {
    let validDisplays = displays.filter(isValidDisplay)
    guard !validDisplays.isEmpty else { return [] }

    return windows.prefix(10_000).compactMap { window in
      guard isValidRect(window.frame), window.processID > 0,
        let applicationName = boundedMetadata(window.applicationName, maxUTF16CodeUnits: 300),
        !applicationName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        let title = boundedMetadata(window.title, maxUTF16CodeUnits: 2_000),
        isValidIdentifier(window.id),
        isValidOptionalIdentifier(window.bundleID),
        isValidOptionalIdentifier(window.executableIdentity),
        isValidOptionalIdentifier(window.signingIdentity),
        let display = bestDisplay(for: window.frame, displays: validDisplays)
      else {
        return nil
      }
      let scaleFactor = Double(display.pixelWidth) / display.frame.width
      guard scaleFactor.isFinite, scaleFactor > 0, scaleFactor <= 8 else { return nil }
      let appID = window.bundleID ?? "pid:\(window.processID)"
      return NativeWindowDescriptor(
        app: NativeAppIdentity(
          id: appID,
          name: applicationName,
          processId: window.processID,
          bundleId: window.bundleID,
          executableIdentity: window.executableIdentity,
          signingIdentity: window.signingIdentity
        ),
        window: NativeWindowIdentity(
          id: window.id,
          title: title,
          bounds: window.frame
        ),
        display: NativeDisplayGeometry(
          id: display.id,
          width: display.pixelWidth,
          height: display.pixelHeight,
          scaleFactor: scaleFactor
        ),
        focused: window.id == focusedWindowID,
        minimized: !window.isOnScreen
      )
    }
  }

  private static func bestDisplay(
    for window: NativeRect,
    displays: [RawNativeDisplay]
  ) -> RawNativeDisplay? {
    displays.max { left, right in
      intersectionArea(window, left.frame) < intersectionArea(window, right.frame)
    }
  }

  private static func intersectionArea(_ left: NativeRect, _ right: NativeRect) -> Double {
    let width = max(0, min(left.x + left.width, right.x + right.width) - max(left.x, right.x))
    let height = max(0, min(left.y + left.height, right.y + right.height) - max(left.y, right.y))
    return width * height
  }

  private static func isValidDisplay(_ display: RawNativeDisplay) -> Bool {
    isValidIdentifier(display.id) && isValidRect(display.frame) && display.pixelWidth > 0
      && display.pixelWidth <= 131_072
      && display.pixelHeight > 0 && display.pixelHeight <= 131_072
  }

  private static func isValidOptionalIdentifier(_ value: String?) -> Bool {
    value == nil || isValidIdentifier(value!)
  }

  private static func isValidIdentifier(_ value: String) -> Bool {
    value == value.trimmingCharacters(in: .whitespacesAndNewlines)
      && !value.isEmpty && value.utf16.count <= 200 && !containsControlCharacters(value)
  }

  private static func boundedMetadata(
    _ value: String,
    maxUTF16CodeUnits: Int
  ) -> String? {
    guard !containsControlCharacters(value) else { return nil }
    var result = ""
    var used = 0
    for character in value {
      let count = String(character).utf16.count
      if used + count > maxUTF16CodeUnits { break }
      result.append(character)
      used += count
    }
    return result
  }

  private static func containsControlCharacters(_ value: String) -> Bool {
    value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
  }

  private static func isValidRect(_ rect: NativeRect) -> Bool {
    rect.x.isFinite && rect.y.isFinite && rect.width.isFinite && rect.height.isFinite
      && rect.x >= -131_072 && rect.x <= 131_072 && rect.y >= -131_072 && rect.y <= 131_072
      && rect.width > 0 && rect.width <= 131_072 && rect.height > 0 && rect.height <= 131_072
  }
}
