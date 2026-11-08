import { describe, expect, it } from "vitest"

import { CAPABILITY_MANIFEST, capabilityOf, fallbackFor } from "./capabilityManifest"

/**
 * **W8 / T8：能力清单必须说清"能做什么、不能做什么、不能时怎么办"。**
 *
 * 这一组钉住四条结构性判据：
 * ① 每个声明都有输入、求解域、答案类型、核验方式与回退理由；
 * ② 清单里**没有** `formally_proved` 这种能力（没有证明产物的核验器）；
 * ③ 域外题族一律 `unsupported`，不会"先猜一个"；
 * ④ 四个已落地的题族都在清单里，且核验方式与实现一致。
 */

describe("W8 — capability declarations are explicit", () => {
  it("declares every required field for every family", () => {
    expect(CAPABILITY_MANIFEST.length).toBeGreaterThanOrEqual(4)
    for (const declaration of CAPABILITY_MANIFEST) {
      expect(declaration.family.length).toBeGreaterThan(0)
      expect(declaration.inputs.length).toBeGreaterThan(0)
      expect(declaration.solveDomain.length).toBeGreaterThan(0)
      expect(declaration.answerKinds.length).toBeGreaterThan(0)
      expect(declaration.verification.length).toBeGreaterThan(0)
      expect(declaration.fallbackReason.length).toBeGreaterThan(0)
    }
  })

  it("never claims a formal-proof capability", () => {
    for (const declaration of CAPABILITY_MANIFEST) {
      expect(declaration.verification).not.toContain("formally_proved" as never)
    }
  })

  it("keeps the implemented families and their verification methods aligned", () => {
    expect(capabilityOf("rectangle-fold")?.verification).toEqual(["instance"])
    expect(capabilityOf("conic-eccentricity")?.verification).toContain("interval-branch")
    expect(capabilityOf("orthographic-cuboid")?.verification).toContain("mesh")
    expect(capabilityOf("trig-monotonicity")?.answerKinds).toEqual(expect.arrayContaining(["interval", "numeric"]))
  })

  it("falls back to unsupported for a family nobody implements", () => {
    const fallback = fallbackFor("three-body-problem")
    expect(fallback.kind).toBe("unsupported")
    expect(fallback.reason).toContain("不会猜测解法")
  })

  it("uses the family's declared fallback when it is known", () => {
    expect(fallbackFor("rectangle-fold").kind).toBe("clarify")
    expect(fallbackFor("conic-eccentricity").kind).toBe("unsupported")
    expect(fallbackFor("orthographic-cuboid").kind).toBe("clarify")
  })
})
