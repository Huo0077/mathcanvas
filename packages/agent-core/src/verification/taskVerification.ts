import type { VerificationCheck, VerificationReport } from "../contracts"
import { parseVerificationReport } from "../toolContracts"

/**
 * **任务级语义验证**（Phase 3 Task 3.2 的第一片）。
 *
 * ## 为什么需要它
 *
 * 在这之前，"这一步做完了吗"没有任何确定性判据。可用的信号只有三种，而它们
 * **都不是证据**：
 * - 动作编译成功（`compilePlan` 回 `ok`）—— 那只说明**计划合法**，不说明画对了；
 * - 草稿版本号涨了（`draftVersion += 1`）—— 那只说明**暂存发生了**；
 * - 模型在文本里说"已完成" —— 那是模型的自述。
 *
 * 计划 Task 3.1 的原话是："**Do not treat a tool receipt, draft creation, or revision increase
 * as success.**" 所以这一层要回答的是一个**不同**的问题：对着候选文档，
 * "用户要的那个东西真的在那里、而且是那个尺寸吗"。
 *
 * ## 这一层只做确定性判定，没有模型参与
 *
 * 每个 check 都是一次可复现的读取与比较。判据刻意**只有三态**（外加两个"我判断不了"）：
 * `passed` / `failed` / `unknown`（信息不足以判定）—— 并且**含糊一律算 failed 或 unknown，
 * 绝不算 passed**。"验证通过"必须是强判据，否则它会让整个门禁变成形式。
 *
 * ## 与 `not_supported` 的区别
 *
 * 遇到**这一层还不支持**的 check 类型时如实返回 `not_supported`，
 * 而不是当成 `passed` —— 计划 Task 3.1 Step 3 的原话是
 * "视觉能力不可用时，必须有本地布局验证结果或明确 `not_supported`"。
 */

/** 一个待验证的断言。`not_supported` 的判据由 `kind` 决定（见下）。 */
export type TaskCheck =
  /** 文档里必须存在这个 id 的对象。 */
  | { id: string; kind: "exists"; entityId: string }
  /** 这个 id 的对象必须是这个类型。 */
  | { id: string; kind: "type"; entityId: string; expected: string }
  /** 这个实体的包围盒边长必须（在容差内）等于给定值。 */
  | { id: string; kind: "size"; entityId: string; expected: readonly number[]; tolerance?: number }
  /** 这个对象的标签必须等于给定字符串。 */
  | { id: string; kind: "label"; entityId: string; expected: string }
  /** 标签里必须存在一个匹配的对象（用户说"画一个立方体"时用它）。 */
  | { id: string; kind: "labelled"; label: string }
  /**
   * **这一层还不支持**的断言（截面 / 关系 / 删除 / 参数化）。
   *
   * 显式登记为好让调用方知道"我们没验"，而不是让它悄悄变成 `passed`。
   * Phase 3 的后续任务会逐条把它们变成真 check。
   */
  | { id: string; kind: "unsupported"; reason: string }

/**
 * 文档的一个只读视图 —— 只取验证真正需要的字段，不依赖 `@draw/dsl` 的具体形状。
 *
 * 图元按 `Record<string, unknown>` 读（而不是只声明 `id/type/label`）：验证要看的字段
 * 随 check 类型变化（`vertexIds`、坐标分量…），把它们逐个写进类型等于让这份类型
 * 成为第三份"图元有哪些字段"的说明。**这里刻意不做类型断言**：每个字段在使用点
 * 都先判了类型（见 `extentOf`），读不出来就是 `unknown`。
 */
export interface VerifiableDocument {
  primitives: readonly (Record<string, unknown> & { id: string; type: string; label?: string })[]
}

const DEFAULT_TOLERANCE = 1e-6

/** 数值比较：**必须给容差**，否则浮点误差会把"棱长 3"判成失败。 */
function closeEnough(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance
}

/**
 * 求一个实体的包围盒边长。
 *
 * 只认**能直接读出几何**的那几种：2D 点 / 空间点 / 由模板构造的多面体（读它的顶点）。
 * 读不出来的（曲线、由别的对象派生出来的）返回 `null` —— 那是 `unknown`，不是 `failed`。
 */
function extentOf(document: VerifiableDocument, entityId: string): number[] | null {
  const entity = document.primitives.find((primitive) => primitive.id === entityId) as Record<string, unknown> | undefined
  if (!entity) return null
  const points: number[][] = []
  const pushPoint = (value: unknown, dims: 2 | 3) => {
    if (typeof value !== "object" || value === null) return
    const record = value as Record<string, unknown>
    const coordinates = dims === 2 ? [record.x, record.y] : [record.x, record.y, record.z]
    if (coordinates.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) points.push(coordinates as number[])
  }
  pushPoint(entity, entity.z === undefined ? 2 : 3)
  // 模板 / 点集多面体的顶点族：内核把它们物化成 `vertexIds` 指向的一批点。
  const vertexIds = entity.vertexIds
  if (Array.isArray(vertexIds)) {
    for (const id of vertexIds) {
      const vertex = document.primitives.find((primitive) => primitive.id === id) as Record<string, unknown> | undefined
      if (vertex) pushPoint(vertex, vertex.z === undefined ? 2 : 3)
    }
  }
  if (points.length === 0) return null
  const dims = Math.max(...points.map((point) => point.length))
  const extent: number[] = []
  for (let axis = 0; axis < dims; axis += 1) {
    const values = points.map((point) => point[axis]).filter((value): value is number => typeof value === "number")
    extent.push(Math.max(...values) - Math.min(...values))
  }
  return extent
}

function checkOf(id: string, status: VerificationCheck["status"], detail: string, path?: string): VerificationCheck {
  return { id, status, detail, ...(path === undefined ? {} : { path }) }
}

/**
 * 逐条跑 check，产出一份**可校验**的验证报告。
 *
 * 返回的 `report` 一定通过 `parseVerificationReport` —— 那一条不变量
 *（"`status: "passed"` 要求至少一条 check 且每条都 passed"）由 `toolContracts` 钉着，
 * 这里在收口时自己先走一遍，免得出一个自己都不合法的报告。
 */
export function verifyTaskChecks(document: VerifiableDocument, checks: readonly TaskCheck[]): { report: VerificationReport; error?: string } {
  const results: VerificationCheck[] = []

  for (const check of checks) {
    switch (check.kind) {
      case "exists": {
        const found = document.primitives.some((primitive) => primitive.id === check.entityId)
        results.push(checkOf(check.id, found ? "passed" : "failed", found ? `${check.entityId} exists` : `no object ${check.entityId}`, `primitives.${check.entityId}`))
        break
      }
      case "type": {
        const entity = document.primitives.find((primitive) => primitive.id === check.entityId)
        if (!entity) results.push(checkOf(check.id, "failed", `no object ${check.entityId}`, `primitives.${check.entityId}`))
        else results.push(checkOf(check.id, entity.type === check.expected ? "passed" : "failed", `${check.entityId} is ${entity.type}, expected ${check.expected}`, `primitives.${check.entityId}.type`))
        break
      }
      case "label": {
        const entity = document.primitives.find((primitive) => primitive.id === check.entityId)
        if (!entity) results.push(checkOf(check.id, "failed", `no object ${check.entityId}`, `primitives.${check.entityId}`))
        else results.push(checkOf(check.id, entity.label === check.expected ? "passed" : "failed", `${check.entityId} is labelled ${entity.label ?? "(none)"}, expected ${check.expected}`, `primitives.${check.entityId}.label`))
        break
      }
      case "labelled": {
        const found = document.primitives.some((primitive) => primitive.label === check.label)
        results.push(checkOf(check.id, found ? "passed" : "failed", found ? `an object is labelled ${check.label}` : `no object is labelled ${check.label}`, "primitives"))
        break
      }
      case "size": {
        const extent = extentOf(document, check.entityId)
        if (extent === null) {
          /**
           * **读不出几何 ≠ 尺寸不对**。这是 `unknown`：这一层的读取能力够不到它，
           * 把它当成 `failed` 会冤枉一份正确的文档，当成 `passed` 则是撒谎。
           */
          results.push(checkOf(check.id, "unknown", `cannot read the extent of ${check.entityId}`, `primitives.${check.entityId}`))
          break
        }
        const tolerance = check.tolerance ?? DEFAULT_TOLERANCE
        const mismatched = check.expected
          .map((expected, axis) => ({ axis, expected, actual: extent[axis] }))
          .filter((entry) => entry.actual === undefined || !closeEnough(entry.actual, entry.expected, tolerance))
        results.push(checkOf(
          check.id,
          mismatched.length === 0 ? "passed" : "failed",
          mismatched.length === 0
            ? `${check.entityId} extent is [${extent.join(", ")}]`
            : `${check.entityId} extent is [${extent.join(", ")}], expected [${check.expected.join(", ")}]`,
          `primitives.${check.entityId}`
        ))
        break
      }
      case "unsupported": {
        results.push(checkOf(check.id, "not_supported", check.reason))
        break
      }
      default: {
        /**
         * 判别联合已经穷尽；真走到这里说明调用方从不可信来源造了 check。
         * 如实报 `not_supported` 而不是崩，也不是放行。
         */
        results.push(checkOf((check as { id: string }).id, "not_supported", "unknown check kind"))
      }
    }
  }

  /**
   * 汇总口径（**刻意保守**）：
   * - 有任何一条 `failed` → `failed`；
   * - 有任何一条 `not_supported` → `not_supported`（"我们没验"不能被说成通过）；
   * - 有任何一条 `unknown` → `unknown`；
   * - 有任何一条 `approximate` → `approximate`；
   * - 全部 `passed` → `passed`；
   * - **一条 check 都没有 → `unknown`**（空集不能算通过）。
   */
  const status: VerificationReport["status"] = results.length === 0
    ? "unknown"
    : results.some((check) => check.status === "failed")
      ? "failed"
      : results.some((check) => check.status === "not_supported")
        ? "not_supported"
        : results.some((check) => check.status === "unknown")
          ? "unknown"
          : results.some((check) => check.status === "approximate")
            ? "approximate"
            : "passed"

  const next_actions = status === "passed"
    ? []
    : results
      .filter((check) => check.status !== "passed")
      .slice(0, 3)
      .map((check) => `${check.id}: ${check.detail}`)

  const candidate: VerificationReport = { status, checks: results, next_actions }
  const parsed = parseVerificationReport(candidate)
  if (!parsed.ok) {
    // 自己造出来的报告自己不合法 —— 这是本层的 bug，如实说出来而不是把非法报告交出去。
    return { report: candidate, error: parsed.errors.map((entry) => `${entry.code}@${entry.path}`).join(", ") }
  }
  return { report: parsed.value }
}
