import { describe, expect, it } from "vitest"

import { MAIN_ACTIVITY_KT, NETWORK_SECURITY_CONFIG_XML, patchAndroidManifest } from "./android-post-init.mjs"

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
  it("patches AndroidManifest.xml with hardware acceleration, network security config, and adjustResize idempotently", () => {
    const once = patchAndroidManifest(SAMPLE_MANIFEST)
    expect(once).toContain('android:hardwareAccelerated="true"')
    expect(once).toContain('android:networkSecurityConfig="@xml/network_security_config"')
    expect(once).toContain('android:windowSoftInputMode="adjustResize"')

    const twice = patchAndroidManifest(once)
    expect(twice).toBe(once)
  })

  it("keeps cloud traffic HTTPS-only while permitting local loopback in network_security_config.xml", () => {
    expect(NETWORK_SECURITY_CONFIG_XML).toContain('cleartextTrafficPermitted="false"')
    expect(NETWORK_SECURITY_CONFIG_XML).toContain(">127.0.0.1<")
    expect(NETWORK_SECURITY_CONFIG_XML).toContain('includeSubdomains="true">localhost<')
  })

  it("configures MainActivity.kt with edge-to-edge inset padding and Android back bridge", () => {
    expect(MAIN_ACTIVITY_KT).toContain("enableEdgeToEdge(")
    expect(MAIN_ACTIVITY_KT).toContain("WindowInsetsCompat.Type.systemBars()")
    expect(MAIN_ACTIVITY_KT).toContain("WindowInsetsCompat.Type.displayCutout()")
    expect(MAIN_ACTIVITY_KT).toContain("WindowInsetsCompat.Type.ime()")
    expect(MAIN_ACTIVITY_KT).toContain("__mathcanvasHandleAndroidBack")
  })
})
