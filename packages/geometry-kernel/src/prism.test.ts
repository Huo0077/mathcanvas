import { describe, expect, it } from "vitest"

import type { Vector3 } from "./geometry3d"

import { buildPrismTopology, validatePrismInput } from "./prism"

/**
 * **棱柱的纯拓扑**（Solid/Prism 切片 Task 2；设计规格 §3.3）。
 *
 * 规格原文：
 *
 * ```text
 * Ti = Bi + v
 * 底面 = [B0 ... Bn-1]
 * 顶面 = [Tn-1 ... T0]
 * 侧面 i = [Bi, B(i+1), T(i+1), Ti]
 * ```
 *
 * 这一层只做"从底面多边形与向量算出顶点 / 棱 / 面"，**不碰文档、不分配 id、不写全局状态**。
 * 用户级引用永远指向 Solid（`SolidPolyhedron`），子对象名由调用方按 Solid ID 派生（规格 §3.3）。
 */

const triangle: Vector3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 3, y: 0, z: 0 },
  { x: 0, y: 4, z: 0 }
]

/** 斜四棱柱：底面是单位正方形，向量带水平偏移（题面里的"斜"正是这个水平分量）。 */
const square: Vector3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 2, y: 2, z: 0 },
  { x: 0, y: 2, z: 0 }
]
const oblique: Vector3 = { x: 1, y: 0.5, z: 3 }

/** 环上的向量差：用于"对边相等且平行"这类性质断言。 */
function edgeVector(points: Vector3[], from: number, to: number): Vector3 {
  return { x: points[to].x - points[from].x, y: points[to].y - points[from].y, z: points[to].z - points[from].z }
}

function cross(first: Vector3, second: Vector3): Vector3 {
  return { x: first.y * second.z - first.z * second.y, y: first.z * second.x - first.x * second.z, z: first.x * second.y - first.y * second.x }
}

describe("prism topology", () => {
  it("builds a triangular prism with the documented vertex, edge and face counts", () => {
    const topology = buildPrismTopology(triangle, { x: 0, y: 0, z: 5 })

    expect(topology).not.toBeNull()
    if (!topology) return
    expect(topology.vertices).toHaveLength(6)
    // 3 底棱 + 3 顶棱 + 3 侧棱
    expect(topology.edges).toHaveLength(9)
    // 底面 + 顶面 + 3 个侧面
    expect(topology.faces).toHaveLength(5)
    expect(topology.baseCount).toBe(3)

    // Ti = Bi + v：前三个是底面，后三个是平移后的顶面。
    for (let index = 0; index < 3; index += 1) expect(topology.vertices[3 + index]).toEqual({ ...triangle[index], z: 5 })
    /**
     * 面环是**朝外**的（见 `orients every face ring outwards`），所以底面的环绕方向由几何决定，
     * 不能断言"等于输入顺序"。要钉的是**环里是哪三个顶点**以及公式 `[Bi, B(i+1), T(i+1), Ti]`：
     * 每个侧面里，两个相邻的底面下标必须相邻（±1 mod n），另外两个是它们各自的平移。
     */
    expect(new Set(topology.faces[0])).toEqual(new Set([0, 1, 2]))
    expect(new Set(topology.faces[1])).toEqual(new Set([3, 4, 5]))
    const sideFaces = topology.faces.slice(2)
    expect(sideFaces).toHaveLength(3)
    for (const face of sideFaces) {
      expect(face).toHaveLength(4)
      /**
       * 侧面 `[Bi, B(i+1), T(i+1), Ti]` 的不变量：环上"相隔两位"的两个顶点同属底面（同理同属顶面），
       * 且它们的下标恰好相差 `±1 mod n`（`i` 与 `i+1` 相邻），另外两个顶点是它们各自的平移 `+ n`。
       * 这条比"等于某个具体数组"强：它同时钉住了 `Ti = Bi + v` 与 `B(i+1)` 的相邻关系，
       * 又不依赖环绕方向（朝外的规范化可能把环整个反过来）。
       */
      expect(face.filter((index) => index < 3)).toHaveLength(2)
      const bottom = [...face].filter((index) => index < 3).sort((first, second) => first - second)
      const top = [...face].filter((index) => index >= 3).sort((first, second) => first - second)
      // `i` 与 `i+1` 相邻：两者之差在 `mod n` 下必须是 ±1（环绕方向不定，所以两个方向都算）。
      expect([1, 2]).toContain((bottom[1] - bottom[0] + 3) % 3)
      expect(top).toEqual(bottom.map((index) => index + 3))
    }
  })

  it("builds an oblique quadrilateral prism whose side faces are parallelograms", () => {
    const topology = buildPrismTopology(square, oblique)

    expect(topology).not.toBeNull()
    if (!topology) return
    const sideFaces = topology.faces.slice(2)
    expect(sideFaces).toHaveLength(4)
    for (const face of sideFaces) expect(face).toHaveLength(4)

    /**
     * 侧面的定义就是 `[Bi, B(i+1), T(i+1), Ti]`：`B(i+1)-Bi` 与 `T(i+1)-Ti` 逐分量相等，
     * 所以它天然是平行四边形。底边与顶边一旦不平行，说明实现是"把散面拼起来"而不是按向量拉伸
     * （规格 §7 明令禁止 Agent 拼散面）。
     */
    for (const face of sideFaces) {
      const bottom = edgeVector(topology.vertices, face[0], face[1])
      const top = edgeVector(topology.vertices, face[3], face[2])
      expect(top.x).toBeCloseTo(bottom.x, 12)
      expect(top.y).toBeCloseTo(bottom.y, 12)
      expect(top.z).toBeCloseTo(bottom.z, 12)
      // 两条侧棱也必须与拉伸向量一致。
      const left = edgeVector(topology.vertices, face[0], face[3])
      const right = edgeVector(topology.vertices, face[1], face[2])
      expect(left).toEqual(oblique)
      expect(right).toEqual(oblique)
    }
  })

  it("keeps every face exactly coplanar and every side edge parallel to the vector", () => {
    const topology = buildPrismTopology(square, oblique)
    expect(topology).not.toBeNull()
    if (!topology) return

    for (const face of topology.faces) {
      const points = face.map((index) => topology.vertices[index])
      // 共面判据：任取三点定法向，其余点在该法向上的分量残差为 0（数值容差内）。
      const normal = cross(
        { x: points[1].x - points[0].x, y: points[1].y - points[0].y, z: points[1].z - points[0].z },
        { x: points[2].x - points[0].x, y: points[2].y - points[0].y, z: points[2].z - points[0].z }
      )
      const scale = Math.max(1, ...points.flatMap((point) => [Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)]))
      for (const point of points) {
        const residual = normal.x * (point.x - points[0].x) + normal.y * (point.y - points[0].y) + normal.z * (point.z - points[0].z)
        // 残差按**法向自身的模长 × 模型尺度**归一化：`(p1-p0)×(p2-p0)` 的量纲是长度的平方。
        expect(Math.abs(residual)).toBeLessThanOrEqual(1e-9 * scale * scale * Math.hypot(normal.x, normal.y, normal.z))
      }
    }

    /**
     * 每条**侧棱**（连接底面第 i 个顶点与顶面第 i 个顶点的棱）都必须与拉伸向量平行。
     * 这是一条比"数面"强得多的性质：它把"按向量拉伸"与"随便凑出一个封闭多面体"分开。
     */
    const count = square.length
    for (let index = 0; index < count; index += 1) {
      const side = edgeVector(topology.vertices, index, count + index)
      expect(side).toEqual(oblique)
      // 棱的两个端点不保证**有序**（棱的编号顺序由"先出现在哪个面环里"决定），所以两种朝向都算。
      expect(topology.edges.some((edge) => (edge.pointIndexes[0] === index && edge.pointIndexes[1] === count + index) || (edge.pointIndexes[1] === index && edge.pointIndexes[0] === count + index))).toBe(true)
    }
  })

  it("honours a reversed base winding instead of losing the input order", () => {
    const reversed = [...square].reverse()
    const topology = buildPrismTopology(reversed, oblique)

    expect(topology).not.toBeNull()
    if (!topology) return
    /**
     * 顶点表仍按**输入顺序**：`[B0…Bn-1, T0…Tn-1]`。面的环绕方向被规范化成**朝外**
     * （这样调用方拿面的叉积就是外法向），但"哪个顶点是 B0"永远是调用方给的那个。
     */
    expect(topology.vertices.slice(0, 4)).toEqual(reversed)
    for (let index = 0; index < 4; index += 1) expect(topology.vertices[4 + index]).toEqual({ x: reversed[index].x + oblique.x, y: reversed[index].y + oblique.y, z: reversed[index].z + oblique.z })

    // 两个环绕方向描述的是**同一只棱柱**：面环的集合（作为集合）必须一致。
    const forward = buildPrismTopology(square, oblique)!
    const ringKey = (face: number[]) => face.join("-")
    const reverseRing = (face: number[]) => [...face].reverse().join("-")
    const forwardRings = new Set(forward.faces.map(ringKey))
    for (const face of topology.faces) {
      expect(forwardRings.has(ringKey(face)) || forwardRings.has(reverseRing(face))).toBe(true)
    }
  })

  /**
   * 面的环绕方向必须**一致朝外**：六个面各自按"外法向"走，`(p1-p0)×(p2-p0)` 就是外法向。
   * 这条不是形式主义——法向朝里的面在画布上会被剔除掉，用户看到的是"棱柱缺了一块"。
   */
  it("orients every face ring outwards", () => {
    const topology = buildPrismTopology(square, oblique)
    expect(topology).not.toBeNull()
    if (!topology) return

    const centroid = topology.vertices.reduce((sum, point) => ({ x: sum.x + point.x / topology.vertices.length, y: sum.y + point.y / topology.vertices.length, z: sum.z + point.z / topology.vertices.length }), { x: 0, y: 0, z: 0 })
    for (const face of topology.faces) {
      const points = face.map((index) => topology.vertices[index])
      const normal = cross(
        { x: points[1].x - points[0].x, y: points[1].y - points[0].y, z: points[1].z - points[0].z },
        { x: points[2].x - points[0].x, y: points[2].y - points[0].y, z: points[2].z - points[0].z }
      )
      const faceCentre = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length, z: sum.z + point.z / points.length }), { x: 0, y: 0, z: 0 })
      const outward = { x: faceCentre.x - centroid.x, y: faceCentre.y - centroid.y, z: faceCentre.z - centroid.z }
      expect(normal.x * outward.x + normal.y * outward.y + normal.z * outward.z).toBeGreaterThan(0)
    }
  })

  it("rejects a zero vector as degenerate instead of producing a flat solid", () => {
    expect(buildPrismTopology(triangle, { x: 0, y: 0, z: 0 })).toBeNull()

    const validation = validatePrismInput(triangle, { x: 0, y: 0, z: 0 })
    expect(validation.ok).toBe(false)
    if (!validation.ok) {
      expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toContain("degenerate-vector")
      expect(validation.diagnostics[0].message).toContain("非零")
    }
  })

  it("rejects a self-intersecting base polygon", () => {
    const bowtie: Vector3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 4, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 0, y: 4, z: 0 }
    ]

    expect(buildPrismTopology(bowtie, { x: 0, y: 0, z: 1 })).toBeNull()
    const validation = validatePrismInput(bowtie, { x: 0, y: 0, z: 1 })
    expect(validation.ok).toBe(false)
    if (!validation.ok) expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toContain("self-intersection")
  })

  /**
   * **C1（评审）：零体积的"棱柱"必须被拒。**
   *
   * 拉伸向量平行于底面（例如底面在 `z = 0` 上、向量取 `(2, 0, 0)`）时，2n 个顶点全部共面，
   * 出来的是**一张平片**而不是实体。同包的既有构造器 `buildPrism → buildFromPoints`
   * 正是用 `hasNonZeroVolume` 拒掉这一类输入的（`solid-builders.ts:309,184-195`），
   * 新校验器漏掉了这条，于是 `compileSolidPrism` 会把 21 个图元写进文档。
   *
   * 顺带说明另一个症状（评审也点到了）：平片的每个面法向都与 `面心 − 形心` 垂直，
   * `facesOutwards` 的判据恒为 `0 > 0 = false`，**六个面的环绕方向全部被随意翻反**。
   * 拒绝这条输入之后那个"平局"就不可达了 —— 所以这里断言的是"先拒绝"，
   * 而不是"给平片挑一个环绕方向"。
   */
  it("rejects an extrusion vector parallel to the base plane as degenerate volume", () => {
    const base = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }]

    expect(buildPrismTopology(base, { x: 2, y: 0, z: 0 })).toBeNull()
    const validation = validatePrismInput(base, { x: 2, y: 0, z: 0 })
    expect(validation.ok).toBe(false)
    if (!validation.ok) {
      expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toContain("degenerate-volume")
      expect(validation.diagnostics.map((diagnostic) => diagnostic.message).join(" ")).toContain("体积")
    }

    // 斜棱柱**不是**这一类：向量只要有一点法向分量，体积就非零（水平偏移再多也照样成立）。
    expect(validatePrismInput(base, { x: 2, y: 5, z: 0.001 }).ok).toBe(true)
    // 反过来，沿法向的直棱柱当然也合法。
    expect(validatePrismInput(base, { x: 0, y: 0, z: 3 }).ok).toBe(true)
  })

  /**
   * **I2（评审）：前三个顶点共线的合法底面不许被误判成自交。**
   *
   * 自交判定要把多边形投到一个不塌陷的二维视图上，而投影轴以前是拿**前三个点**的叉积定的：
   * 前三点共线时那个叉积是零向量，于是退化成"丢掉 x 轴"的兜底投影 ——
   * 对水平底面（`z = const`，也就是默认朝向）来说整只多边形会塌到一条直线上，
   * `segmentsIntersect` 走进共线重叠分支，把**合法**的五边形报成"底面多边形自交"。
   * 模型生成的"边上多给一个共线点"的多边形很常见，所以这条必须能过。
   */
  it("accepts a simple base whose first three vertices are collinear", () => {
    const pentagon = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 2, z: 0 },
      { x: 0, y: 2, z: 0 }
    ]

    const validation = validatePrismInput(pentagon, { x: 0, y: 0, z: 3 })
    expect(validation.ok).toBe(true)

    const topology = buildPrismTopology(pentagon, { x: 0, y: 0, z: 3 })
    expect(topology).not.toBeNull()
    if (!topology) return
    // 5 顶点 ×2 上下底、5 底棱 + 5 顶棱 + 5 侧棱、2 个底面 + 5 个侧面。
    expect(topology.vertices).toHaveLength(10)
    expect(topology.edges).toHaveLength(15)
    expect(topology.faces).toHaveLength(7)
  })

  /**
   * 投影基换了之后，**真正的**自交多边形还得照样被拒（回归守卫：修 I2 不是把自交判定关掉）。
   * 这一只的前三点不共线，和上面那条"共线前缀"是互补的两面。
   */
  it("still rejects a self-intersecting base with a non-collinear start", () => {
    const bowtie = [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 4, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 0, y: 4, z: 0 }
    ]

    const validation = validatePrismInput(bowtie, { x: 0, y: 0, z: 3 })
    expect(validation.ok).toBe(false)
    if (!validation.ok) expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toContain("self-intersection")
  })

  /**
   * 非共面的"底面"不是多边形：`Bi + v` 拉伸出来的东西连面都定义不了。
   * 这条必须在构造期挡住，否则文档里会留下一只每个面都不共面的"棱柱"。
   */
  it("rejects a base that is not planar or has degenerate area", () => {
    const warp = [...square.slice(0, 3), { x: 0, y: 2, z: 1 }]
    const validation = validatePrismInput(warp, { x: 0, y: 0, z: 1 })
    expect(validation.ok).toBe(false)
    if (!validation.ok) expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toContain("non-planar-base")

    const collinear: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]
    const thin = validatePrismInput(collinear, { x: 0, y: 0, z: 1 })
    expect(thin.ok).toBe(false)
    if (!thin.ok) expect(thin.diagnostics.map((diagnostic) => diagnostic.code)).toContain("degenerate-base")
  })

  it("reports not-finite and too-few-point inputs as structured diagnostics rather than throwing", () => {
    const tooFew = validatePrismInput(triangle.slice(0, 2), { x: 0, y: 0, z: 1 })
    expect(tooFew.ok).toBe(false)
    if (!tooFew.ok) expect(tooFew.diagnostics.map((diagnostic) => diagnostic.code)).toContain("invalid-input")

    const infinite = validatePrismInput([...triangle.slice(0, 2), { x: 0, y: 0, z: Number.NaN }], { x: 0, y: 0, z: 1 })
    expect(infinite.ok).toBe(false)
    if (!infinite.ok) expect(infinite.diagnostics.map((diagnostic) => diagnostic.code)).toContain("invalid-input")

    expect(buildPrismTopology([], { x: 0, y: 0, z: 1 })).toBeNull()
  })

  it("returns the same topology for the same input signature and shares no state", () => {
    const first = buildPrismTopology(square, oblique)
    const second = buildPrismTopology(square.map((point) => ({ ...point })), { ...oblique })

    expect(first).toEqual(second)
    // 返回的顶点是**本次调用自己的**副本：调用方改它不该影响下一次调用（纯函数、无共享状态）。
    first!.vertices[0].x = 99
    expect(buildPrismTopology(square, oblique)!.vertices[0].x).toBe(0)
  })

  it("indexes every edge by two vertex indexes and every face by real edges", () => {
    const topology = buildPrismTopology(square, oblique)
    expect(topology).not.toBeNull()
    if (!topology) return

    const edgeKeys = topology.edges.map((edge) => edge.pointIndexes.slice().sort((first, second) => first - second).join(":"))
    expect(new Set(edgeKeys).size).toBe(edgeKeys.length)
    for (const edge of topology.edges) {
      const [first, second] = edge.pointIndexes
      expect(first).not.toBe(second)
      expect(first).toBeGreaterThanOrEqual(0)
      expect(second).toBeLessThan(topology.vertices.length)
    }
    // 五个面各自的环长：底 4 + 顶 4 + 四个侧 4。
    expect(topology.faces.map((face) => face.length)).toEqual([4, 4, 4, 4, 4, 4])
    for (const face of topology.faces) {
      expect(new Set(face).size).toBe(face.length)
      for (let index = 0; index < face.length; index += 1) {
        const pair = [face[index], face[(index + 1) % face.length]].sort((first, second) => first - second).join(":")
        expect(edgeKeys).toContain(pair)
      }
    }
    // 每条棱恰好属于两个面（闭合多面体）。
    const owners = new Map<string, number>()
    for (const face of topology.faces) {
      for (let index = 0; index < face.length; index += 1) {
        const pair = [face[index], face[(index + 1) % face.length]].sort((first, second) => first - second).join(":")
        owners.set(pair, (owners.get(pair) ?? 0) + 1)
      }
    }
    expect(owners.size).toBe(topology.edges.length)
    for (const [pair, count] of owners) expect(count, pair).toBe(2)
  })
})

