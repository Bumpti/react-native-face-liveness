import AVFoundation
import ExpoModulesCore

struct FaceLivenessCredentialsRecord: Record {
  @Field var accessKeyId: String = ""
  @Field var secretAccessKey: String = ""
  @Field var sessionToken: String = ""
  @Field var expiration: String = ""
}

public class FaceLivenessModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FaceLiveness")

    AsyncFunction("getCameraPermissionAsync") { () -> [String: Any] in
      return Self.permissionResponse(AVCaptureDevice.authorizationStatus(for: .video))
    }

    AsyncFunction("requestCameraPermissionAsync") { (promise: Promise) in
      guard AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined else {
        promise.resolve(Self.permissionResponse(AVCaptureDevice.authorizationStatus(for: .video)))
        return
      }
      AVCaptureDevice.requestAccess(for: .video) { _ in
        promise.resolve(Self.permissionResponse(AVCaptureDevice.authorizationStatus(for: .video)))
      }
    }

    View(FaceLivenessExpoView.self) {
      Events("onComplete", "onError")

      Prop("sessionId") { (view: FaceLivenessExpoView, value: String?) in
        view.sessionId = value
      }
      Prop("region") { (view: FaceLivenessExpoView, value: String?) in
        view.region = value
      }
      Prop("credentials") { (view: FaceLivenessExpoView, value: FaceLivenessCredentialsRecord?) in
        view.credentials = value
      }

      OnViewDidUpdateProps { (view: FaceLivenessExpoView) in
        view.render()
      }
    }
  }

  /// Same shape as Expo's permission responses on Android.
  static func permissionResponse(_ status: AVAuthorizationStatus) -> [String: Any] {
    switch status {
    case .authorized:
      return ["status": "granted", "canAskAgain": true]
    case .notDetermined:
      return ["status": "undetermined", "canAskAgain": true]
    default:
      // iOS never shows the prompt again after a refusal or a restriction.
      return ["status": "denied", "canAskAgain": false]
    }
  }
}
