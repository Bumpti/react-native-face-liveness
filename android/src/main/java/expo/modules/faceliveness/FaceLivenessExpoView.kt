package expo.modules.faceliveness

import android.content.Context
import android.view.ViewGroup
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import com.amplifyframework.auth.AWSCredentials
import com.amplifyframework.auth.AWSCredentialsProvider
import com.amplifyframework.auth.AuthException
import com.amplifyframework.core.Consumer
import com.amplifyframework.ui.liveness.model.FaceLivenessDetectionException
import com.amplifyframework.ui.liveness.ui.FaceLivenessDetector
import com.amplifyframework.ui.liveness.ui.LivenessColorScheme
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.time.Instant

private data class LivenessSession(
  val sessionId: String,
  val region: String,
  val credentials: AWSCredentials
)

/** Hands the SDK the credentials the backend issued; it asks once per check. */
private class StaticCredentialsProvider(
  private val credentials: AWSCredentials
) : AWSCredentialsProvider<AWSCredentials> {
  override fun fetchAWSCredentials(onSuccess: Consumer<AWSCredentials>, onError: Consumer<AuthException>) {
    onSuccess.accept(credentials)
  }
}

class FaceLivenessExpoView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // The ComposeView child is laid out by Android, not by React Native.
  override val shouldUseAndroidLayout = true

  private val onComplete by EventDispatcher()
  private val onError by EventDispatcher()

  var sessionId: String? = null
  var region: String? = null
  var credentials: FaceLivenessCredentialsRecord? = null

  private var session by mutableStateOf<LivenessSession?>(null)
  private var settledSessionId: String? = null

  init {
    val composeView = ComposeView(context).apply {
      setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindow)
      setContent {
        val current = session
        if (current != null) {
          key(current.sessionId) {
            MaterialTheme(colorScheme = LivenessColorScheme.default()) {
              FaceLivenessDetector(
                sessionId = current.sessionId,
                region = current.region,
                credentialsProvider = StaticCredentialsProvider(current.credentials),
                disableStartView = true,
                onComplete = {
                  settle(current.sessionId) { onComplete(mapOf()) }
                },
                onError = { error ->
                  settle(current.sessionId) {
                    onError(mapOf("code" to errorCode(error), "message" to (error.message ?: "")))
                  }
                }
              )
            }
          }
        }
      }
    }
    addView(
      composeView,
      ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    )
  }

  /** Mounts the detector once every prop is set, and again for each new session. */
  fun render() {
    val id = sessionId ?: return
    val awsRegion = region ?: return
    val record = credentials ?: return
    if (session?.sessionId == id) return
    val expiration = runCatching { Instant.parse(record.expiration).epochSecond }
      .getOrElse { Instant.now().plusSeconds(900).epochSecond }
    val awsCredentials = AWSCredentials.createAWSCredentials(
      record.accessKeyId,
      record.secretAccessKey,
      record.sessionToken,
      expiration
    ) ?: return
    session = LivenessSession(id, awsRegion, awsCredentials)
  }

  private fun settle(id: String, emit: () -> Unit) {
    post {
      if (settledSessionId == id) return@post
      settledSessionId = id
      emit()
    }
  }
}

internal fun errorCode(error: FaceLivenessDetectionException): String = when (error) {
  is FaceLivenessDetectionException.UserCancelledException -> "cancelled"
  is FaceLivenessDetectionException.CameraPermissionDeniedException -> "camera_denied"
  is FaceLivenessDetectionException.AccessDeniedException -> "access_denied"
  is FaceLivenessDetectionException.SessionNotFoundException -> "session_not_found"
  is FaceLivenessDetectionException.SessionTimedOutException -> "timeout"
  is FaceLivenessDetectionException.SessionInterruptedException -> "network"
  // FaceInOvalMatchExceededTimeLimitException is internal to the SDK.
  else -> if (error.javaClass.simpleName.contains("FaceInOval")) "timeout" else "unknown"
}
