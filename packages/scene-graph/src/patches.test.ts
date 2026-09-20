import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { applyOperation, isDomainOperation } from "./operations"
import { commitPatch, validatePatch } from "./patches"

/**
 * Task 0.3：堵住 **unknown-operation** 与 **false-change** 两个洞。
 *
 * 前者是真实安全缺口：`validatePatch` 逐条 `if (operation.op === "...")` 检查，
 * 一个**没被任何分支覆盖**的 op 会绕过全部校验、直接返回 valid —— 模型或旧版本客户端
 * 塞一个 `{op:"explodeEverything"}` 进来就能进到执行路径。
 * 后者是账本问题：没有语义变化的操作不该把 revision 推高（否则撤销栈里全是空步）。
 */
describe("domain operation runtime guard", () => {
  it("rejects an unknown operation even when TypeScript was bypassed", () => {
    const document = createEmptyDocument("conics")
    const smuggled = { op: "explodeEverything", id: "point-1" } as unknown as Parameters<typeof validatePatch>[1]

    const validation = validatePatch(document, smuggled)

    expect(validation.valid).toBe(false)
    // `PatchValidationResult` 是判别联合：先收窄再读 errors（tsc 会拦住直接访问）。
    if (!validation.valid) {
      expect(validation.errors.join(", ")).toContain("unknown operation")
    } else {
      throw new Error("expected the unknown operation to be rejected")
    }
  })

  it("exposes one guard that both validation and adapters share", () => {
    expect(isDomainOperation({ op: "addPrimitive", primitive: { id: "p1", type: "point", x: 0, y: 0 } })).toBe(true)
    expect(isDomainOperation({ op: "deleteObject", id: "p1" })).toBe(true)
    expect(isDomainOperation({ op: "explodeEverything" })).toBe(false)
    expect(isDomainOperation(null)).toBe(false)
    expect(isDomainOperation("addPrimitive")).toBe(false)
    expect(isDomainOperation({})).toBe(false)
  })
})

describe("no-op input must not advance the revision", () => {
  it("reports unchanged for a visibility update that changes nothing", () => {
    const document = createEmptyDocument("conics")
    const added = commitPatch(document, { op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 0, y: 0, visible: false } })
    expect(added.changed).toBe(true)
    const revisionAfterAdd = added.document.revision

    // 已经是 false，再设一次 false：语义没有变化。
    const unchanged = commitPatch(added.document, { op: "toggleVisibility", id: "point-1", visible: false })

    expect(unchanged.changed).toBe(false)
    expect(unchanged.document.revision).toBe(revisionAfterAdd)
  })

  it("still reports a real visibility flip as changed", () => {
    const document = createEmptyDocument("conics")
    const added = commitPatch(document, { op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 0, y: 0, visible: false } })
    const flipped = commitPatch(added.document, { op: "toggleVisibility", id: "point-1", visible: true })

    expect(flipped.changed).toBe(true)
    expect(flipped.document.revision).toBeGreaterThan(added.document.revision)
  })

  it("keeps applyOperation honest about semantic change", () => {
    const document = createEmptyDocument("conics")
    const added = applyOperation(document, { op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 0, y: 0 } })
    const revisionAfterAdd = added.document.revision
    const noop = applyOperation(added.document, { op: "toggleVisibility", id: "point-1", visible: true })

    // 本来就是可见的：再"设为可见"不该被算成一次改动。
    expect(noop.changed).toBe(false)
    expect(noop.document.revision).toBe(revisionAfterAdd)
  })
})