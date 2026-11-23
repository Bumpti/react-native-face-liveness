import { requireNativeViewManager } from "expo-modules-core";
import type { ComponentType } from "react";
import type { NativeSyntheticEvent } from "react-native";

import type { FaceLivenessError, FaceLivenessViewProps } from "./FaceLiveness.types";

type NativeProps = Omit<FaceLivenessViewProps, "onComplete" | "onError"> & {
  onComplete?: () => void;
  onError?: (event: NativeSyntheticEvent<FaceLivenessError>) => void;
};

const NativeView: ComponentType<NativeProps> = requireNativeViewManager("FaceLiveness");

/**
 * The AWS Face Liveness camera check, full size of its parent. Render it with a
 * fresh `sessionId` for every attempt; the vendor's start screen is disabled, so
 * the app shows its own intro first.
 */
export default function FaceLivenessView({ onError, ...props }: FaceLivenessViewProps) {
  return (
    <NativeView
      {...props}
      onError={onError ? (event) => onError(event.nativeEvent) : undefined}
    />
  );
}
