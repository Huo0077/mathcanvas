import { describe, expect, it } from "vitest"

import type { VerificationReport } from "../contracts"
import { verificationGate, type VerificationGateCode } from "./completionGate"

/**
 * **"没有验证证据就不许进入确认"**（Phase 3 / Task 3.3）。
 *
 * 这一组用例的判据是计划里那两句话：
 * "Forbid inferring task success from revision growth, draft stage success, or model text claims."
 * 与 "没有验证证据时，Agent 只能停在修复、等待或失败，不能报告完成。"
 *
 * 所以每一格里最要紧的都是**拒绝**：一个会放行的门禁比没有门禁更坏，
 * 因为它让"验过了"变成一句没有依据的话，而整个管线看起来是绿的。
 */

const report = (status: VerificationReport["status"], checks: VerificationReport["checks"]): VerificationReport => ({ status, checks, next_actions: [] })
const ok = (id: string) => ({ id, status: "passed" as const, detail: `${id} holds` })

function rejected(value: unknown): VerificationGateCode {
  const gate = verificationGate(value as VerificationReport | null | undefined)
  expect(gate.proceed, `expected the gate to block ${JSON.stringify(value)}`).toBe(false)
  if (gate.proceed) throw new Error("unreachable")
  return gate.code
}

describe("the completion gate blocks everything that is not evidence", () => {
  it("blocks a run that produced no verification report at all", () => {
    // "草稿暂存成功了"不是证据 —— 没有报告就是没有证据。
    expect(rejected(null)).toBe("no_verification_report")
    expect(rejected(undefined)).toBe("no_verification_report")
  })

  it("blocks a failed report and keeps the failing checks actionable", () => {
    const gate = verificationGate(report("failed", [
      { id: "cube-exists", status: "failed", detail: "no object cube" },
      ok("center")
    ]))

    expect(gate.proceed).toBe(false)
    if (gate.proceed) return
    expect(gate.code).toBe("verification_failed")
    expect(gate.reason).toContain("no object cube")
    // 下一步必须来自报告自己的检查项，而不是这里另编一句话。
    expect(gate.next_actions[0]).toContain("cube-exists")
  })

  it("treats a 'passed' status that contains a failed check as a failure, not a bookkeeping error", () => {
    /**
     * 这一格最危险：`status: "passed"` 而 check 里有失败。只看 `status` 的实现会**放行**它。
     *
     * 我们把它读成**确定的失败**（`status` 那个字段填错了），而不是"自相矛盾" ——
     * 后者听起来像一次记账错误、可以忽略，而它实际上是一次失败。
     */
    expect(rejected(report("passed", [ok("a"), { id: "b", status: "failed", detail: "b does not hold" }]))).toBe("verification_failed")
  })

  it("reports self-inconsistency when a 'passed' status disagrees with a merely inconclusive check", () => {
    // 没有 failed、没有 not_supported，却自称 passed 而 check 说"不知道" —— 这才是契约违反。
    expect(rejected(report("passed", [ok("a"), { id: "b", status: "unknown", detail: "cannot read it" }]))).toBe("verification_self_inconsistent")
  })

  it("blocks a passed report that carries no checks", () => {
    // "通过但一条 check 都没有"长得最像成功，所以必须单独挡。
    expect(rejected(report("passed", []))).toBe("verification_has_no_checks")
  })

  it("blocks not_supported, because 'we did not verify' is not 'verified'", () => {
    expect(rejected(report("not_supported", [{ id: "visual", status: "not_supported", detail: "no judge" }]))).toBe("verification_incomplete")
    // 报告说 passed、但里面混着 not_supported，同样不放行。
    expect(rejected(report("passed", [ok("a"), { id: "visual", status: "not_supported", detail: "no judge" }]))).toBe("verification_incomplete")
  })

  it("names every unverified diagram condition instead of showing only the first", () => {
    const gate = verificationGate(report("not_supported", [
      { id: "diagram:0", status: "not_supported", detail: "平面ABD⊥平面BCD：缺少点名" },
      { id: "diagram:1", status: "not_supported", detail: "二面角E-BC-D=45°：角度无法计算" }
    ]))
    expect(gate.proceed).toBe(false)
    if (!gate.proceed) {
      expect(gate.reason).toContain("平面ABD⊥平面BCD")
      expect(gate.reason).toContain("二面角E-BC-D=45°")
    }
  })
  it("blocks unknown and approximate, because inconclusive is not a pass", () => {
    expect(rejected(report("unknown", [{ id: "size", status: "unknown", detail: "cannot read the extent" }]))).toBe("verification_inconclusive")
    expect(rejected(report("approximate", [{ id: "size", status: "approximate", detail: "sampled, not proved" }]))).toBe("verification_inconclusive")
  })

  it("proceeds only when the report really is complete evidence", () => {
    const gate = verificationGate(report("passed", [ok("cube-exists"), ok("edge-length"), ok("clipped")]))

    expect(gate.proceed).toBe(true)
    if (!gate.proceed) return
    expect(gate.report.checks).toHaveLength(3)
  })

  it("is the single definition of the criterion, so callers cannot disagree", () => {
    /**
     * 判据只有这一处实现。这条用例钉的是**性质**而不是某个分支：
     * 对同一份报告问两次，答案必须一致（没有隐藏状态），
     * 而且返回的报告就是传进去的那一份（门禁不改写证据）。
     */
    const input = report("passed", [ok("a")])
    const first = verificationGate(input)
    const second = verificationGate(input)

    expect(first.proceed).toBe(second.proceed)
    if (first.proceed && second.proceed) expect(first.report).toBe(input)
  })
})
