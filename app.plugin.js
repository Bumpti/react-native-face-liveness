// Resolve the app's own copy: this package has no node_modules of its own, and
// a symlinked or git-installed copy must not look next to itself.
const { createRunOncePlugin, withAppBuildGradle, withInfoPlist } = require(
  require.resolve("expo/config-plugins", { paths: [process.cwd(), __dirname] })
);

const pkg = require("./package.json");

const DEFAULT_CAMERA_TEXT = "Allow $(PRODUCT_NAME) to use the camera to verify your profile.";
const DESUGAR_LIB = "com.android.tools:desugar_jdk_libs:2.1.5";

/**
 * Turns on core library desugaring in the app module: the Amplify Android
 * libraries the liveness SDK depends on (core, aws-core, aws-predictions)
 * require it, and AGP refuses the build otherwise (checkDebugAarMetadata).
 * Idempotent: an app that already has it keeps its own setup.
 */
function withDesugaring(contents) {
  let next = contents;
  if (!/coreLibraryDesugaringEnabled\s+true/.test(next)) {
    if (/compileOptions\s*\{/.test(next)) {
      next = next.replace(/compileOptions\s*\{/, (m) => `${m}\n        coreLibraryDesugaringEnabled true`);
    } else {
      next = next.replace(/android\s*\{/, (m) => `${m}\n    compileOptions {\n        coreLibraryDesugaringEnabled true\n    }`);
    }
  }
  if (!/coreLibraryDesugaring\s*\(?\s*["']com\.android\.tools:desugar_jdk_libs/.test(next)) {
    next = next.replace(/\ndependencies\s*\{/, (m) => `${m}\n    coreLibraryDesugaring("${DESUGAR_LIB}")`);
  }
  return next;
}

/**
 * The rest of the native setup lives in the module itself (Swift package in
 * the podspec, Compose in android/build.gradle, CAMERA in the library
 * manifest). The plugin makes sure iOS has a camera usage text, never
 * replacing the app's own, and turns on desugaring for Android.
 *
 * Expo SDK 54 defaults already meet the SDKs' floors: iOS 15.1, Android minSdk 24
 * and compileSdk 36.
 */
function withFaceLiveness(config, props = {}) {
  config = withInfoPlist(config, (cfg) => {
    if (!cfg.modResults.NSCameraUsageDescription) {
      cfg.modResults.NSCameraUsageDescription = props.cameraPermission || DEFAULT_CAMERA_TEXT;
    }
    return cfg;
  });
  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === "groovy") cfg.modResults.contents = withDesugaring(cfg.modResults.contents);
    return cfg;
  });
  return config;
}

module.exports = createRunOncePlugin(withFaceLiveness, pkg.name, pkg.version);
module.exports.withDesugaring = withDesugaring;
