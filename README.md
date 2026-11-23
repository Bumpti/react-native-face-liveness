# react-native-face-liveness

AWS Rekognition Face Liveness for Expo and React Native apps (iOS and Android), plus
TypeScript helpers for the backend (Deno / Supabase edge functions).

The package is the **plumbing only**. Each app keeps its own:
- screens and copy (intro, consent, results);
- thresholds, attempt limits and data model;
- rules (who must verify, what a pass grants).

## What's inside

| Path | What |
|---|---|
| `src/` | `FaceLivenessView`, `getCameraPermissionStatus`, `requestCameraPermission`, types |
| `ios/` | Expo module (Swift). Hosts AWS `FaceLivenessDetectorView` (Swift package `amplify-ui-swift-liveness`, iOS 15+) |
| `android/` | Expo module (Kotlin). Hosts AWS `FaceLivenessDetector` (`com.amplifyframework.ui:liveness` 1.12.0, Compose, minSdk 24) |
| `app.plugin.js` | Config plugin: sets the iOS camera text only when the app has none |
| `server/mod.ts` | Session, results, STS client credentials, face search, index and delete, `livenessVerdict` |
| `scripts/aws-setup.sh` | Idempotent AWS setup per app (collection, server user, client role, edge secrets) |
| `localization/strings.json` | Camera-screen translations (13 languages). Run `node scripts/gen-strings.mjs` after editing it |
| `example/dev-server.ts` | Local backend to try the module on a phone |

## How a check works

1. **The app asks its backend to start.** The backend:
   - calls `createLivenessSession`;
   - calls `issueClientCredentials` (STS `AssumeRole` on `<app>-liveness-client`, 15 minutes, only `rekognition:StartFaceLivenessSession`);
   - returns `{ sessionId, region, credentials }`.
2. **The app renders `FaceLivenessView`** with those values. The AWS start screen is disabled; show your own intro first.
3. **On `onComplete`, the app asks the backend to finish.** The backend:
   - calls `getLivenessResult`, then `livenessVerdict(result, minConfidence)`;
   - uses `referenceImage` with `searchFacesByImage` / `indexFace` as its rules require.

There is no webhook: the backend pulls the result. A session id works for one check and expires
3 minutes after it is sent.

## App side

```jsonc
// package.json
"react-native-face-liveness": "github:Bumpti/react-native-face-liveness#v0.1.0"
```

```js
// app.config.js
plugins: [["react-native-face-liveness", { cameraPermission: "Allow $(PRODUCT_NAME) to use the camera…" }]]
```

```tsx
import { FaceLivenessView, requestCameraPermission } from "react-native-face-liveness";

if ((await requestCameraPermission()) !== "granted") {
  // explain, or open Settings when "blocked"
}

<FaceLivenessView
  style={StyleSheet.absoluteFill}
  sessionId={session.sessionId}
  region={session.region}
  credentials={session.credentials}
  onComplete={() => finish(session.sessionId)}
  onError={({ code }) => handle(code)} // cancelled | camera_denied | access_denied | timeout | network | …
/>
```

- **Native build.** This is a native module: rebuild the dev client after adding it. It does not run in Expo Go.
- **iOS.** The Swift package is added to the pod through React Native's `spm_dependency`, so run `pod install` / `expo prebuild`.
- **xcodebuild from the command line (CI).**
  - Pass `-skipPackagePluginValidation -skipMacroValidation`, because the AWS Swift SDK runs a Smithy build-tool plugin that Xcode otherwise asks to trust. Alternatively, set `defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation -bool YES` and `IDESkipMacroFingerprintValidation -bool YES` on the runner.
  - Do not pass `-sdk iphonesimulator`: it builds the plugin's host tool for the simulator and fails with "SmithyCodegenCLI cannot be found". Use `-destination` only.
  - The first build fetches the AWS Swift SDK graph: several GB in DerivedData/SourcePackages.
- **Android Kotlin.** The app needs Kotlin 2.2, for example `expo-build-properties` → `android.kotlinVersion: "2.2.0"`. The module pins liveness 1.12.0, built with Kotlin 2.2. Liveness 1.13 pulls kotlin-stdlib 2.3 and kotlinx-serialization 1.11, which neither Kotlin 2.1.20 (the Expo SDK 54 default) nor 2.2 can read: "incompatible version of Kotlin", then an internal compiler error. The plugin also turns on core library desugaring, which the Amplify core libraries require.
- **Translations.** The SDK reads its strings from the app's main bundle first, so the podspec copies `ios/Localization/*.lproj` there. If the app ships its own `Localizable.strings`, merge the keys into it instead.

## Server side

Copy `server/mod.ts` into the backend, for example `supabase/functions/_shared/face-liveness/aws.ts`. Keep a
header naming the tag it came from. It imports only `npm:aws4fetch`.

```ts
const cfg = { accessKeyId, secretAccessKey, region: "us-east-1" };
const sessionId = await createLivenessSession(cfg);
const credentials = await issueClientCredentials(cfg, { roleArn, sessionName: userId });
// later
const result = await getLivenessResult(cfg, sessionId);
const verdict = livenessVerdict(result, 80); // approved | declined | retry | failed | pending
```

AWS's guidance on the threshold: 50–60 stops presentation attacks (photos, screens), and 80–90 also
stops injected and deepfake video.

## AWS setup

```sh
AWS_PROFILE=<profile> scripts/aws-setup.sh <app> us-east-1 --supabase-project <ref>
```

This creates `<app>-faces`, `<app>-liveness-server` and `<app>-liveness-client`. It stores in the Supabase project:
- `FACE_LIVENESS_AWS_ACCESS_KEY_ID` and `FACE_LIVENESS_AWS_SECRET_ACCESS_KEY` (only when the user has no key yet);
- `FACE_LIVENESS_AWS_REGION`, `FACE_LIVENESS_CLIENT_ROLE_ARN` and `FACE_LIVENESS_COLLECTION_ID`.

It never prints a secret.

**The account must be on the AWS paid plan.** The free plan's service control policy denies every Rekognition call.

## Trying it on a phone

```sh
FACE_LIVENESS_APP=<app> AWS_PROFILE=<profile> deno run --node-modules-dir=none --allow-net --allow-run=aws --allow-env --allow-sys=networkInterfaces example/dev-server.ts
```

Then point a test screen at the printed LAN address: `POST /start`, render the view, then `POST /finish`.

## Tests

```sh
deno task test
```

## Versions

Releases are git tags (`v0.1.0`, …). Apps pin a tag.

| package | iOS SDK | Android SDK |
|---|---|---|
| 0.1.0 | amplify-ui-swift-liveness ≥ 1.6.0 < 2 | com.amplifyframework.ui:liveness 1.12.0 (1.13 needs Kotlin 2.3) |

## License

MIT. The native AWS liveness SDKs it uses (Amplify UI) are Apache-2.0, under their own terms.
