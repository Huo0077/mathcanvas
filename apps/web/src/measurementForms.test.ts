import { describe, expect, it } from "vitest"

import type { Measurement3 } from "@draw/dsl"

import { measurementFormSuffix } from "./measurementForms"

/**
 * 读数的"精确 / 近似形式"后缀。
 *
 * 用户口径（2026-09-19）："这个近似不那么好用，手稍微偏一偏分数就没了，我们不需要那么精确，
 * 我们要将数据往常见整数和分数上面靠。"
 *
 * 这一份是**唯一的**格式化出处：平面画布的常驻数字、立体几何的画布标注与右侧属性栏的测量卡片
 * 都调它。历史上"度量名 → 中文"曾有三份副本（见 `measurementLabels.ts` 的注释），
 * 数值转换面板本来会成为第四份；这次从第一行就只留一份。
 */
const measurement = (value: number | undefined, status: Measurement3["status"] = "valid"): Measurement3 => ({
  id: "m-length",
  kind: "measurement3",
  sourceIds: ["a", "b"],
  metric: "length",
  value,
  unit: "u",
  precision: "numeric-approximation",
  status,
  explanation: ""
})

describe("measurement form suffix", () => {
  it("appends the exact form when the value really is that form", () => {
    // 精确层：不带 ≈（"能准确计算时还是保留精度"）。
    expect(measurementFormSuffix(measurement(Math.PI / 2))).toBe(" · π/2")
    expect(measurementFormSuffix(measurement(1 / 3))).toBe(" · 1/3")
    expect(measurementFormSuffix(measurement(Math.SQRT2))).toBe(" · √2")
  })

  it("marks a form that was snapped from a dragged value", () => {
    // 吸附层：全精度浮点（拖动出来的）也要认得出常见值，但必须带 ≈。
    expect(measurementFormSuffix(measurement(0.667023))).toBe(" · ≈ 2/3")
    expect(measurementFormSuffix(measurement(1.41421))).toBe(" · ≈ √2")
  })

  it("carries e through like any other named constant", () => {
    // 用户口径（2026-09-19 当天追加）："e 也需要有"。它以前会被吸到 ≈ 27/10。
    expect(measurementFormSuffix(measurement(Math.E))).toBe(" · e")
    expect(measurementFormSuffix(measurement(2.7183))).toBe(" · ≈ e")
  })

  it("stays silent where the suffix would only repeat the number", () => {
    // 整数：3 位小数的读数已经把 4 说清楚了，再挂一个 "· 4" 是噪声。
    expect(measurementFormSuffix(measurement(4))).toBe("")
    // 两位小数兜底（≈ 0.64）与 "0.644" 是同一个信息，重复没有意义。
    expect(measurementFormSuffix(measurement(0.6435))).toBe("")
  })

  it("never decorates a measurement that has no honest value", () => {
    expect(measurementFormSuffix(measurement(undefined, "insufficient-data"))).toBe("")
    expect(measurementFormSuffix(measurement(Number.NaN, "numeric-failure"))).toBe("")
    expect(measurementFormSuffix(measurement(0.666667, "degenerate"))).toBe("")
  })
})
