import { requireNativeModule } from "expo-modules-core";

import type { CameraPermissionStatus } from "./FaceLiveness.types";

type NativePermissionResponse = {
  status: "granted" | "denied" | "undetermined";
  canAskAgain: boolean;
};

type FaceLivenessNativeModule = {
  getCameraPermissionAsync(): Promise<NativePermissionResponse>;
  requestCameraPermissionAsync(): Promise<NativePermissionResponse>;
};

const native = requireNativeModule<FaceLivenessNativeModule>("FaceLiveness");

export function toCameraPermissionStatus(response: NativePermissionResponse): CameraPermissionStatus {
  if (response.status === "granted") return "granted";
  return response.canAskAgain ? "denied" : "blocked";
}

export async function getCameraPermissionStatus(): Promise<CameraPermissionStatus> {
  return toCameraPermissionStatus(await native.getCameraPermissionAsync());
}

/** Shows the OS prompt when it still can; otherwise resolves the current state. */
export async function requestCameraPermission(): Promise<CameraPermissionStatus> {
  return toCameraPermissionStatus(await native.requestCameraPermissionAsync());
}
