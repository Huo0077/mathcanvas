import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Configures the Tauri-generated Android manifest after `tauri android init`.
 *
 * Ensures the main activity resizes when the soft keyboard opens so the AI
 * assistant input and inspector fields stay visible on phones/tablets.
 */
export function patchAndroidManifest(manifestXml) {
  if (!manifestXml.includes("<activity")) {
    throw new Error("AndroidManifest.xml does not contain an <activity element.");
  }

  if (/android:windowSoftInputMode\s*=/.test(manifestXml)) {
    return manifestXml.replace(
      /android:windowSoftInputMode\s*=\s*"[^"]*"/,
      'android:windowSoftInputMode="adjustResize"'
    );
  }

  return manifestXml.replace(
    /<activity\b/,
    '<activity\n            android:windowSoftInputMode="adjustResize"'
  );
}

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(currentFile);

if (isMain) {
  const manifestPath = resolve(
    currentDir,
    "../apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml"
  );
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing generated AndroidManifest.xml at ${manifestPath}`);
  }
  const current = readFileSync(manifestPath, "utf8");
  const updated = patchAndroidManifest(current);
  if (updated !== current) {
    writeFileSync(manifestPath, updated, "utf8");
    console.log(`Updated android:windowSoftInputMode="adjustResize" in ${manifestPath}`);
  } else {
    console.log(`AndroidManifest.xml already configured at ${manifestPath}`);
  }
}
