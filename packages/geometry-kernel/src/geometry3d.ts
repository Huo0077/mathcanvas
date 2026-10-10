export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface Plane3 {
  normal: Vector3
  constant: number
}

export function addVector3(first: Vector3, second: Vector3): Vector3 {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z }
}

export function subtractVector3(first: Vector3, second: Vector3): Vector3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z }
}

export function scaleVector3(vector: Vector3, scalar: number): Vector3 {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar }
}

export function dotVector3(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

export function crossVector3(first: Vector3, second: Vector3): Vector3 {
  return { x: first.y * second.z - first.z * second.y, y: first.z * second.x - first.x * second.z, z: first.x * second.y - first.y * second.x }
}

export function lengthVector3(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z)
}

export function distanceVector3(first: Vector3, second: Vector3): number {
  return lengthVector3(subtractVector3(first, second))
}

export function tripleProduct(first: Vector3, second: Vector3, third: Vector3): number {
  return dotVector3(crossVector3(first, second), third)
}

export function normalizeVector3(vector: Vector3): Vector3 {
  const length = lengthVector3(vector)
  return length > 1e-12 ? scaleVector3(vector, 1 / length) : { x: 0, y: 0, z: 0 }
}

/**
 * 判据的**尺度**：模型自身有多大（各分量绝对值的最大值）。
 *
 * 固定小数位在 1e6 量级的坐标上会把合法的形状判成退化（浮点残差随尺度增长），而绝对容差在
 * 1e-3 量级的模型上又会放过真正退化的输入 —— 所以容差一律**按尺度取**（与 `sections3d.ts` 的
 * `quantumFor` 同一套思路）。
 *
 * **这份定义只有一个家**（2026-10-10 用户现场）：棱柱与多面体原先各写一份，连共面容差都不同
 *（棱柱 `scale * 1e-9`、多面体用 `areCoplanar` 的默认绝对 `1e-10`），于是**同样的形状
 * 做成棱柱能过、做成多面体被拒** —— 而模型只有一次修复机会。
 */
export function extentOf(points: readonly Vector3[]): number {
  return points.reduce((largest, point) => Math.max(largest, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)), 0)
}

/**
 * 一组点里**离最佳平面最远**的那个有多远（单位与坐标一致）。
 *
 * 两个用途：`areCoplanar` 的判据本体（免得"找平面"写两遍），以及**把话说清楚** ——
 * 不共面时模型与用户都需要知道"偏了多少"，否则那句"不共面"在只有一次修复机会时等于没说。
 */
export function maxPlaneDeviation(points: readonly Vector3[]): number {
  if (points.length < 4) return 0
  const first = points[0]
  let candidate: Plane3 | null = null
  for (let secondIndex = 1; secondIndex < points.length && !candidate; secondIndex += 1) {
    for (let thirdIndex = secondIndex + 1; thirdIndex < points.length; thirdIndex += 1) {
      candidate = planeFromPoints(first, points[secondIndex], points[thirdIndex])
      if (candidate) break
    }
  }
  if (!candidate) return 0
  const plane = candidate
  /**
   * **相对第一个点量**（平面本来就过它）：`dot(n, p) + c = dot(n, p - p₀)` 是恒等式，
   * 于是这个量**与坐标系原点无关** —— 1e9 处的单位立方体不再因为浮点余项被当成"不共面"。
   */
  const origin = points[0]
  return points.reduce((largest, point) => Math.max(largest, Math.abs(dotVector3(plane.normal, subtractVector3(point, origin)))), 0)
}

/**
 * 模型自身的**尺寸**（以第一个点为基准的各分量最大差；与 `extentOf` 至多差一个因子 2）。
 *
 * **这条边界是 2026-10-10 被一条既有用例逼出来的**：一只**平移到 1e9** 的单位立方体，
 * `extentOf` 是 1e9，于是 `scale² * 1e-12 = 1e6` 把面积 1 的面判成"零面积"——而它明明是只好立方体。
 *
 * **所以判据尺度分两种，别混**：
 * - **浮点噪声** ∝ 坐标量级 ⇒ 用 `extentOf`（点互异那种"两个点是不是同一个"的判据）；
 * - **几何退化** ∝ 形状尺寸 ⇒ 用这一条（面积、共面那种"这块面是不是真的面"的判据）。
 */
export function modelSpan(points: readonly Vector3[]): number {
  if (points.length === 0) return 0
  const first = points[0]
  let span = 0
  for (const point of points) span = Math.max(span, Math.abs(point.x - first.x), Math.abs(point.y - first.y), Math.abs(point.z - first.z))
  return span
}

export function areCoplanar(points: Vector3[], tolerance = 1e-10): boolean {
  return maxPlaneDeviation(points) <= tolerance
}

/**
 * 环里**最大**的那个三角形面积（用来把"退化"说清楚：零面积的面环到底是多小）。
 *
 * 判据本体是 `hasNonZeroArea` —— 这里只是把同一个量**量出来**，好让报错能指名道姓。
 */
export function maxTriangleArea(points: readonly Vector3[]): number {
  let largest = 0
  if (points.length < 3) return largest
  const first = points[0]
  for (let secondIndex = 1; secondIndex < points.length; secondIndex += 1) {
    for (let thirdIndex = secondIndex + 1; thirdIndex < points.length; thirdIndex += 1) {
      const normal = crossVector3(subtractVector3(points[secondIndex], first), subtractVector3(points[thirdIndex], first))
      largest = Math.max(largest, lengthVector3(normal) / 2)
    }
  }
  return largest
}

/**
 * 环是否有非零面积：存在一组三点不共线即可（**尺度的平方**用于把判据归一化）。
 *
 * **这份定义只有一个家**（2026-10-10 用户现场）：棱柱与多面体原先各写一份 ——
 * 棱柱按 `scale² * 1e-12` 判，多面体用的是"叉积**精确不为零**"，于是同一个退化环
 * 在两个入口得到两个答案。
 */
export function hasNonZeroArea(points: readonly Vector3[], scale: number): boolean {
  if (points.length < 3) return false
  const first = points[0]
  for (let secondIndex = 1; secondIndex < points.length; secondIndex += 1) {
    for (let thirdIndex = secondIndex + 1; thirdIndex < points.length; thirdIndex += 1) {
      const normal = crossVector3(subtractVector3(points[secondIndex], first), subtractVector3(points[thirdIndex], first))
      if (lengthVector3(normal) > scale * scale * 1e-12) return true
    }
  }
  return false
}

/**
 * 点是否两两互异：**按模型自身尺度**判（`scale * 1e-12` 以内算同一个点）。
 *
 * 与 `hasNonZeroArea` 同源：多面体那条原先用"坐标字符串全等"，于是尺度 1e6 下相差 1e-9
 * 的"两个点"被当成互异 —— 那其实是一只退化实体。
 */
export function hasDistinctPoints(points: readonly Vector3[], scale: number): boolean {
  const epsilon = scale * 1e-12
  for (let firstIndex = 0; firstIndex < points.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex += 1) {
      if (lengthVector3(subtractVector3(points[firstIndex], points[secondIndex])) <= epsilon) return false
    }
  }
  return true
}

export function planeFromPoints(first: Vector3, second: Vector3, third: Vector3): Plane3 | null {
  const normal = normalizeVector3(crossVector3(subtractVector3(second, first), subtractVector3(third, first)))
  return lengthVector3(normal) > 0 ? { normal, constant: -dotVector3(normal, first) } : null
}

export function intersectRayPlane(origin: Vector3, direction: Vector3, plane: Plane3): Vector3 | null {
  const denominator = dotVector3(plane.normal, direction)
  if (Math.abs(denominator) < 1e-12) return null
  const distance = -(dotVector3(plane.normal, origin) + plane.constant) / denominator
  return distance >= 0 ? addVector3(origin, scaleVector3(direction, distance)) : null
}

export function dihedralAngle(firstNormal: Vector3, secondNormal: Vector3): number {
  const first = normalizeVector3(firstNormal)
  const second = normalizeVector3(secondNormal)
  const cosine = Math.min(1, Math.max(-1, Math.abs(dotVector3(first, second))))
  return Math.acos(cosine)
}

export function dihedralAngleDegrees(firstNormal: Vector3, secondNormal: Vector3): number {
  return dihedralAngle(firstNormal, secondNormal) * 180 / Math.PI
}

function planeValue(point: Vector3, plane: Plane3): number {
  return dotVector3(plane.normal, point) + plane.constant
}

function interpolateVector3(first: Vector3, second: Vector3, ratio: number): Vector3 {
  return addVector3(first, scaleVector3(subtractVector3(second, first), ratio))
}

export function intersectPlaneSegment(first: Vector3, second: Vector3, plane: Plane3, tolerance = 1e-10): Vector3[] {
  const firstValue = planeValue(first, plane)
  const secondValue = planeValue(second, plane)
  if (Math.abs(firstValue) <= tolerance && Math.abs(secondValue) <= tolerance) return [first, second]
  if (Math.abs(firstValue) <= tolerance) return [first]
  if (Math.abs(secondValue) <= tolerance) return [second]
  if (firstValue * secondValue > 0) return []
  return [interpolateVector3(first, second, firstValue / (firstValue - secondValue))]
}

export function sectionCube(origin: Vector3, size: Vector3, plane: Plane3): Vector3[] {
  const vertices = [
    { x: origin.x, y: origin.y, z: origin.z },
    { x: origin.x + size.x, y: origin.y, z: origin.z },
    { x: origin.x + size.x, y: origin.y + size.y, z: origin.z },
    { x: origin.x, y: origin.y + size.y, z: origin.z },
    { x: origin.x, y: origin.y, z: origin.z + size.z },
    { x: origin.x + size.x, y: origin.y, z: origin.z + size.z },
    { x: origin.x + size.x, y: origin.y + size.y, z: origin.z + size.z },
    { x: origin.x, y: origin.y + size.y, z: origin.z + size.z }
  ]
  const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
  return sectionConvexPolyhedron(vertices, edges, plane)
}

export function sectionConvexPolyhedron(vertices: Vector3[], edges: [number, number][], plane: Plane3): Vector3[] {
  const unique = new Map<string, Vector3>()
  for (const [firstIndex, secondIndex] of edges) {
    for (const point of intersectPlaneSegment(vertices[firstIndex], vertices[secondIndex], plane)) {
      const key = `${point.x.toFixed(10)},${point.y.toFixed(10)},${point.z.toFixed(10)}`
      unique.set(key, point)
    }
  }
  return [...unique.values()]
}
