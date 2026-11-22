import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

export const MAIN_ACTIVITY_KT = `package com.mathcanvas.desktop

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
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
 * - Ensures hardware acceleration (WebGL/Three.js) on `<application>`.
 * - Binds `network_security_config` so cloud endpoints remain HTTPS-only while
 *   Tauri/local loopback (`127.0.0.1`, `*.localhost`) works in release APKs.
 */
export function patchAndroidManifest(manifestXml) {
  let updated = manifestXml;
  updated = ensureTagAttribute(updated, "application", "android:hardwareAccelerated", "true");
  updated = ensureTagAttribute(updated, "application", "android:networkSecurityConfig", "@xml/network_security_config");
  updated = ensureTagAttribute(updated, "activity", "android:windowSoftInputMode", "adjustResize");
  return updated;
}

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(currentFile);

if (isMain) {
  const androidMainDir = resolve(currentDir, "../apps/desktop/src-tauri/gen/android/app/src/main");
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
  const networkConfigPath = resolve(xmlDir, "network_security_config.xml");
  writeFileSync(networkConfigPath, NETWORK_SECURITY_CONFIG_XML, "utf8");
  console.log(`Wrote network security config at ${networkConfigPath}`);

  const mainActivityPath = resolve(androidMainDir, "java/com/mathcanvas/desktop/MainActivity.kt");
  if (existsSync(mainActivityPath)) {
    writeFileSync(mainActivityPath, MAIN_ACTIVITY_KT, "utf8");
    console.log(`Updated MainActivity.kt with edge-to-edge insets & back handling at ${mainActivityPath}`);
  }
}
