import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NETWORK_SECURITY_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="true">localhost</domain>
    </domain-config>
</network-security-config>
`;

export const FILE_PATHS_XML = `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <external-path name="my_images" path="." />
    <cache-path name="my_cache_images" path="." />
    <files-path name="exports" path="exports/" />
</paths>
`;

export const LIGHT_THEME_XML = `<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="Theme.mathcanvas_desktop" parent="Theme.MaterialComponents.DayNight.NoActionBar">
        <item name="android:windowBackground">#FFFFFF</item>
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:navigationBarColor">@android:color/transparent</item>
    </style>
</resources>
`;

export const PROGUARD_BRIDGE_RULE = `# MathCanvas Android WebView export/share bridge
-keepattributes *Annotation*
-keep class com.mathcanvas.desktop.MathCanvasAndroidBridge {
    public *;
}
`;

export const MAIN_ACTIVITY_KT = `package com.mathcanvas.desktop

import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

private const val EXPORT_LOG_TAG = "MathCanvas"
private val ALLOWED_EXPORT_EXTENSIONS = setOf("mgeo", "svg", "png", "csv", "dxf", "pdf", "html")

class MathCanvasAndroidBridge(private val activity: MainActivity) {
  @JavascriptInterface
  fun deliverExport(fileName: String, mimeType: String, share: Boolean): String {
    val result = JSONObject()
    try {
      val cleanName = fileName.trim()
      if (cleanName.isEmpty() || cleanName.length > 160 || cleanName.contains("/") || cleanName.contains("\\\\") || cleanName.contains("..")) {
        return result.put("ok", false).put("error", "invalid_file_name").toString()
      }
      val ext = cleanName.substringAfterLast('.', "").lowercase()
      if (ext !in ALLOWED_EXPORT_EXTENSIONS) {
        return result.put("ok", false).put("error", "disallowed_extension").toString()
      }

      val dataRoot = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) activity.dataDir else File(activity.applicationInfo.dataDir)
      val candidateRoots = listOf(File(dataRoot, "exports"), File(activity.filesDir, "exports"))
      var sourceFile: File? = null
      for (root in candidateRoots) {
        val canonicalRoot = root.canonicalFile
        val candidate = File(canonicalRoot, cleanName).canonicalFile
        if (candidate.path.startsWith(canonicalRoot.path + File.separator) && candidate.isFile) {
          sourceFile = candidate
          break
        }
      }
      if (sourceFile == null) {
        Log.e(EXPORT_LOG_TAG, "deliverExport(\${cleanName}): export_not_found")
        return result.put("ok", false).put("error", "export_not_found").toString()
      }

      val safeMime = mimeType.trim().ifEmpty { "application/octet-stream" }
      val savedToDownloads = copyToPublicDownloads(sourceFile, cleanName, safeMime)
      var shared = false
      if (share) {
        shared = launchShareSheet(sourceFile, cleanName, safeMime)
      }

      result
        .put("ok", true)
        .put("fileName", cleanName)
        .put("savedToDownloads", savedToDownloads)
        .put("shared", shared)
      Log.i(EXPORT_LOG_TAG, "deliverExport(\${cleanName}) downloads=\${savedToDownloads} shared=\${shared}")
      return result.toString()
    } catch (error: Throwable) {
      Log.e(EXPORT_LOG_TAG, "deliverExport failed: \${error.message}", error)
      return result.put("ok", false).put("error", error.message ?: "deliver_export_failed").toString()
    }
  }

  private fun copyToPublicDownloads(sourceFile: File, fileName: String, mimeType: String): Boolean {
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, fileName)
          put(MediaStore.Downloads.MIME_TYPE, mimeType)
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MathCanvas")
          put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = activity.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return false
        try {
          resolver.openOutputStream(uri)?.use { out ->
            FileInputStream(sourceFile).use { input -> input.copyTo(out) }
          } ?: return false
          values.clear()
          values.put(MediaStore.Downloads.IS_PENDING, 0)
          resolver.update(uri, values, null, null)
          true
        } catch (error: Throwable) {
          resolver.delete(uri, null, null)
          throw error
        }
      } else {
        @Suppress("DEPRECATION")
        val downloadsRoot = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val targetDir = File(downloadsRoot, "MathCanvas")
        if (!targetDir.exists()) targetDir.mkdirs()
        val targetFile = File(targetDir, fileName)
        FileInputStream(sourceFile).use { input ->
          FileOutputStream(targetFile).use { out -> input.copyTo(out) }
        }
        true
      }
    } catch (error: Throwable) {
      Log.e(EXPORT_LOG_TAG, "copyToPublicDownloads failed: \${error.message}", error)
      false
    }
  }

  private fun launchShareSheet(sourceFile: File, fileName: String, mimeType: String): Boolean {
    return try {
      val shareDir = File(activity.cacheDir, "exports")
      if (!shareDir.exists()) shareDir.mkdirs()
      val shareFile = File(shareDir, fileName)
      FileInputStream(sourceFile).use { input ->
        FileOutputStream(shareFile).use { out -> input.copyTo(out) }
      }
      val authority = "\${activity.packageName}.fileprovider"
      val contentUri = FileProvider.getUriForFile(activity, authority, shareFile)
      val sendIntent = Intent(Intent.ACTION_SEND).apply {
        type = mimeType
        putExtra(Intent.EXTRA_STREAM, contentUri)
        putExtra(Intent.EXTRA_TITLE, fileName)
        putExtra(Intent.EXTRA_SUBJECT, fileName)
        clipData = ClipData.newRawUri(fileName, contentUri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(sendIntent, fileName).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      activity.runOnUiThread {
        try {
          activity.startActivity(chooser)
        } catch (error: Throwable) {
          Log.e(EXPORT_LOG_TAG, "startActivity(chooser) failed: \${error.message}", error)
        }
      }
      true
    } catch (error: Throwable) {
      Log.e(EXPORT_LOG_TAG, "launchShareSheet failed: \${error.message}", error)
      false
    }
  }
}

class MainActivity : TauriActivity() {
  private var bridgeAttached = false

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    if (!bridgeAttached) {
      webView.addJavascriptInterface(MathCanvasAndroidBridge(this), "MathCanvasAndroid")
      bridgeAttached = true
      Log.i(EXPORT_LOG_TAG, "MathCanvasAndroid bridge attached")
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.light(Color.WHITE, Color.WHITE),
      navigationBarStyle = SystemBarStyle.light(Color.WHITE, Color.WHITE)
    )
    super.onCreate(savedInstanceState)

    val contentView = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(contentView) { view, windowInsets ->
      val bars = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      windowInsets
    }
    ViewCompat.requestApplyInsets(contentView)

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val webView = findWebView(window.decorView)
        if (webView == null) {
          isEnabled = false
          onBackPressedDispatcher.onBackPressed()
          isEnabled = true
          return
        }
        webView.evaluateJavascript(
          "(function(){ try { return !!(window.__mathcanvasHandleAndroidBack && window.__mathcanvasHandleAndroidBack()); } catch (_) { return false; } })()"
        ) { result ->
          if (result != "true") {
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
          }
        }
      }
    })
  }

  private fun findWebView(view: View?): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val found = findWebView(view.getChildAt(i))
        if (found != null) return found
      }
    }
    return null
  }
}
`;

function ensureTagAttribute(xml, tagName, attrName, attrValue) {
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>`, "s");
  const match = tagPattern.exec(xml);
  if (!match) {
    throw new Error(`AndroidManifest.xml does not contain a <${tagName} element.`);
  }
  const openTag = match[0];
  const attrPattern = new RegExp(`${attrName}\\s*=\\s*"[^"]*"`);
  const updatedOpenTag = attrPattern.test(openTag)
    ? openTag.replace(attrPattern, `${attrName}="${attrValue}"`)
    : openTag.replace(new RegExp(`^<${tagName}\\b`), `<${tagName}\n            ${attrName}="${attrValue}"`);
  return xml.slice(0, match.index) + updatedOpenTag + xml.slice(match.index + openTag.length);
}

/**
 * Configures the Tauri-generated Android manifest after `tauri android init`.
 *
 * - Ensures `adjustResize` on `<activity>` for soft keyboard handling.
 * - Ensures hardware acceleration (WebGL/Three.js), `allowBackup="false"`, and `roundIcon` on `<application>`.
 * - Binds `network_security_config` so cloud endpoints remain HTTPS-only while
 *   Tauri/local loopback (`127.0.0.1`, `*.localhost`) works in release APKs.
 */
export function patchAndroidManifest(manifestXml) {
  let updated = manifestXml;
  updated = ensureTagAttribute(updated, "application", "android:hardwareAccelerated", "true");
  updated = ensureTagAttribute(updated, "application", "android:networkSecurityConfig", "@xml/network_security_config");
  updated = ensureTagAttribute(updated, "application", "android:allowBackup", "false");
  updated = ensureTagAttribute(updated, "application", "android:roundIcon", "@mipmap/ic_launcher_round");
  updated = ensureTagAttribute(updated, "activity", "android:windowSoftInputMode", "adjustResize");
  return updated;
}

export function patchProguardRules(existingRules) {
  const marker = "# MathCanvas Android WebView export/share bridge";
  const markerIndex = existingRules.indexOf(marker);
  const base = markerIndex >= 0 ? existingRules.slice(0, markerIndex).trimEnd() : existingRules.trimEnd();
  return `${base}\n\n${PROGUARD_BRIDGE_RULE}`;
}

export function computeAndroidVersionCode(versionName) {
  const parts = String(versionName)
    .split(".")
    .map((part) => Number.parseInt(part.replace(/[^0-9].*$/, ""), 10) || 0);
  const major = parts[0] ?? 1;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return major * 1_000_000 + minor * 1_000 + patch;
}

const REQUIRED_ANDROID_ICON_FILES = [
  "mipmap-anydpi-v26/ic_launcher.xml",
  "mipmap-anydpi-v26/ic_launcher_round.xml",
  "mipmap-mdpi/ic_launcher.png",
  "mipmap-mdpi/ic_launcher_round.png",
  "mipmap-mdpi/ic_launcher_background.png",
  "mipmap-mdpi/ic_launcher_foreground.png",
  "mipmap-hdpi/ic_launcher.png",
  "mipmap-hdpi/ic_launcher_round.png",
  "mipmap-hdpi/ic_launcher_background.png",
  "mipmap-hdpi/ic_launcher_foreground.png",
  "mipmap-xhdpi/ic_launcher.png",
  "mipmap-xhdpi/ic_launcher_round.png",
  "mipmap-xhdpi/ic_launcher_background.png",
  "mipmap-xhdpi/ic_launcher_foreground.png",
  "mipmap-xxhdpi/ic_launcher.png",
  "mipmap-xxhdpi/ic_launcher_round.png",
  "mipmap-xxhdpi/ic_launcher_background.png",
  "mipmap-xxhdpi/ic_launcher_foreground.png",
  "mipmap-xxxhdpi/ic_launcher.png",
  "mipmap-xxxhdpi/ic_launcher_round.png",
  "mipmap-xxxhdpi/ic_launcher_background.png",
  "mipmap-xxxhdpi/ic_launcher_foreground.png",
];

/**
 * Replaces Tauri's default placeholder Android launcher icons with MathCanvas's
 * branded adaptive (`mipmap-anydpi-v26`) and multi-density (`mipmap-*`) icons,
 * and removes stale template robot/grid drawables.
 */
export function syncAndroidLauncherIcons(iconsAndroidDir, resDir) {
  for (const relPath of REQUIRED_ANDROID_ICON_FILES) {
    const src = join(iconsAndroidDir, relPath);
    if (!existsSync(src)) {
      throw new Error(`Missing required MathCanvas Android icon asset: ${src}`);
    }
  }

  for (const dirEntry of readdirSync(iconsAndroidDir, { withFileTypes: true })) {
    if (!dirEntry.isDirectory()) continue;
    const srcSubdir = join(iconsAndroidDir, dirEntry.name);
    const destSubdir = join(resDir, dirEntry.name);
    mkdirSync(destSubdir, { recursive: true });
    for (const fileEntry of readdirSync(srcSubdir, { withFileTypes: true })) {
      if (!fileEntry.isFile()) continue;
      copyFileSync(join(srcSubdir, fileEntry.name), join(destSubdir, fileEntry.name));
    }
  }

  for (const staleRel of ["drawable/ic_launcher_background.xml", "drawable-v24/ic_launcher_foreground.xml"]) {
    const stalePath = join(resDir, staleRel);
    if (existsSync(stalePath)) {
      rmSync(stalePath, { force: true });
    }
  }

  return REQUIRED_ANDROID_ICON_FILES.length;
}

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(currentFile);

if (isMain) {
  const androidAppDir = resolve(currentDir, "../apps/desktop/src-tauri/gen/android/app");
  const androidMainDir = resolve(androidAppDir, "src/main");
  const manifestPath = resolve(androidMainDir, "AndroidManifest.xml");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing generated AndroidManifest.xml at ${manifestPath}`);
  }
  const currentManifest = readFileSync(manifestPath, "utf8");
  const updatedManifest = patchAndroidManifest(currentManifest);
  if (updatedManifest !== currentManifest) {
    writeFileSync(manifestPath, updatedManifest, "utf8");
    console.log(`Updated AndroidManifest.xml at ${manifestPath}`);
  } else {
    console.log(`AndroidManifest.xml already configured at ${manifestPath}`);
  }

  const xmlDir = resolve(androidMainDir, "res/xml");
  mkdirSync(xmlDir, { recursive: true });
  writeFileSync(resolve(xmlDir, "network_security_config.xml"), NETWORK_SECURITY_CONFIG_XML, "utf8");
  writeFileSync(resolve(xmlDir, "file_paths.xml"), FILE_PATHS_XML, "utf8");
  console.log(`Wrote network_security_config.xml and file_paths.xml in ${xmlDir}`);

  for (const relTheme of ["res/values/themes.xml", "res/values-night/themes.xml"]) {
    const themePath = resolve(androidMainDir, relTheme);
    mkdirSync(dirname(themePath), { recursive: true });
    writeFileSync(themePath, LIGHT_THEME_XML, "utf8");
  }
  console.log("Updated Android light windowBackground themes (day & night)");

  const proguardPath = resolve(androidAppDir, "proguard-rules.pro");
  if (existsSync(proguardPath)) {
    const currentProguard = readFileSync(proguardPath, "utf8");
    const updatedProguard = patchProguardRules(currentProguard);
    if (updatedProguard !== currentProguard) {
      writeFileSync(proguardPath, updatedProguard, "utf8");
      console.log(`Updated proguard-rules.pro at ${proguardPath}`);
    }
  }

  const tauriConfPath = resolve(currentDir, "../apps/desktop/src-tauri/tauri.conf.json");
  const tauriPropsPath = resolve(androidAppDir, "tauri.properties");
  if (existsSync(tauriConfPath)) {
    const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
    if (tauriConf?.version) {
      const versionCode = computeAndroidVersionCode(tauriConf.version);
      const propsContent = `// THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.\ntauri.android.versionName=${tauriConf.version}\ntauri.android.versionCode=${versionCode}\n`;
      writeFileSync(tauriPropsPath, propsContent, "utf8");
      console.log(`Synced tauri.properties (${tauriConf.version} / versionCode=${versionCode})`);
    }
  }

  const mainActivityPath = resolve(androidMainDir, "java/com/mathcanvas/desktop/MainActivity.kt");
  if (existsSync(mainActivityPath)) {
    writeFileSync(mainActivityPath, MAIN_ACTIVITY_KT, "utf8");
    console.log(`Updated MainActivity.kt with edge-to-edge insets, back bridge & native export/share bridge at ${mainActivityPath}`);
  }

  const iconsAndroidDir = resolve(currentDir, "../apps/desktop/src-tauri/icons/android");
  const resDir = resolve(androidMainDir, "res");
  const syncedCount = syncAndroidLauncherIcons(iconsAndroidDir, resDir);
  console.log(`Synced ${syncedCount} MathCanvas Android launcher icon assets into ${resDir}`);
}
