# 3D 动点宿主约束 实施计划（切片 1A-2）

> **状态（2026-09-17 复核）**：**已完成**——`hosts3.ts` 里的线 / 线段 / 射线 / 棱 / 面 / 平面 / 圆柱与圆锥侧面宿主、DSL 的可选绑定变体、`resolveBoundPoint3` 与依赖登记都已落地；本片刻意不做的 UI 与拖动随后由 **1A-3** 补齐（属性栏「宿主绑定」下拉 + 拖动状态机），之后又新增了**实体内**体积宿主（`inSolid` + 包围盒比例 `uvw`，越界夹回表面）与固定 1 单位网格。本仓库的**单一进度记录**是 [`docs/project-progress.md`](../../project-progress.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 3D 动点建立"宿主 + 自然参数"的抽象与数据模型：点能被绑定到线段 / 射线 / 直线 / 棱 / 面 / 平面 / 圆柱与圆锥侧面，坐标永远由参数算出（参数是唯一真值）。

**Architecture:** 新建 `packages/geometry-kernel/src/hosts3.ts`，与 2D 的 `planar-constraints.ts` 同构（`evaluate / closestParameter / project / residual / domain`）。DSL 只加三个绑定变体（旧变体保留，`schemaVersion` 保持 `"0.1"`）；scene-graph 负责把宿主接进 `resolveBoundPoint3` 与依赖登记。**本片不做 UI 与拖动**（那是 1A-3），因此功能在本片结束时仍不可从界面触达——这是刻意的切片边界。

**Tech Stack:** TypeScript、Vitest、npm workspaces（`@draw/dsl` / `@draw/geometry-kernel` / `@draw/scene-graph`）。

**Spec:** `docs/superpowers/specs/2026-09-17-3d-viewport-kernel-refactor-design.md` 第 3.1–3.3 节。

## Global Constraints

- `schemaVersion` 保持 `"0.1"`；新增字段一律可选，旧 `.mgeo` 行为不变。
- 内核不得依赖 DOM 或 three.js；只依赖 `@draw/dsl` 的类型（与 `constraints3d.ts` 一致）。
- 所有对外函数的退化输入一律返回 `null`（零长线段、空/非共面面环、半径或高度为 0 的曲面），不抛异常、不伪造坐标。
- 门禁：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run lint`（0 error）、`npm.cmd run build`；本片不改渲染，`test:e2e` 只需保持全绿。
- 中文注释与仓库既有风格一致；新增源码文件用 LF；禁止用 shell 重定向改源码。

---

### Task 1: 线的宿主（直线 / 线段 / 射线）

**Files:**
- Create: `packages/geometry-kernel/src/hosts3.ts`
- Test: `packages/geometry-kernel/src/hosts3.test.ts`
- Modify: `packages/geometry-kernel/src/index.ts`（追加 `export * from "./hosts3"`）

**Interfaces:**
- Produces:
  ```ts
  export interface Host3Parameter { u: number; v?: number }
  export interface Host3 {
    readonly kind: "line" | "segment" | "ray" | "edge" | "face" | "plane" | "cylinder-surface" | "cone-surface"
    readonly domain: { u: readonly [number, number]; v?: readonly [number, number]; closedU?: boolean }
    evaluate(parameter: Host3Parameter): Vector3
    closestParameter(point: Vector3): Host3Parameter
    project(point: Vector3): { parameter: Host3Parameter; point: Vector3; distance: number }
    residual(point: Vector3): number
  }
  export function lineHost3(first: Vector3, second: Vector3, kind: "line" | "segment" | "ray" = "segment"): Host3 | null
  ```
- 参数语义：`evaluate(0) = first`、`evaluate(1) = second`；线段域 `[0,1]`、射线域 `[0,+∞)`、直线域 `(-∞,+∞)`（用 `Number.NEGATIVE_INFINITY` / `POSITIVE_INFINITY` 表示）。
- `closestParameter` 把 `u = dot(p-first, d)/|d|²` 夹到域内；`residual` = `|p - evaluate(closestParameter(p))|`。

- [x] **Step 1: 写失败测试**（`hosts3.test.ts`）

```ts
import { describe, expect, it } from "vitest"
import { lineHost3 } from "./hosts3"

const a = { x: 0, y: 0, z: 0 }
const b = { x: 2, y: 0, z: 0 }

describe("line hosts", () => {
  it("evaluates the affine parameter and reports its domain", () => {
    const segment = lineHost3(a, b, "segment")!
    expect(segment.evaluate({ u: 0 })).toEqual(a)
    expect(segment.evaluate({ u: 0.5 })).toEqual({ x: 1, y: 0, z: 0 })
    expect(segment.evaluate({ u: 1 })).toEqual(b)
    expect(segment.domain.u).toEqual([0, 1])
    expect(lineHost3(a, b, "ray")!.domain.u).toEqual([0, Number.POSITIVE_INFINITY])
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
    // 落在宿主上的点残差为 0，这是"点永远贴住宿主"的可测判据。
    expect(segment.residual({ x: 0.25, y: 0, z: 0 })).toBeCloseTo(0, 10)
  })

  it("refuses degenerate hosts", () => {
    expect(lineHost3(a, { x: 0, y: 0, z: 0 }, "segment")).toBeNull()
  })
})
```

- [x] **Step 2: 跑测试确认 RED** — `npm.cmd test -- packages/geometry-kernel/src/hosts3.test.ts`，期望 `Failed to resolve import "./hosts3"`。

- [x] **Step 3: 实现**（按 Interfaces 的语义；退化时返回 `null`）。

- [x] **Step 4: 跑测试确认 GREEN** — 同上命令，期望 4/4。

- [x] **Step 5: 提交** — `feat(kernel): add line hosts for 3D point constraints`

---

### Task 2: 面与平面宿主

**Files:**
- Modify: `packages/geometry-kernel/src/hosts3.ts`、`hosts3.test.ts`

**Interfaces:**
- Produces: `export function faceHost3(vertices: Vector3[], tolerance = 1e-9): Host3 | null`、`export function planeHost3(origin: Vector3, u: Vector3, v: Vector3): Host3 | null`
- 面宿主：平面基 `U = normalize(v1-v0)`、`N = normalize(cross(v1-v0, v2-v0))`、`V = cross(N, U)`；顶点 uv 由点积得到；域 = uv 包围盒；`closestParameter` 先正交投影得 `(u,v)`，若该点在环内则直接用，否则**夹到环边界上最近的一段**（逐段求最近点，取最小距离）。
- 平面宿主：域为无穷大，`closestParameter` 就是正交投影。**共面容差按点集尺寸归一**（沿用 `planeThroughPoints` 的既有做法）。
- 环内判定用 uv 空间的射线法（奇偶规则），边界上的点算在内。

- [x] **Step 1: 写失败测试** — 覆盖：正方形面内点投影到自身（残差 0）；面外点被夹到最近的边（对角外侧夹到最近顶点）；非共面环返回 null；平面宿主的无界投影；`domain` 是 uv 包围盒。
- [x] **Step 2: 跑测试确认 RED**
- [x] **Step 3: 实现**
- [x] **Step 4: 跑测试确认 GREEN**
- [x] **Step 5: 提交** — `feat(kernel): add face and plane hosts`

---

### Task 3: 圆柱与圆锥侧面宿主

**Files:**
- Modify: `packages/geometry-kernel/src/hosts3.ts`、`hosts3.test.ts`

**Interfaces:**
- Produces: `export function cylinderSurfaceHost3(center: Vector3, radius: number, height: number): Host3 | null`、`export function coneSurfaceHost3(center: Vector3, radius: number, height: number): Host3 | null`
- 世界为 **Z 轴朝上**（与 `buildSolidTemplate` 一致）：底面圆在 `z = center.z`、顶面在 `z = center.z + height`。
  - 圆柱：`evaluate(u,v) = (c.x + r·cos u, c.y + r·sin u, c.z + v·h)`，`u ∈ [0, 2π)` 且 `closedU: true`，`v ∈ [0,1]`。
  - 圆锥：半径随高度线性收缩，`evaluate(u,v) = (c.x + r(1-v)cos u, c.y + r(1-v)sin u, c.z + v·h)`。
- 投影（**解析解，不做全局搜索**）：
  - 圆柱：`u = atan2(dy, dx)` 归一到 `[0, 2π)`；`v = clamp(dz / h, 0, 1)`。
  - 圆锥：设 `ρ = hypot(dx, dy)`、`dz = p.z - c.z`，最小化 `(ρ - r + r v)² + (dz - h v)²` 得
    `v = (h·dz - r·(ρ - r)) / (r² + h²)`，再夹到 `[0,1]`；`u` 同上（`ρ ≈ 0` 时取 `u = 0`）。
- 退化（`radius <= 0`、`|height| < 1e-9`）返回 `null`。

- [x] **Step 1: 写失败测试** — 覆盖：圆柱侧面上的点残差为 0；内侧点沿半径投影到最近的侧面点且 `v` 被夹取；`z` 超出高度时 `v` 夹到 0/1；圆锥顶点附近与母线上点的投影；`closedU` 与 `u` 折回（`-0.1` 弧度等价于 `2π-0.1`）。
- [x] **Step 2: 跑测试确认 RED**
- [x] **Step 3: 实现**
- [x] **Step 4: 跑测试确认 GREEN**
- [x] **Step 5: 提交** — `feat(kernel): add cylinder and cone lateral-surface hosts`

---

### Task 4: 从图元解析宿主

**Files:**
- Modify: `packages/geometry-kernel/src/hosts3.ts`、`hosts3.test.ts`

**Interfaces:**
- Produces: `export function host3FromPrimitive(primitive: PrimitiveSpec, context: readonly PrimitiveSpec[] | ReadonlyMap<string, PrimitiveSpec>): Host3 | null`
- 分派：`line3`（两种 definition）→ 直线；`segment3` → 线段；`ray3` → 射线；`edge3` → 线段；`face3` → 面；`plane3`（两种 definition）→ 平面；`cylinder` / `cone` → 侧面；其余返回 `null`。
- 端点解析复用 `constraints3d.ts` 的同一套规则（`pointDirection` 用 `point + direction` 造第二点）。

- [x] **Step 1: 写失败测试** — 用 `createEmptyDocument` + `buildSolidTemplate` 造真实文档，断言：模板圆柱的 `polyhedron3` 不是宿主（返回 null）、`cylinder` 是侧面宿主、`edge3`/`face3` 能解析、缺失引用返回 null。
- [x] **Step 2: 跑测试确认 RED**
- [x] **Step 3: 实现**
- [x] **Step 4: 跑测试确认 GREEN**
- [x] **Step 5: 提交** — `feat(kernel): resolve hosts from DSL primitives`

---

### Task 5: 绑定数据模型与重算接入

**Files:**
- Modify: `packages/dsl/src/types.ts`（`Point3Binding` 增 `onHost` / `onFace` / `onSurface`）
- Modify: `packages/dsl/src/schema.ts`（校验引用存在性与参数有限性）
- Modify: `packages/scene-graph/src/operations.ts`（`resolveBoundPoint3` 接入宿主；`primitiveDependencies` 登记宿主）
- Test: `packages/dsl/src/schema.test.ts`、`packages/scene-graph/src/scene-store.test.ts`

**Interfaces:**
- Produces（DSL）：
  ```ts
  | { kind: "onHost"; hostId: string; parameter: number }
  | { kind: "onFace"; faceId: string; uv: [number, number] }
  | { kind: "onSurface"; solidId: string; uv: [number, number] }
  ```
- `resolveBoundPoint3` 的三个新分支一律"由参数算坐标"：`host.evaluate(参数)`；宿主解析失败时返回 `null`（保持点的旧坐标，不静默挪动）。
- `primitiveDependencies` 为 `point3` 增加 `onHost → hostId`、`onFace → faceId`、`onSurface → solidId`，保证拓扑序重算与删除保护都覆盖新引用。

- [x] **Step 1: 写失败测试**
  - schema：合法绑定通过；`hostId` 指向不存在的图元 / 指向 `point3` / `parameter` 非有限数 → 报错；旧文档（无新字段）仍通过。
  - scene-graph：造"线段 + 绑到它的点"，参数 0.25 → 点落在 `a + 0.25(b-a)`；移动线段端点（改 point3 位置）后，重算让绑定点跟着走；圆锥侧面绑定的 `uv` 变化 → 点落在侧面解析位置上。
- [x] **Step 2: 跑测试确认 RED**
- [x] **Step 3: 实现**
- [x] **Step 4: 跑测试确认 GREEN**
- [x] **Step 5: 全量门禁 + 文档 + 提交** — `feat(dsl,scene): bind 3D points to host geometry by natural parameter`；提交前更新 `docs/project-progress.md`（含 RED→GREEN 证据与门禁数字），推送并核验两端 ref。

---

## Self-Review

**Spec coverage（对照 spec 第 3.1–3.3 节）**：绑定变体（Task 5）、宿主求值/投影/残差（Task 1–3）、从图元解析宿主（Task 4）、重算与依赖（Task 5）。**未覆盖**：绑定 UI 与拖动状态机（1A-3）、删除宿主时降级为 `free`（区块三）。**两处都已补齐**：1A-3 交付了属性栏「宿主绑定」下拉 + 参数输入 + 沿宿主滑动的拖动状态机（`e2e/geometry3d-host-drag.spec.ts`）；区块三（3-1）把"绑定挡住宿主删除"改成**级联 / 降级为自由点并保留位置**。

**Placeholder scan:** 无 TBD/TODO；每个任务的测试点与算法都写成了可执行描述，解析解公式已给出。

**Type consistency:** `Host3` / `Host3Parameter` / `lineHost3` / `faceHost3` / `planeHost3` / `cylinderSurfaceHost3` / `coneSurfaceHost3` / `host3FromPrimitive` 在 Task 1–5 中命名一致；DSL 变体名 `onHost` / `onFace` / `onSurface` 与 spec 第 3.1 节一致。

---

## 执行记录（2026-09-17 完成）

| 任务 | 状态 | 提交 | 证据 |
| --- | --- | --- | --- |
| Task 1–4 宿主内核（线 / 面 / 平面 / 圆柱与圆锥侧面 / 从图元解析） | 完成 | `f23ba72` | RED：`Failed to resolve import "./hosts3"`；GREEN：`hosts3.test.ts` 12/12 |
| Task 5 绑定数据模型与重算接入 | 完成 | 本片收尾提交 | RED：schema 2 处 + scene-graph 5 处失败（共 6）；GREEN：`point3HostBindings.test.ts` 3/3 + 6/6 |

**实现要点与偏离计划之处**
1. **参数域夹取放在重算层而不是 `evaluate`**：`evaluate` 保持纯粹的正向映射，`resolveBoundPoint3` 用 `clampHostParameter` 把参数夹进宿主域。理由是 `project` 依赖"先夹参数再求值"的顺序，若 `evaluate` 自己也夹，夹取语义会藏在两处、无法单测。
2. **`edge3` 的宿主 `kind` 是 `"edge"` 而不是 `"segment"`**：参数域与线段相同（`[0,1]`），但保留来源信息更有用。第一版测试期望写成 `"segment"`，实现后按实现改正——**这是测试写错、不是实现错**。
3. **共面容差按点集尺寸缩放**（`tolerance * extent`）：大坐标下顶点的绝对误差更大，固定 1e-9 会把真实的面误判成非共面。
4. **删除保护同步补齐**：`patches.ts` 的 `isReferenced` 增加 `onHost / onFace / onSurface` 三种引用，否则宿主被删掉后点的绑定会悬空、文档过不了 schema（这是仓库里已经踩过的坑）。**注意**：这条保护与需求 ③"杜绝图元无法删除"方向相反，会在区块三里改成"级联 / 降级为 free"。**（2026-09-17 已在切片 3-1 兑现：`validateDeletion` + `deletionPlan` 把一次要删的 id 当"自己人"做并集校验，宿主消失时绑定点降级为自由点且位置保留。）**

**本片门禁（实测）**：单测 **77 文件 / 961 用例**（起始 74/940，+3 文件 21 用例）；typecheck 4 workspace；lint 0 error / **52 warning**（持平）；生产构建通过；Playwright **60/60**。

**本片结束时的边界（刻意）**：功能仍**不可从界面触达**——绑定入口、拖动状态机与下游实时重绘都在 1A-3；`isFreeDraggable3` 也仍然只放行 `free`。**（绑定 UI 与拖动都在 1A-3 补齐：属性栏「宿主绑定」下拉 + 参数输入，画布上拖动时把指针落点投影回宿主参数、由参数反算坐标，所以点不会漂离宿主。注意 `isFreeDraggable3` 至今仍刻意拒绝绑定点与派生点——它们不走"自由拖动"那条通道，而是走宿主参数通道；见进度文档的 1A-3 与 3-1 两节。）**
