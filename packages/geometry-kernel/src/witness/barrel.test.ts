import { describe, expect, it } from "vitest"

import { buildFromPoints, candidateResiduals, constructPyramidWitness, constructWitnessShape, createBuilderContext } from "@draw/geometry-kernel"

/**
 * **barrel 导出守卫**（N2 子任务 2a 的授权偏离）：2b 要从包根取用见证构造，
 * 所以这里钉住"它们真的能从 `@draw/geometry-kernel` 导入且可用" —— 少一个导出，
 * 下游就要改成相对路径，分层随之破掉。
 */
describe("witness exports from the barrel", () => {
  it("exposes the constructors and residuals from the package root, and the kernel accepts the produced faces", () => {
    const witness = constructWitnessShape({
      shape: "pyramid",
      base: ["A", "B", "C"],
      apex: { at: "P", foot: "A", height: { kind: "fixed", value: 2 } },
      relations: [
        { kind: "perpendicular", segments: [["A", "B"], ["A", "C"]] },
        { kind: "perpendicular", segments: [["P", "A"], ["A", "B"], ["A", "C"]] }
      ]
    })
    expect(witness.status).toBe("candidate")
    if (witness.status !== "candidate") return
    expect(constructPyramidWitness).toBeTypeOf("function")
    expect(candidateResiduals).toBeTypeOf("function")

    // 内核自己的拓扑构造必须接受构造器给出的坐标与面环（这是 2b 的真正入口）。
    const built = buildFromPoints(
      { vertices: witness.witness.buildOrder.map((index) => witness.witness.points[index]), faces: witness.witness.faces },
      createBuilderContext("barrel")
    )
    expect(built.diagnostics).toEqual([])
    expect(built.polyhedronId).toBeDefined()
  })
})
