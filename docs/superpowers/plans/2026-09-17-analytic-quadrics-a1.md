# A1「解析二次曲面与真圆」实现计划

> **状态（2026-09-17 复核）**：**8 片全部落地并已交付**（用户随后选定"就此收尾 A1"，见 `docs/project-progress.md` 的「解析二次曲面 A1」与「收尾决定」两节；逐片 RED→GREEN 证据、门禁数字与两处如实偏差都记在那里）。**两处与本文写法的差异**：①描边用 `THREE.Line` 而不是计划里写的 `Line2` + `LineMaterial`（理由见 spec §5.6：本片要解决的是**曲线形状**，不是描边宽度，`Line2` 也不替你重采样）；②Task 5 的"解析展开"**延后**（spec §4 与 §5.5 第 8 项：多边形版与解析版宽度只差 0.07%，价值低于投影这一项）。下面的复选框保留为**计划原文**，不逐条回勾。
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让圆柱 / 圆锥的圆成为解析对象：平面 ∩ 二次曲面给精确圆锥曲线，圆与圆锥曲线在任何缩放下都是真曲线，并把 14 处"吃近似"的下游全部适配到解析模型。

**Architecture:** 在 `packages/geometry-kernel` 新增纯函数解析层 `quadrics.ts`（对称 4×4 二次型 + `PᵀQP` 求交 + 圆锥曲线分类/规范化）；DSL 只加两个可选字段（`section.exact`、`intersectionFace.exactLoops`）并复用已有的 `circle3`；面 / 棱 / 手柄仍由既有多边形物化承载，`polyhedron3` 契约不动；渲染改为按屏幕误差驱动细分。

**Tech Stack:** TypeScript（strict）、vitest、React 18 + three.js 0.186（`Line2`/`LineMaterial`、`ShaderMaterial`）、Playwright（e2e）。**不新增任何运行时依赖。**

**Spec:** `docs/superpowers/specs/2026-09-17-analytic-quadrics-design.md`（本文档每个任务都从它推导；调研归档 `docs/research/quadric-intersection-algorithms.md`）

## Global Constraints

- 单一真源：**模型层（`packages/geometry-kernel`）不许 import three.js**，也不许读 `BufferGeometry`；解析结果只由坐标与参数决定。
- 零新依赖：不引入 WASM / CAD 内核 / 线性代数库；3×3 对称特征分解自己写（Jacobi 迭代，见 Task 1）。
- 容差：先做**系统归一化**（把系数缩放到可比较量级），再做**尺度归一化**的零判定（`δ/s²`、`Δ/s³` 对 `1e-12`）；圆的判定用半轴相对差 `(a − b) ≤ 1e-12 · a`。
- 诚实诊断：退化情形一律报 `kind`（`empty` / `point` / `line` / `lines` / `insufficient-data`），**绝不返回"看着像"的几何**；解析不可用时明确回退既有多边形路径并标注 `numeric-approximation`。
- `precision` 的字面量只有 `"exact-input" | "numeric-approximation"`（`packages/dsl/src/types.ts:657`）。
- 命令与门禁（每片结束都要跑）：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run lint`（0 error）、`npm.cmd run build --workspace @draw/web`、`npx playwright test`。
- 提交纪律：每片一个提交；提交前更新 `docs/project-progress.md` 与 `docs/feature-catalog.md`；推送后用 `git rev-parse HEAD` 与 `git ls-remote origin refs/heads/main` 核验一致。
- 文件读写只用编辑工具（read/write/edit），**不要**用 PowerShell 文本管道处理仓库文件（会按 ANSI 解码破坏中文）。

## File Structure

| 文件 | 职责 |
| --- | --- |
| `packages/geometry-kernel/src/quadrics.ts`（新） | 二次型构造、平面求交、圆锥曲线分类与规范化、参数化与自适应采样 |
| `packages/geometry-kernel/src/quadrics.test.ts`（新） | 上述内容的分类 / 边界 / 性质测试 |
| `packages/geometry-kernel/src/section-quadric.ts`（新） | 有限实体裁剪：`sectionQuadric3` 与片段环类型 |
| `packages/geometry-kernel/src/section-quadric.test.ts`（新） | 裁剪与端点落面测试 |
| `packages/dsl/src/types.ts` | `CurvePiece3` / `Conic3` 复用的载荷类型、`section.exact`、`intersectionFace.exactLoops` |
| `packages/dsl/src/schema.ts` + `schema.test.ts` | 新字段校验 |
| `packages/scene-graph/src/operations.ts` | `recomputeSection` 优先解析路径 |
| `apps/web/src/conicSampling.ts`（新） | 屏幕误差 → 分段数（世界单位每像素由调用方给） |
| `apps/web/src/conicSampling.test.ts`（新） | 采样策略单测 |
| `apps/web/src/threePrimitives.ts` | `createCurvePieces3`、`createConic3Line`、`circle3` 渲染 |
| `apps/web/src/components/PropertiesBar.tsx` | 圆锥曲线属性块（中心 / 半轴 / 离心率 / 焦点） |
| `packages/geometry-kernel/src/measurements3d.ts` | 圆柱 / 圆锥闭式体积与面积 |
| `apps/web/src/projectionVisuals.ts` | 圆的投影 → 真椭圆 |
| `packages/geometry-kernel/src/unfold3d.ts`（或新 `unfold-round.ts`） | 圆柱 / 圆锥解析展开 |
| `apps/web/src/persistence/exporters.ts` | SVG `<ellipse>` / `<circle>` |
| `packages/geometry-kernel/src/selection.ts` | 圆 / 圆弧 / 圆锥曲线的解析框选 |
| `apps/web/src/sceneContentSignature.ts` | 解析字段并入签名 |

---

### Task 1: 内核解析层 `quadrics.ts`（二次型 + `PᵀQP` + 圆锥曲线分类）

**Files:**
- Create: `packages/geometry-kernel/src/quadrics.ts`
- Test: `packages/geometry-kernel/src/quadrics.test.ts`

**Interfaces:**
- Consumes: `CylinderPrimitive` / `ConePrimitive` / `Plane3`（`@draw/dsl`、`./geometry3d`）
- Produces（后续任务全部依赖这些名字与签名）:
```ts
export interface Quadric3Bounds { axis: Vector3; origin: Vector3; height: number; radius: number }
export interface Quadric3 { kind: "cylinder" | "cone" | "plane"; matrix: number[]; bounds: Quadric3Bounds }
export function cylinderQuadric3(primitive: CylinderPrimitive): Quadric3
export function coneQuadric3(primitive: ConePrimitive): Quadric3
export function planeQuadric3(plane: Plane3): Quadric3
export function quadric3FromPrimitive(primitive: PrimitiveSpec): Quadric3 | null
export interface Conic3Frame { origin: Vector3; u: Vector3; v: Vector3; normal: Vector3 }
export type Conic3Kind = "circle" | "ellipse" | "parabola" | "hyperbola" | "line" | "lines" | "point" | "empty" | "insufficient-data"
export type Conic3Coefficients = [number, number, number, number, number, number]
export interface Conic3Line { through: { s: number; t: number }; direction: { s: number; t: number } }
export interface Conic3 { /* 见 spec §5.2：kind / frame / coefficients / center? / semiMajor? / semiMinor? / focalParameter? / eccentricity? / foci? / vertex? / lines? / point? / closed */ }
export const CIRCLE_RELATIVE_TOLERANCE = 1e-12
export function planeFrame3(plane: Plane3): Conic3Frame
export function intersectPlaneQuadric3(plane: Plane3, quadric: Quadric3): Conic3
export function conic3PointAt(conic: Conic3, t: number): Vector3
```

- [ ] **Step 1: 写失败测试**（分类与规范化，期望值全部手算好）

```ts
import { describe, expect, it } from "vitest"
import { cylinderQuadric3, coneQuadric3, intersectPlaneQuadric3 } from "./quadrics"

const RADIUS = 2
const HEIGHT = 3
const cylinder = { id: "cyl", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: RADIUS, height: HEIGHT, segments: 48 }
const cone = { id: "cone", type: "cone" as const, center: { x: 0, y: 0, z: 0 }, radius: RADIUS, height: HEIGHT, segments: 48 }

describe("plane ∩ quadric", () => {
  it("cuts a perpendicular circle exactly", () => {
    const conic = intersectPlaneQuadric3({ normal: { x: 0, y: 0, z: 1 }, constant: -1 }, cylinderQuadric3(cylinder))
    expect(conic.kind).toBe("circle")
    expect(conic.closed).toBe(true)
    expect(conic.semiMajor).toBeCloseTo(RADIUS, 12)
    expect(conic.semiMinor).toBeCloseTo(RADIUS, 12)
    expect(conic.eccentricity).toBeCloseTo(0, 12)
    expect(conic.center).toEqual({ x: 0, y: 0, z: 1 })
  })

  it("cuts a 30° ellipse with a = R/cos θ, b = R, e = sin θ", () => {
    const degrees = (value: number) => value * Math.PI / 180
    const theta = degrees(30)
    // 平面过原点、法向与轴成 θ 角：圆锥曲线中心就是轴∩平面 = 原点。
    const conic = intersectPlaneQuadric3({ normal: { x: Math.sin(theta), y: 0, z: Math.cos(theta) }, constant: 0 }, cylinderQuadric3(cylinder))
    expect(conic.kind).toBe("ellipse")
    expect(conic.semiMajor).toBeCloseTo(RADIUS / Math.cos(theta), 12)   // 2.3094010767585034
    expect(conic.semiMinor).toBeCloseTo(RADIUS, 12)
    expect(conic.eccentricity).toBeCloseTo(0.5, 12)
    expect(conic.center!.x).toBeCloseTo(0, 12)
    expect(conic.center!.z).toBeCloseTo(0, 12)
  })

  it("reports two parallel lines, one tangent line, and the empty set", () => {
    const axisParallel = (offset: number) => intersectPlaneQuadric3({ normal: { x: 1, y: 0, z: 0 }, constant: -offset }, cylinderQuadric3(cylinder))
    const two = axisParallel(1)
    expect(two.kind).toBe("lines")
    expect(two.lines).toHaveLength(2)
    expect(two.lines!.map((line) => line.through.t).sort()).toEqual([-Math.sqrt(3), Math.sqrt(3)])
    expect(axisParallel(RADIUS).kind).toBe("line")
    expect(axisParallel(3).kind).toBe("empty")
  })

  it("classifies cone sections: circle, and the four conic types by half-angle", () => {
    // 圆锥半顶角 α = atan(R/h)；平面 ⊥ 轴 → 圆，半径按高度线性收缩。
    const perpendicular = intersectPlaneQuadric3({ normal: { x: 0, y: 0, z: 1 }, constant: -1 }, coneQuadric3(cone))
    expect(perpendicular.kind).toBe("circle")
    expect(perpendicular.semiMajor).toBeCloseTo(RADIUS * (1 - 1 / HEIGHT), 12)   // 2·(1−1/3) = 4/3
    // 平面过顶点 → 一点或两条相交直线（不许给折线）。
    const throughApex = intersectPlaneQuadric3({ normal: { x: 0, y: 0, z: 1 }, constant: 0 }, coneQuadric3(cone))
    expect(["point", "lines"]).toContain(throughApex.kind)
  })

  it("declares a circle only down to 1e-12 relative axis difference: a 1e-3° tilt is an ellipse", () => {
    const degrees = (value: number) => value * Math.PI / 180
    // 正交切面（浮点残差 ~1e-16）→ 圆；倾斜 1e-3° → 椭圆，离心率 = sin(1e-3°) = 1.7453292519943296e-5。
    const orthogonal = intersectPlaneQuadric3({ normal: { x: 0, y: 0, z: 1 }, constant: -1 }, cylinderQuadric3(cylinder))
    expect(orthogonal.kind).toBe("circle")
    const tilt = degrees(1e-3)
    const tilted = intersectPlaneQuadric3({ normal: { x: Math.sin(tilt), y: 0, z: Math.cos(tilt) }, constant: -1 }, cylinderQuadric3(cylinder))
    expect(tilted.kind).toBe("ellipse")
    expect(tilted.eccentricity).toBeCloseTo(Math.sin(tilt), 15)
  })
})
```

- [ ] **Step 2: 跑测试确认失败** — `npx vitest run packages/geometry-kernel/src/quadrics.test.ts`；预期 `Failed to resolve import "./quadrics"`（RED 证据要贴进进度文档）。
- [ ] **Step 3: 实现 `quadrics.ts`**。要点（照 spec §5.1-5.2）：
  - 局部二次型（`Q` 为 4×4 行主序、对称）：圆柱 `x² + y² − R² = 0` → `[1,0,0,0, 0,1,0,0, 0,0,0,0, 0,0,0,−R²]`；圆锥把 `x²+y²` 换成 `(x·h/H + (z−?))` 的线性化形式：顶点在 `(0,0,H)`、`tan α = R/H`，方程 `(H−z)²·tan²α − (x²+y²) = 0`（用 `k = R/H` 归一化成 `k²(H−z)² − (x²+y²) = 0`，避免 `tan` 溢出）；平面 `n·x + c = 0` → `Q = [[0,n],[nᵀ,2c]]` 的对称化形式（满足 `xᵀQx = 2(n·x + c)`，整体缩放不影响零点集）。
  - 世界化：`rotation` 按 `solid-builders.ts` 的 `templatePivot` / `rotateAboutPivot` 同一 pivot 与同一顺序，用刚体变换共轭 `Q_world = Tᵀ Q_local T`，`T = [[Rᵀ, p − Rᵀ·P],[0,1]]`（`p` = 世界 pivot，`P` = 局部 pivot）。
  - 平面求交：`C = Pᵀ Q P`，`P` 的列是 `origin / u / v`；`coefficients` 取 `C` 的 `[0][0], 2·C[0][1], C[1][1], 2·C[0][2], 2·C[1][2], C[2][2]`。
  - 分类：`δ = B² − 4AC`、`Δ = det(C)`，**先系统归一化**（整体除以 `C` 的最大绝对值）再比 `1e-12`；按 spec §5.2 的表给出 `kind`。
  - 规范化提取：解 2×2 线性方程组得中心；对 `[[A, B/2],[B/2, C]]` 做闭式特征分解（两个特征值 `λ±` 与特征向量），用特征值把方程配方成 `λ₊ s'² + λ₋ t'² = −F'`，得到半轴 `a ≥ b`；`e = √(1 − (b/a)²)`；`closed = kind === "circle" || kind === "ellipse"`。
  - 圆的判定：`(a − b) ≤ CIRCLE_RELATIVE_TOLERANCE · a` → `kind = "circle"`（**不是**比 `|A − C|`，理由见 spec §5.2）。
  - 退化情形：`lines` 用 `Conic3Line[]`（过点 + 方向，帧坐标）；`point` 给 `Vector3`；`empty` / `insufficient-data` 不带几何。
  - `planeFrame3` 按 spec 写死的规则（与 `threePrimitives.ts` 的 `planeBasisFrom` 同源）。
- [ ] **Step 4: 跑测试确认通过** — 同一条命令，预期 5 passed。
- [ ] **Step 5: 补性质测试**（spec §8.3）：

```ts
it("keeps every sampled conic point on the quadric (property)", () => {
  const quadric = cylinderQuadric3(cylinder)
  const conic = intersectPlaneQuadric3({ normal: { x: Math.sin(0.4), y: 0, z: Math.cos(0.4) }, constant: -0.7 }, quadric)
  for (let index = 0; index < 64; index += 1) {
    const point = conic3PointAt(conic, (index / 64) * Math.PI * 2)
    const value = quadricValueAt(quadric, point)      // xᵀQx
    expect(Math.abs(value)).toBeLessThan(1e-9 * scaleOf(quadric))
  }
})

it("ignores the polygon segment count (segments is a render hint only)", () => {
  const coarse = intersectPlaneQuadric3({ normal: { x: 0, y: 0, z: 1 }, constant: -1 }, cylinderQuadric3({ ...cylinder, segments: 6 }))
  expect(coarse.semiMajor).toBeCloseTo(RADIUS, 12)
})
```

- [ ] **Step 6: 提交** — `git add packages/geometry-kernel/src/quadrics.ts packages/geometry-kernel/src/quadrics.test.ts` → `git commit -m "feat(kernel): add the analytic quadric layer (PᵀQP plane intersection + conic classification)"`

---

### Task 2: 有限实体裁剪 + DSL `section.exact` + 重算接线

**Files:**
- Create: `packages/geometry-kernel/src/section-quadric.ts`（+ `.test.ts`）
- Modify: `packages/dsl/src/types.ts`（`CurvePiece3`、`SectionPrimitive.exact`、`IntersectionFacePrimitive.exactLoops`）
- Modify: `packages/dsl/src/schema.ts` + `packages/dsl/src/schema.test.ts`
- Modify: `packages/scene-graph/src/operations.ts:563-567`（`recomputeSection`）
- Modify: `packages/scene-graph/src/operations.test.ts`（或同名测试文件）
- Modify: `packages/geometry-kernel/src/index.ts` 无需改（`export *` 已覆盖新文件）

**Interfaces:**
- Consumes: Task 1 的 `Quadric3` / `Conic3` / `intersectPlaneQuadric3` / `conic3PointAt`
- Produces:
```ts
export type CurvePiece3 =
  | { kind: "conic"; conic: Conic3; parameterRange: [number, number] }
  | { kind: "segment"; a: Vector3; b: Vector3 }
export function sectionQuadric3(source: Quadric3, plane: Plane3): { kind: Conic3Kind; loops: CurvePiece3[][] } | null
```

- [ ] **Step 1: 写失败测试**（裁剪必须闭合并落在端面上）

```ts
it("clips an oblique ellipse to the two end caps and closes the loop with cap chords", () => {
  // R=2、h=3 的圆柱，平面绕 x 轴倾斜 30° 且抬高到 z=1.5：椭圆被两底面切掉，补两段弦。
  const result = sectionQuadric3(cylinderQuadric3(cylinder), { normal: { x: 0, y: -Math.sin(Math.PI / 6), z: Math.cos(Math.PI / 6) }, constant: -1.5 * Math.cos(Math.PI / 6) })!
  expect(result.kind).toBe("ellipse")
  expect(result.loops).toHaveLength(1)
  const pieces = result.loops[0]
  expect(pieces.filter((piece) => piece.kind === "segment")).toHaveLength(2)
  for (const piece of pieces) {
    if (piece.kind === "segment") {
      expect([0, HEIGHT]).toContainEqual(Math.round(piece.a.z))
      expect(piece.a.z).toBeCloseTo(piece.b.z, 12)
    }
  }
})

it("returns null for a source that is not a quadric solid", () => {
  const plane = planeQuadric3({ normal: { x: 0, y: 0, z: 1 }, constant: 0 })
  expect(sectionQuadric3(plane, { normal: { x: 0, y: 0, z: 1 }, constant: -1 })).toBeNull()
})
```

- [ ] **Step 2: 跑测试确认失败** — 预期 `Failed to resolve import "./section-quadric"`。
- [ ] **Step 3: 实现裁剪**：把圆锥曲线参数域限制在 `z ∈ [0, h]`（圆柱）或 `z ∈ [0, h]` 与顶点之间（圆锥）；端点落在端面圆内时用一个 `segment` 补弦；`kind` 规则照 spec §5.4（无界相交非空但有限实体截出空 → `empty`）。
- [ ] **Step 4: DSL 字段 + schema**：`section.exact?: { kind: Conic3Kind; loops: CurvePiece3[][] }`、`intersectionFace.exactLoops?: CurvePiece3[][]`；schema 校验数组形状、`kind` 枚举、`conic.coefficients` 六个有限数、`parameterRange` `min ≤ max`；旧档读入后为 `undefined`。
- [ ] **Step 5: 接线 `recomputeSection`**：来源是 `cylinder` / `cone` 时先算 `sectionQuadric3` 并写 `exact`，多边形 `points` / `loops` / `classification` 照原样继续写（拾取与旧消费方读它们）。
- [ ] **Step 6: 跑测试 + 提交** — `npx vitest run packages/geometry-kernel/src/section-quadric.test.ts packages/dsl/src/schema.test.ts packages/scene-graph/src` → 全绿；提交 `feat(kernel,dsl,scene-graph): write the exact section boundary for round solids`。

---

### Task 3: 真曲线渲染（屏幕误差采样 + `circle3` + 边界圆）

**Files:**
- Create: `apps/web/src/conicSampling.ts`（+ `.test.ts`）
- Modify: `packages/geometry-kernel/src/quadrics.ts`（补 `conic3FromCircle3(circle: Circle3Primitive, points: Map<string, Point3Primitive>): Conic3 | null`）
- Modify: `apps/web/src/threePrimitives.ts`
- Modify: `apps/web/src/threeScene.tsx`（把世界单位每像素传进渲染）

**Interfaces:**
- Produces:
```ts
/** n 段折线的最大弦高是 R·(1 − cos(π/n))；解 h ≤ tol 得 n。 */
export function segmentsForSagitta(radius: number, tolerance: number, maxSegments?: number): number
export function sampleClosedConic(conic: Conic3, tolerance: number, maxSegments?: number): Vector3[]
export function sampleOpenCurve(pointAt: (t: number) => Vector3, range: [number, number], tolerance: number, maxDepth?: number): Vector3[]
export function createCurvePieces3(pieces: CurvePiece3[], points: Map<string, Point3Primitive>, tolerance: number): THREE.Object3D | null
```

- [ ] **Step 1: 写失败测试**（采样策略与弦高上界）

```ts
it("picks segment counts from the sagitta bound", () => {
  expect(segmentsForSagitta(2, 0.002141 * 2)).toBe(48)          // 反推 48 段
  expect(segmentsForSagitta(2, 0.5)).toBeLessThan(48)
  expect(segmentsForSagitta(2, 1e-12)).toBe(8192)                // 上限保护
  expect(segmentsForSagitta(2, 1)).toBe(3)                       // 下限
})

it("keeps every chord within tolerance for a circle and an ellipse", () => {
  const circle = intersectPlaneQuadric3({ normal: { x: 0, y: 0, z: 1 }, constant: -1 }, cylinderQuadric3(cylinder))
  const sampled = sampleClosedConic(circle, 0.01)
  for (let index = 0; index < sampled.length; index += 1) {
    const a = sampled[index]
    const b = sampled[(index + 1) % sampled.length]
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
    expect(distanceToCircle(mid, circle)).toBeLessThan(0.01)     // 中点离真圆 < tol
  }
})
```

- [ ] **Step 2: 跑测试确认失败** — 预期 `Failed to resolve import "./conicSampling"`。
- [ ] **Step 3: 实现采样**：闭曲线用 `segmentsForSagitta(max(a, a²/b), tol)`（椭圆取**最大曲率半径** `a²/b`，保守）；开曲线（抛物线 / 双曲线 / 直线）用中点偏差的递归二分，深度上限 16；`tolerance = 0.5px × 世界单位每像素`。
- [ ] **Step 4: 实现渲染**：`createCurvePieces3` 把片段采成点列交给 `THREE.Line2`（`LineMaterial`，`worldUnits: true`，`resolution` 随画布尺寸更新）；`circle3` 走同一条路径（`conic3FromCircle3(circle3, points)` 在 Task 1 的 `quadrics.ts` 里补一个小函数）；圆柱 / 圆锥的上下底圆从解析圆锥曲线画。滞回：世界单位每像素变化超过 2× 才重建。
- [ ] **Step 5: 浏览器用例** — 新增 `e2e/three-true-circle.spec.ts`：造圆柱 → 断言边界圆的分段数随缩放**变大**（用 `data-curve-segments` 读数），且放大 20× 后分段数满足 `R_px > 467` 时明显大于 48。
- [ ] **Step 6: 提交** — `feat(web): draw analytic circles and conics with screen-error driven sampling`。

---

### Task 4: 检查器与对象列表（圆锥曲线属性）

**Files:**
- Modify: `apps/web/src/components/PropertiesBar.tsx`（新增截面 / `circle3` 的属性块）
- Modify: `apps/web/src/components/PropertiesBar.test.tsx`（或 `App.test.tsx`）

- [ ] **Step 1: 写失败测试**：选中一个解析截面（平面 z=1 切 R=2 圆柱）后，面板出现"半径 2.000"与"离心率 0.000"；倾斜 30° 时出现"长半轴 2.309 / 短半轴 2.000 / 离心率 0.500"。
- [ ] **Step 2: 跑测试确认失败** — 预期找不到文本。
- [ ] **Step 3: 实现属性块**：读 `section.exact` 的 `Conic3` 规范数据；`circle3` 显示半径与法向；`empty` / `insufficient-data` 显示诊断而不是空白。
- [ ] **Step 4: 跑测试确认通过 + 提交** — `feat(web): show the exact conic data (centre, axes, eccentricity, foci) in the inspector`。

---

### Task 5: 测量精确化

**Files:**
- Modify: `packages/geometry-kernel/src/measurements3d.ts`
- Modify: `packages/scene-graph/src/operations.ts`（体积 / 面积来源选择）
- Test: `packages/geometry-kernel/src/measurements3d.test.ts`

- [ ] **Step 1: 写失败测试**：`R=2, h=3` 的圆柱体积 = `π·4·3 = 37.699111843077517`（1e-12）、侧面积 = `2π·2·3 = 37.699111843077517`、全面积 = `2πR(R+h) = 62.83185307179586`，且 `precision === "exact-input"`；圆锥 `V = πR²h/3 = 12.566370614359172`、侧面积 = `πR√(R²+h²) = 22.654347079443128`。
- [ ] **Step 2: 跑测试确认失败** — 预期收到 48 边形的近似值（体积 37.5916…）与 `numeric-approximation`。
- [ ] **Step 3: 实现**：来源是 `cylinder` / `cone` 时用闭式；椭圆周长用级数并**如实标 `numeric-approximation`**（面积 `πab` 精确）。
- [ ] **Step 4: 跑测试确认通过 + 提交** — `feat(kernel): measure round solids in closed form (π exact, ellipse perimeter flagged)`。

---

### Task 6: 投影真椭圆 + 圆柱 / 圆锥解析展开

**Files:**
- Modify: `apps/web/src/projectionVisuals.ts`（圆 → 解析椭圆）
- Create: `packages/geometry-kernel/src/unfold-round.ts`（+ `.test.ts`）
- Modify: `apps/web/src/threePrimitives.ts`（展开渲染走新布局）

- [ ] **Step 1: 写失败测试**（投影）：视线与圆平面夹角 `θ` 时投影椭圆离心率 = `sin θ`（1e-9）；`θ = 0`（正对）时是圆且半径不变。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现投影**：圆（中心 + 法向 + 半径）经视图投影矩阵 → 2D 椭圆（中心投影 + 二次型变换）；退化（正对 → 圆、侧对 → 线段）如实分别处理。
- [ ] **Step 4: 写失败测试**（展开）：圆柱侧面展开成 `2πR × h` 矩形 + 两个圆；圆锥展开成扇形（半径 `l = √(R²+h²)`、圆心角 `2πR/l`）。
- [ ] **Step 5: 实现展开 + 渲染**，跑测试到绿色。
- [ ] **Step 6: 提交** — `feat(kernel,web): project circles as exact ellipses and develop round solids exactly`。

---

### Task 7: SVG 导出 + 解析框选

**Files:**
- Modify: `apps/web/src/persistence/exporters.ts`（椭圆 → `<ellipse>`、`circle3` → `<circle>`、解析截面 → `<path>` 弧）
- Modify: `apps/web/src/persistence/exporters.test.ts`（现有断言 `not.toContain("<ellipse")` 要改成 `toContain("<ellipse")`，并在提交信息里说明这是行为变更）
- Modify: `packages/geometry-kernel/src/selection.ts`（圆 / 圆弧 / 圆锥曲线的"完全在框内"用解析判定：极值点 + 端点）

- [ ] **Step 1: 写失败测试**：`exportSvg` 含 `<ellipse`；`R=2` 的圆导出半径属性 = `2·scale`；解析截面导出含 `A` 弧命令。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现导出**。
- [ ] **Step 4: 写失败测试**（框选）：弦鼓起 `1e-6` 但曲线出框 → 判定"不在框内"；完全在框内 → 判定"在框内"；圆套住框 → 不算相交。
- [ ] **Step 5: 实现解析框选，跑测试到绿色，提交** — `feat(kernel,web): export true curves and select them analytically`。

---

### Task 8: 签名 + 旧档回归 + 文档 + 门禁收尾

**Files:**
- Modify: `apps/web/src/sceneContentSignature.ts`（`section.exact` / `intersectionFace.exactLoops` 并入签名）
- Modify: `apps/web/src/sceneContentSignature.test.ts`
- Modify: `docs/project-progress.md`、`docs/feature-catalog.md`、`README.md`

- [ ] **Step 1: 写失败测试**：改 `section.exact` 的内容 → 签名变化；不改 → 签名不变；旧档（无 `exact`）签名与今天一致。
- [ ] **Step 2: 实现签名并入，跑测试到绿色。**
- [ ] **Step 3: 旧档回归**：断言无 `exact` 的旧截面读入后 `points.length` 与今天完全一致，且画布仍走折线路径。
- [ ] **Step 4: 文档**：`docs/project-progress.md` 记本轮 8 片的 RED→GREEN 证据与门禁数字；`docs/feature-catalog.md` 记"截面是解析圆锥曲线 + 圆是真曲线 + 说明退化覆盖到哪、哪里回退"；`README.md` 更新基线数字。
- [ ] **Step 5: 全门禁** — `npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build --workspace @draw/web`、`npx playwright test`；把真实数字写进文档（**不许预先编数字**）。
- [ ] **Step 6: 提交 + 推送 + 核验 ref** — `git push origin main` 后比对 `git rev-parse HEAD` 与 `git ls-remote origin refs/heads/main`。

---

## 计划自审记录

- **spec 覆盖**：§5.1-5.2 → Task 1；§5.3-5.4 + §6 重算链 → Task 2；§5.6 渲染政策 → Task 3；§5.5 第 11 项 → Task 4；第 6 项 → Task 5；第 7-8 项 → Task 6；第 9-10 项 + 第 12 项 → Task 7；第 13-14 项 → Task 2（schema/codec）+ Task 8（签名、回归、门禁）。§7 退化清单 → Task 1/2 的用例；§8 测试策略 → 各 Task 的 Step 1。
- **两处 spec 在写计划时被修正**（已回写 spec，见其 §5.2）：①圆的判定阈值改为**半轴相对差 `1e-12`**（原 `|A − C| ≤ 1e-9` 的判别力只有 0.0018°，与"倾斜 1e-3° 报椭圆"自相矛盾）；②退化直线改为"过点 + 方向"，因为偏移数字区分不了平行与相交。
- **命名一致性**：`sectionQuadric3` / `CurvePiece3` / `Conic3` / `segmentsForSagitta` / `sampleClosedConic` / `createCurvePieces3` 在 Task 1-3 中签名一致；`precision` 只用 `exact-input | numeric-approximation`。
