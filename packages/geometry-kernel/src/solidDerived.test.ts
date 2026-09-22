import { describe, expect, it } from "vitest"

import type { Vector3 } from "./geometry3d"

import { sectionSolid3, solveCircumsphere3, solveInsphere3, type SolidBoundary } from "./solidDerived"

/**
 * **派生立体的四个状态必须是四件事**（Solid/Prism 切片 Task 4；设计规格 §3.1/§3.4）。
 *
 * ```
 * type DerivedSolidResult<T> =
 *   | { status: "exact"; value: T }
 *   | { status: "undefined"; reason: string }
 *   | { status: "degenerate"; reason: string }
 *   | { status: "approximate"; value: T; residual: number }
 * ```
 *
 * 最要紧的一条：**近似不许冒充精确**。一般多面体的外接球不存在时返回 `undefined`，
 * 而不是把一个"最小二乘拟合出来的球"当答案交出去（规格 §10 明确禁止）。
 */

/** 单位立方体 8 顶点、6 个面环（与 `sections3d.test.ts` 同一套）。 */
const cube: SolidBoundary = {
  vertices: [
    { x: -1, y: -1, z: -1 },
    { x: 1, y: -1, z: -1 },
    { x: 1, y: 1, z: -1 },
    { x: -1, y: 1, z: -1 },
    { x: -1, y: -1, z: 1 },
    { x: 1, y: -1, z: 1 },
    { x: 1, y: 1, z: 1 },
    { x: -1, y: 1, z: 1 }
  ],
  faces: [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7]
  ]
}

/** 正四面体（棱长 2√2，顶点取单位立方体的交错顶点）：外接球与内切球都有闭式解。 */
const tetrahedron: SolidBoundary = {
  vertices: [
    { x: 1, y: 1, z: 1 },
    { x: 1, y: -1, z: -1 },
    { x: -1, y: 1, z: -1 },
    { x: -1, y: -1, z: 1 }
  ],
  faces: [
    [0, 1, 2],
    [0, 1, 3],
    [0, 2, 3],
    [1, 2, 3]
  ]
}

const closeTo = (first: Vector3, second: Vector3, digits = 6) => {
  expect(first.x).toBeCloseTo(second.x, digits)
  expect(first.y).toBeCloseTo(second.y, digits)
  expect(first.z).toBeCloseTo(second.z, digits)
}

describe("circumsphere", () => {
  it("solves the circumsphere of a box from its bounding-box centre and half-diagonal", () => {
    const result = solveCircumsphere3(cube)

    expect(result.status).toBe("exact")
    if (result.status !== "exact") return
    closeTo(result.value.center, { x: 0, y: 0, z: 0 })
    // 体对角线半径：半边长 √3。
    expect(result.value.radius).toBeCloseTo(Math.sqrt(3), 9)
    // 每个顶点到球心的距离都必须等于半径（残差为 0，这才是"外接"）。
    for (const vertex of cube.vertices) {
      expect(Math.hypot(vertex.x - result.value.center.x, vertex.y - result.value.center.y, vertex.z - result.value.center.z)).toBeCloseTo(result.value.radius, 9)
    }
  })

  it("solves the circumsphere of a tetrahedron by equidistant equations", () => {
    const result = solveCircumsphere3(tetrahedron)

    expect(result.status).toBe("exact")
    if (result.status !== "exact") return
    closeTo(result.value.center, { x: 0, y: 0, z: 0 })
    expect(result.value.radius).toBeCloseTo(Math.sqrt(3), 9)
  })

  /**
   * 一只**非球面**的多面体（把立方体的一个顶点往外拉）：一般多面体不一定有外接球。
   * 这时必须报 `undefined` —— 不允许交出一个"差不多"的球。
   */
  it("returns undefined for a solid with no circumsphere instead of approximating one", () => {
    const stretched: SolidBoundary = { ...cube, vertices: cube.vertices.map((vertex, index) => index === 6 ? { x: 2.5, y: 1, z: 1 } : vertex) }

    const result = solveCircumsphere3(stretched)

    expect(result.status).toBe("undefined")
    if (result.status === "undefined") expect(result.reason).toContain("外接球")
  })

  it("rejects degenerate and non-finite input instead of solving a meaningless sphere", () => {
    // 共面：四个点都在 z = 0 上，没有外接球（体积为零）。
    const flat: SolidBoundary = { vertices: [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: -1, y: 1, z: 0 }], faces: [[0, 1, 2, 3]] }
    const flatResult = solveCircumsphere3(flat)
    expect(flatResult.status).toBe("degenerate")

    const broken: SolidBoundary = { ...tetrahedron, vertices: [...tetrahedron.vertices.slice(0, 3), { x: Number.NaN, y: 0, z: 0 }] }
    expect(solveCircumsphere3(broken).status).toBe("degenerate")

    const tooFew: SolidBoundary = { vertices: tetrahedron.vertices.slice(0, 3), faces: [[0, 1, 2]] }
    expect(solveCircumsphere3(tooFew).status).toBe("degenerate")
  })
})

describe("insphere", () => {
  it("solves the insphere of a tetrahedron from the equidistant-to-four-faces equations", () => {
    const result = solveInsphere3(tetrahedron)

    expect(result.status).toBe("exact")
    if (result.status !== "exact") return
    closeTo(result.value.center, { x: 0, y: 0, z: 0 })
    // 正四面体棱长 2√2 的内切球半径 = a√6/12 = √3/3。
    expect(result.value.radius).toBeCloseTo(Math.sqrt(3) / 3, 9)
  })

  /**
   * **I3（评审）：规格 §3.4 对一般凸多面体的口径是"不满足时返回 `undefined`"。**
   *
   * 原文："一般凸多面体内切球：求解最大内接球约束，**不满足时返回 `undefined`**。"
   * 所以"最大内接球碰不到全部面"不能报成 `approximate` —— 那个状态在
   * `DerivedSolidResult` 里的含义是"这是个带残差的数值解"，而这里的事实是
   * "这只实体没有内切球"。两者必须分开，测试也不许用 `toContain` 同时放过两种状态
   * （那样它根本检测不出这条偏差）。
   */
  it("returns undefined when the maximal inscribed sphere misses some face", () => {
    const skewed: SolidBoundary = { ...cube, vertices: cube.vertices.map((vertex, index) => index === 6 ? { x: 3, y: 1, z: 1 } : vertex) }

    const result = solveInsphere3(skewed)

    expect(result.status).toBe("undefined")
    if (result.status === "undefined") expect(result.reason).toContain("内切球")
  })

  it("solves the insphere of a box as the largest inscribed sphere", () => {
    const result = solveInsphere3(cube)

    expect(result.status).toBe("exact")
    if (result.status !== "exact") return
    closeTo(result.value.center, { x: 0, y: 0, z: 0 })
    expect(result.value.radius).toBeCloseTo(1, 9)
  })

  it("rejects degenerate input", () => {
    const flat: SolidBoundary = { vertices: [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: -1, y: 1, z: 0 }], faces: [[0, 1, 2, 3]] }
    expect(solveInsphere3(flat).status).toBe("degenerate")
  })
})

/**
 * **截面：沿着拓扑邻接串联边界，而不是按形心角排序**（规格 §3.4）。
 *
 * 这一条非凸用例是关键：按形心角排序会把 L 形截面的凹口"抄近路"连成对角线，
 * 于是截面的周长与形状全错，而它在凸图形上完全看不出来（凸的多边形两种排序结果一致）。
 */
describe("solid section boundary", () => {
  /**
   * L 形棱柱：底面是 L 形多边形（画在 `x–z` 平面上），沿 **y** 拉伸。
   *
   * 剖切平面 y = 0.5（`normal: (0,1,0), constant: -0.5` 就是 `y = 0.5`）切出来的正是那个 L 形本身：
   * 六条边、凹口处不能"抄近路"。这是"按拓扑邻接成环"与"按形心角排序"结果不同的那一类图形。
   */
  const lProfile: Array<{ x: number; z: number }> = [
    { x: 0, z: 0 },
    { x: 3, z: 0 },
    { x: 3, z: 1 },
    { x: 1, z: 1 },
    { x: 1, z: 3 },
    { x: 0, z: 3 }
  ]

  function lPrismBoundary(): SolidBoundary {
    const vertices: Vector3[] = [
      ...lProfile.map((point) => ({ x: point.x, y: 0, z: point.z })),
      ...lProfile.map((point) => ({ x: point.x, y: 1, z: point.z }))
    ]
    const faces: number[][] = [
      lProfile.map((_, index) => index),
      lProfile.map((_, index) => lProfile.length + index),
      ...lProfile.map((_, index) => [index, (index + 1) % lProfile.length, lProfile.length + ((index + 1) % lProfile.length), lProfile.length + index])
    ]
    return { vertices, faces }
  }

  /** 单位立方体（0..1 那个角）：分类用例都用它，几何最容易手算。 */
  function unitCubeBoundary(): SolidBoundary {
    return {
      vertices: [
        { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 1 }
      ],
      faces: [
        [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]
      ]
    }
  }

  it("returns an ordered closed loop for a plane that cuts the prism in half", () => {
    const result = sectionSolid3(lPrismBoundary(), { normal: { x: 0, y: 1, z: 0 }, constant: -0.5 })

    expect(result.status).toBe("exact")
    if (result.status !== "exact") return
    expect(result.value.classification).toBe("polygon")
    expect(result.value.points).toHaveLength(6)
    // 边界必须沿 L 形的真实棱走：相邻两点的连线长度只能是 1、2、3，绝不能出现"抄近路"的对角线。
    const edgeLengths = result.value.points.map((point, index) => {
      const next = result.value.points[(index + 1) % result.value.points.length]
      return Math.round(Math.hypot(point.x - next.x, point.y - next.y, point.z - next.z))
    }).sort((first, second) => first - second)
    expect(edgeLengths).toEqual([1, 1, 2, 2, 3, 3])
  })

  it("classifies none and a plane that only touches an edge as a segment", () => {
    const boundary = lPrismBoundary()

    const none = sectionSolid3(boundary, { normal: { x: 0, y: 1, z: 0 }, constant: -10 })
    expect(none.status).toBe("exact")
    if (none.status === "exact") {
      expect(none.value.classification).toBe("none")
      expect(none.value.points).toEqual([])
    }

    /**
     * 与**底面**重合：`y = 0` 正好切在实体最下面那个面上，交集是一条闭合边界（六边形），
     * 所以它是 `polygon` 而不是 `segment` —— 这一条顺带钉住"共面不等于退化"。
     */
    const coplanar = sectionSolid3(boundary, { normal: { x: 0, y: 1, z: 0 }, constant: 0 })
    expect(coplanar.status).toBe("exact")
    if (coplanar.status === "exact") {
      expect(coplanar.value.classification).toBe("polygon")
      expect(coplanar.value.points).toHaveLength(6)
    }

    /**
     * 与**一条棱**重合：单位立方体上的 `x + y = 2` 只碰到 (1,1) 那一竖条棱 ——
     * 两个端点各有邻点落在平面的两侧，其余棱都不与它相交。这时交集必须是 `segment`：
     * 多报一个点就会被画成一条假边界，少报一个就连不成线段。
     */
    const segment = sectionSolid3(unitCubeBoundary(), { normal: { x: 1, y: 1, z: 0 }, constant: -2 })
    expect(segment.status).toBe("exact")
    if (segment.status === "exact") {
      expect(segment.value.classification).toBe("segment")
      expect(segment.value.points).toHaveLength(2)
    }
  })

  /** 顶点相切：平面只碰到原点那个角。 */
  it("reports a single touching vertex as a point section", () => {
    const point = sectionSolid3(unitCubeBoundary(), { normal: { x: 1, y: 1, z: 1 }, constant: 0 })

    expect(point.status).toBe("exact")
    if (point.status === "exact") {
      expect(point.value.classification).toBe("point")
      expect(point.value.points).toEqual([{ x: 0, y: 0, z: 0 }])
    }
  })

  it("rejects a degenerate cutting plane and insufficient topology", () => {
    const boundary = lPrismBoundary()

    const zeroNormal = sectionSolid3(boundary, { normal: { x: 0, y: 0, z: 0 }, constant: 0 })
    expect(zeroNormal.status).toBe("degenerate")

    const tooLittle: SolidBoundary = { vertices: boundary.vertices, faces: [[0, 1, 2]] }
    expect(sectionSolid3(tooLittle, { normal: { x: 0, y: 1, z: 0 }, constant: -0.5 }).status).toBe("degenerate")
  })
})
