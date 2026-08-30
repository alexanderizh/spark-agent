import Foundation

public let maxNativeTextUTF16Units = 100_000
public let maxNativeKeyChordKeys = 8

public struct NativeNormalizedPoint: Equatable, Sendable {
  public let x: Double
  public let y: Double

  public init(x: Double, y: Double) {
    self.x = x
    self.y = y
  }
}

public enum NativeWaitCondition: Equatable, Sendable {
  case loadingStopped
  case elementPresent(String)
  case elementAbsent(String)
  case windowFocused(String)
  case snapshotChanged(String)
}

public enum NativeComputerAction: Equatable, Sendable {
  case observe(fullTree: Bool?)
  case invokeElement(elementID: String, action: String?)
  case setValue(elementID: String, value: String, sensitive: Bool?)
  case selectText(elementID: String, text: String, prefix: String?, suffix: String?)
  case click(point: NativeNormalizedPoint, button: String?, count: Int?)
  case move(point: NativeNormalizedPoint)
  case drag(from: NativeNormalizedPoint, to: NativeNormalizedPoint, durationMs: Int?)
  case scroll(elementID: String?, point: NativeNormalizedPoint?, deltaX: Double, deltaY: Double)
  case keypress(keys: [String])
  case typeText(text: String, sensitive: Bool?)
  case waitFor(condition: NativeWaitCondition, timeoutMs: Int)
  case focusWindow(windowID: String)

  public var type: String {
    switch self {
    case .observe: "observe"
    case .invokeElement: "invoke_element"
    case .setValue: "set_value"
    case .selectText: "select_text"
    case .click: "click"
    case .move: "move"
    case .drag: "drag"
    case .scroll: "scroll"
    case .keypress: "keypress"
    case .typeText: "type_text"
    case .waitFor: "wait_for"
    case .focusWindow: "focus_window"
    }
  }

  public var elementID: String? {
    switch self {
    case .invokeElement(let id, _), .setValue(let id, _, _), .selectText(let id, _, _, _): id
    case .scroll(let id, _, _, _): id
    default: nil
    }
  }
}

public struct NativePolicyContext: Equatable, Sendable {
  public let effect: String
  public let targetKind: String
  public let targetID: String
  public let dataClasses: [String]
}

public enum NativeExecutionLane: String, Equatable, Sendable {
  case backgroundSemantic = "background_semantic"
  case foregroundInput = "foreground_input"
  case passive
}

public struct NativeComputerActionEnvelope: Equatable, Sendable {
  public let computerSessionID: String
  public let actionID: String
  public let actuatorLeaseID: String
  public let observedFrameID: String
  public let observedTreeVersion: String
  public let targetAppID: String
  public let targetWindowID: String
  public let action: NativeComputerAction
  public let executionLane: NativeExecutionLane
  public let policyContext: NativePolicyContext
  public let intent: String
  public let hasExpectedPostcondition: Bool
}

func decodeComputerActionEnvelope(_ value: Any?) throws -> NativeComputerActionEnvelope {
  guard let object = value as? [String: Any] else { throw invalidFields }
  let required: Set<String> = [
    "computerSessionId", "actionId", "actuatorLeaseId", "observedFrameId",
    "observedTreeVersion", "targetAppId", "targetWindowId", "action", "policyContext", "intent",
  ]
  let optional: Set<String> = ["expectedPostcondition", "executionLane"]
  guard required.isSubset(of: Set(object.keys)), Set(object.keys).isSubset(of: required.union(optional))
  else { throw invalidFields }
  let intent = try string(object["intent"], min: 1, max: 4_000, trimmed: true)
  if let postcondition = object["expectedPostcondition"] {
    try validateVerificationSpec(postcondition)
  }
  let action = try decodeAction(object["action"])
  let expectedLane = executionLane(for: action)
  let lane: NativeExecutionLane
  if let rawLane = object["executionLane"] {
    guard let raw = rawLane as? String, let decoded = NativeExecutionLane(rawValue: raw),
      decoded == expectedLane
    else { throw invalidFields }
    lane = decoded
  } else {
    lane = expectedLane
  }
  return NativeComputerActionEnvelope(
    computerSessionID: try identifier(object["computerSessionId"]),
    actionID: try identifier(object["actionId"]),
    actuatorLeaseID: try identifier(object["actuatorLeaseId"]),
    observedFrameID: try identifier(object["observedFrameId"]),
    observedTreeVersion: try identifier(object["observedTreeVersion"]),
    targetAppID: try identifier(object["targetAppId"]),
    targetWindowID: try identifier(object["targetWindowId"]),
    action: action,
    executionLane: lane,
    policyContext: try decodePolicyContext(object["policyContext"]),
    intent: intent,
    hasExpectedPostcondition: object["expectedPostcondition"] != nil
  )
}

private func executionLane(for action: NativeComputerAction) -> NativeExecutionLane {
  switch action {
  case .invokeElement, .setValue, .selectText:
    return .backgroundSemantic
  case .observe, .waitFor:
    return .passive
  default:
    return .foregroundInput
  }
}

private func decodeAction(_ value: Any?) throws -> NativeComputerAction {
  guard let object = value as? [String: Any], let type = object["type"] as? String else {
    throw invalidFields
  }
  switch type {
  case "observe":
    try keys(object, required: ["type"], optional: ["fullTree"])
    return .observe(fullTree: try optionalBoolean(object, "fullTree"))
  case "invoke_element":
    try keys(object, required: ["type", "elementId"], optional: ["action"])
    let action = try optionalEnum(
      object, "action", allowed: ["invoke", "select", "focus", "expand", "collapse"])
    return .invokeElement(elementID: try identifier(object["elementId"]), action: action)
  case "set_value":
    try keys(object, required: ["type", "elementId", "value"], optional: ["sensitive"])
    return .setValue(
      elementID: try identifier(object["elementId"]),
      value: try string(object["value"], min: 0, max: maxNativeTextUTF16Units),
      sensitive: try optionalBoolean(object, "sensitive")
    )
  case "select_text":
    try keys(object, required: ["type", "elementId", "text"], optional: ["prefix", "suffix"])
    return .selectText(
      elementID: try identifier(object["elementId"]),
      text: try string(object["text"], min: 1, max: maxNativeTextUTF16Units),
      prefix: try optionalString(object, "prefix", min: 0, max: 2_000),
      suffix: try optionalString(object, "suffix", min: 0, max: 2_000)
    )
  case "click":
    try keys(object, required: ["type", "point"], optional: ["button", "count"])
    let count = try optionalInteger(object, "count")
    guard count.map({ (1...3).contains($0) }) ?? true else { throw invalidFields }
    return .click(
      point: try point(object["point"]),
      button: try optionalEnum(object, "button", allowed: ["left", "right", "middle"]),
      count: count
    )
  case "move":
    try keys(object, required: ["type", "point"])
    return .move(point: try point(object["point"]))
  case "drag":
    try keys(object, required: ["type", "from", "to"], optional: ["durationMs"])
    let duration = try optionalInteger(object, "durationMs")
    guard duration.map({ (50...30_000).contains($0) }) ?? true else { throw invalidFields }
    return .drag(from: try point(object["from"]), to: try point(object["to"]), durationMs: duration)
  case "scroll":
    try keys(object, required: ["type", "deltaX", "deltaY"], optional: ["elementId", "point"])
    let deltaX = try finiteNumber(object["deltaX"], range: -100_000...100_000)
    let deltaY = try finiteNumber(object["deltaY"], range: -100_000...100_000)
    guard deltaX != 0 || deltaY != 0 else { throw invalidFields }
    return .scroll(
      elementID: try optionalIdentifier(object, "elementId"),
      point: try object["point"].map { try point($0) },
      deltaX: deltaX,
      deltaY: deltaY
    )
  case "keypress":
    try keys(object, required: ["type", "keys"])
    guard let values = object["keys"] as? [String],
      (1...maxNativeKeyChordKeys).contains(values.count), values.allSatisfy(validKey)
    else { throw invalidFields }
    return .keypress(keys: values)
  case "type_text":
    try keys(object, required: ["type", "text"], optional: ["sensitive"])
    return .typeText(
      text: try string(object["text"], min: 1, max: maxNativeTextUTF16Units),
      sensitive: try optionalBoolean(object, "sensitive")
    )
  case "wait_for":
    try keys(object, required: ["type", "condition", "timeoutMs"])
    let timeout = try integer(object["timeoutMs"])
    guard (50...120_000).contains(timeout) else { throw invalidFields }
    return .waitFor(condition: try waitCondition(object["condition"]), timeoutMs: timeout)
  case "focus_window":
    try keys(object, required: ["type", "windowId"])
    return .focusWindow(windowID: try identifier(object["windowId"]))
  default:
    throw invalidFields
  }
}

private func decodePolicyContext(_ value: Any?) throws -> NativePolicyContext {
  guard let object = value as? [String: Any] else { throw invalidFields }
  try keys(object, required: ["effect", "target", "dataClasses"])
  let effect = try enumString(
    object["effect"],
    allowed: [
      "read_only", "reversible_local", "external_write", "high_impact", "restricted",
    ])
  guard let target = object["target"] as? [String: Any] else { throw invalidFields }
  try keys(target, required: ["kind", "id"])
  let targetKind = try enumString(
    target["kind"],
    allowed: [
      "application", "window", "element", "domain", "recipient", "file_policy", "system_setting",
      "account", "unknown",
    ])
  guard let classes = object["dataClasses"] as? [String], classes.count <= 8,
    Set(classes).count == classes.count,
    classes.allSatisfy({
      ["public", "internal", "personal", "sensitive", "credential", "financial", "health", "legal"]
        .contains($0)
    })
  else { throw invalidFields }
  return NativePolicyContext(
    effect: effect, targetKind: targetKind, targetID: try identifier(target["id"]),
    dataClasses: classes)
}

private func waitCondition(_ value: Any?) throws -> NativeWaitCondition {
  guard let object = value as? [String: Any], let kind = object["kind"] as? String else {
    throw invalidFields
  }
  switch kind {
  case "loading_stopped":
    try keys(object, required: ["kind"])
    return .loadingStopped
  case "element_present":
    try keys(object, required: ["kind", "elementId"])
    return .elementPresent(try identifier(object["elementId"]))
  case "element_absent":
    try keys(object, required: ["kind", "elementId"])
    return .elementAbsent(try identifier(object["elementId"]))
  case "window_focused":
    try keys(object, required: ["kind", "windowId"])
    return .windowFocused(try identifier(object["windowId"]))
  case "snapshot_changed":
    try keys(object, required: ["kind", "previousFrameId"])
    return .snapshotChanged(try identifier(object["previousFrameId"]))
  default: throw invalidFields
  }
}

private func validateVerificationSpec(_ value: Any) throws {
  guard let object = value as? [String: Any], let kind = object["kind"] as? String else {
    throw invalidFields
  }
  switch kind {
  case "accessibility":
    try keys(object, required: ["kind", "selector", "assertion"])
    try validateElementSelector(object["selector"])
    try validateElementAssertion(object["assertion"])
  case "dom":
    try keys(object, required: ["kind", "windowId", "assertion"])
    _ = try identifier(object["windowId"])
    try validateDomAssertion(object["assertion"])
  case "visual":
    try keys(object, required: ["kind", "assertion"], optional: ["region"])
    if let region = object["region"] { try validateRect(region) }
    try validateVisualAssertion(object["assertion"])
  case "file":
    try keys(object, required: ["kind", "pathPolicyRef", "assertion"])
    _ = try identifier(object["pathPolicyRef"])
    try validateFileAssertion(object["assertion"])
  case "application_state":
    try keys(object, required: ["kind", "appId", "assertion"])
    _ = try identifier(object["appId"])
    try validateApplicationAssertion(object["assertion"])
  case "external_readback":
    try keys(object, required: ["kind", "connectorId", "assertion"])
    _ = try identifier(object["connectorId"])
    try validateExternalAssertion(object["assertion"])
  default: throw invalidFields
  }
}

private func validateElementSelector(_ value: Any?) throws {
  guard let object = value as? [String: Any] else { throw invalidFields }
  try keys(object, required: [], optional: ["elementId", "role", "name"])
  guard !object.isEmpty else { throw invalidFields }
  if object["elementId"] != nil { _ = try identifier(object["elementId"]) }
  if object["role"] != nil { _ = try string(object["role"], min: 1, max: 120, trimmed: true) }
  if object["name"] != nil { _ = try string(object["name"], min: 0, max: 1_000) }
}

private func validateElementAssertion(_ value: Any?) throws {
  guard let object = value as? [String: Any], let operation = object["operator"] as? String else {
    throw invalidFields
  }
  try keys(object, required: ["operator", "expected"])
  if ["exists", "visible", "enabled", "focused"].contains(operation) {
    guard strictBool(object["expected"]) != nil else { throw invalidFields }
  } else if ["value_equals", "text_contains"].contains(operation) {
    _ = try string(
      object["expected"], min: operation == "text_contains" ? 1 : 0, max: maxNativeTextUTF16Units)
  } else {
    throw invalidFields
  }
}

private func validateDomAssertion(_ value: Any?) throws {
  guard let object = value as? [String: Any], let operation = object["operator"] as? String else {
    throw invalidFields
  }
  try keys(object, required: ["selector", "operator", "expected"], optional: ["attribute"])
  _ = try string(object["selector"], min: 1, max: 2_000, trimmed: true)
  if ["exists", "visible"].contains(operation) {
    guard strictBool(object["expected"]) != nil else { throw invalidFields }
  } else if ["text_contains", "attribute_equals"].contains(operation) {
    _ = try string(object["expected"], min: 0, max: maxNativeTextUTF16Units)
  } else {
    throw invalidFields
  }
  if operation == "attribute_equals" {
    _ = try string(object["attribute"], min: 1, max: 200, trimmed: true)
  } else if object["attribute"] != nil {
    _ = try string(object["attribute"], min: 1, max: 200, trimmed: true)
  }
}

private func validateVisualAssertion(_ value: Any?) throws {
  guard let object = value as? [String: Any], let operation = object["operator"] as? String else {
    throw invalidFields
  }
  try keys(object, required: ["operator", "expected"])
  switch operation {
  case "text_present", "text_absent": _ = try string(object["expected"], min: 1, max: 20_000)
  case "similarity_at_least": _ = try finiteNumber(object["expected"], range: 0...1)
  case "changed": guard strictBool(object["expected"]) != nil else { throw invalidFields }
  default: throw invalidFields
  }
}

private func validateFileAssertion(_ value: Any?) throws {
  guard let object = value as? [String: Any], let operation = object["operator"] as? String else {
    throw invalidFields
  }
  switch operation {
  case "exists":
    try keys(object, required: ["operator", "expected"])
    guard strictBool(object["expected"]) != nil else { throw invalidFields }
  case "sha256_equals":
    try keys(object, required: ["operator", "expected"])
    let digest = try string(object["expected"], min: 64, max: 64)
    guard digest.allSatisfy({ $0.isHexDigit }) else { throw invalidFields }
  case "size_between":
    try keys(object, required: ["operator", "minBytes", "maxBytes"])
    let min = try integer(object["minBytes"])
    let max = try integer(object["maxBytes"])
    guard min >= 0, max >= min else { throw invalidFields }
  case "text_contains":
    try keys(object, required: ["operator", "expected"])
    _ = try string(object["expected"], min: 1, max: maxNativeTextUTF16Units)
  default: throw invalidFields
  }
}

private func validateApplicationAssertion(_ value: Any?) throws {
  guard let object = value as? [String: Any], let operation = object["operator"] as? String else {
    throw invalidFields
  }
  try keys(object, required: ["operator", "expected"])
  if ["running", "frontmost", "window_exists"].contains(operation) {
    guard strictBool(object["expected"]) != nil else { throw invalidFields }
  } else if operation == "window_title_contains" {
    _ = try string(object["expected"], min: 0, max: 2_000)
  } else {
    throw invalidFields
  }
}

private func validateExternalAssertion(_ value: Any?) throws {
  guard let object = value as? [String: Any], let operation = object["operator"] as? String else {
    throw invalidFields
  }
  try keys(object, required: ["resource", "operator", "expected"])
  _ = try string(object["resource"], min: 1, max: 500, trimmed: true)
  switch operation {
  case "exists": guard strictBool(object["expected"]) != nil else { throw invalidFields }
  case "contains": _ = try string(object["expected"], min: 1, max: maxNativeTextUTF16Units)
  case "status_is": _ = try string(object["expected"], min: 1, max: 500, trimmed: true)
  case "equals":
    guard
      strictBool(object["expected"]) != nil || object["expected"] is String
        || (try? finiteNumber(
          object["expected"],
          range: -Double.greatestFiniteMagnitude...Double.greatestFiniteMagnitude)) != nil
    else { throw invalidFields }
    if object["expected"] is String {
      _ = try string(object["expected"], min: 0, max: maxNativeTextUTF16Units)
    }
  default: throw invalidFields
  }
}

private func validateRect(_ value: Any?) throws {
  guard let object = value as? [String: Any] else { throw invalidFields }
  try keys(object, required: ["x", "y", "width", "height"])
  _ = try finiteNumber(object["x"], range: -131_072...131_072)
  _ = try finiteNumber(object["y"], range: -131_072...131_072)
  let width = try finiteNumber(object["width"], range: 0...131_072)
  let height = try finiteNumber(object["height"], range: 0...131_072)
  guard width > 0, height > 0 else { throw invalidFields }
}

private func point(_ value: Any?) throws -> NativeNormalizedPoint {
  guard let object = value as? [String: Any] else { throw invalidFields }
  try keys(object, required: ["x", "y"])
  return NativeNormalizedPoint(
    x: try finiteNumber(object["x"], range: 0...1),
    y: try finiteNumber(object["y"], range: 0...1)
  )
}

private func keys(_ object: [String: Any], required: Set<String>, optional: Set<String> = []) throws
{
  let actual = Set(object.keys)
  guard required.isSubset(of: actual), actual.isSubset(of: required.union(optional)) else {
    throw invalidFields
  }
}

private func identifier(_ value: Any?) throws -> String {
  let result = try string(value, min: 1, max: 200, trimmed: true)
  guard !result.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) else {
    throw invalidFields
  }
  return result
}

private func optionalIdentifier(_ object: [String: Any], _ key: String) throws -> String? {
  guard let value = object[key] else { return nil }
  return try identifier(value)
}

private func string(_ value: Any?, min: Int, max: Int, trimmed: Bool = false) throws -> String {
  guard let value = value as? String else { throw invalidFields }
  let checked = trimmed ? value.trimmingCharacters(in: .whitespacesAndNewlines) : value
  guard checked.utf16.count >= min, checked.utf16.count <= max else { throw invalidFields }
  return value
}

private func optionalString(_ object: [String: Any], _ key: String, min: Int, max: Int) throws
  -> String?
{
  guard let value = object[key] else { return nil }
  return try string(value, min: min, max: max)
}

private func enumString(_ value: Any?, allowed: Set<String>) throws -> String {
  guard let value = value as? String, allowed.contains(value) else { throw invalidFields }
  return value
}

private func optionalEnum(_ object: [String: Any], _ key: String, allowed: Set<String>) throws
  -> String?
{
  guard let value = object[key] else { return nil }
  return try enumString(value, allowed: allowed)
}

private func integer(_ value: Any?) throws -> Int {
  guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
    number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
    number.doubleValue >= Double(Int.min), number.doubleValue <= Double(Int.max)
  else { throw invalidFields }
  return number.intValue
}

private func optionalInteger(_ object: [String: Any], _ key: String) throws -> Int? {
  guard let value = object[key] else { return nil }
  return try integer(value)
}

private func finiteNumber(_ value: Any?, range: ClosedRange<Double>) throws -> Double {
  guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
    throw invalidFields
  }
  let result = number.doubleValue
  guard result.isFinite, range.contains(result) else { throw invalidFields }
  return result
}

private func optionalBoolean(_ object: [String: Any], _ key: String) throws -> Bool? {
  guard let value = object[key] else { return nil }
  guard let result = strictBool(value) else { throw invalidFields }
  return result
}

private func strictBool(_ value: Any?) -> Bool? {
  guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
    return nil
  }
  return number.boolValue
}

private func validKey(_ key: String) -> Bool {
  let named: Set<String> = [
    "Alt", "Backspace", "Control", "Delete", "End", "Enter", "Escape", "Home", "Meta",
    "PageDown", "PageUp", "Shift", "Space", "Tab", "ArrowDown", "ArrowLeft", "ArrowRight",
    "ArrowUp",
  ]
  if named.contains(key) { return true }
  if key.first == "F", let number = Int(key.dropFirst()), (1...24).contains(number),
    key == "F\(number)"
  {
    return true
  }
  if NativeKeySymbols.isShiftedSymbol(key) { return true }
  return key.utf8.count == 1
    && key.utf8.first.map({
      (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0)
    }) == true
}

private let invalidFields = NativeHostProtocolError.invalidRequestFields
