#!/usr/bin/env node
// Writes the AWS liveness SDKs' camera-screen translations from localization/strings.json:
//   iOS:     ios/Localization/<lang>.lproj/Localizable.strings (copied into the app's main
//            bundle by the podspec; the SDK reads the main bundle first)
//   Android: android/src/main/res/values-<qualifier>/strings.xml (this library's resources
//            override the SDK's, which this library depends on)
// Run after editing the JSON: node scripts/gen-strings.mjs
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(readFileSync(join(root, "localization/strings.json"), "utf8"));

// iOS key (amplify-ui-swift-liveness 1.6.x) → concept. A literal " " stays as is.
const IOS = {
  amplify_ui_liveness_get_ready_page_title: "page_title",
  amplify_ui_liveness_get_ready_photosensitivity_title: "photo_title",
  amplify_ui_liveness_get_ready_photosensitivity_description: "photo_desc",
  amplify_ui_liveness_get_ready_photosensitivity_icon_a11y: "photo_icon",
  amplify_ui_liveness_get_ready_photosensitivity_dialog_title: "photo_title",
  amplify_ui_liveness_get_ready_photosensitivity_dialog_description: "photo_dialog_desc",
  amplify_ui_liveness_get_ready_begin_check: "begin",
  amplify_ui_liveness_challenge_recording_indicator_label: "rec",
  amplify_ui_liveness_challenge_instruction_hold_face_during_countdown: "hold_countdown",
  amplify_ui_liveness_challenge_instruction_hold_face_during_freshness: "hold_lights",
  amplify_ui_liveness_challenge_instruction_move_face_back: "move_back",
  amplify_ui_liveness_challenge_instruction_move_face_closer: "move_closer",
  amplify_ui_liveness_challenge_instruction_move_face_in_front_of_camera: "face_in_front",
  amplify_ui_liveness_challenge_instruction_multiple_faces_detected: "one_face",
  amplify_ui_liveness_challenge_instruction_hold_still: "hold_still",
  amplify_ui_liveness_challenge_connecting: "connecting",
  amplify_ui_liveness_challenge_verifying: "verifying",
  amplify_ui_liveness_challenge_cancel_a11y: "cancel",
  amplify_ui_liveness_camera_setting_alert_title: "cam_alert_title",
  amplify_ui_liveness_camera_setting_alert_message: "cam_alert_msg",
  amplify_ui_liveness_camera_setting_alert_update_setting_button_text: "cam_alert_update",
  amplify_ui_liveness_camera_setting_alert_not_now_button_text: "cam_alert_not_now",
  amplify_ui_liveness_close_button_a11y: "close",
  amplify_ui_liveness_orientation_prompt_title: "orient_title",
  amplify_ui_liveness_orientation_prompt_description: "orient_desc",
  amplify_ui_liveness_center_your_face_text: "center_face",
  amplify_ui_liveness_camera_permission_page_title: "page_title",
  amplify_ui_liveness_camera_permission_button_title: "perm_button_title",
  amplify_ui_liveness_camera_permission_button_header: "perm_header",
  amplify_ui_liveness_camera_permission_button_description: "perm_desc",
  amplify_ui_liveness_face_not_prepared_reason_pendingCheck: " ",
  amplify_ui_liveness_face_not_prepared_reason_not_in_oval: "fit_oval",
  amplify_ui_liveness_face_not_prepared_reason_move_face_closer: "move_closer",
  amplify_ui_liveness_face_not_prepared_reason_move_face_right: "move_right",
  amplify_ui_liveness_face_not_prepared_reason_move_face_left: "move_left",
  amplify_ui_liveness_face_not_prepared_reason_move_to_dimmer_area: "dimmer",
  amplify_ui_liveness_face_not_prepared_reason_move_to_brighter_area: "brighter",
  amplify_ui_liveness_face_not_prepared_reason_no_face: "face_in_front",
  amplify_ui_liveness_face_not_prepared_reason_multiple_faces: "one_face",
  amplify_ui_liveness_face_not_prepared_reason_face_too_close: "farther",
};

// Android key (com.amplifyframework.ui:liveness 1.13.x) → concept.
const ANDROID = {
  amplify_ui_liveness_get_ready_center_face_label: "center_face",
  amplify_ui_liveness_get_ready_photosensitivity_title: "photo_title",
  amplify_ui_liveness_get_ready_photosensitivity_description: "photo_desc",
  amplify_ui_liveness_get_ready_a11y_photosensitivity_icon_content_description: "photo_icon",
  amplify_ui_liveness_get_ready_photosensitivity_dialog_title: "photo_title",
  amplify_ui_liveness_get_ready_photosensitivity_dialog_description: "photo_dialog_desc",
  amplify_ui_liveness_get_ready_photosensitivity_dialog_dismiss: "photo_dismiss",
  amplify_ui_liveness_get_ready_begin_check: "begin",
  amplify_ui_liveness_challenge_recording_indicator_label: "rec",
  amplify_ui_liveness_challenge_instruction_hold_face_during_freshness: "hold_still",
  amplify_ui_liveness_challenge_instruction_move_face_further: "move_back",
  amplify_ui_liveness_challenge_instruction_move_face_closer: "move_closer",
  amplify_ui_liveness_challenge_instruction_move_face: "face_in_front",
  amplify_ui_liveness_challenge_instruction_multiple_faces_detected: "one_face",
  amplify_ui_liveness_challenge_connecting: "connecting",
  amplify_ui_liveness_challenge_verifying: "verifying",
  amplify_ui_liveness_challenge_a11y_cancel_content_description: "cancel",
};

// iOS folder name → Android resource qualifiers (pt-BR also serves other Portuguese locales).
const LANGS = {
  "pt-BR": ["pt-rBR", "pt"],
  es: ["es"],
  fr: ["fr"],
  de: ["de"],
  it: ["it"],
  nl: ["nl"],
  da: ["da"],
  nb: ["nb"],
  sv: ["sv"],
  tr: ["tr"],
  ja: ["ja"],
  hi: ["hi"],
  te: ["te"],
};

const text = (lang, concept) => {
  if (concept === " ") return " ";
  const value = source[lang]?.[concept];
  if (!value) throw new Error(`missing ${lang}.${concept}`);
  return value;
};

const iosEscape = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const androidEscape = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "\\'").replace(/"/g, '\\"');

rmSync(join(root, "ios/Localization"), { recursive: true, force: true });
for (const [lang, qualifiers] of Object.entries(LANGS)) {
  const iosFile = join(root, "ios/Localization", `${lang}.lproj`, "Localizable.strings");
  mkdirSync(dirname(iosFile), { recursive: true });
  const iosBody = Object.entries(IOS).map(([key, concept]) => `"${key}" = "${iosEscape(text(lang, concept))}";`);
  writeFileSync(iosFile, `/* Generated by scripts/gen-strings.mjs from localization/strings.json. */\n${iosBody.join("\n")}\n`);

  const androidBody = Object.entries(ANDROID)
    .map(([key, concept]) => `  <string name="${key}">${androidEscape(text(lang, concept))}</string>`)
    .join("\n");
  for (const qualifier of qualifiers) {
    const file = join(root, "android/src/main/res", `values-${qualifier}`, "strings.xml");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generated by scripts/gen-strings.mjs from localization/strings.json. -->\n<resources>\n${androidBody}\n</resources>\n`,
    );
  }
}
console.log(`wrote ${Object.keys(LANGS).length} languages`);
