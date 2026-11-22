import { describe, expect, it } from "vitest"

import {
  computeAndroidVersionCode,
  FILE_PATHS_XML,
  LIGHT_THEME_XML,
  MAIN_ACTIVITY_KT,
  NETWORK_SECURITY_CONFIG_XML,
  patchAndroidManifest,
  patchProguardRules
} from "./android-post-init.mjs"

const SAMPLE_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:usesCleartextTraffic="\${usesCleartextTraffic}">
        <activity
            android:name=".MainActivity"
            android:exported="true">
        </activity>
    </application>
</manifest>`

describe("android-post-init", () => {
  it("patches AndroidManifest.xml with hardware acceleration, network security config, allowBackup=false, roundIcon, and adjustResize idempotently", () => {
    const once = patchAndroidManifest(SAMPLE_MANIFEST)
    expect(once).toContain('android:hardwareAccelerated="true"')
    expect(once).toContain('android:networkSecurityConfig="@xml/network_security_config"')
    expect(once).toContain('android:allowBackup="false"')
    expect(once).toContain('android:roundIcon="@mipmap/ic_launcher_round"')
    expect(once).toContain('android:windowSoftInputMode="adjustResize"')

    const twice = patchAndroidManifest(once)
    expect(twice).toBe(once)
  })

  it("keeps cloud traffic HTTPS-only while permitting local loopback in network_security_config.xml", () => {
    expect(NETWORK_SECURITY_CONFIG_XML).toContain('cleartextTrafficPermitted="false"')
    expect(NETWORK_SECURITY_CONFIG_XML).toContain(">127.0.0.1<")
    expect(NETWORK_SECURITY_CONFIG_XML).toContain('includeSubdomains="true">localhost<')
  })

  it("exposes exports/ in file_paths.xml and sets white windowBackground theme to avoid dark flash", () => {
    expect(FILE_PATHS_XML).toContain('<files-path name="exports" path="exports/" />')
    expect(LIGHT_THEME_XML).toContain("#FFFFFF")
  })

  it("configures MainActivity.kt with edge-to-edge insets, back bridge, and native Downloads/Share bridge", () => {
    expect(MAIN_ACTIVITY_KT).toContain("enableEdgeToEdge(")
    expect(MAIN_ACTIVITY_KT).toContain("WindowInsetsCompat.Type.systemBars()")
    expect(MAIN_ACTIVITY_KT).toContain("WindowInsetsCompat.Type.displayCutout()")
    expect(MAIN_ACTIVITY_KT).toContain("WindowInsetsCompat.Type.ime()")
    expect(MAIN_ACTIVITY_KT).toContain("__mathcanvasHandleAndroidBack")
    expect(MAIN_ACTIVITY_KT).toContain("override fun onWebViewCreate(webView: WebView)")
    expect(MAIN_ACTIVITY_KT).toContain("MathCanvasAndroidBridge")
    expect(MAIN_ACTIVITY_KT).toContain("activity.dataDir")
    expect(MAIN_ACTIVITY_KT).toContain("MediaStore.Downloads")
    expect(MAIN_ACTIVITY_KT).toContain("FileProvider.getUriForFile")
    expect(MAIN_ACTIVITY_KT).toContain("Intent.ACTION_SEND")
  })

  it("adds R8 ProGuard keep rule for MathCanvasAndroidBridge idempotently and computes versionCode", () => {
    const once = patchProguardRules("# base\n")
    expect(once).toContain("-keepattributes *Annotation*")
    expect(once).toContain("-keep class com.mathcanvas.desktop.MathCanvasAndroidBridge")
    expect(patchProguardRules(once)).toBe(once)
    expect(computeAndroidVersionCode("5.1.0")).toBe(5_001_000)
    expect(computeAndroidVersionCode("5.0.0")).toBe(5_000_000)
  })
})
