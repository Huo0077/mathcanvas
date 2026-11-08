import type { AnswerKind } from "./answerResult"

/**
 * **题族能力清单（W8 / T8，2026-11-08）**。
 *
 * 这是"这一版**能做什么**"的结构化声明，不是营销文案：每个题族必须写清
 * 输入形态、求解域、答案类型、核验方式与**回退条件**。运行时/评测按它判断
 * "不支持"该走澄清还是明确超出能力 —— 不再由一句措辞或某个正则偶然决定。
 *
 * 三条纪律：
 * 1. **不声明形式证明**：`verification` 里没有 `formally_proved`；有证明产物的能力另立条目；
 * 2. **回退必须明确**：每个题族都有 `fallback` 与写下来的理由；
 * 3. **域外就是域外**：清单外的题族返回 `unsupported`，不许"先猜一个"。
 */

export type VerificationMethod = "instance" | "interval-branch" | "mesh" | "none"

export interface CapabilityDeclaration {
  family: string
  /** 输入形态：`text` / `structured-views` / `image`。 */
  inputs: readonly string[]
  /** 求解域（人读，但每条都必须具体到可判断）。 */
  solveDomain: readonly string[]
  answerKinds: readonly AnswerKind[]
  verification: readonly VerificationMethod[]
  fallback: "clarify" | "unsupported" | "text"
  fallbackReason: string
}

export const CAPABILITY_MANIFEST: readonly CapabilityDeclaration[] = [
  {
    family: "rectangle-fold",
    inputs: ["text"],
    solveDomain: ["矩形/正方形沿一条对角线折起", "折前或折后长度", "折角（明写或由折后长度反求）", "两块平面垂直或明确折角"],
    answerKinds: ["numeric", "proof"],
    verification: ["instance"],
    fallback: "clarify",
    fallbackReason: "折角未知且只问折后时，缺的是用户能回答的条件；先问折角，不默认 90°。"
  },
  {
    family: "conic-eccentricity",
    inputs: ["text"],
    solveDomain: ["双曲线垂足与离心率关系（PF₁²=k·OP² 型）", "椭圆上距离全称不等式的离心率范围"],
    answerKinds: ["numeric", "interval"],
    verification: ["instance", "interval-branch"],
    fallback: "unsupported",
    fallbackReason: "超出这两类判据的圆锥曲线结论没有独立核验路径，返回超出能力而不是猜。"
  },
  {
    family: "orthographic-cuboid",
    inputs: ["structured-views"],
    solveDomain: ["轴对齐长方体", "沿一条棱切掉长方体的 L 形柱体", "切槽高度已知"],
    answerKinds: ["numeric"],
    verification: ["mesh", "interval-branch"],
    fallback: "clarify",
    fallbackReason: "切槽高度/遮挡信息不可观测时体积不唯一，必须要求补充，不取常见值。"
  },
  {
    family: "trig-monotonicity",
    inputs: ["text"],
    solveDomain: ["可化为单一三角式的单调递增/递减区间", "限定定义域内的单调性"],
    answerKinds: ["interval", "numeric"],
    verification: ["interval-branch"],
    fallback: "unsupported",
    fallbackReason: "不可化为同一三角式的问法没有共享判据，返回超出能力。"
  }
]

export function capabilityOf(family: string): CapabilityDeclaration | undefined {
  return CAPABILITY_MANIFEST.find((declaration) => declaration.family === family)
}

/**
 * **域外的回退**：清单里有就按清单，没有就明确 `unsupported`。
 * 返回的是"该对用户说什么"，调用方不能把它升级成"已解答"。
 */
export function fallbackFor(family: string, reasonCode = "outside_supported_domain"): { kind: "clarify" | "unsupported" | "text"; reasonCode: string; reason: string } {
  const declaration = capabilityOf(family)
  if (declaration === undefined) {
    return { kind: "unsupported", reasonCode, reason: `当前能力清单里没有「${family}」这一族，不会猜测解法。` }
  }
  return {
    kind: declaration.fallback,
    reasonCode,
    reason: declaration.fallbackReason
  }
}
