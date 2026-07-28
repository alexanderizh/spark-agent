public struct ProcessCodeIdentity: Equatable, Sendable {
  public let identifier: String?
  public let teamIdentifier: String?
  public let isAppleAnchored: Bool

  public init(identifier: String?, teamIdentifier: String?, isAppleAnchored: Bool) {
    self.identifier = identifier
    self.teamIdentifier = teamIdentifier
    self.isAppleAnchored = isAppleAnchored
  }
}

public struct ParentProcessInstance: Equatable, Sendable {
  public let processID: Int32
  public let startTimeToken: UInt64
  public let identity: ProcessCodeIdentity

  public init(processID: Int32, startTimeToken: UInt64, identity: ProcessCodeIdentity) {
    self.processID = processID
    self.startTimeToken = startTimeToken
    self.identity = identity
  }
}

public enum ParentProcessStabilityError: Error, Equatable, Sendable {
  case processChanged
}

public enum ParentProcessStabilityPolicy {
  public static func validate(
    before: ParentProcessInstance,
    after: ParentProcessInstance
  ) throws {
    guard before == after else { throw ParentProcessStabilityError.processChanged }
  }
}

public enum ParentProcessTrustError: Error, Equatable, Sendable {
  case unexpectedHostIdentifier
  case unexpectedParentIdentifier
  case hostIsNotAppleAnchored
  case parentIsNotAppleAnchored
  case missingHostTeamIdentifier
  case missingParentTeamIdentifier
  case teamIdentifierMismatch
}

public enum ParentProcessTrustPolicy {
  public static let hostIdentifier = "com.spark-agent.desktop.computer-host"
  public static let parentIdentifier = "com.spark-agent.desktop"

  public static func validate(
    host: ProcessCodeIdentity,
    parent: ProcessCodeIdentity
  ) throws {
    guard host.identifier == hostIdentifier else {
      throw ParentProcessTrustError.unexpectedHostIdentifier
    }
    guard parent.identifier == parentIdentifier else {
      throw ParentProcessTrustError.unexpectedParentIdentifier
    }
    guard host.isAppleAnchored else {
      throw ParentProcessTrustError.hostIsNotAppleAnchored
    }
    guard parent.isAppleAnchored else {
      throw ParentProcessTrustError.parentIsNotAppleAnchored
    }
    guard let hostTeamIdentifier = nonempty(host.teamIdentifier) else {
      throw ParentProcessTrustError.missingHostTeamIdentifier
    }
    guard let parentTeamIdentifier = nonempty(parent.teamIdentifier) else {
      throw ParentProcessTrustError.missingParentTeamIdentifier
    }
    guard hostTeamIdentifier == parentTeamIdentifier else {
      throw ParentProcessTrustError.teamIdentifierMismatch
    }
  }

  private static func nonempty(_ value: String?) -> String? {
    guard let value, !value.isEmpty else { return nil }
    return value
  }
}
