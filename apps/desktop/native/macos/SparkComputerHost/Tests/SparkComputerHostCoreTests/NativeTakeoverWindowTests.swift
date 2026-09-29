import XCTest

@testable import SparkComputerHostCore

final class NativeTakeoverWindowTests: XCTestCase {
  func testDetectsNothingBeforeAnyActionIsArmed() {
    var window = NativeTakeoverWindow()
    window.recordInteraction(at: 100)
    XCTAssertFalse(window.detectsTakeover(), "an idle session must never report a takeover")
  }

  func testInteractionBeforeTheActionDoesNotAbortIt() {
    var window = NativeTakeoverWindow()
    window.recordInteraction(at: 100)
    window.begin(at: 200)
    XCTAssertFalse(
      window.detectsTakeover(),
      "the user's own activity between actions must not poison the next action")
  }

  func testInteractionDuringTheActionAbortsIt() {
    var window = NativeTakeoverWindow()
    window.begin(at: 200)
    window.recordInteraction(at: 205)
    XCTAssertTrue(window.detectsTakeover())
  }

  func testInteractionExactlyAtActionStartCounts() {
    var window = NativeTakeoverWindow()
    window.begin(at: 200)
    window.recordInteraction(at: 200)
    XCTAssertTrue(window.detectsTakeover())
  }

  func testEndDisarmsSoALateInteractionDoesNotLeakIntoTheNextAction() {
    var window = NativeTakeoverWindow()
    window.begin(at: 200)
    window.recordInteraction(at: 205)
    XCTAssertTrue(window.detectsTakeover())
    window.end()
    XCTAssertFalse(window.detectsTakeover())
    window.begin(at: 300)
    XCTAssertFalse(
      window.detectsTakeover(),
      "an interaction from the previous action must not abort a fresh one")
  }

  /// The regression this type exists for: a sticky flag made the SECOND action of a
  /// session fail after the user had merely touched the target window during the first.
  func testSecondActionSurvivesAnInteractionThatAbortedTheFirst() {
    var window = NativeTakeoverWindow()
    window.begin(at: 200)
    window.recordInteraction(at: 201)
    XCTAssertTrue(window.detectsTakeover())
    window.end()

    window.begin(at: 400)
    XCTAssertFalse(window.detectsTakeover(), "action 2 must start clean")
  }
}
