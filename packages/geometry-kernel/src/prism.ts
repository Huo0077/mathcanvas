import { areCoplanar, crossVector3, dotVector3, lengthVector3, normalizeVector3, subtractVector3, type Vector3 } from "./geometry3d"

/**
 * **棱柱的纯拓扑构造**（Solid/Prism 切片 Task 2；设计规格 §3.3）。
 *
 * 规格给定的公式只有三行：
 *
 * ```text
 * Ti = Bi + vector
 * 底面 = [B0 ... Bn-1]
 * 顶面 = [Tn-1 ... T0]
 * 侧面 i = [Bi, B(i+1), T(i+1), Ti]
 * ```
 *
 * 这个文件就实现这三行 —— 不碰文档、不分配 id、不写全局状态、也不"猜"缺失的输入。
 * 用户级引用永远指向 Solid（`SolidPolyhedron`），子对象名由调用方按 Solid ID 派生（规格 §3.3），
 * 所以这里返回的是**下标**而不是 id：命名策略属于文档层，不属于几何层。
 *
 * ## 为什么侧面必须是**生成**的，而不是"三个/四个面拼起来"
 *
 * 侧面 `[Bi, B(i+1), T(i+1), Ti]` 的两条对边逐分量相等（`B(i+1) - Bi == T(i+1) - Ti == v - v`），
 * 所以它**天然共面且是平行四边形**。规格 §7 明令禁止"把散面拼成 Prism"：拼出来的面只要有一个
 * 顶点没对齐，画布上就是一只"侧面拧着"的棱柱，而且截面 / 交线全都会跟着错。
 */

/** 一条棱：两个顶点在 `SolidTopology.vertices` 里的下标，加上它归属的两个面。 */
export interface PrismEdge {
  pointIndexes: [number, number]
  faceIndexes: [number, number]
}

/**
 * 一只多面体的**拓扑事实**：顶点位置、棱（按顶点下标）、面（按顶点下标的闭合环，首尾不重复）。
 *
 * 环绕方向一律规范成**朝外**（`(p1-p0)×(p2-p0)` 就是外法向），调用方不必再判方向。
 */
export interface SolidTopology {
  /** 顶点位置：`[B0…Bn-1, T0…Tn-1]`。 */
  vertices: Vector3[]
  edges: PrismEdge[]
  /** 面的顶点下标环：`[底面, 顶面, 侧面 0 … 侧面 n-1]`。 */
  faces: number[][]
  /** 底面顶点数（`n`）。 */
  baseCount: number
}

export type PrismDiagnosticCode = "invalid-input" | "degenerate-vector" | "degenerate-base" | "non-planar-base" | "self-intersection" | "degenerate-volume"

export interface PrismDiagnostic {
  code: PrismDiagnosticCode
  message: string
}

export type PrismValidation =
  | { ok: true }
  | { ok: false; diagnostics: PrismDiagnostic[] }

/**
 * 判据的**尺度**。
 *
 * 固定小数位在 1e6 量级的坐标上会把合法的棱柱判成退化（浮点残差随尺度增长），
 * 而绝对容差在 1e-3 量级的模型上又会放过真正退化的输入。所以容差按模型自身尺度取，
 * 与 `sections3d.ts` 的 `quantumFor` 同一套思路。
 */
function extentOf(points: readonly Vector3[]): number {
  return points.reduce((largest, point) => Math.max(largest, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)), 0)
}

/** 平面内的二维点（规格 §3.2 的底面写法）。 */
export interface PrismPlaneCoordinate {
  x: number
  y: number
}

/** 规格 §3.2 的底面平面：原点 + 法向。 */
export interface PrismBasePlane {
  origin: Vector3
  normal: Vector3
}

/**
 * 规格 §3.2 的输入形式：**平面 + 二维多边形**。
 *
 * 存储形式仍然是世界顶点（见 `PrismConstruction` 的注释：第二份几何真源必然分叉），
 * 所以解析边界要用 `liftPrismBasePolygon` 把二维点抬到平面上。
 */
export interface PrismPlaneBase {
  plane: PrismBasePlane
  polygon: readonly PrismPlaneCoordinate[]
}

/** 形状守卫：这份底面用的是"平面 + 二维点"写法吗（存储形式是三维点，两者互斥）。 */
export function isPrismPlaneBase(base: unknown): base is PrismPlaneBase {
  if (!base || typeof base !== "object") return false
  const candidate = base as { plane?: unknown; polygon?: unknown }
  const plane = candidate.plane as { origin?: unknown; normal?: unknown } | undefined
  const hasPlane = Boolean(plane && typeof plane === "object"
    && isFiniteVector(plane.origin) && isFiniteVector(plane.normal) && lengthVector3(plane.normal) > 0)
  if (!hasPlane || !Array.isArray(candidate.polygon)) return false
  return candidate.polygon.length > 0 && candidate.polygon.every((point) => {
    if (!point || typeof point !== "object") return false
    const candidatePoint = point as { x?: unknown; y?: unknown }
    return Number.isFinite(candidatePoint.x) && Number.isFinite(candidatePoint.y) && !("z" in (point as object))
  })
}

/**
 * 把规格 §3.2 的**平面 + 二维多边形**抬成世界坐标顶点（解析边界用，纯函数）。
 *
 * 基底取法：参考轴取"与法向最不平行的坐标轴"，`u = n × axis` 归一化、`v = u × n`，
 * 于是 `(u, v, n)` 是正交右手系。对最常见的 `normal = +z` 参考轴因此是 +y，
 * 抬升结果就是 `origin + (x, y, 0)` —— 二维点 `(x, y)` 直接落在熟悉的 x–y 方向上。
 * （底面朝向只影响"哪边算 x"，不影响形状与共面性；这里选的是与规格例子直觉一致的那一种。）
 *
 * 结果**必然**落在给定平面上（点由平面原点加平面内两个方向线性组合而成），
 * 所以共面性是构造出来的、不是碰巧成立的。
 */
export function liftPrismBasePolygon(base: PrismPlaneBase): Vector3[] {
  const normal = lengthVector3(base.plane.normal) > 0 ? normalizeVector3(base.plane.normal) : { x: 0, y: 0, z: 1 }
  /**
   * **平面内正交基必须是右手系，而且对 +z 要给出 `u = +x`、`v = +y`**（外部审查 M2）。
   *
   * 原先这里取 `u = n × axis`、`v = u × n`，而 `u × v = u × (u × n) = −n` **恒成立** ——
   * 也就是说 `(u, v, n)` 对**任何**法向都是**左手系**。后果不是"朝向不同"这么轻：
   * 对 `normal = +z`，选轴排序把 x 排在前面（x 与 y 并列，稳定排序保持原序），
   * 于是 `u = z × x = +y`、`v = y × z = +x` —— 抬升把二维坐标 **转置**了：
   * 规格 §3.2 的例子 `(0,0),(4,0),(5,2),(1,2)` 抬出来是 `(0,0),(0,4),(2,5),(2,1)`（x、y 互换）。
   * 对中心对称的底面（矩形）看不出差别，但对**不**中心对称的底面，导入的实体就是请求图形的
   * **镜像摆放** —— 而剖切面、指定的中点、测量全都按世界坐标读，于是整道题都摆在镜像位置上。
   *
   * 修法就是文档里早就写着的那一句：参考轴取"与法向最不平行的坐标轴"，
   * 基用 `u = axis × n`、`v = n × u`（此时 `u × v = n`，右手系）。**并列时优先 +y**，
   * 对最常见的 `normal = +z` 就得到 `u = +x`、`v = +y`，也就是文档承诺的 `origin + (x, y, 0)`。
   */
  const axes = [
    // 顺序即"并列时的优先级"：+y 最优先（对 +z 给出熟悉的 x–y 朝向）。
    { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }
  ]
  let reference = axes[0]
  for (const axis of axes) {
    // 严格小于 ⇒ 并列时先出现的（+y）胜出。
    if (Math.abs(dotProduct(axis, normal)) < Math.abs(dotProduct(reference, normal))) reference = axis
  }
  let u = { x: 1, y: 0, z: 0 }
  for (const axis of [reference, ...axes]) {
    const candidate = crossVector3(axis, normal)
    if (lengthVector3(candidate) > 1e-6) {
      u = normalizeVector3(candidate)
      break
    }
  }
  const v = crossVector3(normal, u)
  return base.polygon.map((point) => ({
    x: base.plane.origin.x + point.x * u.x + point.y * v.x,
    y: base.plane.origin.y + point.x * u.y + point.y * v.y,
    z: base.plane.origin.z + point.x * u.z + point.y * v.z
  }))
}

function dotProduct(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

/**
 * **文档导入路径的几何语义判据**（Fix round 2 / I6）。
 *
 * 输入是已经抬成世界顶点的底面与向量；输出是**结构化诊断**（路径与文案由调用方拼）。
 * 存在的理由是分层：`@draw/dsl` 不能依赖内核（内核依赖 DSL），所以 schema 不自己实现
 * "共面 / 自交 / 零体积"，而是由 codec 把这个判据注入文档校验 —— 于是**创建路径与导入路径
 * 用的是同一份规则**，不会像评审指出的那样一处在、一处不在。
 */
export function validatePrismSolidConstruction(polygon: readonly Vector3[], vector: Vector3): PrismValidation {
  return validatePrismInput(polygon, vector)
}

function isFiniteVector(value: unknown): value is Vector3 {
  return Boolean(value && typeof value === "object"
    && Number.isFinite((value as Vector3).x)
    && Number.isFinite((value as Vector3).y)
    && Number.isFinite((value as Vector3).z))
}

function diagnostic(code: PrismDiagnosticCode, message: string): PrismDiagnostic {
  return { code, message }
}

/**
 * 底面所在平面的**稳健法向**（未单位化）。
 *
 * 为什么不能只看前三个点：模型给出的多边形在边上多带一个**共线点**是很常见的
 * （`(0,0,0),(1,0,0),(2,0,0),…`），那时 `cross(p1-p0, p2-p0)` 是零向量，
 * 所有下游判据（自交投影轴、体积）都会跟着塌掉。所以这里按 `areCoplanar` 同一套思路
 * 找**第一组真正不共线**的三点。
 *
 * 全部三点共线时返回零向量：那时底面本身已经退化，调用方会先报 `degenerate-base`。
 */
function baseNormal(points: readonly Vector3[]): Vector3 {
  for (let second = 1; second < points.length; second += 1) {
    for (let third = second + 1; third < points.length; third += 1) {
      const normal = crossVector3(subtractVector3(points[second], points[0]), subtractVector3(points[third], points[0]))
      if (lengthVector3(normal) > 0) return normal
    }
  }
  return { x: 0, y: 0, z: 0 }
}

/**
 * 投影到"丢掉法向主导轴"的平面上：自交判定只需要一个不塌陷的二维视图。
 *
 * 投影轴取自**整只多边形**的稳健法向（见 `baseNormal`），而不是前三个点的叉积。
 * 退化到底（法向为零）时按最大坐标跨度选一个视图，保证不会把整只多边形压成一条线
 * —— 那会让共线重叠分支把合法多边形报成自交（评审 I2 的现场）。
 */
function projectForIntersection(points: readonly Vector3[]): Array<{ x: number; y: number }> {
  const normal = baseNormal(points)
  const absolute = { x: Math.abs(normal.x), y: Math.abs(normal.y), z: Math.abs(normal.z) }
  if (absolute.x > 0 || absolute.y > 0 || absolute.z > 0) {
    if (absolute.x >= absolute.y && absolute.x >= absolute.z) return points.map((point) => ({ x: point.y, y: point.z }))
    if (absolute.y >= absolute.z) return points.map((point) => ({ x: point.x, y: point.z }))
    return points.map((point) => ({ x: point.x, y: point.y }))
  }
  const spread = points.reduce((span, point) => ({
    x: Math.max(span.x, Math.abs(point.x)),
    y: Math.max(span.y, Math.abs(point.y)),
    z: Math.max(span.z, Math.abs(point.z))
  }), { x: 0, y: 0, z: 0 })
  if (spread.x <= spread.y && spread.x <= spread.z) return points.map((point) => ({ x: point.y, y: point.z }))
  if (spread.y <= spread.z) return points.map((point) => ({ x: point.x, y: point.z }))
  return points.map((point) => ({ x: point.x, y: point.y }))
}

function orientation(first: { x: number; y: number }, second: { x: number; y: number }, third: { x: number; y: number }): number {
  return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
}

function onSegment(first: { x: number; y: number }, second: { x: number; y: number }, point: { x: number; y: number }): boolean {
  return Math.min(first.x, second.x) <= point.x && point.x <= Math.max(first.x, second.x)
    && Math.min(first.y, second.y) <= point.y && point.y <= Math.max(first.y, second.y)
}

function segmentsIntersect(firstStart: { x: number; y: number }, firstEnd: { x: number; y: number }, secondStart: { x: number; y: number }, secondEnd: { x: number; y: number }): boolean {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart)
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd)
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart)
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd)
  if ((firstOrientation > 0 && secondOrientation < 0 || firstOrientation < 0 && secondOrientation > 0) && (thirdOrientation > 0 && fourthOrientation < 0 || thirdOrientation < 0 && fourthOrientation > 0)) return true
  return firstOrientation === 0 && onSegment(firstStart, firstEnd, secondStart)
    || secondOrientation === 0 && onSegment(firstStart, firstEnd, secondEnd)
    || thirdOrientation === 0 && onSegment(secondStart, secondEnd, firstStart)
    || fourthOrientation === 0 && onSegment(secondStart, secondEnd, firstEnd)
}

/**
 * 多边形是否自交（Bowtie 那种）。相邻边共享端点，跳过；首尾相邻的那一对也跳过。
 * 少于四个点时不可能自交。
 */
function hasSelfIntersectingPolygon(points: readonly Vector3[]): boolean {
  if (points.length < 4) return false
  const projected = projectForIntersection(points)
  for (let firstIndex = 0; firstIndex < projected.length; firstIndex += 1) {
    const firstNextIndex = (firstIndex + 1) % projected.length
    for (let secondIndex = firstIndex + 1; secondIndex < projected.length; secondIndex += 1) {
      const secondNextIndex = (secondIndex + 1) % projected.length
      if (firstIndex === secondIndex || firstNextIndex === secondIndex || secondNextIndex === firstIndex) continue
      if (segmentsIntersect(projected[firstIndex], projected[firstNextIndex], projected[secondIndex], projected[secondNextIndex])) return true
    }
  }
  return false
}

/** 底面是否有非零面积：存在一组三点不共线即可（尺度的平方用于把判据归一化）。 */
function hasNonZeroArea(points: readonly Vector3[], scale: number): boolean {
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

function hasDistinctPoints(points: readonly Vector3[], scale: number): boolean {
  const epsilon = scale * 1e-12
  for (let firstIndex = 0; firstIndex < points.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex += 1) {
      if (lengthVector3(subtractVector3(points[firstIndex], points[secondIndex])) <= epsilon) return false
    }
  }
  return true
}

/**
 * 棱柱输入的**结构化校验**（规格 §6.2：几何语义只保留在确定性这一层）。
 *
 * 检查的是"这份底面 + 向量能不能构成一只棱柱"，**不是**字段类型（那是 DSL schema 的职责）：
 * 至少三个点、点互异、底面共面且有非零面积、多边形不自交、向量有限且非零、
 * **拉伸方向与底面不平行（体积非零）**。
 * 失败时返回**可读的诊断码**而不是抛异常 —— 调用方（动作编译器）要据此给用户一句话。
 *
 * 底面那几条各自独立收集（评审 M7：`else if` 链只会报第一条，而契约上写的是复数诊断）。
 */
export function validatePrismInput(basePolygon: readonly Vector3[], vector: Vector3): PrismValidation {
  if (!Array.isArray(basePolygon) || basePolygon.length < 3) return { ok: false, diagnostics: [diagnostic("invalid-input", "棱柱底面至少需要三个顶点。")] }
  if (basePolygon.some((point) => !isFiniteVector(point))) return { ok: false, diagnostics: [diagnostic("invalid-input", "棱柱底面的顶点必须是有限坐标。")] }
  if (!isFiniteVector(vector)) return { ok: false, diagnostics: [diagnostic("invalid-input", "棱柱的拉伸向量必须是有限坐标。")] }

  const diagnostics: PrismDiagnostic[] = []
  const scale = Math.max(extentOf(basePolygon), extentOf([vector]))
  const vectorLength = lengthVector3(vector)
  /**
   * 底面的平面法向：体积判据与自交投影都要它（见 `baseNormal`）。
   * 底面本身退化时它是零向量，此时不再往下判——那些判据都没有意义。
   */
  const normal = baseNormal(basePolygon)
  const normalLength = lengthVector3(normal)
  const baseUsable = hasDistinctPoints(basePolygon, scale) && hasNonZeroArea(basePolygon, scale) && normalLength > 0

  if (!hasDistinctPoints(basePolygon, scale)) diagnostics.push(diagnostic("degenerate-base", "棱柱底面存在重合的顶点，无法确定多边形。"))
  if (!hasNonZeroArea(basePolygon, scale)) diagnostics.push(diagnostic("degenerate-base", "棱柱底面的面积为零，拉伸不出实体。"))
  if (baseUsable && basePolygon.length >= 4 && !areCoplanar([...basePolygon], scale * 1e-9)) diagnostics.push(diagnostic("non-planar-base", "棱柱底面的顶点不共面。"))
  if (baseUsable && hasSelfIntersectingPolygon(basePolygon)) diagnostics.push(diagnostic("self-intersection", "棱柱底面多边形自交。"))

  // 零向量拉伸出来的是"两片重合的多边形"，不是实体（规格 §3.2：向量有限且非零）。
  if (vectorLength <= scale * 1e-12) diagnostics.push(diagnostic("degenerate-vector", "棱柱的拉伸向量必须非零。"))
  /**
   * **零体积**（评审 C1）：拉伸向量平行于底面时 2n 个顶点全部共面，出来的是一张平片。
   *
   * 判据是"向量在法向上的分量相对自身长度可以忽略"：`|dot(v, n)| <= tol · |v| · |n|`。
   * 只看 `|v| ≠ 0` 是不够的 —— `(2, 0, 0)` 在 `z = 0` 的底面上非零，却一点体积都拉不出来。
   * 同包的既有构造器正是用 `hasNonZeroVolume` 拒掉这一类
   * （`solid-builders.ts` 的 `buildPrism → buildFromPoints → degenerate-volume`），
   * 这里与它对齐，避免同一个包里的两条构造路径给出不同结论。
   *
   * 顺带也消掉一个"平局"：平片的每个面法向都与"面心 − 形心"垂直，定向判据恒为 0，
   * 六个面的环绕方向会被任意翻反。先拒绝掉，那个分支就不可达。
   */
  if (baseUsable && vectorLength > scale * 1e-12 && Math.abs(dotVector3(vector, normal)) <= 1e-12 * vectorLength * normalLength) {
    diagnostics.push(diagnostic("degenerate-volume", "棱柱的拉伸向量平行于底面，体积为零（拉出来的是一张平片而不是实体）。"))
  }

  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true }
}

/**
 * 面环的 **Newell 法向**（未单位化，模长 = 2×面积，方向随绕向）。
 *
 * 为什么不用 `(p1−p0)×(p2−p0)`：环上前三点**共线**是完全合法的多边形
 *（模型生成的"边上多给一个共线点"很常见，本文件的自交判据早就为此改过一次）。
 * 那时叉积是零向量 ⇒ 定向判据恒为 `false` ⇒ 这个面被翻成**朝内**，
 * 违反 `SolidTopology` 的朝外契约（外部审查 G3）。Newell 用**整个环**求和，
 * 只有环真的退化成零面积时它才是零向量 —— 那种输入已被 `degenerate-volume` 拒掉。
 *
 * 同一类缺陷在本仓库已经修过两次（`unfold3d` 的环法向、`hosts3` 的退化判据），
 * 做法一致：环上的整体量，不要只看头三个点。
 */
function newellNormal(ring: readonly number[], vertices: readonly Vector3[]): Vector3 {
  let x = 0
  let y = 0
  let z = 0
  for (let index = 0; index < ring.length; index += 1) {
    const current = vertices[ring[index]]
    const next = vertices[ring[(index + 1) % ring.length]]
    x += (current.y - next.y) * (current.z + next.z)
    y += (current.z - next.z) * (current.x + next.x)
    z += (current.x - next.x) * (current.y + next.y)
  }
  return { x, y, z }
}

/** 面环定向：环的 Newell 法向是否指向实体外部（相对形心）。 */
function facesOutwards(ring: readonly number[], vertices: readonly Vector3[], centroid: Vector3): boolean {
  const normal = newellNormal(ring, vertices)
  const centre = ring.reduce((sum, index) => ({
    x: sum.x + vertices[index].x / ring.length,
    y: sum.y + vertices[index].y / ring.length,
    z: sum.z + vertices[index].z / ring.length
  }), { x: 0, y: 0, z: 0 })
  const outward = subtractVector3(centre, centroid)
  return normal.x * outward.x + normal.y * outward.y + normal.z * outward.z > 0
}

/**
 * 底面多边形 + 拉伸向量 → 拓扑。输入非法时返回 `null`（细节由 `validatePrismInput` 给出）。
 *
 * 顶点与面的环绕方向都**确定性**地由输入决定：同一个输入签名永远得到同一份拓扑。这是
 * "子对象 id 在重算之后仍然一致"的前提（规格 §3.3：`solidId:v0` / `solidId:e0` / `solidId:f0`）。
 */
export function buildPrismTopology(basePolygon: readonly Vector3[], vector: Vector3): SolidTopology | null {
  if (!validatePrismInput(basePolygon, vector).ok) return null

  const baseCount = basePolygon.length
  const vertices: Vector3[] = [
    ...basePolygon.map((point) => ({ x: point.x, y: point.y, z: point.z })),
    // Ti = Bi + vector
    ...basePolygon.map((point) => ({ x: point.x + vector.x, y: point.y + vector.y, z: point.z + vector.z }))
  ]

  // 底面 = [B0 … Bn-1]、顶面 = [Tn-1 … T0]、侧面 i = [Bi, B(i+1), T(i+1), Ti]。
  const rings: number[][] = [
    Array.from({ length: baseCount }, (_, index) => index),
    Array.from({ length: baseCount }, (_, index) => baseCount - 1 - index + baseCount),
    ...Array.from({ length: baseCount }, (_, index) => [index, (index + 1) % baseCount, baseCount + ((index + 1) % baseCount), baseCount + index])
  ]

  const centroid = vertices.reduce((sum, point) => ({
    x: sum.x + point.x / vertices.length,
    y: sum.y + point.y / vertices.length,
    z: sum.z + point.z / vertices.length
  }), { x: 0, y: 0, z: 0 })
  /**
   * 环绕方向统一朝外。规格只给了"顶面反向"这一条配方（它假定底面按 +法向逆时针给），
   * 但调用方给的底面环绕方向我们无从保证：不规范化的话，一半的输入会得到法向朝里的面，
   * 渲染时被背面剔除、截面法向也反号。判据是几何自身的（面心相对形心的朝向），
   * 所以**不会**把两个不同的输入混成同一个结果，也不会丢掉"B0 是谁"。
   */
  const faces = rings.map((ring) => (facesOutwards(ring, vertices, centroid) ? ring : [...ring].reverse()))

  /**
   * 棱：面的相邻点对去重（保持"先出现的先编号"，因此顺序确定）。
   * 先记每个面用到哪几条棱，再从这份记录反推"每条棱归属哪两个面" —— 顺手也就把
   * "每条棱恰好被两个面共享"这条闭合性事实变成了可断言的数据。
   */
  const edgeIndexByKey = new Map<string, number>()
  const pointIndexes: Array<[number, number]> = []
  const faceEdgeIndexes: number[][] = []
  for (const face of faces) {
    const indexes: number[] = []
    for (let index = 0; index < face.length; index += 1) {
      const first = face[index]
      const second = face[(index + 1) % face.length]
      const key = first < second ? `${first}:${second}` : `${second}:${first}`
      let edgeIndex = edgeIndexByKey.get(key)
      if (edgeIndex === undefined) {
        edgeIndex = pointIndexes.length
        edgeIndexByKey.set(key, edgeIndex)
        pointIndexes.push([first, second])
      }
      indexes.push(edgeIndex)
    }
    faceEdgeIndexes.push(indexes)
  }
  const edgeFaces: number[][] = pointIndexes.map(() => [])
  for (const [faceIndex, indexes] of faceEdgeIndexes.entries()) {
    for (const edgeIndex of indexes) edgeFaces[edgeIndex].push(faceIndex)
  }
  const edges: PrismEdge[] = pointIndexes.map((pair, index) => ({ pointIndexes: pair, faceIndexes: [edgeFaces[index][0] ?? 0, edgeFaces[index][1] ?? 0] }))

  return { vertices, edges, faces, baseCount }
}
