import type { DerivedSolidResult } from "@draw/dsl"

import { crossVector3, dotVector3, lengthVector3, normalizeVector3, subtractVector3, type Plane3, type Vector3 } from "./geometry3d"
import { sectionPolyhedron3, type Section3Result } from "./sections3d"

/**
 * **派生立体的求解器**（Solid/Prism 切片 Task 4；设计规格 §3.1/§3.4）。
 *
 * 规格给了统一的返回形状，而这个文件是它唯一的落点：
 *
 * ```ts
 * type DerivedSolidResult<T> =
 *   | { status: "exact"; value: T }
 *   | { status: "undefined"; reason: string }
 *   | { status: "degenerate"; reason: string }
 *   | { status: "approximate"; value: T; residual: number }
 * ```
 *
 * ## 四个状态为什么必须分开
 *
 * - `degenerate`：**输入**本身不成立（共面、点数不够、坐标不是有限数）。这时连"有没有解"都不该谈。
 * - `undefined`：输入成立，但**解不存在** —— 一般多面体不一定有外接球 / 内切球。
 * - `exact`：闭式解，残差为 0（在浮点意义上）。
 * - `approximate`：数值解，**必须带残差**。规格 §10 明令："不存在时返回明确状态，
 *   不生成近似冒充精确结果"。所以 `approximate` 与 `exact` 不能合并，`undefined` 与
 *   "近似解"也不能合并 —— 折叠任何一个，调用方就没有办法如实告诉用户"这个球不是外接球"。
 *
 * 全部是纯函数：不写全局状态、不改输入、不伪造缺失坐标。
 */

/** 一只多面体的**几何边界**：顶点位置 + 面的顶点下标环。 */
export interface SolidBoundary {
  vertices: readonly Vector3[]
  faces: readonly (readonly number[])[]
}

export interface Sphere3 {
  center: Vector3
  radius: number
}

export interface SolidSection3 {
  classification: "none" | "point" | "segment" | "polygon"
  /** 周长最大的一环，按**拓扑邻接**顺序（沿实体自己的面成环，见 `sections3d.ts`）。 */
  points: Vector3[]
  /** 全部闭合环，按面积降序。 */
  loops: Vector3[][]
  explanation: string
}

function isFiniteVector(value: unknown): value is Vector3 {
  return Boolean(value && typeof value === "object"
    && Number.isFinite((value as Vector3).x)
    && Number.isFinite((value as Vector3).y)
    && Number.isFinite((value as Vector3).z))
}

/** 每次求解都要用的守卫：顶点有限、面环合法、至少四个顶点。不成立时返回原因。 */
function boundaryProblem(boundary: SolidBoundary): string | null {
  if (!boundary || !Array.isArray(boundary.vertices) || !Array.isArray(boundary.faces)) return "实体边界缺少顶点或面。"
  if (boundary.vertices.length < 4) return "实体至少需要四个顶点，当前拓扑不足。"
  if (boundary.vertices.some((vertex) => !isFiniteVector(vertex))) return "实体顶点包含非有限坐标。"
  const validFaces = boundary.faces.filter((face) => Array.isArray(face) && face.length >= 3 && face.every((index) => Number.isInteger(index) && index >= 0 && index < boundary.vertices.length))
  if (validFaces.length < 4) return "实体至少需要四个合法面环，当前拓扑不足。"
  return null
}

function extentOf(vertices: readonly Vector3[]): number {
  return vertices.reduce((largest, vertex) => Math.max(largest, Math.abs(vertex.x), Math.abs(vertex.y), Math.abs(vertex.z)), 1)
}

/**
 * 求解线性方程组 `A x = b`（高斯消元 + 部分主元）。
 *
 * `null` 表示**奇异** —— 这里不用"最小二乘"顶替：方程组的唯一解就是球心，
 * 退化的方程组意味着"没有唯一球心"，必须如实返回而不是挑一个看起来合理的点。
 */
function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const size = matrix.length
  const augmented = matrix.map((row, index) => [...row, vector[index]])
  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row
    if (Math.abs(augmented[pivot][column]) <= 1e-12) return null
    if (pivot !== column) [augmented[pivot], augmented[column]] = [augmented[column], augmented[pivot]]
    for (let row = column + 1; row < size; row += 1) {
      const factor = augmented[row][column] / augmented[column][column]
      for (let item = column; item <= size; item += 1) augmented[row][item] -= factor * augmented[column][item]
    }
  }
  const solution = new Array<number>(size).fill(0)
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = augmented[row][size]
    for (let column = row + 1; column < size; column += 1) sum -= augmented[row][column] * solution[column]
    solution[row] = sum / augmented[row][row]
  }
  return solution
}

/** 三个坐标方向上的极值半宽：长方体判定与包围盒中心都要它。 */
function halfExtents(vertices: readonly Vector3[]): Vector3 {
  const min = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY }
  const max = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY }
  for (const vertex of vertices) {
    min.x = Math.min(min.x, vertex.x); max.x = Math.max(max.x, vertex.x)
    min.y = Math.min(min.y, vertex.y); max.y = Math.max(max.y, vertex.y)
    min.z = Math.min(min.z, vertex.z); max.z = Math.max(max.z, vertex.z)
  }
  return { x: (max.x - min.x) / 2, y: (max.y - min.y) / 2, z: (max.z - min.z) / 2 }
}

function boundingBoxCenter(vertices: readonly Vector3[]): Vector3 {
  const min = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY }
  const max = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY }
  for (const vertex of vertices) {
    min.x = Math.min(min.x, vertex.x); max.x = Math.max(max.x, vertex.x)
    min.y = Math.min(min.y, vertex.y); max.y = Math.max(max.y, vertex.y)
    min.z = Math.min(min.z, vertex.z); max.z = Math.max(max.z, vertex.z)
  }
  return { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }
}

/**
 * 挑四个**仿射无关**的顶点（不共面）；顶点全共面 / 共线 / 重合时返回 `null`。
 *
 * 三步"最远点"：最远的点给出方向，离那条**直线**最远的点给出平面，
 * 离那个**平面**最远的点给出体积。三步都取到非退化距离时，四点必然仿射无关。
 * 全程 O(n)，不依赖顶点顺序。
 *
 * 顺带这也给出了**条件数最好**的那一组：底面积与高都取到最大，
 * 于是那个 3×3 方程组离奇异最远（`solveLinearSystem` 的判据是绝对主元 1e-12）。
 */
function affinelyIndependentTetrad(vertices: readonly Vector3[], tolerance: number): [Vector3, Vector3, Vector3, Vector3] | null {
  const origin = vertices[0]
  const farthest = (measure: (candidate: Vector3) => number): { point: Vector3; value: number } => {
    let best = { point: origin, value: Number.NEGATIVE_INFINITY }
    for (const vertex of vertices) {
      const value = measure(vertex)
      if (value > best.value) best = { point: vertex, value }
    }
    return best
  }

  // ① 离 origin 最远的点：给出第一条方向。全重合 ⇒ 退化。
  const first = farthest((vertex) => lengthVector3(subtractVector3(vertex, origin)))
  if (!(first.value > tolerance)) return null
  const direction = normalizeVector3(subtractVector3(first.point, origin))
  if (!(lengthVector3(direction) > 0)) return null

  // ② 离直线 origin→first 最远的点：给出第二条方向。全共线 ⇒ 退化。
  const second = farthest((vertex) => lengthVector3(crossVector3(direction, subtractVector3(vertex, origin))))
  if (!(second.value > tolerance)) return null
  const normal = normalizeVector3(crossVector3(direction, subtractVector3(second.point, origin)))
  if (!(lengthVector3(normal) > 0)) return null

  // ③ 离平面 origin/first/second 最远的点：给出体积。全共面 ⇒ 退化。
  const third = farthest((vertex) => Math.abs(dotVector3(normal, subtractVector3(vertex, origin))))
  if (!(third.value > tolerance)) return null

  return [origin, first.point, second.point, third.point]
}

/**
 * **外接球**。
 *
 * - 长方体（顶点恰好是包围盒的 8 个角）：包围盒中心 + 体对角线半径（规格 §3.4 的第一条闭式解）。
 * - 一般情形：解 $\|P_i - c\|^2 = r^2$ 的等距方程组（对 $i > 0$ 与 $i = 0$ 相减得到线性方程），
 *   得到候选球心后**逐个顶点验残差**（规格 §3.4 的第三条："校验所有顶点残差，不满足时返回 `undefined`"）。
 *
 * 残差不满足时返回 `undefined` 而不是"最接近的那个球"：一般多面体不一定有外接球，
 * 交一个近似球出去等于告诉用户一个假的数学事实。
 */
export function solveCircumsphere3(boundary: SolidBoundary): DerivedSolidResult<Sphere3> {
  const problem = boundaryProblem(boundary)
  if (problem) return { status: "degenerate", reason: problem }

  const vertices = boundary.vertices
  const scale = extentOf(vertices)
  const tolerance = scale * 1e-9

  /**
   * 长方体：顶点恰好是包围盒的 **8 个角**时用闭式解（体对角线半径）。
   *
   * "每个坐标都落在包围盒的极值上"才是"这是一只长方体"的判据。只看"八个卦限都有人"
   * 是不够的：把立方体的一个顶点往外拉一点，八个卦限仍然占满，但边长已经不是三对了 ——
   * 那时包围盒中心**不是**外接球心（实测：残差 0.81 被当成了 0）。
   */
  const half = halfExtents(vertices)
  if (vertices.length === 8) {
    const center = boundingBoxCenter(vertices)
    const isCorner = (vertex: Vector3) =>
      (Math.abs(Math.abs(vertex.x - center.x) - half.x) <= tolerance)
      && (Math.abs(Math.abs(vertex.y - center.y) - half.y) <= tolerance)
      && (Math.abs(Math.abs(vertex.z - center.z) - half.z) <= tolerance)
    const octants = new Set(vertices.map((vertex) => `${vertex.x - center.x > 0 ? 1 : 0}${vertex.y - center.y > 0 ? 1 : 0}${vertex.z - center.z > 0 ? 1 : 0}`))
    if (vertices.every(isCorner) && octants.size === 8) {
      const radius = Math.hypot(half.x, half.y, half.z)
      if (radius > tolerance) return { status: "exact", value: { center, radius } }
      return { status: "degenerate", reason: "长方体的边长退化，外接球不存在。" }
    }
  }

  /**
   * 一般情形：先挑一组**仿射无关**的四点定出候选球心，再对**全部**顶点验残差。
   *
   * ## 为什么不再枚举所有 C(n,4)（外部审查 G1）
   *
   * 过四个不共面点的球是**唯一**的。所以只要实体真的有外接球，任何一组不共面的四点
   * 算出来的都是同一颗球 —— 枚举出来的每一种组合都在重复同一件事。
   * 反过来也成立：某一组不共面的四点残差过不了，这只实体就**没有**外接球
   *（换一组只会得到另一颗同样过不了的球，否则那颗更早的球早就通过残差了）。
   *
   * 而枚举的代价是 C(n,4) 再加上一次**线性扫描**的球心去重：实测 16 顶点 103ms、
   * 22 顶点 1538ms（每 +2 顶点约 ×2.5）⇒ 32 顶点要几分钟、48 顶点要几小时。
   * 这条路径用户随手就能触发（属性面板在选中任何图元时都会对整篇文档算一遍读数）。
   * 现在挑四点 O(n)、验残差 O(n)，整体 O(n)。
   *
   * 顶点全共面 / 共线 / 重合时 `affinelyIndependentTetrad` 给出 `null`，
   * 于是走到下面那条与旧实现**完全相同**的 `undefined` 分支（原因文案一字不改）。
   */
  const tetrad = affinelyIndependentTetrad(vertices, tolerance)
  if (tetrad) {
    const reference = tetrad[0]
    const matrix = tetrad.slice(1).map((point) => [2 * (point.x - reference.x), 2 * (point.y - reference.y), 2 * (point.z - reference.z)])
    const rhs = tetrad.slice(1).map((point) => (point.x * point.x + point.y * point.y + point.z * point.z) - (reference.x * reference.x + reference.y * reference.y + reference.z * reference.z))
    const solution = solveLinearSystem(matrix, rhs)
    if (solution) {
      const candidate = { x: solution[0], y: solution[1], z: solution[2] }
      const distances = vertices.map((vertex) => lengthVector3(subtractVector3(vertex, candidate)))
      const radius = (Math.min(...distances) + Math.max(...distances)) / 2
      if (radius > tolerance && Math.max(...distances) - Math.min(...distances) <= tolerance) {
        return { status: "exact", value: { center: candidate, radius } }
      }
    }
  }

  // 一颗球都过不了残差：如实说"没有外接球"，而不是交一个近似。
  return { status: "undefined", reason: "该多面体没有外接球：找不到到所有顶点等距的点。" }
}

function planeThroughFace(points: readonly Vector3[]): Plane3 | null {
  const normal = normalizeVector3(crossVector3(subtractVector3(points[1], points[0]), subtractVector3(points[2], points[0])))
  if (lengthVector3(normal) <= 0) return null
  return { normal, constant: -dotVector3(normal, points[0]) }
}

/** 有向平面值：`> 0` 在法向那一侧。面的法向朝外时，实体内部是负值。 */
function planeValue(point: Vector3, plane: Plane3): number {
  return dotVector3(plane.normal, point) + plane.constant
}

/**
 * **内切球**。
 *
 * - 四面体：解"到四个面等距"的方程（四面体的内心 = 各项点对面面积的加权平均，规格 §3.4）。
 * - 一般凸多面体：求**最大内接球** —— 也就是让"到所有面的最小距离"最大的那个点。
 *   这里用一条确定性的迭代（形心起步，逐步朝最紧的那个面的反方向移动并收缩步长）。
 *
 * 收敛之后按面距的**离散度**决定状态：所有面的距离一致 → `exact`（贴住了每一个面）；
 * 不一致 → `undefined`（最大内接球贴不上某些面，那只实体**没有**内切球）；
 * 连一个"球都放不下"（半径退化为 0）→ 同样是 `undefined`。
 * 这里不产出 `approximate`：规格 §3.4 对一般凸多面体的口径就是"不满足时返回 `undefined`"
 * （详见函数末尾的注释）。"存在内切球"与"只有最大内接球"因此是两个可区分的答案。
 */
export function solveInsphere3(boundary: SolidBoundary): DerivedSolidResult<Sphere3> {
  const problem = boundaryProblem(boundary)
  if (problem) return { status: "degenerate", reason: problem }

  const vertices = boundary.vertices
  const scale = extentOf(vertices)
  const tolerance = scale * 1e-9

  /** 面的**外法向**平面：把面环按"相对实体形心朝外"定向，内部就是所有面的负半空间。 */
  const centroid = vertices.reduce((sum, vertex) => ({
    x: sum.x + vertex.x / vertices.length,
    y: sum.y + vertex.y / vertices.length,
    z: sum.z + vertex.z / vertices.length
  }), { x: 0, y: 0, z: 0 })
  const planes: Plane3[] = []
  for (const face of boundary.faces) {
    if (!Array.isArray(face) || face.length < 3) continue
    const points = face.map((index) => vertices[index])
    if (points.some((point) => !isFiniteVector(point))) continue
    const plane = planeThroughFace(points)
    if (!plane) continue
    const faceCentre = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length, z: sum.z + point.z / points.length }), { x: 0, y: 0, z: 0 })
    const outward = subtractVector3(faceCentre, centroid)
    const flipped = dotVector3(plane.normal, outward) < 0
    planes.push(flipped ? { normal: { x: -plane.normal.x, y: -plane.normal.y, z: -plane.normal.z }, constant: -plane.constant } : plane)
  }
  if (planes.length < 4) return { status: "degenerate", reason: "实体的面不足以定义内切球（至少需要四个面）。" }

  /** 面距：内部为正（内部在朝外法向的负半空间里）。 */
  const distancesAt = (point: Vector3) => planes.map((plane) => -planeValue(point, plane))
  const minDistance = (point: Vector3) => Math.min(...distancesAt(point))

  // 形心起步：它是凸体的内点，保证迭代点始终在内部附近。
  let current = centroid
  let best = minDistance(current)
  if (!Number.isFinite(best)) return { status: "degenerate", reason: "实体面距无法计算（法向退化）。" }
  let step = scale
  while (step > tolerance) {
    let improved = false
    for (const direction of [
      { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }
    ]) {
      const candidate = { x: current.x + direction.x * step, y: current.y + direction.y * step, z: current.z + direction.z * step }
      const value = minDistance(candidate)
      if (Number.isFinite(value) && value > best) {
        current = candidate
        best = value
        improved = true
        break
      }
    }
    if (!improved) step /= 2
  }

  if (!Number.isFinite(best) || best <= tolerance) return { status: "undefined", reason: "该实体放不下任何内切球（最大内接球半径退化为零）。" }

  /**
   * **规格 §3.4 的口径**："一般凸多面体外接球 / 内切球……**不满足时返回 `undefined`**"。
   *
   * 所以"最大内接球只碰到一部分面"（四面体那种"到四个面等距"的条件不成立）必须报 `undefined`，
   * 不能报 `approximate` —— 后者的含义是"这是一个带残差的数值解"，而这里的事实是
   * "这只实体根本没有内切球"。把两者合并，调用方就没有办法如实告诉用户这句话，
   * 而这正是 `DerivedSolidResult` 把四个状态分开的全部理由（规格 §3.1）。
   *
   * 判据用**最大面距**：四个面等距时它就是半径；只要有一个面明显更远，这只球就贴不上它。
   */
  const distances = distancesAt(current)
  const spread = Math.max(...distances) - Math.min(...distances)
  if (spread <= tolerance * Math.max(1, scale)) return { status: "exact", value: { center: current, radius: best } }
  return { status: "undefined", reason: `该实体没有内切球：最大内接球到各面的距离不一致（最大面距 ${spread.toPrecision(3)}）。` }
}

/**
 * **截面**：沿实体自己的面成环，而不是按形心角排序（规格 §3.4）。
 *
 * 排序规则**复用** `sections3d.ts` 里已有的那条路径（`sectionPolyhedron3`：
 * 逐面求交 → 按共享端点串成闭合环）。这里只把它的结果翻译成统一个派生状态，
 * 因此"非凸截面"与"带孔 / 分块的截面"和立方体的截面走的是同一份实现 —— 不存在第二套排序。
 */
export function sectionSolid3(boundary: SolidBoundary, plane: Plane3, tolerance = 1e-9): DerivedSolidResult<SolidSection3> {
  const problem = boundaryProblem(boundary)
  if (problem) return { status: "degenerate", reason: problem }
  if (!isFiniteVector(plane?.normal) || !Number.isFinite(plane?.constant)) return { status: "degenerate", reason: "剖切平面包含非有限坐标。" }

  const section: Section3Result = sectionPolyhedron3([...boundary.vertices], boundary.faces.map((face) => [...face]), plane, tolerance)
  // 拓扑不足 / 边界串不起来：这与"平面没切到实体"是两回事，必须分开报（既有实现已经在解释里区分）。
  if (section.status === "insufficient-data") return { status: "degenerate", reason: section.explanation }
  return {
    status: "exact",
    value: { classification: section.status, points: section.points, loops: section.loops, explanation: section.explanation }
  }
}
