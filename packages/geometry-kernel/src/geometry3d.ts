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
  return points.reduce((largest, point) => Math.max(largest, Math.abs(dotVector3(plane.normal, point) + plane.constant)), 0)
}

export function areCoplanar(points: Vector3[], tolerance = 1e-10): boolean {
  return maxPlaneDeviation(points) <= tolerance
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
