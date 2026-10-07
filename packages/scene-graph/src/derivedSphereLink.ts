import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { solveCircumsphere3, solveInsphere3, type SolidBoundary } from "@draw/geometry-kernel"

import { solidTopology3 } from "./sectionRecompute"

/**
 * **这只派生球还是不是它宿主的球？**（S5 的核验；设计 §4.1）。
 *
 * ## 为什么要有这一条
 *
 * 球是**派生量**：`recomputeDerivedObjects` 会在宿主变化时把它重算。设计里那句
 * **"物化但不重算被否决"** 说的是"别让球静默过期"。重算路径保证了正常流程，
 * 但"正常流程"不是判据 —— **判据是"过期了看得出来"**。所以这里从文档**自己的坐标**出发
 * 独立复核一遍：
 *
 * - `current`：宿主现在解出来的那只球，就是画面上这一只；
 * - `outdated`：宿主**现在没有**这种球了（例如顶点被拉走之后就没有外接球）——
 *   画面上这只是**上一次能解出来的那一只**。这正是"保留上一次几何、不伪造近似球"
 *   那条口径的**必然结果**，所以它不是缺陷，但**必须说出来**，否则用户会把一只不再是外接球的球当成外接球；
 * - `mismatch`：宿主有这种球，但画面上这只**不是它**（半径 / 球心对不上）——
 *   那是真异常（手改了球、或者重算没跑到），要显形。
 *
 * ## 为什么判据落在这里、而不是只写在用例里
 *
 * 用例证明的是"重算路径会更新它"；这一条要在**每一次**读文档时都成立，
 * 因为用户与模型看到的都是文档。所以它成为 `solidStatusReport` 的一条读数
 *（`derived.sphere_stale`，**只在出问题时出现**：没问题时不该多一行噪声）。
 */

export type DerivedSphereLink =
  | { status: "holds" }
  | { status: "outdated"; reason: string }
  | { status: "violated"; reason: string }

/** 允许的相对误差：以球的尺度为基准（半径），绝对下限 1e-9 —— 与全仓的残差口径一致。 */
function toleranceFor(radius: number): number {
  return Math.max(1e-9, 1e-6 * Math.max(1, radius))
}

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

const subtract = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const cross = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const norm = (a: { x: number; y: number; z: number }): number => Math.hypot(a.x, a.y, a.z)

const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values)
const show = (value: number): string => value.toPrecision(6)

/**
 * **直接几何判定：这只球是不是宿主的球**（不读求解器）。
 *
 * 设计 §4.1 的原话是"外接球核验**到各顶点等距**、内切球核验**到各面相切**"。
 * 所以判据必须**自己算距离**：
 * - 外接球：球心到**每个**顶点的距离都相同，且等于球的半径；
 * - 内切球：球心到**每个**面所在平面的距离都相同，且等于球的半径。
 *
 * **为什么不拿 `solveCircumsphere3` 的结果来比**：那只球本来就是那个求解器算出来的，
 * 用它复核它自己等于没复核（同一个 bug 会同时出现在两边）。求解器在这里只回答
 * 另一个问题 —— "宿主现在**还有没有**这种球"（存在性），那个问题它才是权威。
 */
function sphereFitsHost(
  kind: "circumsphere" | "insphere",
  center: { x: number; y: number; z: number },
  radius: number,
  boundary: SolidBoundary
): { ok: true } | { ok: false; reason: string } {
  const tolerance = toleranceFor(radius)
  if (kind === "circumsphere") {
    if (boundary.vertices.length === 0) return { ok: false, reason: "宿主没有顶点，无从谈外接球。" }
    const distances = boundary.vertices.map((vertex) => distance(center, vertex))
    if (spread(distances) > tolerance) {
      return { ok: false, reason: `球心到各顶点的距离不一致（最远 ${show(Math.max(...distances))}、最近 ${show(Math.min(...distances))}），所以它不是外接球。` }
    }
    if (Math.abs(distances[0]! - radius) > tolerance) {
      return { ok: false, reason: `球心到各顶点等距（${show(distances[0]!)}），但那个距离与这只球的半径 ${show(radius)} 不符 —— 它过不了这些顶点。` }
    }
    return { ok: true }
  }
  if (boundary.faces.length === 0) return { ok: false, reason: "宿主没有面，无从谈内切球。" }
  const faceDistances: number[] = []
  for (const ring of boundary.faces) {
    const [first, second, third] = ring.map((index) => boundary.vertices[index])
    if (!first || !second || !third) return { ok: false, reason: "宿主的面环指到了不存在的顶点，无法核验内切球。" }
    const normal = cross(subtract(second, first), subtract(third, first))
    const length = norm(normal)
    if (length <= 1e-12) continue // 退化面（三点共线）给不出平面：它约束不了球，跳过而不是判失败。
    faceDistances.push(Math.abs(normal.x * (center.x - first.x) + normal.y * (center.y - first.y) + normal.z * (center.z - first.z)) / length)
  }
  if (faceDistances.length === 0) return { ok: false, reason: "宿主的每一个面都退化，无从谈内切球。" }
  if (spread(faceDistances) > tolerance) {
    return { ok: false, reason: `球心到各面的距离不一致（最远 ${show(Math.max(...faceDistances))}、最近 ${show(Math.min(...faceDistances))}），所以它贴不上每一个面。` }
  }
  if (Math.abs(faceDistances[0]! - radius) > tolerance) {
    return { ok: false, reason: `球心到各面等距（${show(faceDistances[0]!)}），但那个距离与这只球的半径 ${show(radius)} 不符 —— 它没有与各面相切。` }
  }
  return { ok: true }
}

/**
 * 复核一只派生球。**不是派生球 / 宿主不在文档里**时返回 `null`（那种情况无话可说：
 * 宿主被删掉之后球仍在，是文档层的既有约定，不是这条判据要管的事）。
 */
export function derivedSphereLink(sphere: Extract<PrimitiveSpec, { type: "sphere" }>, primitiveMap: Map<string, PrimitiveSpec>): DerivedSphereLink | null {
  const binding = sphere.derivedFrom
  if (!binding) return null
  const host = primitiveMap.get(binding.solidId)
  if (!host || host.type !== "polyhedron3") return null
  const topology = solidTopology3(host, primitiveMap)
  if (!topology) return null
  const boundary: SolidBoundary = { vertices: topology.vertices, faces: topology.faces }
  const label = binding.kind === "circumsphere" ? "外接球" : "内切球"
  /**
   * **先后顺序有意为之**：先问"宿主现在还有没有这种球"（存在性，求解器说了算）。
   * 没有 ⇒ 画面上那只是**上一次能解出来的那一个** —— 这正是"保留上一次几何、不伪造近似球"
   * 那条口径的必然结果，不是缺陷，但必须说出来。有 ⇒ 再用**直接几何**复核这一只。
   */
  const solved = binding.kind === "circumsphere" ? solveCircumsphere3(boundary) : solveInsphere3(boundary)
  if (solved.status !== "exact") {
    /**
     * `DerivedSolidResult` 的**非精确**那一支不止一种：`undefined` / `degenerate` 带 `reason`，
     * 而 `approximate` 带的是 `value` 与 `residual`。直接读 `.reason` 会让 `typecheck` 红
     *（`vitest` 不做类型检查，所以用例全绿也拦不住）—— 本处按判别式分开写。
     */
    const reason = "reason" in solved ? solved.reason : `只有数值近似解（残差 ${solved.residual.toPrecision(3)}），不是精确解`
    return { status: "outdated", reason: `宿主现在没有${label}（${reason}），画面上这一只是**上一次能解出来的那一个**。` }
  }
  const fitted = sphereFitsHost(binding.kind, sphere.center, sphere.radius, boundary)
  return fitted.ok ? { status: "holds" } : { status: "violated", reason: fitted.reason }
}

/**
 * 文档里所有**不成立 / 过期**的派生球（正常时为空）。
 *
 * 刻意不返回"当前正确"的那些：读数表里没问题就不该多一行噪声，
 * 而"宿主有没有球"这件事已经由 `derived.circumsphere` / `derived.insphere` 报了。
 */
export function staleDerivedSpheres(
  document: GeometryDocument
): { sphereId: string; hostId: string; link: Extract<DerivedSphereLink, { status: "outdated" | "violated" }> }[] {
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const stale: { sphereId: string; hostId: string; link: Extract<DerivedSphereLink, { status: "outdated" | "violated" }> }[] = []
  for (const primitive of document.primitives) {
    if (primitive.type !== "sphere" || !primitive.derivedFrom) continue
    const link = derivedSphereLink(primitive, primitiveMap)
    if (link !== null && link.status !== "holds") {
      stale.push({ sphereId: primitive.id, hostId: primitive.derivedFrom.solidId, link })
    }
  }
  return stale
}
