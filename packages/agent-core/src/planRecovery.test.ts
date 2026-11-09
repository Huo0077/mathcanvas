import { describe, expect, it } from "vitest"

import { MAX_REFERENCE_REPAIRS, MAX_REPAIR_ATTEMPTS } from "./contracts"
import {
  decidePlanRecovery,
  describeReferenceRepair,
  type PlanRecoveryDecision,
  type PlanRecoveryInput
} from "./planRecovery"
import { describeSchemaRecoveryHint } from "./schemas"
import type { ParseError } from "./contracts"

/**
 * **W5：计划协议与证据引用的定向恢复（2026-11-09）**。
 *
 * 现场三类失败都死在"只有一句话"上：
 * ① 缺 `alias`、坐标写成别的键、`actions` 空数组 —— 模型不知道**具体哪个字段**错了；
 * ② 回答了但引用了一个**这次没有产生**的工具结果 ID（mm-029/055/066、text-190）——
 *    原先直接进 `waiting`，用户看到一句"需要你补充"，而模型只要看到"可引用的 ID 是这几个"
 *    就能自己改对；
 * ③ auth / 取消 / 预算用尽 —— 这几类**不该**再发一次请求。
 *
 * 所以恢复决定只有一个入口 `decidePlanRecovery`，它同时回答"修不修"与"只准引用哪些 ID"。
 */

const base: PlanRecoveryInput = {
  failure: "schema",
  schemaRepairsUsed: 0,
  referenceRepairsUsed: 0,
  callsRemaining: 8,
  availableResultIds: []
}

const decision = (overrides: Partial<PlanRecoveryInput> = {}): PlanRecoveryDecision =>
  decidePlanRecovery({ ...base, ...overrides })

describe("W5 — 信封格式只修一次", () => {
  it("repairs the first schema failure", () => {
    expect(decision()).toMatchObject({ action: "repair" })
  })

  it("stops on a second schema failure instead of asking again", () => {
    expect(decision({ schemaRepairsUsed: MAX_REPAIR_ATTEMPTS }).action).toBe("stop")
    expect(decision({ schemaRepairsUsed: MAX_REPAIR_ATTEMPTS })).toMatchObject({ reason: expect.stringContaining("schema") })
  })
})

describe("W5 — 引用修复只认这次真实产生的 ID", () => {
  it("hands the model the exact ids it may cite", () => {
    const output = decision({ failure: "tool_reference", availableResultIds: ["tool-1", "tool-2"] })
    expect(output).toMatchObject({ action: "repair", allowedResultIds: ["tool-1", "tool-2"] })
    if (output.action === "repair") expect(output.hint).toContain("tool-1")
  })

  it("stops when this run produced no referenceable result at all", () => {
    expect(decision({ failure: "tool_reference", availableResultIds: [] })).toMatchObject({ action: "stop" })
  })

  it("stops at the reference repair limit and keeps the counters separate from schema repairs", () => {
    expect(decision({ failure: "tool_reference", referenceRepairsUsed: MAX_REFERENCE_REPAIRS, availableResultIds: ["tool-1"] }).action).toBe("stop")
    expect(decision({ failure: "tool_reference", schemaRepairsUsed: MAX_REPAIR_ATTEMPTS, availableResultIds: ["tool-1"] }).action).toBe("repair")
  })
})

describe("W5 — 不可恢复与超预算的失败永不重问", () => {
  it.each(["auth", "cancelled"] as const)("%s never repairs", (failure) => {
    const output = decision({ failure, availableResultIds: ["tool-1"] })
    expect(output.action).toBe("stop")
    if (output.action === "stop") expect(output.reason).toBe(failure)
  })

  it("does not send a request when the budget is gone", () => {
    expect(decision({ callsRemaining: 0, availableResultIds: ["tool-1"] })).toMatchObject({ action: "stop", reason: "budget_exhausted" })
  })
})

describe("W5 — 恢复提示点名具体字段与合法形式", () => {
  const errors: ParseError[] = [
    { code: "missing_field", path: "envelope.actions[0].inputs.alias", detail: "a new object must declare an alias" },
    { code: "invalid_type", path: "envelope.actions[1].inputs.x", detail: "expected a finite number" },
    { code: "empty_actions", path: "envelope.actions", detail: "a plan needs at least one action" }
  ]

  it("names each rejected field with the legal form", () => {
    const hint = describeSchemaRecoveryHint(errors)
    expect(hint).toContain("envelope.actions[0].inputs.alias")
    expect(hint).toContain("alias")
    expect(hint).toContain("envelope.actions[1].inputs.x")
    expect(hint).toContain("数字")
    expect(hint).toContain("envelope.actions")
    expect(hint).toContain("至少")
  })

  it("stays bounded so it can never become the whole prompt", () => {
    const many = Array.from({ length: 80 }, () => errors[0]!)
    expect(describeSchemaRecoveryHint(many).length).toBeLessThanOrEqual(4096)
    expect(describeReferenceRepair(Array.from({ length: 200 }, (_, index) => `result-${index}`)).length).toBeLessThanOrEqual(4096)
  })

  it("says a pure answer does not need an empty plan", () => {
    const hint = describeSchemaRecoveryHint([{ code: "empty_actions", path: "envelope.actions", detail: "a plan needs at least one action" }])
    expect(hint).toContain("kind")
    expect(hint).toContain("answer")
  })
})
