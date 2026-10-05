import { describe, expect, it } from "vitest"

import { selectWitness, type WitnessRequest } from "./underdetermined"
import { selectWitnessWithoutSearch } from "./witnessSelection"

/**
 * **不需要编译器的那几族选择器**（复核裁决 R29-B）。
 *
 * 这个文件钉住拆分的**契约**，而不是重述实现：
 *
 * 1. `polyhedron` 在**类型上**进不了叶子模块（下面那段 `@ts-expect-error` 由 `npm run typecheck`
 *    执行 —— 哪天它不再是类型错误，"未使用的 expect-error" 会让门禁红）；
 * 2. facade（`selectWitness`）对这几族的结果与叶子**逐字段相同** —— 也就是"没有第二份实现"，
 *    而这条不是靠读代码相信的，是靠 `toEqual` 断言的。
 */
describe("compiler-free witness selection (leaf module)", () => {
  it("keeps the facade and the leaf identical for every kind the leaf owns", () => {
    const requests: WitnessRequest[] = [
      { kind: "triangle", prompt: "画一个三角形 ABC 的示意图" },
      { kind: "triangle", prompt: "证明任意三角形都成立" },
      { kind: "triangle", constraints: { triangle: { a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, c: { x: 0, y: 2 } } } },
      { kind: "slope" },
      { kind: "slope", constraints: { slope: 2.5 } },
      { kind: "prism", prompt: "画一个棱柱" },
      { kind: "prism", constraints: { vector: { x: 0, y: 0, z: 5 } } },
      { kind: "prism", prompt: "证明任意棱柱都满足某结论" },
      { kind: "moving_point" },
      { kind: "moving_point", constraints: { parameter: 0.75 } }
    ]

    for (const request of requests) {
      // facade 的入参类型是宽的那个（含 polyhedron），叶子只收纯族 —— 这条断言顺带证明
      // "转调"没有在两边各写一份文案（`considered` / `assumption` / 诊断都逐字段相等）。
      expect(selectWitness(request), request.kind).toEqual(selectWitnessWithoutSearch({ ...request, kind: request.kind as "triangle" | "slope" | "prism" | "moving_point" }))
    }
  })

  it("still answers the documented shapes for the audit's kind (prism)", () => {
    const result = selectWitnessWithoutSearch({ kind: "prism" })

    expect(result.status).toBe("witness")
    if (result.status !== "witness" || result.value.kind !== "prism") throw new Error("expected a prism witness")
    expect(result.value.basePolygon).toHaveLength(4)
    expect(result.value.vector).toEqual({ x: 0, y: 0, z: 3 })
    expect(result.assumption.path).toBe("witness.prism")
  })

  it("rejects a polyhedron request at the type level", () => {
    // 只做类型检查，不执行：这是"叶子模块不负责需要编译器的族"的可执行断言。
    function typeLevelOnly(): void {
      // @ts-expect-error polyhedron 的选择要经过搜索器（因此经过编译器），叶子模块在类型上就拒绝它
      selectWitnessWithoutSearch({ kind: "polyhedron" })
    }
    expect(typeof typeLevelOnly).toBe("function")
  })
})
