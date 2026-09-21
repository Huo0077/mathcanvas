import { describe, expect, it } from "vitest"

import { createIdAllocator } from "./index"

/**
 * **分配器的"占用"语义**（2026-09-21 补，来自真实现场）。
 *
 * 真缺陷：`createIdAllocator()` 的计数器从 1 开始，**完全不知道目标文档里已经有哪些 id**。
 * 于是在一个已经有 `solid-1` 的画布上，Agent 新建的第一个立体又被分配成 `solid-1` →
 * `validatePatch` 判 `duplicate object id` → 整轮运行以 `compile_failed` 结束
 * （现场见 `apps/web/src/agent/draftStore.test.ts` 里那条用例与 run 账本 `run-6-mubf109e`）。
 *
 * 这里钉住两条：
 * 1. **不发出已被占用的 id**；
 * 2. **别名幂等**依旧成立（同一 alias 再来一次还是同一个 id）—— 修复不许把这条弄丢。
 */
describe("id allocator occupancy", () => {
  it("skips ids the target document already occupies", () => {
    const allocator = createIdAllocator(["solid-1", "point-1", "point-2"])

    // 同类已占两个 → 从 point-3 开始。
    expect(allocator.allocate("point", "A")).toBe("point-3")
    expect(allocator.allocate("point", "B")).toBe("point-4")
    // 别的 kind 的已占用 id 不影响这一族。
    expect(allocator.allocate("solid", "cube")).toBe("solid-2")
    expect(allocator.allocate("circle", "c")).toBe("circle-1")
  })

  it("keeps alias idempotency while skipping occupied ids", () => {
    const allocator = createIdAllocator(["point-1"])

    expect(allocator.allocate("point", "A")).toBe("point-2")
    expect(allocator.allocate("point", "A")).toBe("point-2")
    expect(allocator.allocate("point", "B")).toBe("point-3")
  })

  it("never hands out an id twice, even with a sparse occupied set", () => {
    const allocator = createIdAllocator(["point-2", "point-5"])

    const ids = ["A", "B", "C", "D"].map((alias) => allocator.allocate("point", alias))

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain("point-2")
    expect(ids).not.toContain("point-5")
  })
})
