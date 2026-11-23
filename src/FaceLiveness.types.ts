import type { ViewProps } from "react-native";

/** Short-lived AWS credentials issued by the app's backend (STS AssumeRole). */
export type FaceLivenessCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  /** ISO-8601 instant, e.g. "2026-11-23T03:00:00Z". */
  expiration: string;
};

/** Every way a check can end other than `onComplete`. Stable across iOS and Android. */
export type FaceLivenessErrorCode =
  | "cancelled"
  | "camera_denied"
  | "camera_unavailable"
  | "access_denied"
  | "session_not_found"
  | "timeout"
  | "face_not_detected"
  | "multiple_faces"
  | "face_too_close"
  | "network"
  | "service_unavailable"
  | "unknown";

export type FaceLivenessError = {
  code: FaceLivenessErrorCode;
  /** The native SDK's message, for logs only; never shown to people. */
  message: string;
};

export type FaceLivenessViewProps = ViewProps & {
  /** A session created by the backend (CreateFaceLivenessSession). One check per session. */
  sessionId: string;
  /** The AWS region the session was created in, e.g. "us-east-1". */
  region: string;
  credentials: FaceLivenessCredentials;
  /** The check ended; the backend reads the result (GetFaceLivenessSessionResults). */
  onComplete?: () => void;
  onError?: (error: FaceLivenessError) => void;
};

/**
 * - `granted`: the camera can be used.
 * - `denied`: not granted yet, and the OS can still ask.
 * - `blocked`: refused for good; only the system Settings can change it.
 */
export type CameraPermissionStatus = "granted" | "denied" | "blocked";
