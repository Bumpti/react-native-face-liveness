import AWSPluginsCore
import ExpoModulesCore
import FaceLiveness
import SwiftUI

private struct StaticTemporaryCredentials: AWSTemporaryCredentials {
  let accessKeyId: String
  let secretAccessKey: String
  let sessionToken: String
  let expiration: Date
}

/// Hands the SDK the credentials the backend issued; it asks once per check.
private struct StaticCredentialsProvider: AWSPluginsCore.AWSCredentialsProvider {
  let credentials: StaticTemporaryCredentials

  func fetchAWSCredentials() async throws -> AWSPluginsCore.AWSCredentials {
    credentials
  }
}

final class FaceLivenessExpoView: ExpoView {
  let onComplete = EventDispatcher()
  let onError = EventDispatcher()

  var sessionId: String?
  var region: String?
  var credentials: FaceLivenessCredentialsRecord?

  private var hosting: UIHostingController<AnyView>?
  private var renderedSessionId: String?
  private var settledSessionId: String?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
  }

  /// Mounts the detector once every prop is set, and again for each new session.
  func render() {
    guard let sessionId, let region, let credentials, sessionId != renderedSessionId else { return }
    renderedSessionId = sessionId

    let provider = StaticCredentialsProvider(
      credentials: StaticTemporaryCredentials(
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
        expiration: Self.parseDate(credentials.expiration)
      )
    )
    let detector = FaceLivenessDetectorView(
      sessionID: sessionId,
      credentialsProvider: provider,
      region: region,
      disableStartView: true,
      isPresented: .constant(true),
      onCompletion: { [weak self] result in
        DispatchQueue.main.async { self?.settle(sessionId: sessionId, result: result) }
      }
    )

    detachHosting()
    let controller = UIHostingController(rootView: AnyView(detector))
    controller.view.backgroundColor = .clear
    controller.view.frame = bounds
    controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    hosting = controller
    attachHosting()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      detachHosting()
    } else {
      attachHosting()
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    hosting?.view.frame = bounds
  }

  private func attachHosting() {
    guard let hosting, window != nil, hosting.view.superview == nil else { return }
    // The detector drives the camera from SwiftUI lifecycle callbacks, so its
    // controller joins the view-controller hierarchy.
    if let parent = parentViewController {
      parent.addChild(hosting)
      addSubview(hosting.view)
      hosting.didMove(toParent: parent)
    } else {
      addSubview(hosting.view)
    }
  }

  private func detachHosting() {
    guard let hosting else { return }
    hosting.willMove(toParent: nil)
    hosting.view.removeFromSuperview()
    hosting.removeFromParent()
  }

  private var parentViewController: UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let controller = next as? UIViewController { return controller }
      responder = next
    }
    return nil
  }

  private func settle(sessionId: String, result: Result<Void, FaceLivenessDetectionError>) {
    guard settledSessionId != sessionId else { return }
    settledSessionId = sessionId
    switch result {
    case .success:
      onComplete([:])
    case .failure(let error):
      onError(["code": Self.code(for: error), "message": error.message])
    }
  }

  static func code(for error: FaceLivenessDetectionError) -> String {
    switch error {
    case .userCancelled: return "cancelled"
    case .cameraPermissionDenied: return "camera_denied"
    case .cameraNotAvailable: return "camera_unavailable"
    case .accessDenied, .invalidSignature: return "access_denied"
    case .sessionNotFound: return "session_not_found"
    case .sessionTimedOut, .faceInOvalMatchExceededTimeLimitError: return "timeout"
    case .countdownNoFace: return "face_not_detected"
    case .countdownMultipleFaces: return "multiple_faces"
    case .countdownFaceTooClose: return "face_too_close"
    case .socketClosed, .sessionInterrupted: return "network"
    case .internalServer, .throttling, .serviceQuotaExceeded, .serviceUnavailable: return "service_unavailable"
    default: return "unknown"
    }
  }

  private static func parseDate(_ value: String) -> Date {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = withFraction.date(from: value) { return date }
    return ISO8601DateFormatter().date(from: value) ?? Date(timeIntervalSinceNow: 900)
  }
}
