import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument, type Measurement3, type PrimitiveSpec } from "@draw/dsl"

import { planarMeasurementPosition, planarMeasurementText, planarMeasurementVisuals } from "./planarMeasurementVisuals"

/**
 * 平面画布的常驻测量数字（slice 5）。
 *
 * 用户口径："我希望数学测量的结果能在图中浮现一个数字，而不是非要去看右侧属性栏。"
 * 这一组用例守两件事：**位置按类型算对**（长度中点 / 距离垂足中点 / 角度角平分线 / 面积形心），
 * 以及"算不出位置就不画"（退化与缺失来源绝不产出假数字）。
 */
function documentWith(primitives: PrimitiveSpec[], measurements: Measurement3[]): GeometryDocument {
  return { ...createEmptyDocument("conics"), primitives, measurements }
}

const point = (id: string, x: number, y: number): PrimitiveSpec => ({ id, type: "point", x, y })
const measurement = (metric: Measurement3["metric"], sourceIds: string[], value: number, unit: string): Measurement3 => ({
  id: `m-${metric}`,
  kind: "measurement3",
  sourceIds,
  metric,
  value,
  unit,
  precision: "numeric-approximation",
  status: "valid",
  explanation: ""
})

describe("planar measurement labels for line and circle sources", () => {
  /**
   * 用户口径："由动点引申出来的图元（如切线，动圆）也需要具有正常图元的基本功能"。
   * 画布数字以前只画点类测量：圆的面积、两线夹角这类测量在画布上**没有数字**。
   */
  const circle: PrimitiveSpec = { id: "c1", type: "circle", center: { x: 2, y: -1 }, radius: 3 }
  const line: PrimitiveSpec = { id: "l1", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }
  const tangent: PrimitiveSpec = { id: "t1", type: "tangent", sourceId: "c1", x: 0, point: { x: 5, y: -1 }, slope: 0, a: { x: 5, y: -1 }, b: { x: 5, y: 1 }, status: "approximate" }

  it("labels a circle's area and perimeter with the right units, at the centre", () => {
    const document = documentWith([circle], [measurement("area", ["c1"], Math.PI * 9, "u²"), measurement("perimeter", ["c1"], Math.PI * 6, "u")])

    const labels = planarMeasurementVisuals(document)

    expect(labels.map((label) => label.text)).toEqual(["面积：28.274u² · 9π", "周长：18.850u · 6π"])
    // 圆的读数摆在圆心，不是随便飘着。
    expect(labels[0].position).toEqual({ x: 2, y: -1 })
  })

  it("labels the angle between a tangent and a line", () => {
    const document = documentWith([line, tangent], [measurement("angle", ["l1", "t1"], Math.PI / 2, "rad")])

    const labels = planarMeasurementVisuals(document)

    expect(labels).toHaveLength(1)
    expect(labels[0].text).toBe("角度：1.571rad · π/2")
    expect(Number.isFinite(labels[0].position.x) && Number.isFinite(labels[0].position.y)).toBe(true)
  })

  it("still draws nothing when a source disappears", () => {
    const document = documentWith([circle], [measurement("area", ["c-missing"], Math.PI * 9, "u²")])

    expect(planarMeasurementVisuals(document)).toEqual([])
  })
})

describe("planar measurement labels", () => {
  it("shows the same text the inspector shows, and places a length at the midpoint", () => {
    const document = documentWith([point("a", 0, 0), point("b", 4, 0)], [measurement("length", ["a", "b"], 4, "u")])

    const [label] = planarMeasurementVisuals(document)
    // 与属性栏同一份文本（一个测量只有一个数）。整数的精确形式与小数读数重复，所以不挂后缀。
    expect(label.text).toBe("长度：4.000u")
    expect(label.position.x).toBeCloseTo(2, 12)
    expect(label.position.y).toBeCloseTo(0, 12)
    expect(label.selected).toBe(false)
  })

  /**
   * 用户口径（2026-09-19）："这个近似不那么好用，手稍微偏一偏分数就没了……我们要将数据往常见
   * 整数和分数上面靠。" 画布数字是拖动时眼睛所在的地方，所以"分数掉没掉"必须在这里就能看见。
   */
  it("hangs the common form on the canvas number, marked when it was snapped", () => {
    // 0.667023 是拖动出来的全精度浮点：吸附层认出 2/3，带 ≈。
    const dragged = documentWith([point("a", 0, 0), point("b", 1, 0)], [measurement("length", ["a", "b"], 0.667023, "u")])
    expect(planarMeasurementVisuals(dragged)[0].text).toBe("长度：0.667u · ≈ 2/3")

    // 精确值的 3-4-5 斜边：整数 ⇒ 不加后缀（读数自己就是 5.000）。
    const exact = documentWith([point("a", 0, 0), point("b", 3, 0), point("c", 0, 4)], [measurement("distance", ["b", "a", "c"], 5, "u")])
    expect(planarMeasurementVisuals(exact)[0].text).toBe("距离：5.000u")
  })

  it("puts a point-to-line distance between the foot of the perpendicular and the point", () => {
    // A(0,0) B(4,0) 定义直线，P(1,3) 到它的垂足是 (1,0) ⇒ 标签落在 (1, 1.5)。
    const document = documentWith([point("a", 0, 0), point("b", 4, 0), point("p", 1, 3)], [measurement("distance", ["a", "b", "p"], 3, "u")])

    const [label] = planarMeasurementVisuals(document)
    expect(label.position.x).toBeCloseTo(1, 12)
    expect(label.position.y).toBeCloseTo(1.5, 12)
  })

  it("keeps two-point distances at the midpoint as well", () => {
    const document = documentWith([point("a", 0, 0), point("b", 0, 2)], [measurement("distance", ["a", "b"], 2, "u")])
    const [label] = planarMeasurementVisuals(document)
    expect(label.position.x).toBeCloseTo(0, 12)
    expect(label.position.y).toBeCloseTo(1, 12)
  })

  it("offsets an angle label along the bisector so it never sits on the vertex", () => {
    // 顶点是**第二个**点（下标 1）：A(2,0)、V(0,0)、B(0,2) ⇒ 角平分线是 (1,1)/√2。
    const document = documentWith([point("a", 2, 0), point("v", 0, 0), point("b", 0, 2)], [measurement("angle", ["a", "v", "b"], Math.PI / 2, "rad")])

    const [label] = planarMeasurementVisuals(document)
    // 平面角的单位也是**弧度**（两边统一，见 `measurements3d` 的说明），后缀是它的精确形式。
    expect(label.text).toBe("角度：1.571rad · π/2")
    expect(label.position.x).toBeGreaterThan(0)
    expect(label.position.y).toBeGreaterThan(0)
    // 落在角平分线上（x == y），而且离顶点有一段距离（不压在顶点上）。
    expect(label.position.x).toBeCloseTo(label.position.y, 12)
    expect(Math.hypot(label.position.x, label.position.y)).toBeGreaterThan(0.2)
  })

  it("puts an area label on the centroid of the source points", () => {
    const document = documentWith([point("a", 0, 0), point("b", 6, 0), point("c", 0, 3)], [measurement("area", ["a", "b", "c"], 9, "u²")])
    const [label] = planarMeasurementVisuals(document)
    expect(label.position.x).toBeCloseTo(2, 12)
    expect(label.position.y).toBeCloseTo(1, 12)
  })

  it("never invents a number or a position for a degenerate or incomplete measurement", () => {
    const primitives = [point("a", 0, 0), point("b", 4, 0)]
    // 退化（两点重合 ⇒ 长度为 0）：既不产出文本，也不产出位置。
    const degenerate: Measurement3 = { ...measurement("length", ["a", "b"], 0, "u"), status: "degenerate", explanation: "两个点重合" }
    expect(planarMeasurementText(degenerate)).toBeNull()
    expect(planarMeasurementVisuals(documentWith(primitives, [degenerate]))).toHaveLength(0)

    // 值缺失（内核算不出来）：同样不画。
    const missing: Measurement3 = { ...measurement("length", ["a", "b"], 0, "u"), value: undefined, status: "insufficient-data" }
    expect(planarMeasurementVisuals(documentWith(primitives, [missing]))).toHaveLength(0)

    // 来源点被删掉：位置无从谈起，不猜一个地方摆。
    const dangling = measurement("length", ["a", "gone"], 4, "u")
    expect(planarMeasurementVisuals(documentWith(primitives, [dangling]))).toHaveLength(0)

    // 三点共线（面积 0）时，位置本身还能算，但状态已经不是 valid ⇒ 不产出。
    const collinear: Measurement3 = { ...measurement("area", ["a", "b", "c"], 0, "u²"), status: "degenerate" }
    expect(planarMeasurementVisuals(documentWith([...primitives, point("c", 8, 0)], [collinear]))).toHaveLength(0)
  })

  it("refuses a position it cannot define, and flags the selected measurement", () => {
    // 角度两边都退化为零向量：位置算不出来（不返回一个碰巧的坐标）。
    expect(planarMeasurementPosition(measurement("angle", ["a", "v", "b"], 1, "rad"), [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }])).toBeNull()
    // 定义直线的两点重合：垂足无从谈起。
    expect(planarMeasurementPosition(measurement("distance", ["a", "b", "p"], 1, "u"), [{ x: 2, y: 2 }, { x: 2, y: 2 }, { x: 5, y: 5 }])).toBeNull()

    // 选中来源时标签带高亮标记（数字常驻之后，"我选的是哪条"仍然看得出来）。
    const document = documentWith([point("a", 0, 0), point("b", 4, 0)], [measurement("length", ["a", "b"], 4, "u")])
    expect(planarMeasurementVisuals(document, ["a"])[0].selected).toBe(true)
    expect(planarMeasurementVisuals(document, ["m-length"])[0].selected).toBe(false)
  })
})
