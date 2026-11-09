import { describe, expect, it } from "vitest"

import { chooseSolveStrategy, MAX_INDEPENDENT_CANDIDATES, type SolveStrategyInput } from "./solveStrategyPolicy"

/**
 * **W8：失败后的风险路由（2026-11-09）**。
 *
 * 判据用表驱动钉死，因为这条决策一旦"顺手放宽"，产品就会在没有授权的情况下
 * 换成另一个模型、或者让文字模型去猜图上的尺寸。
 */

const base: SolveStrategyInput = { failure: "none", mode: "default", callsRemaining: 6, hasAuthorizedIndependentProfile: false }
const decide = (overrides: Partial<SolveStrategyInput>) => chooseSolveStrategy({ ...base, ...overrides })

describe("W8 默认档不升级", () => {
  it("keeps the primary model while nothing failed", () => {
    expect(decide({})).toBe("primary")
  })

  it("stops on a refuted candidate when no independent profile is authorized", () => {
    expect(decide({ failure: "refuted" })).toBe("stop")
    expect(decide({ failure: "disagreement" })).toBe("stop")
  })

  it("never sends a text model to guess a missing image condition", () => {
    expect(decide({ failure: "image_gap" })).toBe("vision_reread")
    expect(decide({ failure: "image_gap", hasAuthorizedIndependentProfile: true })).toBe("vision_reread")
  })
})

describe("W8 不可恢复与预算边界", () => {
  it("stops on auth even with an authorized independent profile", () => {
    expect(decide({ failure: "auth", hasAuthorizedIndependentProfile: true })).toBe("stop")
  })

  it("stops when the session has no calls left", () => {
    expect(decide({ failure: "refuted", callsRemaining: 0, hasAuthorizedIndependentProfile: true })).toBe("stop")
    expect(decide({ failure: "image_gap", callsRemaining: 0 })).toBe("stop")
  })
})

describe("W8 授权后才允许独立候选", () => {
  it("uses the independent candidate only when both authorization and calls exist", () => {
    expect(decide({ failure: "refuted", hasAuthorizedIndependentProfile: true })).toBe("independent")
    expect(decide({ failure: "disagreement", hasAuthorizedIndependentProfile: true })).toBe("independent")
    expect(decide({ failure: "refuted", hasAuthorizedIndependentProfile: true, callsRemaining: 1 })).toBe("independent")
  })

  it("caps independent candidates at two", () => {
    expect(MAX_INDEPENDENT_CANDIDATES).toBe(2)
  })

  it("keeps high accuracy from changing the authorization requirement", () => {
    expect(decide({ mode: "high_accuracy", failure: "refuted" })).toBe("stop")
    expect(decide({ mode: "high_accuracy", failure: "refuted", hasAuthorizedIndependentProfile: true })).toBe("independent")
  })
})
