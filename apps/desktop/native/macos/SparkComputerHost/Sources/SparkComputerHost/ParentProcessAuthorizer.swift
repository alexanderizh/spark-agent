import Darwin
import Foundation
import Security
import SparkComputerHostCore

enum ParentProcessAuthorizationError: Error {
  case codeLookupFailed
  case signingInformationUnavailable
  case appleAnchorRequirementUnavailable
  case processIdentityChanged
}

enum ParentProcessAuthorizer {
  static func authorize() throws {
    var hostCode: SecCode?
    guard SecCodeCopySelf([], &hostCode) == errSecSuccess, let hostCode else {
      throw ParentProcessAuthorizationError.codeLookupFailed
    }

    let parentProcessIdentifier = getppid()
    guard parentProcessIdentifier > 1 else {
      throw ParentProcessAuthorizationError.codeLookupFailed
    }
    let parentStartTime = try processStartTimeToken(parentProcessIdentifier)
    let parentCode = try code(for: parentProcessIdentifier)
    let parentIdentity = try identity(for: parentCode)
    let before = ParentProcessInstance(
      processID: parentProcessIdentifier,
      startTimeToken: parentStartTime,
      identity: parentIdentity
    )

    let parentProcessIdentifierAfter = getppid()
    guard parentProcessIdentifierAfter > 1 else {
      throw ParentProcessAuthorizationError.processIdentityChanged
    }
    let parentCodeAfter = try code(for: parentProcessIdentifierAfter)
    let after = ParentProcessInstance(
      processID: parentProcessIdentifierAfter,
      startTimeToken: try processStartTimeToken(parentProcessIdentifierAfter),
      identity: try identity(for: parentCodeAfter)
    )
    do {
      try ParentProcessStabilityPolicy.validate(before: before, after: after)
    } catch {
      throw ParentProcessAuthorizationError.processIdentityChanged
    }

    try ParentProcessTrustPolicy.validate(
      host: try identity(for: hostCode),
      parent: parentIdentity
    )
  }

  private static func code(for processID: pid_t) throws -> SecCode {
    let attributes =
      [kSecGuestAttributePid as String: NSNumber(value: processID)] as CFDictionary
    var code: SecCode?
    guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess,
      let code
    else { throw ParentProcessAuthorizationError.codeLookupFailed }
    return code
  }

  private static func identity(for code: SecCode) throws -> ProcessCodeIdentity {
    guard SecCodeCheckValidity(code, [], nil) == errSecSuccess else {
      throw ParentProcessAuthorizationError.signingInformationUnavailable
    }
    let appleAnchored = try isAppleAnchored(code)
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else {
      throw ParentProcessAuthorizationError.signingInformationUnavailable
    }
    var information: CFDictionary?
    guard
      SecCodeCopySigningInformation(
        staticCode,
        SecCSFlags(rawValue: kSecCSSigningInformation),
        &information
      )
        == errSecSuccess,
      let dictionary = information as? [String: Any]
    else {
      throw ParentProcessAuthorizationError.signingInformationUnavailable
    }

    return ProcessCodeIdentity(
      identifier: dictionary[kSecCodeInfoIdentifier as String] as? String,
      teamIdentifier: dictionary[kSecCodeInfoTeamIdentifier as String] as? String,
      isAppleAnchored: appleAnchored
    )
  }

  private static func processStartTimeToken(_ processID: pid_t) throws -> UInt64 {
    var info = proc_bsdinfo()
    let expectedSize = MemoryLayout<proc_bsdinfo>.size
    let readSize = withUnsafeMutablePointer(to: &info) { pointer in
      proc_pidinfo(processID, PROC_PIDTBSDINFO, 0, pointer, Int32(expectedSize))
    }
    guard readSize == Int32(expectedSize) else {
      throw ParentProcessAuthorizationError.codeLookupFailed
    }
    return (UInt64(info.pbi_start_tvsec) << 20) ^ UInt64(info.pbi_start_tvusec)
  }

  private static func isAppleAnchored(_ code: SecCode) throws -> Bool {
    var requirement: SecRequirement?
    guard
      SecRequirementCreateWithString(
        "anchor apple generic" as CFString,
        [],
        &requirement
      ) == errSecSuccess,
      let requirement
    else {
      throw ParentProcessAuthorizationError.appleAnchorRequirementUnavailable
    }
    return SecCodeCheckValidity(code, [], requirement) == errSecSuccess
  }
}
