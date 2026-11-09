/**
 * **风险路由与独立候选（W8，2026-11-09）**。
 *
 * 这一层只回答一个问题：**这次失败之后该走哪条路**。
 *
 * 三类失败的处理方式完全不同：
 * - `auth`：再试一次只会重复失败与重复计费 → `stop`；
 * - `image_gap`：缺的是图上条件 → `vision_reread`（**绝不能**让纯文字模型补猜）；
 * - `refuted` / `disagreement`：需要**另一个独立候选**才可能推进，而且必须有
 *   用户授权的独立模型配置（`hasAuthorizedIndependentProfile`）→ `independent`，否则 `stop`。
 *
 * 两条纪律：
 * 1. **不看模型自报置信度**：路由只认宿主侧的失败分类与剩余调用次数；
 * 2. **没有授权就不升级**：默认档不会因为没有别的配置而悄悄换模型；高精度档只影响
 *    请求/token 上限（见 `solveSession`），**不改变**"有没有授权"这条前提。
 */

export type SolveMode = "default" | "high_accuracy"
export type SolveFailure = "none" | "image_gap" | "refuted" | "disagreement" | "auth"
export type SolveStrategy = "primary" | "vision_reread" | "independent" | "stop"

export interface SolveStrategyInput {
  failure: SolveFailure
  mode: SolveMode
  /** 还能发几次生成请求（来自会话账本，不是猜的）。 */
  callsRemaining: number
  /** 用户是否明确授权过一个独立模型配置来做交叉验证。 */
  hasAuthorizedIndependentProfile: boolean
}

/** 独立候选最多两个：再多就只是重复同一个错误前提。 */
export const MAX_INDEPENDENT_CANDIDATES = 2

export function chooseSolveStrategy(input: SolveStrategyInput): SolveStrategy {
  // 不可恢复：auth 再试也是同样的结果。
  if (input.failure === "auth") return "stop"
  if (!Number.isFinite(input.callsRemaining) || input.callsRemaining <= 0) return "stop"
  if (input.failure === "none") return "primary"
  if (input.failure === "image_gap") return "vision_reread"
  // refuted / disagreement：没有授权的独立配置就只能如实停下。
  if (!input.hasAuthorizedIndependentProfile) return "stop"
  return "independent"
}
