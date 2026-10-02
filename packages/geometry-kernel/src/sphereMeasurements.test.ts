import { describe, expect, it } from "vitest"

import { createEmptyDocument, type Measurement3, type PrimitiveSpec } from "@draw/dsl"

import { calculateMeasurement3 } from "./measurements3d"

/**
 * 球的表面积与体积（实施计划 Task 3 的测量那一半）。
 *
 * 判据是**闭式**而不是"从显示网格数出来"：
 * - 面积 `4πr²`、体积 `4πr³/3`，`precision` 必须是 `"exact-input"`；
 * - 拿 r=2 钉住具体数值：面积 `16π`、体积 `32π/3`（不是"约等于 50.27"）。
 *
 * 为什么值得单独钉：同一个球如果走"三角网格求和"，48 边形的结果会明显偏小，而且**随画布网格密度变化** ——
 * 那样测出来的数会跟着渲染设置漂。球是解析实体，读数也必须来自解析式。
 */

const sphere = (radius: number, id = "sphere-1"): PrimitiveSpec => ({ id, type: "sphere", center: { x: 1, y: 2, z: 3 }, radius })

const measurement = (metric: Measurement3["metric"], sourceIds: string[]): Measurement3 => ({
  id: `m-${metric}`,
  kind: "measurement3",
  sourceIds,
  metric,
  precision: "numeric-approximation",
  status: "valid",
  explanation: ""
})

const document = createEmptyDocument("geometry3d")

describe("sphere measurements are closed form, not mesh sums", () => {
  it("reads the surface area as 4πr² and marks it exact-input", () => {
    const result = calculateMeasurement3(measurement("area", ["sphere-1"]), [sphere(2)])

    expect(result.status).toBe("valid")
    expect(result.precision).toBe("exact-input")
    expect(result.unit).toBe("u²")
    expect(result.value).toBeCloseTo(16 * Math.PI, 12)
    // 特意与"从 48 边形网格数出来"的值对比：那个数会明显小一截，钉住这一点防退回。
    expect(result.value).toBeGreaterThan(16 * Math.PI - 1e-9)
  })

  it("reads the volume as 4πr³/3 and marks it exact-input", () => {
    const result = calculateMeasurement3(measurement("volume", ["sphere-1"]), [sphere(2)])

    expect(result.status).toBe("valid")
    expect(result.precision).toBe("exact-input")
    expect(result.unit).toBe("u³")
    expect(result.value).toBeCloseTo((32 * Math.PI) / 3, 12)
  })

  it("scales with the radius instead of reusing one hard-coded number", () => {
    const small = calculateMeasurement3(measurement("volume", ["sphere-1"]), [sphere(1)])
    const large = calculateMeasurement3(measurement("volume", ["sphere-1"]), [sphere(3)])

    expect(small.value).toBeCloseTo((4 * Math.PI) / 3, 12)
    // 体积按 r³ 走：3 倍半径 = 27 倍体积。这比"两个数不相等"强得多。
    expect(large.value! / small.value!).toBeCloseTo(27, 9)
  })

  it("accepts the document's primitive map as well as an array", () => {
    const byId = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
    byId.set("sphere-1", sphere(2))

    expect(calculateMeasurement3(measurement("area", ["sphere-1"]), byId).value).toBeCloseTo(16 * Math.PI, 12)
  })
})
