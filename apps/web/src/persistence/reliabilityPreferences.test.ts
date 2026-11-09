import { beforeEach, describe, expect, it } from "vitest"

import {
  hasAuthorizedIndependentProfile,
  readReliabilityPreferences,
  setIndependentProfileId,
  writeReliabilityPreferences
} from "./reliabilityPreferences"

/**
 * **W8：独立候选只保存引用（2026-11-09）**。
 *
 * 设置页可以记下"哪一份配置被授权做交叉验证"，但**不能**复制密钥、也不能因为
 * 设置被写坏就悄悄换成另一份配置。坏数据只退化成"未授权"。
 */

const KEY = "mathcanvas:reliability-preferences"

beforeEach(() => { localStorage.clear() })

describe("W8 独立候选配置引用", () => {
  it("defaults to no authorization", () => {
    expect(readReliabilityPreferences()).toEqual({ independentProfileId: null })
    expect(hasAuthorizedIndependentProfile()).toBe(false)
  })

  it("stores only the profile id", () => {
    expect(setIndependentProfileId("profile-2")).toBe(true)
    expect(readReliabilityPreferences()).toEqual({ independentProfileId: "profile-2" })
    expect(hasAuthorizedIndependentProfile()).toBe(true)
    const stored = JSON.parse(localStorage.getItem(KEY)!)
    expect(Object.keys(stored)).toEqual(["independentProfileId"])
  })

  it("drops any extra field, including a secret", () => {
    expect(writeReliabilityPreferences({ independentProfileId: "profile-1", apiKey: "sk-secret" } as never)).toBe(true)
    const stored = localStorage.getItem(KEY)!
    expect(stored).not.toContain("sk-secret")
    expect(stored).not.toContain("apiKey")
  })

  it("degrades malformed settings to 'not authorized'", () => {
    localStorage.setItem(KEY, "{bad json")
    expect(readReliabilityPreferences().independentProfileId).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ independentProfileId: 42 }))
    expect(readReliabilityPreferences().independentProfileId).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ independentProfileId: "x".repeat(200) }))
    expect(readReliabilityPreferences().independentProfileId).toBeNull()
    localStorage.setItem(KEY, JSON.stringify(["profile-1"]))
    expect(readReliabilityPreferences().independentProfileId).toBeNull()
  })

  it("rejects an invalid id instead of writing half a setting", () => {
    expect(setIndependentProfileId("   ")).toBe(false)
    expect(readReliabilityPreferences().independentProfileId).toBeNull()
    expect(setIndependentProfileId(null)).toBe(true)
    expect(readReliabilityPreferences().independentProfileId).toBeNull()
  })
})
