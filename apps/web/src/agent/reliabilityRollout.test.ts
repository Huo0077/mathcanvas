import { describe, expect, it } from "vitest"

import { createAgentReliabilityFlags, isEnabledForSession, RELIABILITY_FLAGS_FOR_TESTS, rolloutBucket, validateReliabilityConfig } from "./reliabilityFlags"

/**
 * **W11：开关依赖、灰度分桶与回滚（2026-11-09）**。
 *
 * 三条判据：
 * ① **非法依赖组合必须被拒**（核验开着、目标跟踪关着 → 核验的对象是猜的）；
 * ② **同会话分桶稳定**（不随机、不随重启变化，同档位下每次同一桶）；
 * ③ **关掉核验只让证据更保守**：答案仍保留，但不会再有"已核验"标签。
 */

describe("W11 开关依赖", () => {
  it("rejects math verification without goal tracking (and states the exact dependency)", () => {
    const result = validateReliabilityConfig(createAgentReliabilityFlags({ mathVerificationV1: true, answerSemanticsV1: true }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((error) => error.code)).toContain("math_requires_goal_tracking")
  })

  it("rejects math verification without answer semantics", () => {
    const result = validateReliabilityConfig(createAgentReliabilityFlags({ mathVerificationV1: true, goalTrackingV1: true }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((error) => error.code)).toContain("math_requires_answer_semantics")
  })

  it("rejects the orthographic family without math verification", () => {
    const result = validateReliabilityConfig(createAgentReliabilityFlags({ orthographicTemplatesV1: true, goalTrackingV1: true }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((error) => error.code)).toContain("orthographic_requires_math_verification")
  })

  it("rejects reread without a session or without attachment capability", () => {
    expect(validateReliabilityConfig(createAgentReliabilityFlags({ imageRereadV1: true }), { sessionAvailable: false }).ok).toBe(false)
    const noAttachments = validateReliabilityConfig(createAgentReliabilityFlags({ imageRereadV1: true }), { attachmentCapability: false })
    expect(noAttachments.ok).toBe(false)
    if (!noAttachments.ok) expect(noAttachments.errors.map((error) => error.code)).toContain("reread_requires_attachments")
  })

  it("accepts the full test configuration and the all-off default", () => {
    expect(validateReliabilityConfig(RELIABILITY_FLAGS_FOR_TESTS).ok).toBe(true)
    expect(validateReliabilityConfig(createAgentReliabilityFlags()).ok).toBe(true)
    expect(validateReliabilityConfig(createAgentReliabilityFlags({ imageRereadV1: true }), { sessionAvailable: true, attachmentCapability: true }).ok).toBe(true)
  })
})

describe("W11 灰度分桶稳定", () => {
  it("always puts the same session in the same bucket", () => {
    const first = rolloutBucket("conversation-abc")
    expect(rolloutBucket("conversation-abc")).toBe(first)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(100)
  })

  it("keeps the decision stable and monotone across percentages", () => {
    const id = "session-xyz"
    const bucket = rolloutBucket(id)
    expect(isEnabledForSession(id, 0)).toBe(false)
    expect(isEnabledForSession(id, 100)).toBe(true)
    expect(isEnabledForSession(id, bucket)).toBe(false)
    expect(isEnabledForSession(id, bucket + 1)).toBe(true)
  })

  it("does not enable anything at 0% and enables everything at 100%", () => {
    for (const id of ["a", "b", "c", "会话-1"]) {
      expect(isEnabledForSession(id, 0)).toBe(false)
      expect(isEnabledForSession(id, 100)).toBe(true)
    }
  })
})
