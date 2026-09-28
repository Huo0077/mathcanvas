import type { VerificationCheck, VerificationReport } from "../contracts"
import { parseVerificationReport } from "../toolContracts"

/**
 * **"什么算做完了"** —— 一次运行的验收条件，以及把它们跑成一份报告。
 *
 * ## 为什么需要它（Phase 3 接线缺的那一半）
 *
 * `verification/taskVerification.ts` 能对着一份文档跑检查，`verification/completionGate.ts`
 * 能判一份报告算不算证据 —— 但**中间少了一样东西**：`draft.verify` 那类工具与
 * Task 3.1 的 `TaskSpec` 承诺的"这个任务要满足哪几条"从来没有形状。
 * 于是"验证"这件事在运行期无从而起：没有人说得清该检查什么。
 *
 * ## 为什么验收条件是**判别联合**而不是字符串 + 可选字段
 *
 * 评测夹具里用的是 `{ type: string; target?: string; expected?: string | number | boolean }`
 * （见 `apps/web/src/agent/fixtures/agentTaskFixtures.ts`）。那套形状适合夹具
 * —— 它要能被非 TypeScript 的读者直接写出来 —— 但对运行期不够：
 * 字符串 `type` 拼错时**没有编译错误**，只会静默地什么都不检查。
 *
 * 所以运行期用判别联合：漏一个字段、拼错一个 `kind`，`tsc` 直接拦下。
 * 两者刻意不合并，理由与上面那段是同一件事。
 *
 * ## 判据：空条件是**失败**，不是"没有条件"
 *
 * `acceptance: []` 必须产出 `not_supported` 报告（→ 门禁不放行）。
 * "这个任务没有任何验收条件"与"这个任务验过了"是两件事，
 * 而把前者当后者正是"模型说完成了就算完成"的另一种写法。
 */

export type AcceptanceCheck =
  /** 文档里必须有一个这个类型的对象。 */
  | { kind: "has_primitive"; type: string }
  /** 这个 id 的对象必须存在。 */
  | { kind: "has_entity"; id: string }
  /** 实体的包围盒边长必须（在容差内）等于给定值。 */
  | { kind: "edge_length"; id: string; expected: number; tolerance?: number }
  /** 场景里必须有一个带这个标签的对象。 */
  | { kind: "has_label"; label: string }
  /**
   * **这一层还不支持**的验收条件。显式登记，好让它如实变成 `not_supported`，
   * 而不是被静默忽略（静默忽略会让"我们没验"读起来像"验过了"）。
   */
  | { kind: "unsupported"; reason: string }

/** 一份候选文档里，验证需要读到的部分。 */
export interface AcceptanceDocument {
  primitives: readonly (Record<string, unknown> & { id: string; type: string; label?: string })[]
}

const DEFAULT_TOLERANCE = 1e-6

/**
 * **从一个图元里读出平面/空间坐标**。
 *
 * 两种写法都要认（这是实测的，不是防御性编程）：
 * - `point3` 把坐标放在 `position: {x,y,z}` 里；
 * - 平面 `point` 把坐标直接放在图元上（`{x, y}`）。
 *
 * 只认其中一种的后果很实：`edge_length` 会对着**完全正常**的立方体报
 * `unknown: cannot read the extent`，而门禁因此拦住一次正确的作图。
 * （同一处错误在 `layoutModel.ts` 里也犯过一次，所以这里把读法收成一个函数。）
 */
export function coordinatesOf(primitive: Record<string, unknown>): { x: number; y: number; z?: number } | null {
  const position = primitive.position
  if (typeof position === "object" && position !== null) {
    const { x, y, z } = position as Record<string, unknown>
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
      return typeof z === "number" && Number.isFinite(z) ? { x, y, z } : { x, y }
    }
  }
  const { x, y, z } = primitive
  if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
    return typeof z === "number" && Number.isFinite(z) ? { x, y, z } : { x, y }
  }
  return null
}

/** 从图元里读顶点坐标，用来算包围盒边长。读不出来返回 null（→ unknown，不是 failed）。 */
function extentOf(document: AcceptanceDocument, id: string): number[] | null {
  const entity = document.primitives.find((primitive) => primitive.id === id)
  if (!entity) return null
  const points: number[][] = []
  const push = (value: Record<string, unknown>) => {
    const coordinates = coordinatesOf(value)
    if (coordinates === null) return
    points.push(coordinates.z === undefined ? [coordinates.x, coordinates.y] : [coordinates.x, coordinates.y, coordinates.z])
  }
  push(entity)
  const vertexIds = entity.vertexIds
  if (Array.isArray(vertexIds)) {
    for (const vertexId of vertexIds) {
      const vertex = document.primitives.find((primitive) => primitive.id === vertexId)
      if (vertex) push(vertex)
    }
  }
  if (points.length === 0) return null
  const dims = Math.max(...points.map((point) => point.length))
  return Array.from({ length: dims }, (_, axis) => {
    const values = points.map((point) => point[axis]).filter((value): value is number => typeof value === "number")
    return Math.max(...values) - Math.min(...values)
  })
}

/**
 * 跑一遍验收条件。返回的 `report` **一定能被 `parseVerificationReport` 接受**
 * —— 否则门禁会拿一份非法报告当证据（`completionGate` 已经会拦住那种，
 * 但让非法报告根本不产生更省事）。
 */
export function runAcceptance(document: AcceptanceDocument | null, acceptance: readonly AcceptanceCheck[]): VerificationReport {
  if (acceptance.length === 0) {
    return { status: "not_supported", checks: [{ id: "acceptance:none", status: "not_supported", detail: "the run declared no acceptance criteria, so nothing proves the task was achieved" }], next_actions: ["declare at least one acceptance criterion before claiming the task is done"] }
  }

  const checks: VerificationCheck[] = acceptance.map((entry, index) => {
    const id = `${entry.kind}:${index}`
    if (entry.kind === "unsupported") return { id, status: "not_supported", detail: entry.reason }
    if (!document) return { id, status: "unknown", detail: "there is no candidate document to check" }

    switch (entry.kind) {
      case "has_primitive": {
        const found = document.primitives.some((primitive) => primitive.type === entry.type)
        return { id, status: found ? "passed" : "failed", detail: found ? `a ${entry.type} exists` : `no ${entry.type} exists` }
      }
      case "has_entity": {
        const found = document.primitives.some((primitive) => primitive.id === entry.id)
        return { id, status: found ? "passed" : "failed", detail: found ? `${entry.id} exists` : `no object ${entry.id}` }
      }
      case "has_label": {
        const found = document.primitives.some((primitive) => primitive.label === entry.label)
        return { id, status: found ? "passed" : "failed", detail: found ? `an object is labelled ${entry.label}` : `no object is labelled ${entry.label}` }
      }
      case "edge_length": {
        const extent = extentOf(document, entry.id)
        // 读不出几何 ≠ 尺寸不对：那是 `unknown`（这一层够不到），不是 `failed`。
        if (extent === null) return { id, status: "unknown", detail: `cannot read the extent of ${entry.id}` }
        const tolerance = entry.tolerance ?? DEFAULT_TOLERANCE
        const mismatched = extent.filter((value) => Math.abs(value - entry.expected) > tolerance)
        return {
          id,
          status: mismatched.length === 0 ? "passed" : "failed",
          detail: mismatched.length === 0
            ? `${entry.id} measures ${entry.expected}`
            : `${entry.id} measures [${extent.join(", ")}], expected ${entry.expected}`
        }
      }
      default: {
        // 判别联合已穷尽；真到这里说明条件来自不可信来源，如实报 `not_supported`。
        return { id, status: "not_supported", detail: "unknown acceptance check kind" }
      }
    }
  })

  /**
   * 汇总口径与 `taskVerification` **逐字一致**（`failed` > `not_supported` > `unknown` > `passed`）。
   * 两处各写一套口径就会出现"同一个任务在两个地方判得不一样"，那是这个项目已经吃过亏的坑。
   */
  const status: VerificationReport["status"] = checks.some((check) => check.status === "failed") ? "failed"
    : checks.some((check) => check.status === "not_supported") ? "not_supported"
      : checks.some((check) => check.status === "unknown") ? "unknown"
        : checks.some((check) => check.status === "approximate") ? "approximate"
          : "passed"

  const candidate: VerificationReport = { status, checks, next_actions: status === "passed" ? [] : checks.filter((check) => check.status !== "passed").map((check) => `${check.id}: ${check.detail}`) }
  const parsed = parseVerificationReport(candidate)
  return parsed.ok ? parsed.value : candidate
}
