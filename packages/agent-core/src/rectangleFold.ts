import { POINT_NAME_SOURCE, canonicalPointName } from "@draw/geometry-kernel"

import { parseDiagramObligations } from "./diagramObligations"
import { foldPointAboutHinge } from "./foldChain"
import { readNamedFold, namedFoldSpans, type NamedFoldTransition, type SourceSpan } from "./namedFold"

/**
 * **矩形沿对角线折起**（A3，2026-10-26）。
 *
 * 这一层回答三个问题，**不猜**任何一个：
 *
 * 1. 题面里的矩形是哪四个点、哪两条边给定了长度？
 * 2. 折的是哪条对角线、哪一片跟着动、折角是多少（或**未知**）？
 * 3. 折前 / 折后各自要满足什么？
 *
 * ## 为什么折角不许默认 90°
 *
 * 「沿对角线 AC 把 △ABC 折起」**没有**给出折角。此时折后点在一个圆上（绕折痕旋转），
 * 题目若还要求 `BD` 的长，答案随折角变化 —— 那是**信息不足**，必须问用户
 *（`needs_angle`），而不是挑一个好看的角度算下去。
 *
 * 只有题面**明确**写出「平面 ABC ⊥ 平面 ACD」且这两个平面正好是折痕两侧的平面时，
 * 才采用 90°（`explicit-perpendicular-planes`）；垂直关系说的若不是这两张面，
 * 一律 `unsupported` —— 那说明我们对题面的理解还缺一块。
 *
 * ## 数学（用户案例，2026-10-26）
 *
 * 矩形 ABCD，AB=4，BC=2，沿 AC 折起使平面 ABC ⊥ 平面 ACD：
 *
 * - 折前 A=(0,0,0)、B=(4,0,0)、C=(4,2,0)、D=(0,2,0)；
 * - 折后 B₁=(16/5, 8/5, ±4/√5)；
 * - (B₁−D)·(C−A)=12（所以 **BD⊥AC 不成立**）；
 * - BD²=68/5，BD=2√85/5≈3.68781778291715。
 *
 * 第（1）问因此**不能**被证明：这一层返回的是"在该题设下该命题不成立"的确定性结论，
 * 而不是"再找一组坐标碰运气"。
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export type PointTable = Record<string, Vec3>

export interface RectangleSpec {
  /** 矩形的循环顺序（`ABCD` ⇒ A→B→C→D→A）。 */
  ring: [string, string, string, string]
  /** 折痕两端（必须是环上的**对角**）。 */
  hinge: [string, string]
  /** 动的那一片三角形（折痕 + 一个环上点）。 */
  moving: [string, string, string]
  /** 不动的那一片三角形。 */
  fixed: [string, string, string]
  /** 会动的那个点（折痕两点不动）。 */
  apex: string
  sides: { a: number; b: number; aSegment: string; bSegment: string }
  fold: NamedFoldTransition
  angle:
    | { kind: "given"; degrees: number; source: "explicit-degrees" | "explicit-perpendicular-planes" }
    | { kind: "unknown" }
  perpendicular?: { moving: [string, string, string]; fixed: [string, string, string]; span: SourceSpan }
  spans: { rectangle: SourceSpan; fold: SourceSpan }
}

export type RectangleFoldRead =
  | { status: "none" }
  | { status: "unsupported"; reason: string; sourceText?: string }
  | { status: "ok"; spec: RectangleSpec }

export interface RectangleFoldGeometry {
  spec: RectangleSpec
  /** 折前状态的点表（显示名）。 */
  pre: PointTable
  /** 折后状态的点表：没改名时 `apex` 这个名字在**这张表里**表示折后位置。 */
  post: PointTable
  angleDegrees: number
  branch: 1 | -1
  /** 折后点的显示名（没改名时与 `apex` 相同）。 */
  apexPostName: string
}

export type RectangleFoldBuild =
  | { status: "ok"; geometry: RectangleFoldGeometry }
  | { status: "needs_angle"; question: string; spec: RectangleSpec }
  | { status: "unsupported"; reason: string }

export interface RectangleFoldCheck {
  id: string
  state: 0 | 1
  status: "passed" | "failed"
  detail: string
}

const P = POINT_NAME_SOURCE
const RECTANGLE_PATTERN = new RegExp(`(?:矩形|长方形)\\s*(${P})(${P})(${P})(${P})`)
const PERPENDICULAR_PLANES = new RegExp(
  `平面\\s*(${P})(${P})(${P})\\s*(?:⊥|垂直于|垂直)\\s*平面\\s*(${P})(${P})(${P})`,
  "g"
)
const EPS = 1e-9

function sub(left: Vec3, right: Vec3): Vec3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z }
}

function dot(left: Vec3, right: Vec3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x
  }
}

function norm(vector: Vec3): number {
  return Math.sqrt(dot(vector, vector))
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPS * Math.max(1, Math.abs(left), Math.abs(right))
}

function sameTriangle(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().join("") === [...right].sort().join("")
}

function segmentKey(first: string, second: string): string {
  return [first, second].sort().join("")
}

/**
 * 读出矩形 + 对角线折 + （可选的）两平面垂直。
 *
 * 返回 `none` 表示"这道题不是这一类"；`unsupported` 表示"看起来是，但缺条件/对不上"，
 * 两种情况必须分开 —— 不能把"缺一条边"说成"不是矩形折叠题"。
 */
export function readRectangleFold(prompt: string): RectangleFoldRead {
  const rectangle = RECTANGLE_PATTERN.exec(prompt)
  if (rectangle === null) return { status: "none" }
  const ring = rectangle.slice(1, 5).map(canonicalPointName) as [string, string, string, string]
  if (new Set(ring).size !== 4) return { status: "unsupported", reason: `矩形点名有重复（${ring.join("")}）。`, sourceText: rectangle[0] }
  const rectangleSpan: SourceSpan = { start: rectangle.index, end: rectangle.index + rectangle[0].length, text: rectangle[0] }

  /**
   * **两次折起：明确拒绝，不"只折第一次"**（2026-10-27，探针实测的静默丢句）。
   *
   * `readNamedFold` 只返回**第一笔**折起。连续折起的题面（`先沿 AC 折起…，再沿 B′C 折起…`）
   * 若照旧往下走，产物只有一笔 `solid.fold`，而题设核验却报 `passed`
   * —— 图少折一笔、报告干净，正是本仓最不能接受的一类（与"静默丢条件"同源）。
   *
   * 连续折叠的支持（第二次折的是第一次折后的面）还没做，所以这里**说清不支持**：
   * 宁可不出计划，也不出一张少了一笔的图。
   */
  const foldSpans = namedFoldSpans(prompt)
  if (foldSpans.length > 1) {
    return {
      status: "unsupported",
      reason: `题面里有 ${foldSpans.length} 笔折起（${foldSpans.map((span) => `「${span}」`).join("、")}）—— 连续折叠目前不支持：只画第一笔会少折一笔，所以这里不生成计划。`,
      sourceText: rectangle[0]
    }
  }

  const foldRead = readNamedFold(prompt)
  if (foldRead.status === "none") {
    return { status: "unsupported", reason: "题面写了矩形，但没有读出「沿某条线折起」这一笔 —— 不知道该折哪一片。", sourceText: rectangle[0] }
  }
  if (foldRead.status === "invalid") return { status: "unsupported", reason: foldRead.reason, sourceText: foldRead.sourceText }

  const hinge = foldRead.hingeNames
  const hingeIndex = ring.indexOf(hinge[0])
  // 折痕必须是**对角**：环上相隔两个位置。相邻边折起来是另一类题（不是矩形对角线折叠）。
  const isDiagonal = hingeIndex >= 0 && ring[(hingeIndex + 2) % 4] === hinge[1]
  if (!isDiagonal) {
    return { status: "unsupported", reason: `折痕 ${hinge.join("")} 不是矩形 ${ring.join("")} 的对角线。`, sourceText: foldRead.transition.source.text }
  }
  const forward: [string, string, string] = [ring[hingeIndex]!, ring[(hingeIndex + 1) % 4]!, ring[(hingeIndex + 2) % 4]!]
  const backward: [string, string, string] = [ring[hingeIndex]!, ring[(hingeIndex + 2) % 4]!, ring[(hingeIndex + 3) % 4]!]
  const moving = sameTriangle(foldRead.face, forward) ? forward : backward
  const fixed = sameTriangle(foldRead.face, forward) ? backward : forward
  if (!sameTriangle(foldRead.face, moving)) {
    return { status: "unsupported", reason: `折片 ${foldRead.face.join("")} 不是矩形沿 ${hinge.join("")} 折起时应动的那一片（${forward.join("")} 或 ${backward.join("")}）。`, sourceText: foldRead.transition.source.text }
  }
  if (!foldRead.face.every((name) => ring.includes(name))) {
    return { status: "unsupported", reason: `折片 ${foldRead.face.join("")} 上有点不在矩形 ${ring.join("")} 上。`, sourceText: foldRead.transition.source.text }
  }
  if (foldRead.apex !== moving.find((name) => !hinge.includes(name))) {
    return { status: "unsupported", reason: `动点与折片不一致（${foldRead.apex}）。`, sourceText: foldRead.transition.source.text }
  }

  // 边长：只认**环上的边**。给的是对角线就说明这条不是"边长"，缺边长无法确定矩形。
  const givens = parseDiagramObligations(prompt).givens
  const lengths = new Map<string, { value: number; sourceText: string }>()
  for (const given of givens) {
    if (given.kind !== "fixedLength" || given.value === undefined) continue
    const pair = given.targets
    if (pair.length !== 2) continue
    lengths.set(segmentKey(canonicalPointName(pair[0]!), canonicalPointName(pair[1]!)), { value: Number(given.value), sourceText: given.sourceText })
  }
  const edgeOf = (first: string, second: string): { value: number; segment: string } | null => {
    // 矩形的对边相等：`AB` 与 `CD`、`BC` 与 `DA` 各是同一长度。
    for (const candidate of [[first, second], [ring[(ring.indexOf(first) + 2) % 4], ring[(ring.indexOf(second) + 2) % 4]]] as const) {
      const [left, right] = candidate
      if (left === undefined || right === undefined) continue
      const found = lengths.get(segmentKey(left, right))
      if (found !== undefined) return { value: found.value, segment: `${left}${right}` }
    }
    return null
  }
  /**
   * **"比例 + 一条边"也要定得出矩形**（2026-10-27，探针 §11.5 缺口②）。
   *
   * 卷面上 `AB:BC=2:1，AB=4` 这种写法很常见：比例 + 一条边把另一条边**唯一确定**。
   * 旧实现只认"逐条给长度"，于是整句被判"缺少边 BC"⇒ 题做不了。
   *
   * **只认相邻的一对边**：`segmentRatio` 的两段必须分别落在"a 边"（`ring[0]→ring[1]` 或它的对边）
   * 与"b 边"（`ring[1]→ring[2]` 或它的对边）上。`AB:CD` 这种写的是**两条对边**之比 ——
   * 矩形的对边本来相等，那条比例定不出 `BC`，所以仍然说缺失（有反例用例钉住）。
   * 值的方向按 `segmentRatio` 的约定：`value = |前一段| / |后一段|`。
   */
  const sideOf = (pair: readonly string[]): 0 | 1 | null => {
    if (pair.length !== 2) return null
    const [first, second] = [canonicalPointName(pair[0]!), canonicalPointName(pair[1]!)]
    const isEdge = (index: number): boolean =>
      (first === ring[index] && second === ring[(index + 1) % 4]) || (first === ring[(index + 1) % 4] && second === ring[index])
    if (isEdge(0) || isEdge(2)) return 0
    if (isEdge(1) || isEdge(3)) return 1
    return null
  }
  /**
   * **相邻一对边的比例**：`r` 的含义是 `|a 边| / |b 边| = r`（`a 边` = `ring[0]→ring[1]`，
   * `b 边` = `ring[1]→ring[2]`；对边因矩形性质等价）。
   *
   * `segmentRatio` 的约定是 `value = |前一段| / |后一段|`，所以两段的落在哪条边上决定 r 怎么算。
   * `AB:CD` 这种"两条对边之比"不算 —— 矩形的对边本来相等，它定不出另一条边。
   */
  const adjacentRatio = (): number | null => {
    for (const given of givens) {
      if (given.kind !== "segmentRatio" || given.value === undefined) continue
      const first = sideOf(given.targets.slice(0, 2))
      const second = sideOf(given.targets.slice(2, 4))
      if (first === null || second === null || first === second) continue
      const value = Number(given.value)
      if (!Number.isFinite(value) || !(value > 0)) continue
      return first === 0 ? value : 1 / value
    }
    return null
  }
  const ratio = adjacentRatio()
  let a = edgeOf(ring[0], ring[1])
  let b = edgeOf(ring[1], ring[2])
  // **只有恰好缺一条边时才用比例补**（两条都缺 ⇒ 比例给定不出尺度，仍然如实报缺）。
  if (a !== null && b === null && ratio !== null) b = { value: a.value / ratio, segment: `${ring[1]}${ring[2]}` }
  if (b !== null && a === null && ratio !== null) a = { value: b.value * ratio, segment: `${ring[0]}${ring[1]}` }
  if (a === null || b === null) {
    const missing = a === null ? `${ring[0]}${ring[1]}` : `${ring[1]}${ring[2]}`
    return {
      status: "unsupported",
      reason: `矩形要按边长确定，但缺少边 ${missing} 的长度（它与其对边都没有给）。只给一条边或只给对角线都不够。`,
      sourceText: rectangle[0]
    }
  }

  // 垂直关系：**只认折痕两侧的那两张面**。先扫完再判，免得"先看到一条不相干的垂直"就放弃。
  const perpendicularMatches: { first: string[]; second: string[]; span: SourceSpan }[] = []
  for (const match of prompt.matchAll(PERPENDICULAR_PLANES)) {
    perpendicularMatches.push({
      first: [match[1]!, match[2]!, match[3]!].map(canonicalPointName),
      second: [match[4]!, match[5]!, match[6]!].map(canonicalPointName),
      span: { start: match.index, end: match.index + match[0].length, text: match[0] }
    })
  }
  const foldPlanes = perpendicularMatches.find(({ first, second }) =>
    (sameTriangle(first, moving) && sameTriangle(second, fixed)) || (sameTriangle(first, fixed) && sameTriangle(second, moving))
  )
  if (foldPlanes === undefined && perpendicularMatches.length > 0) {
    const first = perpendicularMatches[0]!
    return {
      status: "unsupported",
      reason: `题面的垂直关系「${first.span.text}」说的不是折痕两侧的平面（折后应是 ${moving.join("")} 与 ${fixed.join("")}）—— 无法据此确定折角。`,
      sourceText: first.span.text
    }
  }
  const perpendicular: RectangleSpec["perpendicular"] = foldPlanes === undefined ? undefined : { moving, fixed, span: foldPlanes.span }

  const angle: RectangleSpec["angle"] = foldRead.transition.angle.kind === "given"
    ? { kind: "given", degrees: foldRead.transition.angle.degrees, source: "explicit-degrees" }
    : perpendicular === undefined
      ? { kind: "unknown" }
      : { kind: "given", degrees: 90, source: "explicit-perpendicular-planes" }

  return {
    status: "ok",
    spec: {
      ring,
      hinge,
      moving,
      fixed,
      apex: foldRead.apex,
      sides: { a: a.value, b: b.value, aSegment: a.segment, bSegment: b.segment },
      fold: foldRead.transition,
      angle,
      ...(perpendicular === undefined ? {} : { perpendicular }),
      spans: { rectangle: rectangleSpan, fold: foldRead.transition.source }
    }
  }
}

/**
 * 按题设构造折前 / 折后两组坐标。
 *
 * - 折前：矩形放在 z=0，`ring[0]` 在原点、`ring[0]→ring[1]` 沿 x 轴 —— 这是一个**内部**坐标系，
 *   点名的顺序、边长、折痕都从 `spec` 来，不匹配原题字符串；
 * - 折后：折痕两点不动，动点绕折痕旋转 `angleDegrees`；`branch=±1` 是两个镜像分支；
 * - 折角未知时返回 `needs_angle` 与一个具体问题，**绝不默认 90°**。
 */
export function buildRectangleFold(spec: RectangleSpec, options: { angleDegrees?: number; branch?: 1 | -1 } = {}): RectangleFoldBuild {
  const given = options.angleDegrees !== undefined
    ? { kind: "given" as const, degrees: options.angleDegrees }
    : spec.angle.kind === "given"
      ? { kind: "given" as const, degrees: spec.angle.degrees }
      : null
  if (given === null) {
    return {
      status: "needs_angle",
      spec,
      question: `题面只说了沿 ${spec.hinge.join("")} 把 △${spec.moving.join("")} 折起，没有给折角，也没有说折后两平面垂直 —— 折后 ${spec.apex} 的位置不唯一。请补充折角（例如"折起 60°"）或"平面 ${spec.moving.join("")} ⊥ 平面 ${spec.fixed.join("")}"。`
    }
  }
  const [r0, r1, r2, r3] = spec.ring
  const pre: PointTable = {
    [r0]: { x: 0, y: 0, z: 0 },
    [r1]: { x: spec.sides.a, y: 0, z: 0 },
    [r2]: { x: spec.sides.a, y: spec.sides.b, z: 0 },
    [r3]: { x: 0, y: spec.sides.b, z: 0 }
  }
  const branch = options.branch ?? 1
  const apexPostName = spec.fold.displayPostName
  const rotated = foldPointAboutHinge(pre[spec.apex]!, pre[spec.hinge[0]]!, pre[spec.hinge[1]]!, given.degrees * branch)
  const post: PointTable = { ...pre, [apexPostName]: { x: rotated.x, y: rotated.y, z: rotated.z } }
  // 显式改名时，折前位置在**折后状态**里不再存在（同名/同名点由状态表分开，靠改名则靠删键）。
  if (apexPostName !== spec.apex) delete post[spec.apex]
  return {
    status: "ok",
    geometry: { spec, pre, post, angleDegrees: given.degrees, branch, apexPostName }
  }
}

/**
 * 对**给定的两份点表**逐条核验（构造出来的、或从候选文档读回来的都一样）。
 *
 * 折前：矩形判据（非退化、顶点闭合/平行四边形、共面、相邻边垂直、边长与题面一致）。
 * 折后：折痕不动、折片刚性、已知折角对得上、两平面垂直（题面明写时）、真的离开了折前平面。
 */
export function verifyRectangleFold(
  spec: RectangleSpec,
  candidate: { pre: PointTable; post: PointTable },
  options: { angleDegrees?: number } = {}
): { status: "passed" | "failed"; checks: RectangleFoldCheck[] } {
  const checks: RectangleFoldCheck[] = []
  const push = (id: string, state: 0 | 1, ok: boolean, detail: string): void => {
    checks.push({ id, state, status: ok ? "passed" : "failed", detail })
  }
  const [r0, r1, r2, r3] = spec.ring
  const pre = candidate.pre
  const missing = spec.ring.filter((name) => pre[name] === undefined)
  if (missing.length > 0) {
    push("rectangle_present", 0, false, `折前状态缺少点名：${missing.join("、")}。`)
    return { status: "failed", checks }
  }
  const A = pre[r0]!
  const B = pre[r1]!
  const C = pre[r2]!
  const D = pre[r3]!

  // ① 非退化
  const ab = sub(B, A)
  const bc = sub(C, B)
  const area = norm(cross(ab, bc))
  push("rectangle_nondegenerate", 0, norm(ab) > EPS && norm(bc) > EPS && area > EPS, `|${r0}${r1}|=${norm(ab)}，|${r1}${r2}|=${norm(bc)}，面积=${area / 2}。`)

  // ② 顶点闭合关系 / 平行四边形：A + C = B + D
  const closure = sub({ x: A.x + C.x, y: A.y + C.y, z: A.z + C.z }, { x: B.x + D.x, y: B.y + D.y, z: B.z + D.z })
  push("rectangle_closure", 0, norm(closure) <= 1e-8 * Math.max(1, norm(A), norm(C)), `对角线中点差 ${norm(closure)}（平行四边形闭合要求为 0）。`)

  // ③ 相邻边垂直（只查这一条**不够** —— 还必须闭合、共面、非退化）
  push("rectangle_right_angle", 0, close(dot(ab, bc), 0), `(${r1}−${r0})·(${r2}−${r1})=${dot(ab, bc)}（rect 要求 0）。`)

  // ④ 共面：D 到平面 ABC 的距离为 0
  const normal = cross(ab, bc)
  const normalLength = norm(normal)
  const planeDistance = normalLength > EPS ? Math.abs(dot(sub(D, A), normal)) / normalLength : Number.POSITIVE_INFINITY
  push("rectangle_coplanar", 0, planeDistance <= 1e-8 * Math.max(1, norm(ab), norm(bc)), `D 到平面 ${r0}${r1}${r2} 的距离=${planeDistance}。`)

  // ⑤ 边长与题面一致（另一条边由矩形性质推出，不另写规则）
  const expected: { first: string; second: string; value: number }[] = [
    { first: r0, second: r1, value: spec.sides.a },
    { first: r1, second: r2, value: spec.sides.b },
    { first: r2, second: r3, value: spec.sides.a },
    { first: r3, second: r0, value: spec.sides.b }
  ]
  for (const { first, second, value } of expected) {
    const actual = norm(sub(pre[first]!, pre[second]!))
    push(`rectangle_side_${first}${second}`, 0, close(actual, value), `|${first}${second}|=${actual}，题面要求 ${value}。`)
  }

  // ⑥ 折痕不动
  for (const hingeName of spec.hinge) {
    const before = pre[hingeName]!
    const after = candidate.post[hingeName]
    const moved = after === undefined ? Number.POSITIVE_INFINITY : norm(sub(after, before))
    push(`hinge_fixed_${hingeName}`, 1, moved <= 1e-8 * Math.max(1, norm(before)), `${hingeName} 在折后移动了 ${moved}（折痕上的点必须不动）。`)
  }

  // ⑦ 折片刚性：动点到折痕两端的距离不变
  const apexPostName = spec.fold.displayPostName
  const apexPost = candidate.post[apexPostName] ?? candidate.post[spec.apex]
  if (apexPost === undefined) {
    push("apex_present", 1, false, `折后状态缺少动点 ${apexPostName}。`)
    return { status: "failed", checks }
  }
  const hingeBefore = spec.hinge.map((name) => pre[name]!)
  const hingeAfterRaw = spec.hinge.map((name) => candidate.post[name])
  if (hingeAfterRaw.some((point) => point === undefined)) {
    push("hinge_present", 1, false, "折后状态缺少折痕端点。")
    return { status: "failed", checks }
  }
  const hingeAfter = hingeAfterRaw as Vec3[]
  for (const [index, hingeName] of spec.hinge.entries()) {
    const beforeDistance = norm(sub(pre[spec.apex]!, hingeBefore[index]!))
    const afterDistance = norm(sub(apexPost, hingeAfter[index]!))
    push(`flap_rigid_${hingeName}`, 1, close(beforeDistance, afterDistance), `|${spec.apex}${hingeName}| 折前=${beforeDistance}、折后=${afterDistance}（刚体运动要求相等）。`)
  }

  // ⑧ 已知折角：实际转过的角度（不区分镜像分支）必须等于题面/垂直关系给出的角
  const expectedAngle = options.angleDegrees ?? (spec.angle.kind === "given" ? spec.angle.degrees : undefined)
  if (spec.angle.kind === "given" || expectedAngle !== undefined) {
    const axis = sub(hingeBefore[1]!, hingeBefore[0]!)
    const axisLength = norm(axis)
    const unit = { x: axis.x / axisLength, y: axis.y / axisLength, z: axis.z / axisLength }
    const project = (vector: Vec3): Vec3 => {
      const along = dot(vector, unit)
      return { x: vector.x - unit.x * along, y: vector.y - unit.y * along, z: vector.z - unit.z * along }
    }
    const beforeOffset = project(sub(pre[spec.apex]!, hingeBefore[0]!))
    const afterOffset = project(sub(apexPost, hingeAfter[0]!))
    const denominator = norm(beforeOffset) * norm(afterOffset)
    const cosine = denominator > EPS ? dot(beforeOffset, afterOffset) / denominator : 1
    const degrees = (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
    push("fold_angle_matches", 1, Math.abs(degrees - expectedAngle!) <= 1e-6, `实际折角=${degrees}°，题设=${expectedAngle}°。`)
  }

  // ⑨ 两平面垂直（只在题面明写时查）
  if (spec.perpendicular !== undefined) {
    const movingNormal = cross(sub(candidate.post[spec.moving[1]]!, candidate.post[spec.moving[0]]!), sub(candidate.post[spec.moving[2]]!, candidate.post[spec.moving[0]]!))
    const fixedNormal = cross(sub(candidate.post[spec.fixed[1]]!, candidate.post[spec.fixed[0]]!), sub(candidate.post[spec.fixed[2]]!, candidate.post[spec.fixed[0]]!))
    const dotNormals = dot(movingNormal, fixedNormal)
    const scale = norm(movingNormal) * norm(fixedNormal)
    push("planes_perpendicular", 1, scale > EPS && Math.abs(dotNormals / scale) <= 1e-8, `两平面法向量点积=${dotNormals}（垂直要求 0）。`)
  }

  return { status: checks.every((check) => check.status === "passed") ? "passed" : "failed", checks }
}

/** 折后状态里"显示名 → 坐标"。没显式改名时 `apex` 就是折后位置。 */
export function postPointsOf(geometry: RectangleFoldGeometry): PointTable {
  return geometry.post
}

/** `(A−B)·(D−C)`：用来判断"某两条线垂直"是否成立，并给出残差。 */
export function evaluatePerpendicular(points: PointTable, first: [string, string], second: [string, string]): { holds: boolean; residual: number; detail: string } {
  const [a1, b1] = first
  const [a2, b2] = second
  if (points[a1] === undefined || points[b1] === undefined || points[a2] === undefined || points[b2] === undefined) {
    return { holds: false, residual: Number.NaN, detail: `缺少点名：${[a1, b1, a2, b2].filter((name) => points[name] === undefined).join("、")}。` }
  }
  const residual = dot(sub(points[a1]!, points[b1]!), sub(points[b2]!, points[a2]!))
  return {
    holds: close(residual, 0),
    residual,
    detail: `(${a1}−${b1})·(${b2}−${a2})=${residual}${close(residual, 0) ? "（垂直）" : "（不垂直）"}。`
  }
}

/** 折后状态里一条线段的长度。 */
export function evaluateLength(points: PointTable, segment: [string, string]): { value: number; detail: string } {
  const [first, second] = segment
  if (points[first] === undefined || points[second] === undefined) {
    return { value: Number.NaN, detail: `缺少点名：${[first, second].filter((name) => points[name] === undefined).join("、")}。` }
  }
  const value = norm(sub(points[first]!, points[second]!))
  return { value, detail: `${first}${second}=${value}。` }
}
