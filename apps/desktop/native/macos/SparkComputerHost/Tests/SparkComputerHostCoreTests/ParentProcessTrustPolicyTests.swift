import XCTest

@testable import SparkComputerHostCore

final class ParentProcessTrustPolicyTests: XCTestCase {
  private let trustedHost = ProcessCodeIdentity(
    identifier: "com.spark-agent.desktop.computer-host",
    teamIdentifier: "ABCDE12345",
    isAppleAnchored: true
  )
  private let trustedParent = ProcessCodeIdentity(
    identifier: "com.spark-agent.desktop",
    teamIdentifier: "ABCDE12345",
    isAppleAnchored: true
  )

  func testAcceptsTheExpectedAppleAnchoredHostAndParentFromTheSameTeam() throws {
    XCTAssertNoThrow(
      try ParentProcessTrustPolicy.validate(host: trustedHost, parent: trustedParent)
    )
  }

  func testRejectsAnUnexpectedHostIdentifier() {
    let host = ProcessCodeIdentity(
      identifier: "com.attacker.host",
      teamIdentifier: trustedHost.teamIdentifier,
      isAppleAnchored: true
    )

    XCTAssertThrowsError(try ParentProcessTrustPolicy.validate(host: host, parent: trustedParent)) {
      XCTAssertEqual($0 as? ParentProcessTrustError, .unexpectedHostIdentifier)
    }
  }

  func testRejectsAnUnexpectedParentIdentifier() {
    let parent = ProcessCodeIdentity(
      identifier: "com.attacker.parent",
      teamIdentifier: trustedParent.teamIdentifier,
      isAppleAnchored: true
    )

    XCTAssertThrowsError(try ParentProcessTrustPolicy.validate(host: trustedHost, parent: parent)) {
      XCTAssertEqual($0 as? ParentProcessTrustError, .unexpectedParentIdentifier)
    }
  }

  func testRejectsDifferentSigningTeams() {
    let parent = ProcessCodeIdentity(
      identifier: trustedParent.identifier,
      teamIdentifier: "FGHIJ67890",
      isAppleAnchored: true
    )

    XCTAssertThrowsError(try ParentProcessTrustPolicy.validate(host: trustedHost, parent: parent)) {
      XCTAssertEqual($0 as? ParentProcessTrustError, .teamIdentifierMismatch)
    }
  }

  func testRejectsAHostThatIsNotAppleAnchored() {
    let host = ProcessCodeIdentity(
      identifier: trustedHost.identifier,
      teamIdentifier: trustedHost.teamIdentifier,
      isAppleAnchored: false
    )

    XCTAssertThrowsError(try ParentProcessTrustPolicy.validate(host: host, parent: trustedParent)) {
      XCTAssertEqual($0 as? ParentProcessTrustError, .hostIsNotAppleAnchored)
    }
  }

  func testRejectsAParentThatIsNotAppleAnchored() {
    let parent = ProcessCodeIdentity(
      identifier: trustedParent.identifier,
      teamIdentifier: trustedParent.teamIdentifier,
      isAppleAnchored: false
    )

    XCTAssertThrowsError(try ParentProcessTrustPolicy.validate(host: trustedHost, parent: parent)) {
      XCTAssertEqual($0 as? ParentProcessTrustError, .parentIsNotAppleAnchored)
    }
  }

  func testRejectsAMissingHostTeamIdentifier() {
    let host = ProcessCodeIdentity(
      identifier: trustedHost.identifier,
      teamIdentifier: nil,
      isAppleAnchored: true
    )

    XCTAssertThrowsError(try ParentProcessTrustPolicy.validate(host: host, parent: trustedParent)) {
      XCTAssertEqual($0 as? ParentProcessTrustError, .missingHostTeamIdentifier)
    }
  }

  func testRejectsAMissingParentTeamIdentifier() {
    let parent = ProcessCodeIdentity(
      identifier: trustedParent.identifier,
      teamIdentifier: nil,
      isAppleAnchored: true
    )

    XCTAssertThrowsError(try ParentProcessTrustPolicy.validate(host: trustedHost, parent: parent)) {
      XCTAssertEqual($0 as? ParentProcessTrustError, .missingParentTeamIdentifier)
    }
  }

  func testRejectsParentPIDReuseEvenWhenTheReplacementHasTheSameSignature() {
    let before = ParentProcessInstance(
      processID: 42,
      startTimeToken: 100,
      identity: trustedParent
    )
    let reused = ParentProcessInstance(
      processID: 42,
      startTimeToken: 101,
      identity: trustedParent
    )

    XCTAssertThrowsError(try ParentProcessStabilityPolicy.validate(before: before, after: reused)) {
      XCTAssertEqual($0 as? ParentProcessStabilityError, .processChanged)
    }
  }

  func testAcceptsTwoObservationsOfTheSameParentProcessInstance() throws {
    let parent = ParentProcessInstance(
      processID: 42,
      startTimeToken: 100,
      identity: trustedParent
    )
    XCTAssertNoThrow(try ParentProcessStabilityPolicy.validate(before: parent, after: parent))
  }
}
