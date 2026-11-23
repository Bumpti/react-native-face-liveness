package expo.modules.faceliveness

import android.Manifest
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class FaceLivenessCredentialsRecord : Record {
  @Field val accessKeyId: String = ""
  @Field val secretAccessKey: String = ""
  @Field val sessionToken: String = ""
  @Field val expiration: String = ""
}

class FaceLivenessModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FaceLiveness")

    AsyncFunction("getCameraPermissionAsync") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }

    AsyncFunction("requestCameraPermissionAsync") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.CAMERA)
    }

    View(FaceLivenessExpoView::class) {
      Events("onComplete", "onError")

      Prop("sessionId") { view: FaceLivenessExpoView, value: String? ->
        view.sessionId = value
      }
      Prop("region") { view: FaceLivenessExpoView, value: String? ->
        view.region = value
      }
      Prop("credentials") { view: FaceLivenessExpoView, value: FaceLivenessCredentialsRecord? ->
        view.credentials = value
      }

      OnViewDidUpdateProps { view: FaceLivenessExpoView ->
        view.render()
      }
    }
  }
}
