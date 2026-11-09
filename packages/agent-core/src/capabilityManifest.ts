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
    solveDomain: ["双曲线垂足与离心率关系（PF₁²=k·OP² 型）", "椭圆上距离全称不等式的离心率范围",
      "双曲线焦点到渐近线的垂足（必须同时落在线上且与焦点连线垂直）",
      "椭圆点到上顶点距离上界（只在 e≤√2/2 时成立；e=√3/2 必须给出反例）"],
    answerKinds: ["numeric", "interval"],
    verification: ["instance", "interval-branch"],
    fallback: "unsupported",
    fallbackReason: "超出这几类判据的圆锥曲线结论没有独立核验路径，返回超出能力而不是猜。"
  },
  {
    family: "function-equivalence",
    inputs: ["text"],
    solveDomain: ["有限区间内两个初等表达式的采样反例（|sinxcosx| 型绝对值、定义域不一致）",
      "弧度/角度单位必须按声明一致；采样通过只标 sampled"],
    answerKinds: ["numeric", "proof"],
    verification: ["instance"],
    fallback: "unsupported",
    fallbackReason: "超出可解析表达式（数字、x、π、四则、整数幂、绝对值、sin/cos/tan/sqrt/abs）的结论没有采样判据。"
  },
  {
    family: "finite-probability",
    inputs: ["text"],
    solveDomain: ["有限等可能样本", "无放回组合计数（有放回是另一种模型，不能混用）"],
    answerKinds: ["numeric"],
    verification: ["instance"],
    fallback: "unsupported",
    fallbackReason: "样本空间/等可能/独立条件必须由题面绑定；没有绑定就返回超出能力，不用概率计算器冒充解析。"
  },
  {
    family: "plane-right-triangle",
    inputs: ["text"],
    solveDomain: ["非退化直角三角形的面积（三个顶点坐标来自题面）"],
    answerKinds: ["numeric"],
    verification: ["instance"],
    fallback: "unsupported",
    fallbackReason: "任意三角形/圆的面积与角度暂无注册判据，非直角输入返回超出能力而不是硬套公式。"
  },
  {
    family: "continued-fraction-monotonicity",
    inputs: ["text"],
    solveDomain: ["正整数系数连分数的精确求值（bigint，无浮点）", "相邻项反例否证单调性（只否证，不证明）"],
    answerKinds: ["proof"],
    verification: ["instance"],
    fallback: "clarify",
    fallbackReason: "有限项相符不等于一般结论成立；需要递推/归纳检查时如实说不知道。"
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
