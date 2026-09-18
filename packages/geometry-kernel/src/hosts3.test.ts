import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import { buildSolidTemplate } from "./solid-builders"
import { clampPointIntoSolid3, circleHost3, coneSurfaceHost3, cylinderSurfaceHost3, faceHost3, host3FromPrimitive, lineHost3, planeHost3, polygonNormal3, solidVolumeHost3 } from "./hosts3"
import { circleConic3, conic3PointAt } from "./quadrics"

const a = { x: 0, y: 0, z: 0 }
const b = { x: 2, y: 0, z: 0 }

/**
 * L 形棱柱：xy 平面内的 L（右下角 (notch,notch)-(size,size) 那块被挖掉）沿 z 拉伸 `height`。
 * 面环按"从外面看逆时针"给出，与 `buildSolidTemplate` 的绕向约定一致。
 */
function lPrism(size: number, notch: number, height: number): { vertices: { x: number; y: number; z: number }[]; faces: number[][] } {
  const outline = [
    { x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: notch },
    { x: notch, y: notch }, { x: notch, y: size }, { x: 0, y: size }
  ]
  const count = outline.length
  const vertices = [
    ...outline.map((point) => ({ x: point.x, y: point.y, z: 0 })),
    ...outline.map((point) => ({ x: point.x, y: point.y, z: height }))
  ]
  return {
    vertices,
    faces: [
      Array.from({ length: count }, (_, index) => (count - index) % count),
      Array.from({ length: count }, (_, index) => index + count),
      ...Array.from({ length: count }, (_, index) => [index, (index + 1) % count, ((index + 1) % count) + count, index + count])
    ]
  }
}

describe("solid volume hosts", () => {
  /**
   * 用户要求："动点的约束应该可以在立方体内"。
   *
   * 体积宿主与线 / 面宿主是**两种**约束：线 / 面是"投影到低维宿主上"，
   * 而实体内是"已经在里面就别动，跑到外面就夹回边界"——所以 `residual` 在里面必须是 0，
   * 参数域的边界就是实体的表面。
   */
  const cube = { vertices: [
    { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 2, z: 0 },
    { x: 0, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }, { x: 2, y: 2, z: 2 }, { x: 0, y: 2, z: 2 }
  ], faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]] }

  it("maps uvw through the bounding box and keeps the point inside the solid", () => {
    const host = solidVolumeHost3(cube.vertices, cube.faces)!
    expect(host.kind).toBe("solid-volume")
    expect(host.domain.u).toEqual([0, 1])
    expect(host.domain.v).toEqual([0, 1])
    expect(host.domain.w).toEqual([0, 1])
    // 参数到坐标：uvw 是**包围盒**内的比例。
    expect(host.evaluate({ u: 0, v: 0, w: 0 })).toEqual({ x: 0, y: 0, z: 0 })
    expect(host.evaluate({ u: 0.5, v: 0.5, w: 0.5 })).toEqual({ x: 1, y: 1, z: 1 })
    expect(host.evaluate({ u: 1, v: 1, w: 1 })).toEqual({ x: 2, y: 2, z: 2 })
  })

  it("leaves an interior point alone and clamps an exterior one onto the surface", () => {
    const host = solidVolumeHost3(cube.vertices, cube.faces)!
    // 里面：残差 0，project 不动它（这就是"可以自由地在体内移动"）。
    expect(host.residual({ x: 1, y: 1, z: 1 })).toBeCloseTo(0, 9)
    expect(host.project({ x: 1, y: 0.5, z: 1.5 }).point).toEqual({ x: 1, y: 0.5, z: 1.5 })
    // 外面：夹回表面（最近的那个面），残差就是到表面的距离。
    const outside = host.project({ x: 5, y: 1, z: 1 })
    expect(outside.point.x).toBeCloseTo(2, 9)
    expect(outside.point.y).toBeCloseTo(1, 9)
    expect(outside.point.z).toBeCloseTo(1, 9)
    expect(outside.distance).toBeCloseTo(3, 9)
    expect(host.residual({ x: 1, y: -4, z: 1 })).toBeCloseTo(4, 9)
  })

  it("round-trips a point through closestParameter and evaluate", () => {
    const host = solidVolumeHost3(cube.vertices, cube.faces)!
    const inside = { x: 0.5, y: 1.5, z: 1 }
    const parameter = host.closestParameter(inside)
    expect(parameter.u).toBeCloseTo(0.25, 9)
    expect(parameter.v).toBeCloseTo(0.75, 9)
    expect(parameter.w).toBeCloseTo(0.5, 9)
    // 参数是唯一真值：由参数算回来的坐标就是它自己（体内不夹）。
    expect(host.evaluate(parameter)).toEqual(inside)
  })

  it("refuses a solid without usable faces instead of inventing a box", () => {
    expect(solidVolumeHost3(cube.vertices, [])).toBeNull()
    expect(solidVolumeHost3([{ x: 0, y: 0, z: 0 }], cube.faces)).toBeNull()
  })

  /**
   * 体检发现的真缺陷：`clampPointIntoSolid3` 用**全体顶点的形心**判断面的朝向，而凹实体的形心
   * 可能落在实体之外，于是内凹面的法向被翻反、"违反"判据看不到它，最后把点原样返回——
   * 绑在实体内、却停在空气里的点会被当成"已满足"保存下来。宁可拒绝这个宿主（约束报数据不足），
   * 也不能伪造一个体外的坐标。
   */
  it("refuses a non-convex solid instead of parking a bound point in its cavity", () => {
    const l = lPrism(3, 1, 1)
    expect(clampPointIntoSolid3(l.vertices, l.faces, { x: 3, y: 3, z: 0 })).toBeNull()
    expect(solidVolumeHost3(l.vertices, l.faces)).toBeNull()
  })

  it("refuses a prism whose face rings are wound inconsistently", () => {
    const flipped = { vertices: cube.vertices, faces: [cube.faces[0], [...cube.faces[1]].reverse(), ...cube.faces.slice(2)] }
    expect(solidVolumeHost3(flipped.vertices, flipped.faces)).toBeNull()
  })

  /**
   * 同一次体检的另一条：面法向的退化判据用的是**绝对** EPSILON（1e-12）去比 Newell 法向的模长
   * （≈ 2×面面积），于是 1e-5 量级的实体所有面平面都算不出来，`clampPointIntoSolid3` 直接
   * 在 `planes.length === 0` 处返回输入点——一个静默失效的宿主。容差必须随实体尺度缩放。
   */
  it("keeps clamping on a solid far smaller than the absolute epsilon", () => {
    const scale = 1e-5
    const tiny = {
      vertices: cube.vertices.map((vertex) => ({ x: vertex.x * scale, y: vertex.y * scale, z: vertex.z * scale })),
      faces: cube.faces
    }
    const host = solidVolumeHost3(tiny.vertices, tiny.faces)
    expect(host).not.toBeNull()
    // 立方体边长是 2，所以 u = 0.5 落在 x = 1×scale 上。
    const inside = host!.evaluate({ u: 0.5, v: 0.5, w: 0.5 })
    expect(inside.x / scale).toBeCloseTo(1, 9)
    // 外面 2 倍远的点必须被夹回表面，而不是原样返回（旧实现在这里静默失效）。
    const clamped = host!.project({ x: 4 * scale, y: scale, z: scale })
    expect(clamped.point.x / scale).toBeCloseTo(2, 9)
    expect(clamped.distance / scale).toBeCloseTo(2, 9)
  })
})

describe("line hosts", () => {
  it("evaluates the affine parameter and reports its domain", () => {
    const segment = lineHost3(a, b, "segment")!
    expect(segment.evaluate({ u: 0 })).toEqual(a)
    expect(segment.evaluate({ u: 0.5 })).toEqual({ x: 1, y: 0, z: 0 })
    expect(segment.evaluate({ u: 1 })).toEqual(b)
    expect(segment.domain.u).toEqual([0, 1])
    expect(segment.kind).toBe("segment")
    expect(lineHost3(a, b, "ray")!.domain.u).toEqual([0, Number.POSITIVE_INFINITY])
    expect(lineHost3(a, b, "line")!.domain.u).toEqual([Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY])
  })

  it("clamps the closest parameter into the domain instead of leaving the host", () => {
    expect(lineHost3(a, b, "segment")!.closestParameter({ x: 5, y: 3, z: 0 })).toEqual({ u: 1 })
    expect(lineHost3(a, b, "line")!.closestParameter({ x: 5, y: 3, z: 0 }).u).toBeCloseTo(2.5, 10)
    expect(lineHost3(a, b, "ray")!.closestParameter({ x: -4, y: 0, z: 0 })).toEqual({ u: 0 })
  })

  it("projects and measures the residual", () => {
    const segment = lineHost3(a, b, "segment")!
    const projected = segment.project({ x: 1, y: 3, z: 0 })
    expect(projected.point).toEqual({ x: 1, y: 0, z: 0 })
    expect(projected.distance).toBeCloseTo(3, 10)
    expect(segment.residual({ x: 1, y: 3, z: 0 })).toBeCloseTo(3, 10)
    // 落在宿主上的点残差为 0 —— 这是"点永远贴住宿主"的可测判据。
    expect(segment.residual({ x: 0.25, y: 0, z: 0 })).toBeCloseTo(0, 10)
  })

  it("refuses degenerate hosts", () => {
    expect(lineHost3(a, { x: 0, y: 0, z: 0 }, "segment")).toBeNull()
  })
})

describe("face and plane hosts", () => {
  // 4×4 的正方形，落在 z = 0 平面上。
  const square = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }]

  it("projects points inside the ring onto the plane, and clamps the rest to the boundary", () => {
    const face = faceHost3(square)!
    expect(face.kind).toBe("face")
    expect(face.evaluate({ u: 1, v: 2 })).toEqual({ x: 1, y: 2, z: 0 })
    expect(face.domain.u).toEqual([0, 4])
    expect(face.domain.v).toEqual([0, 4])

    // 环内：正交投影，残差就是到平面的距离。
    expect(face.project({ x: 2, y: 2, z: 5 }).point).toEqual({ x: 2, y: 2, z: 0 })
    expect(face.residual({ x: 2, y: 2, z: 5 })).toBeCloseTo(5, 10)

    // 一条边外：夹到最近的那条边上，而不是留在平面里的虚空处。
    expect(face.project({ x: 6, y: 2, z: 0 }).point).toEqual({ x: 4, y: 2, z: 0 })
    expect(face.residual({ x: 6, y: 2, z: 0 })).toBeCloseTo(2, 10)

    // 对角外侧：夹到最近的顶点。
    expect(face.project({ x: 6, y: 6, z: 0 }).point).toEqual({ x: 4, y: 4, z: 0 })
    expect(face.residual({ x: 6, y: 6, z: 0 })).toBeCloseTo(Math.hypot(2, 2), 10)
  })

  it("refuses rings that are not coplanar or too small", () => {
    expect(faceHost3([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])).toBeNull()
    expect(faceHost3([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }])).toBeNull()
    expect(faceHost3([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 3 }])).toBeNull()
  })

  it("keeps a plane host unbounded", () => {
    const plane = planeHost3({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })!
    expect(plane.kind).toBe("plane")
    expect(plane.domain.u).toEqual([Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY])
    expect(plane.project({ x: 3, y: 4, z: 9 }).point).toEqual({ x: 3, y: 4, z: 0 })
    expect(plane.residual({ x: 3, y: 4, z: 9 })).toBeCloseTo(9, 10)
    expect(plane.residual({ x: 3, y: 4, z: 0 })).toBeCloseTo(0, 10)
  })
})

describe("surface hosts", () => {
  const center = { x: 0, y: 0, z: 0 }

  it("puts cylinder points on the lateral surface and clamps the axial parameter", () => {
    const cylinder = cylinderSurfaceHost3(center, 2, 4)!
    expect(cylinder.kind).toBe("cylinder-surface")
    expect(cylinder.domain.u).toEqual([0, Math.PI * 2])
    expect(cylinder.domain.closedU).toBe(true)
    expect(cylinder.evaluate({ u: 0, v: 0.5 }).x).toBeCloseTo(2, 10)
    expect(cylinder.evaluate({ u: 0, v: 0.5 }).z).toBeCloseTo(2, 10)

    // 侧面上的点残差为 0。
    expect(cylinder.residual({ x: 2, y: 0, z: 2 })).toBeCloseTo(0, 10)
    // 轴上的点沿半径投影到最近的侧面点。
    const onAxis = cylinder.project({ x: 0, y: 0, z: 2 })
    expect(onAxis.distance).toBeCloseTo(2, 10)
    expect(Math.hypot(onAxis.point.x, onAxis.point.y)).toBeCloseTo(2, 10)
    // 超出高度的点把 v 夹到端点，而不是跑到侧面之外。
    expect(cylinder.project({ x: 2, y: 0, z: 9 }).parameter.v).toBeCloseTo(1, 10)
    expect(cylinder.project({ x: 2, y: 0, z: -3 }).parameter.v).toBeCloseTo(0, 10)
    expect(cylinderSurfaceHost3(center, 0, 4)).toBeNull()
    expect(cylinderSurfaceHost3(center, 2, 0)).toBeNull()
  })

  it("solves the cone's closest point in closed form", () => {
    const cone = coneSurfaceHost3(center, 2, 4)!
    expect(cone.kind).toBe("cone-surface")
    // 顶点。
    expect(cone.evaluate({ u: 0, v: 1 }).z).toBeCloseTo(4, 10)
    expect(Math.hypot(cone.evaluate({ u: 0, v: 1 }).x, cone.evaluate({ u: 0, v: 1 }).y)).toBeCloseTo(0, 10)
    // 母线上的点：v = 0.5 处半径 1。
    expect(cone.residual({ x: 1, y: 0, z: 2 })).toBeCloseTo(0, 10)
    expect(cone.closestParameter({ x: 1, y: 0, z: 2 }).v).toBeCloseTo(0.5, 10)
    // 轴上的点：最小化 (2v-2)² + (2-4v)² ⇒ v = 0.6、距离 √0.8。
    const onAxis = cone.project({ x: 0, y: 0, z: 2 })
    expect(onAxis.parameter.v).toBeCloseTo(0.6, 10)
    expect(onAxis.distance).toBeCloseTo(Math.sqrt(0.8), 10)
    expect(coneSurfaceHost3(center, 2, 0)).toBeNull()
  })

  it("folds the azimuthal parameter back into [0, 2π)", () => {
    const cylinder = cylinderSurfaceHost3(center, 2, 4)!
    const behind = cylinder.closestParameter({ x: -2, y: -1e-12, z: 1 })
    expect(behind.u).toBeGreaterThanOrEqual(0)
    expect(behind.u).toBeLessThan(Math.PI * 2)
    expect(behind.u).toBeCloseTo(Math.PI, 6)
  })
})

describe("circle orbit host", () => {
  const center = { x: 1, y: 0, z: 2 }

  /**
   * 用户要求："增加一些可以旋转，平移的平面图元……主要作用是作为约束轨道。"
   *
   * 空间圆轨道是**一维闭合宿主**：参数是圆周角、首尾相接。与线段/棱宿主的关键差别就是"闭合"，
   * 所以参数必须归一到 `[0, 2π)`——否则拖过一整圈之后参数会一直涨，读数与数值输入都会失控。
   */
  it("maps the angle onto the circle and back, closed on itself", () => {
    const host = circleHost3(center, { x: 0, y: 0, z: 1 }, 2)!
    expect(host.kind).toBe("circle")
    expect(host.domain.u).toEqual([0, Math.PI * 2])
    expect(host.domain.closedU).toBe(true)

    // 每个参数点都落在圆上（圆心 (1,0,2)、半径 2、法向 +z）。
    for (const u of [0, 0.7, Math.PI / 2, Math.PI, 5.9, Math.PI * 2]) {
      const point = host.evaluate({ u })
      expect(Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - 2)).toBeLessThan(1e-12)
      expect(point.z).toBeCloseTo(center.z, 12)
    }
    // 闭合：`2π` 与 `0` 是同一个点。
    const start = host.evaluate({ u: 0 })
    const end = host.evaluate({ u: Math.PI * 2 })
    expect(Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)).toBeLessThan(1e-12)

    // 圆上的点：残差 0、参数可逆。
    for (const u of [0.3, 2.1, 4.4]) {
      const point = host.evaluate({ u })
      expect(host.residual(point)).toBeLessThan(1e-12)
      expect(host.closestParameter(point).u).toBeCloseTo(u, 9)
    }
  })

  it("projects an off-circle point onto the rim and folds the parameter into [0, 2π)", () => {
    const host = circleHost3(center, { x: 0, y: 0, z: 1 }, 2)!

    // 圆内的点：投影到圆周，距离 = 2 − 到圆心的距离。
    const inside = host.project({ x: 1, y: 0, z: 2 })
    expect(inside.distance).toBeCloseTo(2, 10)
    expect(Math.abs(Math.hypot(inside.point.x - 1, inside.point.y) - 2)).toBeLessThan(1e-12)

    // 圆外的点：距离 = 到圆心的距离 − 2。
    const outside = host.project({ x: 5, y: 0, z: 2 })
    expect(outside.distance).toBeCloseTo(2, 10)

    // 轴上的点（正上方）：投影到任一半径都等价，但参数必须落在域内且有限。
    const onAxis = host.project({ x: 1, y: 0, z: 9 })
    expect(onAxis.parameter.u).toBeGreaterThanOrEqual(0)
    expect(onAxis.parameter.u).toBeLessThan(Math.PI * 2)
    expect(Number.isFinite(onAxis.parameter.u)).toBe(true)
    expect(onAxis.distance).toBeCloseTo(Math.hypot(2, 7), 10)

    // 参数 0 落在**圆自己的**参数 0 上（帧与 `circleConic3` 同源）：法向 +z 时它是 y 负方向那一点。
    const conic = circleConic3(center, { x: 0, y: 0, z: 1 }, 2)!
    const parameterZero = conic3PointAt(conic, 0)!
    const hostZero = host.evaluate({ u: 0 })
    expect(Math.hypot(hostZero.x - parameterZero.x, hostZero.y - parameterZero.y, hostZero.z - parameterZero.z)).toBeLessThan(1e-12)

    // −y 方向的点正好在参数 0 上；负角度一侧也要折回 `[0, 2π)`。
    const behind = host.project({ x: 1, y: -3, z: 2 })
    expect(behind.point.x).toBeCloseTo(parameterZero.x, 9)
    expect(behind.point.y).toBeCloseTo(parameterZero.y, 9)
    expect(behind.distance).toBeCloseTo(1, 10)
    expect(behind.parameter.u).toBeGreaterThanOrEqual(0)
    expect(behind.parameter.u).toBeLessThan(Math.PI * 2)
    expect(behind.parameter.u).toBeCloseTo(0, 9)
  })

  it("shares one parameterisation with the analytic circle it draws", () => {
    const conic = circleConic3(center, { x: 1, y: 2, z: 2 }, 1.5)!
    const host = circleHost3(center, { x: 1, y: 2, z: 2 }, 1.5)!

    // 宿主参数与解析圆的参数逐点重合：读数、输入框、圆上的点说的是同一件事。
    for (const u of [0, 0.4, 1.7, 3.1, 4.9, 6.2]) {
      const fromHost = host.evaluate({ u })
      const fromConic = conic3PointAt(conic, u)!
      expect(Math.hypot(fromHost.x - fromConic.x, fromHost.y - fromConic.y, fromHost.z - fromConic.z)).toBeLessThan(1e-12)
      expect(host.closestParameter(fromConic).u).toBeCloseTo(u, 9)
    }
  })

  it("refuses a degenerate circle instead of inventing an orbit", () => {
    // 零法向 / 负半径 / 非有限半径都不给出宿主。
    expect(circleHost3(center, { x: 0, y: 0, z: 0 }, 2)).toBeNull()
    expect(circleHost3(center, { x: 0, y: 0, z: 1 }, 0)).toBeNull()
    expect(circleHost3(center, { x: 0, y: 0, z: 1 }, -1)).toBeNull()
    expect(circleHost3(center, { x: 0, y: 0, z: 1 }, Number.NaN)).toBeNull()
    expect(circleHost3(center, { x: 0, y: 0, z: 1 }, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it("works with a tilted normal (the circle can be rotated by the handle)", () => {
    // 法向沿 +x ⇒ 圆落在 yz 平面内。
    const host = circleHost3({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 3)!
    for (const u of [0.2, 1.9, 4.4]) {
      const point = host.evaluate({ u })
      expect(Math.abs(point.x)).toBeLessThan(1e-12)
      expect(Math.hypot(point.y, point.z)).toBeCloseTo(3, 10)
    }
    expect(host.residual({ x: 0, y: 3, z: 0 })).toBeLessThan(1e-12)
  })
})

describe("host resolution from primitives", () => {
  const cylinder = { id: "cylinder-1", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: 2, height: 4, segments: 8 }

  it("resolves the hosts the DSL can express, and refuses the rest", () => {
    const built = buildSolidTemplate(cylinder)
    const document = { ...createEmptyDocument("geometry3d"), primitives: [cylinder, ...built.primitives] }
    const map = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
    const polyhedron = document.primitives.find((primitive) => primitive.type === "polyhedron3")!
    const edge = document.primitives.find((primitive) => primitive.type === "edge3")!
    const face = document.primitives.find((primitive) => primitive.type === "face3")!

    expect(host3FromPrimitive(cylinder, map)?.kind).toBe("cylinder-surface")
    // 棱的 kind 是 "edge"（而不是 "segment"）：它保留来源信息，但参数域与线段相同。
    expect(host3FromPrimitive(edge, map)?.kind).toBe("edge")
    expect(host3FromPrimitive(edge, map)?.domain.u).toEqual([0, 1])
    expect(host3FromPrimitive(face, map)?.kind).toBe("face")
    // 多面体与孤立的点不是宿主。
    expect(host3FromPrimitive(polyhedron, map)).toBeNull()
    expect(host3FromPrimitive(document.primitives.find((primitive) => primitive.type === "point3")!, map)).toBeNull()
  })

  it("returns null when the referenced points are missing", () => {
    const dangling = { id: "edge-x", type: "edge3" as const, pointIds: ["missing-a", "missing-b"] as [string, string] }
    const document = createEmptyDocument("geometry3d")
    const map = new Map([[dangling.id, dangling]])
    expect(host3FromPrimitive(dangling, document.primitives)).toBeNull()
    expect(host3FromPrimitive(dangling, map)).toBeNull()
  })

  /**
   * 空间圆轨道：**要能当宿主**才有"约束轨道"可言。`circle3` 只存 `centerId`（引用），
   * 所以宿主要从点表里解析圆心；圆心缺失或法向/半径退化时如实返回 `null`。
   */
  it("resolves a circle3 track as a host, and refuses a broken one", () => {
    const center = { id: "p-center", type: "point3" as const, position: { x: 1, y: 2, z: 3 } }
    const track = { id: "orbit-1", type: "circle3" as const, centerId: "p-center", normal: { x: 0, y: 0, z: 1 }, radius: 2 }
    const map = new Map<string, unknown>([[center.id, center], [track.id, track]])
    const host = host3FromPrimitive(track, map as never)!
    expect(host.kind).toBe("circle")
    expect(host.domain.closedU).toBe(true)
    expect(host.residual({ x: 1, y: 4, z: 3 })).toBeLessThan(1e-12)

    // 圆心点缺失 / 半径为 0 / 法向为零：都不给宿主。
    expect(host3FromPrimitive(track, new Map([[track.id, track]]) as never)).toBeNull()
    expect(host3FromPrimitive({ ...track, radius: 0 }, map as never)).toBeNull()
    expect(host3FromPrimitive({ ...track, normal: { x: 0, y: 0, z: 0 } }, map as never)).toBeNull()
  })
})

/**
 * 多边形法向：属性栏「当前法向」读数与 `closedFacePlanes3` 的"点在里面/在外面"用的是**同一个** Newell 实现。
 * 两份实现漂移过一次（"校验说行、应用说不行"），所以这里既测数值也测"退化就如实说不知道"。
 */
describe("polygon normal", () => {
  it("returns the unit normal of a tilted ring, following the winding", () => {
    const square = [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }, { x: 0, y: 2, z: 2 }]
    const normal = polygonNormal3(square)!
    // 平面 z = y 的法向是 (0, −1, 1)/√2（绕向 +x → +y）。
    expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1, 12)
    expect(normal.x).toBeCloseTo(0, 12)
    expect(normal.y).toBeCloseTo(-1 / Math.SQRT2, 12)
    expect(normal.z).toBeCloseTo(1 / Math.SQRT2, 12)
    // 反向绕向 = 反向法向。
    const reversed = polygonNormal3([...square].reverse())!
    expect(reversed.y).toBeCloseTo(1 / Math.SQRT2, 12)
  })

  it("refuses a ring that is not a surface", () => {
    expect(polygonNormal3([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])).toBeNull()
    expect(polygonNormal3([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }])).toBeNull()
  })
})
