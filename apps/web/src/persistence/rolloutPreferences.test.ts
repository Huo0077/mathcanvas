import { beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_ROLLOUT_PERCENTAGE, readRolloutPercentage, setRolloutPercentage } from "./rolloutPreferences"

/**
 * **W4：新安装默认 100%，坏配置退化到 0**。设置写坏时退化到 0，而不是"全量打开"。
 */
const KEY = "mathcanvas:reliability-rollout"

beforeEach(() => { localStorage.clear() })

describe("灰度比例", () => {
  it("defaults to 100% for a fresh installation and stores an integer percentage", () => {
    expect(DEFAULT_ROLLOUT_PERCENTAGE).toBe(100)
    expect(readRolloutPercentage()).toBe(100)
    expect(setRolloutPercentage(37.8)).toBe(true)
    expect(readRolloutPercentage()).toBe(37)
  })

  it("treats an unreadable store as unsafe rather than a fresh install", () => {
    const read = vi.spyOn(localStorage, "getItem").mockImplementationOnce(() => { throw new Error("storage blocked") })
    try { expect(readRolloutPercentage()).toBe(0) } finally { read.mockRestore() }
  })

  it("respects a previously saved explicit zero despite the new-install default", () => {
    expect(setRolloutPercentage(0)).toBe(true)
    expect(readRolloutPercentage()).toBe(0)
  })

  it("clamps to [0,100] and rejects non-finite input", () => {
    expect(setRolloutPercentage(150)).toBe(true)
    expect(readRolloutPercentage()).toBe(100)
    expect(setRolloutPercentage(-5)).toBe(true)
    expect(readRolloutPercentage()).toBe(0)
    expect(setRolloutPercentage(Number.NaN)).toBe(false)
    expect(readRolloutPercentage()).toBe(0)
  })

  it("keeps malformed settings conservative at 0% instead of changing the new-install default", () => {
    localStorage.setItem(KEY, "{bad json")
    expect(readRolloutPercentage()).toBe(0)
    localStorage.setItem(KEY, JSON.stringify({ percentage: "50" }))
    expect(readRolloutPercentage()).toBe(0)
    localStorage.setItem(KEY, JSON.stringify({ percentage: Number.POSITIVE_INFINITY }))
    expect(readRolloutPercentage()).toBe(0)
    localStorage.setItem(KEY, JSON.stringify([50]))
    expect(readRolloutPercentage()).toBe(0)
  })
})
