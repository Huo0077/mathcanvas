import { beforeEach, describe, expect, it } from "vitest"

import { DEFAULT_ROLLOUT_PERCENTAGE, readRolloutPercentage, setRolloutPercentage } from "./rolloutPreferences"

/**
 * **W11：灰度比例默认 0%**。设置写坏时退化到 0，而不是"全量打开"。
 */
const KEY = "mathcanvas:reliability-rollout"

beforeEach(() => { localStorage.clear() })

describe("灰度比例", () => {
  it("defaults to 0% and stores an integer percentage", () => {
    expect(DEFAULT_ROLLOUT_PERCENTAGE).toBe(0)
    expect(readRolloutPercentage()).toBe(0)
    expect(setRolloutPercentage(37.8)).toBe(true)
    expect(readRolloutPercentage()).toBe(37)
  })

  it("clamps to [0,100] and rejects non-finite input", () => {
    expect(setRolloutPercentage(150)).toBe(true)
    expect(readRolloutPercentage()).toBe(100)
    expect(setRolloutPercentage(-5)).toBe(true)
    expect(readRolloutPercentage()).toBe(0)
    expect(setRolloutPercentage(Number.NaN)).toBe(false)
    expect(readRolloutPercentage()).toBe(0)
  })

  it("degrades malformed settings to 0% instead of enabling everything", () => {
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
