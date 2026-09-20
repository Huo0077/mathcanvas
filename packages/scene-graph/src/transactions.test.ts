import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { createPoint3 } from "./operations"
import { commitTransaction } from "./transactions"

/**
 * Task 0.4：**原子事务**与**顺序无关的删除**。
 *
 * 计划要修的真实缺陷：手工 UI 逐项调用 `deleteObject`，于是"点 A 与依赖它的直线 AB"一起选中时，
 * 先删点会因为"仍被引用"被拒、先删线又会把点留下 —— 谁先谁后都不对。事务必须把整批当作**并集**。
 */
function lineDocument() {
  const document = createEmptyDocument("geometry3d")
  document.primitives = [
    createPoint3("point-b", { x: 2, y: 0, z: 0 }),
    { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["point-a", "point-b"] } },
    createPoint3("point-a", { x: 0, y: 0, z: 0 })
  ]
  return document
}

describe("atomic transactions", () => {
  it("deletes a complete union regardless of the order the ids arrive in", () => {
    // 刻意用用户报的顺序 [line, b, a]：逐项删除时这个顺序会失败。
    // 两次必须基于**同一个 base 对象**：不同 `createEmptyDocument` 调用的 metadata.id 不同，
    // 那样比较哈希等于在比较两份文档（第一版就是这么写错的）。
    const base = lineDocument()
    const forward = commitTransaction({ base, operations: [{ op: "deleteObjects", ids: ["line-ab", "point-b", "point-a"] }] })
    const reversed = commitTransaction({ base, operations: [{ op: "deleteObjects", ids: ["point-a", "point-b", "line-ab"] }] })

    expect(forward.errors).toEqual([])
    expect(forward.changed).toBe(true)
    expect(forward.document.primitives).toHaveLength(0)
    // 顺序无关：两种顺序得到同一份结果。
    expect(reversed.document.primitives).toHaveLength(0)
    expect(reversed.afterHash).toBe(forward.afterHash)
    expect([...forward.diff.removed].sort()).toEqual(["line-ab", "point-a", "point-b"])
  })

  it("refuses a locked dependent and leaves the document untouched", () => {
    const base = lineDocument()
    const locked = { ...base, primitives: base.primitives.map((primitive) => primitive.id === "point-a" ? { ...primitive, locked: true } : primitive) }

    const result = commitTransaction({ base: locked, operations: [{ op: "deleteObjects", ids: ["line-ab", "point-a"] }] })

    expect(result.changed).toBe(false)
    expect(result.document).toBe(locked)
    expect(result.errors.join(", ")).toContain("locked")
  })

  it("executes all operations or none when one of them fails", () => {
    const document = createEmptyDocument("conics")
    const result = commitTransaction({
      base: document,
      operations: [
        { op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 0, y: 0 } },
        // 目标不存在：这一笔必须让**整批**回滚，而不是留下半截文档。
        { op: "deleteObject", id: "missing-1" }
      ]
    })

    expect(result.changed).toBe(false)
    expect(result.document).toBe(document)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.document.primitives).toHaveLength(0)
  })

  it("creates exactly one revision for a batch that succeeds", () => {
    const document = createEmptyDocument("conics")
    const result = commitTransaction({
      base: document,
      operations: [
        { op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 0, y: 0 } },
        { op: "addPrimitive", primitive: { id: "point-2", type: "point", x: 1, y: 0 } }
      ]
    })

    expect(result.errors).toEqual([])
    expect(result.changed).toBe(true)
    expect(result.document.primitives).toHaveLength(2)
    /**
     * revision 的语义是**内容版本号**：两笔成功操作推两格（实测 `batchResult: 2`）。
     * "一次事务 = 一步撤销"由调用方按事务粒度压栈保证（store 只把整批结果作为一步），
     * 而不是靠压住 revision —— 后者会让版本号不再反映内容变化的次数。
     */
    expect(result.document.revision).toBe(document.revision + 2)
    expect(result.diff.added).toEqual(["point-1", "point-2"])
  })

  it("rejects a transaction whose expected generation is stale", () => {
    const document = createEmptyDocument("conics")
    const result = commitTransaction({ base: document, operations: [{ op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 0, y: 0 } }], expectedGeneration: document.revision + 5 })

    expect(result.changed).toBe(false)
    expect(result.document).toBe(document)
    expect(result.errors.join(", ")).toContain("generation")
  })

  it("reports a no-op batch as unchanged instead of bumping the revision", () => {
    const document = createEmptyDocument("conics")
    const added = commitTransaction({ base: document, operations: [{ op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 0, y: 0 } }] })
    const noop = commitTransaction({ base: added.document, operations: [{ op: "toggleVisibility", id: "point-1", visible: true }] })

    expect(noop.changed).toBe(false)
    expect(noop.document.revision).toBe(added.document.revision)
  })
})