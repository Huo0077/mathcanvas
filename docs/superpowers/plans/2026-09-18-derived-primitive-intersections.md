# 派生图元成为一等图元：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让切线 / 法线 / 割线 / 导函数 / 积分区域能与其它图元求交，让平面测量接受"线类 / 圆类"来源（夹角、点到直线距离、圆的面积/周长/半径），并把切线缺省画长一点。

**Architecture:** "哪些类型可求交"与"有哪些度量名"各收敛成 **`@draw/dsl` 里一张 `as const` 表**（dsl 是最底层，内核已经 import 它；反向会成环）。内核的类型联合与 `samplePrimitive` 从表**派生**并加 `never` 穷尽性检查，于是"加了类型忘了写采样"是编译错误而不是运行期静默失效。平面测量从"纯点解析"升级为**实体感知**（`point | line | circle`），按「度量 × 实体种类」分派。

**Tech Stack:** TypeScript strict、npm workspaces（`@draw/dsl` / `@draw/geometry-kernel` / `@draw/scene-graph` / `apps/web`）、React 19 + Vite 7、Vitest（jsdom）、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-18-derived-primitive-intersections-design.md`

## Global Constraints

- 不新增任何运行时依赖；`packages/*` 不得 import three.js。
- 修改仓库文件一律用文件编辑工具，**不要**用 PowerShell 文本管道改写源码（历史上这样写出过乱码）。
- 一次性探针跑完即删，绝不提交。
- 不改 `schemaVersion`；旧文档逐位不变。
- 每片结束都跑门禁：`npm.cmd run typecheck`（4 workspace）、`npm.cmd test`、`npm.cmd run lint`（0 error）、`npm run build --workspace @draw/web`、`npx playwright test`（全量）。
- 度量/类型名单**只允许一处定义**，其余全部 import；出现第二处硬编码即是本计划要消灭的缺陷。
- `analysisSet` 不参与求交（理由见 spec §3.6），实施时不得顺手加进去。

---

### Task 1: dsl —— 可求交类型的单一真源，并放行新来源

**Files:**
- Create: `packages/dsl/src/sampledTypes.ts`
- Create: `packages/dsl/src/sampledTypes.test.ts`
- Modify: `packages/dsl/src/index.ts`（导出新模块）
- Modify: `packages/dsl/src/schema.ts:5`（删本地 `sampledTypes`）、`:600`、`:605`（改用谓词）

**Interfaces:**
- Consumes: 无（本计划第一片）
- Produces: `SAMPLED_PRIMITIVE_TYPES: readonly string[]`、`SampledPrimitiveType`、`isSampledPrimitiveType(type: string): type is SampledPrimitiveType`（Task 2/3 依赖）

- [ ] **Step 1: 写失败测试**

```ts
// packages/dsl/src/sampledTypes.test.ts
import { describe, expect, it } from "vitest"
import { createEmptyDocument, validateDocument } from "./index"
import { SAMPLED_PRIMITIVE_TYPES, isSampledPrimitiveType } from "./sampledTypes"

describe("sampled primitive types", () => {
  it("covers every curve-like type, including the derived ones", () => {
    for (const type of ["line", "segment", "ray", "polyline", "circle", "arc", "parabola", "ellipse", "hyperbola", "function", "tangent", "normal", "secant", "derivative", "integral"]) {
      expect(SAMPLED_PRIMITIVE_TYPES).toContain(type)
      expect(isSampledPrimitiveType(type)).toBe(true)
    }
    // 静态标记不是曲线，故意不在表里。
    expect(isSampledPrimitiveType("analysisSet")).toBe(false)
    expect(isSampledPrimitiveType("point")).toBe(false)
  })

  it("accepts a tangent as an intersection source", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-src", type: "circle", center: { x: 0, y: 6 }, radius: 2 },
      { id: "line-1", type: "line", a: { x: -6, y: 3 }, b: { x: 10, y: 3 } },
      { id: "tangent-1", type: "tangent", sourceId: "circle-src", x: 2, point: { x: 2, y: 6 }, slope: 0, a: { x: -1, y: 6 }, b: { x: 5, y: 6 }, status: "approximate", anchor: { kind: "parameter", parameter: 0 } },
      { id: "set-1", type: "intersectionSet", objectA: "tangent-1", objectB: "line-1", points: [{ x: 2, y: 3 }], status: "valid", explanation: "probe" }
    ]
    const result = validateDocument(document)
    const relevant = result.errors.filter((error) => error.includes("intersection"))
    expect(relevant).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/dsl/src/sampledTypes.test.ts`
Expected: 第 2 条 FAIL —— `intersection set references invalid objects`（第 1 条因模块不存在而无法 import，同样算红）

- [ ] **Step 3: 写实现**

```ts
// packages/dsl/src/sampledTypes.ts
/**
 * 能被"采样求交"当作曲线的一维图元类型 —— **唯一真源**。
 *
 * 这条名单以前在五处各写了一遍（内核的 `SampledPrimitive` 联合类型与采样分支、dsl 校验、
 * scene-graph 的重算取源、web 的预览、web 的"手动建交点"按钮），于是"切线能不能和别的图元
 * 求交"这个问题的答案取决于你问的是哪一处 —— 实测结果就是切线在所有地方都不能求交。
 *
 * 放在 `@draw/dsl` 而不是内核：依赖方向是 dsl → kernel → scene-graph → web，内核已经 import dsl；
 * 反向 import 会成环。
 *
 * `analysisSet` 不在名单里：它存的是离散的零点/极值/拐点，没有曲线几何。
 */
export const SAMPLED_PRIMITIVE_TYPES = [
  "line", "segment", "ray", "polyline",
  "circle", "arc", "parabola", "ellipse", "hyperbola", "function",
  // 由其它图元引申出来的：切线 / 法线 / 割线是可视线段，导函数 / 积分区域自带采样点。
  "tangent", "normal", "secant", "derivative", "integral"
] as const

export type SampledPrimitiveType = (typeof SAMPLED_PRIMITIVE_TYPES)[number]

export function isSampledPrimitiveType(type: string): type is SampledPrimitiveType {
  return (SAMPLED_PRIMITIVE_TYPES as readonly string[]).includes(type)
}
```

在 `packages/dsl/src/index.ts` 里按既有写法导出 `./sampledTypes`。

`schema.ts`：删掉第 5 行的 `const sampledTypes = ...`，顶部加 `import { isSampledPrimitiveType } from "./sampledTypes"`，第 600/605 行的 `sampledTypes.has(referenceType(byId, value.objectA) ?? "")` 改成 `isSampledPrimitiveType(referenceType(byId, value.objectA) ?? "")`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/dsl/src`
Expected: 全绿（含既有 `schema.test.ts`、`codec.test.ts`）

- [ ] **Step 5: 提交**

```bash
git add packages/dsl/src/sampledTypes.ts packages/dsl/src/sampledTypes.test.ts packages/dsl/src/index.ts packages/dsl/src/schema.ts
git commit -m "refactor(dsl): one source of truth for the sampled primitive types"
```

---

### Task 2: 内核 —— 采样新类型，并用穷尽性检查钉住

**Files:**
- Modify: `packages/geometry-kernel/src/curve-intersections.ts:8`（类型派生）、`:73-98`（采样分支）
- Modify: `packages/geometry-kernel/src/curve-intersections.test.ts`（新增用例）

**Interfaces:**
- Consumes: Task 1 的 `SampledPrimitiveType` / `isSampledPrimitiveType`
- Produces: `SampledPrimitive`（成员集合扩大到 15 类，**只增不减**）、`samplePrimitive` 对新类型返回几何（Task 3 依赖）

- [ ] **Step 1: 先只改类型（无行为变化）**

`curve-intersections.ts` 第 8 行改成：

```ts
import type { SampledPrimitiveType } from "@draw/dsl"

export type SampledPrimitive = Extract<PrimitiveSpec, { type: SampledPrimitiveType }>
```

- [ ] **Step 2: 写失败测试**

```ts
// packages/geometry-kernel/src/curve-intersections.test.ts（追加）
describe("derived primitives as intersection sources", () => {
  const line: SampledPrimitive = { id: "l", type: "line", a: { x: -10, y: 0 }, b: { x: 10, y: 0 } }
  const circle: SampledPrimitive = { id: "c", type: "circle", center: { x: 0, y: 2 }, radius: 2 }

  const tangent: SampledPrimitive = { id: "t", type: "tangent", sourceId: "c", x: 0, point: { x: 0, y: 4 }, slope: 0, a: { x: -3, y: 4 }, b: { x: 3, y: 4 }, status: "approximate", anchor: { kind: "parameter", parameter: 0 } }
  const normal: SampledPrimitive = { id: "n", type: "normal", sourceId: "c", x: 0, point: { x: 0, y: 4 }, slope: 0, a: { x: 0, y: 1 }, b: { x: 0, y: 5 }, status: "approximate", anchor: { kind: "parameter", parameter: 0 } }
  const secant: SampledPrimitive = { id: "s", type: "secant", sourceId: "f", x1: -1, x2: 1, points: [{ x: -1, y: 0 }, { x: 1, y: 0 }], slope: 0, a: { x: -1, y: 0 }, b: { x: 1, y: 0 }, status: "approximate" }
  const derivative: SampledPrimitive = { id: "d", type: "derivative", sourceId: "f", order: 1, domain: [-2, 2], samples: 2, points: [{ x: -2, y: -2 }, { x: 2, y: 2 }], status: "approximate" }
  const integral: SampledPrimitive = { id: "i", type: "integral", sourceId: "f", domain: [-2, 2], steps: 2, points: [{ x: -2, y: 2 }, { x: 2, y: 2 }], area: 8, status: "approximate" }

  it("intersects a tangent and a normal with a line", () => {
    expect(pointsOf(intersectSampledPrimitives(tangent, line))).toEqual([{ x: 0, y: 4 }])
    expect(pointsOf(intersectSampledPrimitives(normal, line))).toEqual([])   // 竖直线段不穿过 y=0..5 之外的 y=0？见下方期望
  })

  it("intersects a secant, a derivative and an integral with a circle", () => {
    expect(pointsOf(intersectSampledPrimitives(secant, circle)).length).toBe(2)
    expect(pointsOf(intersectSampledPrimitives(derivative, circle)).length).toBe(2)
    expect(pointsOf(intersectSampledPrimitives(integral, circle)).length).toBe(2)
  })

  it("draws nothing from a failed tangent, so it cannot intersect anything", () => {
    const failed = { ...tangent, status: "failed" as const }
    expect(samplePrimitiveForTest(failed)).toEqual([])
    expect(pointsOf(intersectSampledPrimitives(failed, line))).toEqual([])
  })
})
```

> 实施提示：`normal`（`x=0`，`y` 从 1 到 5）与 `line`（`y=0`）**不相交**，所以上面对 normal 的期望是 `[]`；请按实际几何写死期望，不要为了让它"通过"去改夹具 —— 这条用例守的是"采样真的按 `a/b` 走"。

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run packages/geometry-kernel/src/curve-intersections.test.ts`
Expected: RED —— 采样落到最后的函数分支，读不到 `expression` 而抛错被吞掉 ⇒ 交点数为 0（`expected [] to equal [{x:0,y:4}]` 之类）

- [ ] **Step 4: 实现采样分支**

在 `samplePrimitive` 的 `polyline` 分支之后插入，并把末尾的 `function` 分支写成显式判断 + 穷尽性检查：

```ts
  // 由其它图元引申出来的直线类：它们画出来就是 a→b 这一段，交点也只落在看得见的那一段上。
  if (primitive.type === "tangent" || primitive.type === "normal" || primitive.type === "secant") {
    if (primitive.status !== "approximate") return []
    const length = Math.hypot(primitive.b.x - primitive.a.x, primitive.b.y - primitive.a.y)
    return Number.isFinite(length) && length > 1e-12 ? [[primitive.a, primitive.b]] : []
  }
  // 导函数与积分区域自带采样点；积分只用区域上边界，填充是装饰。
  if (primitive.type === "derivative" || primitive.type === "integral") {
    if (primitive.status !== "approximate") return []
    return primitive.points.length >= 2 ? [primitive.points] : []
  }
  if (primitive.type === "function") {
    return adaptiveSampleFunctionSegments((x) => evaluateParameterExpression(primitive.expression, { x }), primitive.domain, { initialSteps: primitive.samples ?? 256, maxSteps: Math.max(primitive.samples ?? 256, 2048) })
  }
  // 穷尽性检查：往 SAMPLED_PRIMITIVE_TYPES 里加了类型却忘了写采样，这里会**编译失败**。
  const exhaustive: never = primitive
  return exhaustive
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run packages/geometry-kernel/src`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add packages/geometry-kernel/src/curve-intersections.ts packages/geometry-kernel/src/curve-intersections.test.ts
git commit -m "feat(kernel): sample tangents, normals, secants, derivatives and integrals"
```

---

### Task 3: 收敛剩下三处副本（预览 / 手动建交点 / 持久化重算）

**Files:**
- Modify: `apps/web/src/intersectionPreview.ts:12-16`
- Modify: `apps/web/src/App.tsx:558`、`:567`
- Modify: `packages/scene-graph/src/operations.ts:1186`、`:1197-1208`
- Modify: `apps/web/src/intersectionPreview.test.ts`（新增用例）
- Modify: `packages/scene-graph/src/intersections.test.ts`（新增"切线驱动的交点跟着走"）

**Interfaces:**
- Consumes: Task 1 的 `isSampledPrimitiveType`、Task 2 的采样
- Produces: 三条路径都能求交（Task 8 的 e2e 依赖）

- [ ] **Step 1: 写失败测试（预览）**

```ts
// apps/web/src/intersectionPreview.test.ts（追加）
it("enumerates the pair when one source is a tangent", () => {
  const document = createEmptyDocument("conics")
  document.primitives = [
    { id: "circle-src", type: "circle", center: { x: 0, y: 6 }, radius: 2 },
    { id: "line-1", type: "line", a: { x: -6, y: 3 }, b: { x: 10, y: 3 } },
    { id: "tangent-1", type: "tangent", sourceId: "circle-src", x: 2, point: { x: 2, y: 6 }, slope: 0, a: { x: -1, y: 4 }, b: { x: 5, y: 4 }, status: "approximate", anchor: { kind: "parameter", parameter: 0 } }
  ]
  const previews = computeIntersectionPreviews(document).previews
  expect(previews.some((preview) => preview.objectA === "tangent-1" || preview.objectB === "tangent-1")).toBe(true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run apps/web/src/intersectionPreview.test.ts`
Expected: FAIL —— `expected false to be true`（切线不在 `sampledTypes` 里）

- [ ] **Step 3: 三处改用同一个谓词**

```ts
// apps/web/src/intersectionPreview.ts
import { isSampledPrimitiveType } from "@draw/dsl"

function isSampledPrimitive(primitive: PrimitiveSpec): primitive is SampledPrimitive {
  return isSampledPrimitiveType(primitive.type)
}
```
（删掉本地 `const sampledTypes = new Set(...)`）

```ts
// apps/web/src/App.tsx：删掉第 558 行的 intersectionTypes 常量，第 567 行改成
const canCreateIntersection = canCreatePointConnection || (selectedIds.length === 2 && selectedIds.every((id) => {
  const primitive = document.primitives.find((candidate) => candidate.id === id)
  return Boolean(primitive) && isSampledPrimitiveType(primitive!.type)
}))
```

`packages/scene-graph/src/operations.ts`：`isSampledPrimitive` 与 `sampledSource` 里的本地判断改成 `isSampledPrimitiveType(primitive.type)`（`sampledSource` 的返回值类型仍是 `SampledPrimitive | undefined`）。

- [ ] **Step 4: 写"持久化交点跟着动"的测试**

```ts
// packages/scene-graph/src/intersections.test.ts（追加）
it("follows a driven tangent so an intersection set stays live", () => {
  const document = createEmptyDocument("conics")
  document.primitives = [
    { id: "circle-src", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
    { id: "point-a", type: "point", x: 2, y: 0, binding: { kind: "onPath", pathId: "circle-src", parameter: 0, parameterId: "t-a" } },
    { id: "line-1", type: "line", a: { x: -6, y: 1 }, b: { x: 10, y: 1 } },
    { id: "tangent-1", type: "tangent", sourceId: "circle-src", x: 0, point: { x: 2, y: 0 }, slope: 0, a: { x: 2, y: -2 }, b: { x: 2, y: 2 }, status: "approximate", anchor: { kind: "point", pointId: "point-a" } },
    { id: "set-1", type: "intersectionSet", objectA: "tangent-1", objectB: "line-1", points: [], status: "valid", explanation: "" }
  ]
  document.parameters = { "t-a": { id: "t-a", value: 0, min: 0, max: 6.28, step: 0.05, ownerId: "point-a" } }
  const atZero = commitPatch(document, { op: "setParameter", id: "t-a", value: Math.PI / 2 }).document
  const tangent = atZero.primitives.find((primitive) => primitive.id === "tangent-1") as { a: { x: number; y: number } }
  const set = atZero.primitives.find((primitive) => primitive.id === "set-1") as { points: { x: number; y: number }[] }
  expect(tangent.a.y).toBeCloseTo(2, 6)          // 切点转到 (0,2)，切线水平
  expect(set.points).toHaveLength(1)              // 与 y=1 相交一次
  expect(set.points[0].y).toBeCloseTo(1, 6)
})
```

- [ ] **Step 5: 跑测试**

Run: `npx vitest run apps/web/src/intersectionPreview.test.ts packages/scene-graph/src`
Expected: 全绿（Step 3 之前第 4 条必红：`set.points` 为空数组）

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/intersectionPreview.ts apps/web/src/intersectionPreview.test.ts apps/web/src/App.tsx packages/scene-graph/src/operations.ts packages/scene-graph/src/intersections.test.ts
git commit -m "feat(web,scene-graph): route every intersection path through the shared type list"
```

---

### Task 4: 内核 —— 测量改实体感知

**Files:**
- Modify: `packages/geometry-kernel/src/dynamic-measurements.ts`（新增实体类型 + 分派分支）
- Modify: `packages/geometry-kernel/src/dynamic-measurements.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `MeasurableEntity`、`EntityResolver`、`pointEntityResolver(positions)`，以及 `evaluatePlanarMeasurement(measurement, resolve: CoordinateResolver | EntityResolver)`（Task 5/6 依赖）

- [ ] **Step 1: 写失败测试**

```ts
// packages/geometry-kernel/src/dynamic-measurements.test.ts（追加）
describe("entity-aware planar measurements", () => {
  const entities: Record<string, MeasurableEntity> = {
    l1: { kind: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
    l2: { kind: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },      // 与 l1 成 45°
    l3: { kind: "line", a: { x: 0, y: 3 }, b: { x: 1, y: 3 } },      // 与 l1 平行
    p1: { kind: "point", position: { x: 0, y: 5 } },
    c1: { kind: "circle", center: { x: 0, y: 0 }, radius: 2 },
    c0: { kind: "circle", center: { x: 0, y: 0 }, radius: 0 }
  }
  const resolve = (id: string) => entities[id] ?? null
  const measure = (metric: PlanarMetric, sourceIds: string[]) => evaluatePlanarMeasurement({ id: "m", metric, sourceIds }, resolve)

  it("measures the acute angle between two lines", () => {
    expect(measure("angle", ["l1", "l2"]).value!).toBeCloseTo(Math.PI / 4, 9)
    expect(measure("angle", ["l1", "l3"]).value).toBeCloseTo(0, 9)
    expect(measure("angle", ["l1", "l2"]).unit).toBe("rad")
  })

  it("measures the distance from a point to a line", () => {
    expect(measure("distance", ["p1", "l1"]).value!).toBeCloseTo(5, 9)
  })

  it("measures a circle's area, perimeter and radius", () => {
    expect(measure("area", ["c1"]).value!).toBeCloseTo(Math.PI * 4, 9)
    expect(measure("area", ["c1"]).unit).toBe("u²")
    expect(measure("perimeter", ["c1"]).value!).toBeCloseTo(Math.PI * 4, 9)
    expect(measure("radius", ["c1"]).value!).toBeCloseTo(2, 9)
  })

  it("refuses a degenerate circle instead of reporting zero", () => {
    expect(measure("area", ["c0"]).status).toBe("degenerate")
    expect(measure("perimeter", ["c0"]).status).toBe("degenerate")
  })

  it("still accepts a point-only resolver, so existing callers keep working", () => {
    const positions = new Map([["a", { x: 0, y: 0 }], ["b", { x: 3, y: 0 }]])
    expect(evaluatePlanarMeasurement({ id: "m", metric: "length", sourceIds: ["a", "b"] }, pointEntityResolver(positions)).value).toBe(3)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/geometry-kernel/src/dynamic-measurements.test.ts`
Expected: FAIL —— `角度需要三个点` 等 `insufficient-data`（新组合还不存在）

- [ ] **Step 3: 实现**

```ts
// dynamic-measurements.ts（新增，紧挨 CoordinateResolver）
export type MeasurableEntity =
  | { kind: "point"; position: Coordinate }
  | { kind: "line"; a: Coordinate; b: Coordinate }
  | { kind: "circle"; center: Coordinate; radius: number }

export type EntityResolver = (id: string) => MeasurableEntity | null

/** 兼容旧调用点：点表 → 实体解析器。 */
export function pointEntityResolver(positions: Map<string, Coordinate>): EntityResolver {
  return (id) => {
    const position = positions.get(id)
    return position ? { kind: "point", position } : null
  }
}

/** 两条直线的**锐角**夹角，[0, π/2]；任一条退化时返回 null。 */
export function acuteAngleBetweenLines(first: { a: Coordinate; b: Coordinate }, second: { a: Coordinate; b: Coordinate }): number | null {
  const firstDirection = { x: first.b.x - first.a.x, y: first.b.y - first.a.y }
  const secondDirection = { x: second.b.x - second.a.x, y: second.b.y - second.a.y }
  const firstLength = Math.hypot(firstDirection.x, firstDirection.y)
  const secondLength = Math.hypot(secondDirection.x, secondDirection.y)
  if (!(firstLength > 1e-12) || !(secondLength > 1e-12)) return null
  const cosine = Math.abs((firstDirection.x * secondDirection.x + firstDirection.y * secondDirection.y) / (firstLength * secondLength))
  return Math.acos(Math.min(1, cosine))
}
```

`evaluatePlanarMeasurement` 的签名改为 `resolve: CoordinateResolver | EntityResolver`，函数体开头把两种解析结果**归一化**：

```ts
  const entities: (MeasurableEntity | null)[] = sourceIds.map((id) => {
    const resolved = resolve(id)
    if (!resolved) return null
    return "kind" in resolved ? resolved : { kind: "point", position: resolved }
  })
  const points: (Coordinate | null)[] = entities.map((entity) => (entity?.kind === "point" ? entity.position : null))
```
（下面所有既有分支继续用 `points`，**一字不改**。）然后在 `switch` 里按"度量 × 种类"加分支：

```ts
    case "angle": {
      // 两条线类：锐角夹角。三种点：原有的顶点角。
      const lines = entities.filter((entity): entity is Extract<MeasurableEntity, { kind: "line" }> => entity?.kind === "line")
      if (lines.length === 2 && entities.length === 2) {
        const radians = acuteAngleBetweenLines(lines[0], lines[1])
        return radians === null ? invalid(measurement, "degenerate", "作为夹角一边的直线退化为零长度。") : succeed(radians, "rad", radians * 180 / Math.PI)
      }
      if (points.length < 3) return invalid(measurement, "insufficient-data", "角度需要三个点 [A, V, B]，或两条直线。")
      /* …既有三点分支原样保留… */
    }
```
`distance`、`area`、`perimeter`、`radius` 同样先看实体种类：`distance` 支持 `[point, line]`；`area`/`perimeter`/`radius` 支持单个 `circle`（`radius <= 1e-12` → `degenerate`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/geometry-kernel/src`
Expected: 全绿（既有 `dynamic-measurements.test.ts` 里的点类用例不受影响）

- [ ] **Step 5: 提交**

```bash
git add packages/geometry-kernel/src/dynamic-measurements.ts packages/geometry-kernel/src/dynamic-measurements.test.ts
git commit -m "feat(kernel): let planar measurements resolve lines and circles, not just points"
```

---

### Task 5: dsl —— 度量名也收敛成一张表，并加入周长 / 半径

**Files:**
- Modify: `packages/dsl/src/types.ts:836`（`MEASUREMENT_METRICS` 表 + 派生类型）
- Modify: `packages/dsl/src/schema.ts:857`（改用表）
- Modify: `packages/dsl/src/schema.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `MEASUREMENT_METRICS`、`Measurement3Metric`（含 `perimeter` / `radius`）（Task 6 依赖）

- [ ] **Step 1: 写失败测试**

```ts
// packages/dsl/src/schema.test.ts（追加）
it("accepts the perimeter and radius metrics", () => {
  const document = createEmptyDocument("conics")
  document.primitives = [{ id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 }]
  document.measurements = [
    { id: "m-1", kind: "measurement3", sourceIds: ["circle-1"], metric: "perimeter", value: 12.566, unit: "u", precision: "numeric-approximation", status: "valid", explanation: "" },
    { id: "m-2", kind: "measurement3", sourceIds: ["circle-1"], metric: "radius", value: 2, unit: "u", precision: "numeric-approximation", status: "valid", explanation: "" }
  ]
  expect(validateDocument(document).errors.filter((error) => error.includes("metric"))).toEqual([])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/dsl/src/schema.test.ts`
Expected: FAIL —— `measurement metric is invalid: m-1`

- [ ] **Step 3: 实现**

```ts
// packages/dsl/src/types.ts
/** 度量名 —— 与可求交类型同理，**只在这里定义一次**（校验、读数名、画布文本都从它派生）。 */
export const MEASUREMENT_METRICS = ["length", "angle", "area", "volume", "distance", "dihedral", "perimeter", "radius"] as const
export type Measurement3Metric = (typeof MEASUREMENT_METRICS)[number]
```
`schema.ts:857` 改成 `if (!(MEASUREMENT_METRICS as readonly string[]).includes(String(measurement.metric)))`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/dsl/src`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/dsl/src/types.ts packages/dsl/src/schema.ts packages/dsl/src/schema.test.ts
git commit -m "feat(dsl): add perimeter and radius to the measurement metrics, from one table"
```

---

### Task 6: 界面 —— 测量选项、读数文本与位置

**Files:**
- Modify: `apps/web/src/spatialTools.ts:27-40`（`planarMeasurementOptions`）
- Modify: `apps/web/src/planarMeasurementVisuals.ts:22`（`METRIC_NAMES`）、`:25-31`（文本）、`:48-105`（位置）
- Modify: `apps/web/src/App.tsx:988-999`（新建时的预检解析器改成实体解析器）
- Modify: `packages/scene-graph/src/operations.ts:1852-1862`（重算解析器改成实体解析器）
- Test: `apps/web/src/spatialTools.test.ts`、`apps/web/src/planarMeasurementVisuals.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `EntityResolver` / `pointEntityResolver`、Task 5 的度量名
- Produces: 用户可见的"夹角（两条线）""圆的面积/周长/半径"入口与读数（Task 8 的 e2e 依赖）

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/spatialTools.test.ts（追加）
it("offers an angle for two line-like objects and circle metrics for a circle", () => {
  const line = { id: "l1", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } as const
  const tangent = { id: "t1", type: "tangent", sourceId: "c", x: 0, point: { x: 0, y: 0 }, slope: 0, a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, status: "approximate" } as const
  const circle = { id: "c1", type: "circle", center: { x: 0, y: 0 }, radius: 2 } as const
  expect(measurementOptionsFor("conics", [line, tangent]).map((option) => option.metric)).toEqual(["angle"])
  expect(measurementOptionsFor("conics", [circle]).map((option) => option.metric)).toEqual(["area", "perimeter", "radius"])
  // 切线不提供"长度"：它的 a/b 是绘制长度，不是几何事实。
  expect(measurementOptionsFor("conics", [tangent]).map((option) => option.metric)).toEqual([])
})
```

```ts
// apps/web/src/planarMeasurementVisuals.test.ts（追加）
it("labels circle metrics with the right units", () => {
  const circle = { id: "c1", type: "circle", center: { x: 0, y: 0 }, radius: 2 }
  const area = { id: "m-area", kind: "measurement3", sourceIds: ["c1"], metric: "area", value: Math.PI * 4, unit: "u²", precision: "numeric-approximation", status: "valid", explanation: "" }
  const perimeter = { id: "m-per", kind: "measurement3", sourceIds: ["c1"], metric: "perimeter", value: Math.PI * 4, unit: "u", precision: "numeric-approximation", status: "valid", explanation: "" }
  const document = { ...createEmptyDocument("conics"), primitives: [circle], measurements: [area, perimeter] }
  expect(planarMeasurementText(area)).toBe("面积：12.566u²")
  expect(planarMeasurementText(perimeter)).toBe("周长：12.566u")
  // 圆的标签落在圆心上，不是随便飘着。
  const labels = planarMeasurementVisuals(document)
  expect(labels.find((label) => label.id === "m-area")?.position).toEqual({ x: 0, y: 0 })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run apps/web/src/spatialTools.test.ts apps/web/src/planarMeasurementVisuals.test.ts`
Expected: FAIL —— 选项为空、`周长` 未定义（`METRIC_NAMES` 缺键）

- [ ] **Step 3: 实现**

```ts
// spatialTools.ts
const isLineLike2d = (primitive: PrimitiveSpec) => ["line", "segment", "ray", "tangent", "normal", "secant"].includes(primitive.type)
const isCircleLike2d = (primitive: PrimitiveSpec) => ["circle", "arc"].includes(primitive.type)

function planarMeasurementOptions(selection: PrimitiveSpec[]): MeasurementOption[] {
  const points = selection.filter(isPoint)
  const options: MeasurementOption[] = []
  if (selection.length === 2 && points.length === 2) options.push({ metric: "length", label: "长度" })
  if (selection.length === 2 && selection.every(isLineLike2d)) options.push({ metric: "angle", label: "夹角（两条线）" })
  if (selection.length === 2 && points.length === 1 && selection.some(isLineLike2d)) options.push({ metric: "distance", label: "距离（点到直线）" })
  if (selection.length === 1 && isCircleLike2d(selection[0])) options.push(
    { metric: "area", label: "面积" },
    { metric: "perimeter", label: "周长" },
    { metric: "radius", label: "半径" }
  )
  if (selection.length === 3 && points.length === 3) options.push(
    { metric: "angle", label: "角度（第二个点作顶点）", dihedralKind: "interior" },
    { metric: "area", label: "面积" },
    { metric: "distance", label: "距离（第三个点到前两点的直线）" }
  )
  return options
}
```

`planarMeasurementVisuals.ts`：`METRIC_NAMES` 加 `perimeter: "周长"`、`radius: "半径"`；`planarMeasurementPosition` 为"单圆类来源"返回圆心（沿用 `resolve` 出的实体）；`planarMeasurementText` 无需改逻辑（`unit` 已由内核给出）。

`App.tsx:988-999` 与 `operations.ts:1852-1862`：把"用点表构造解析器"换成从**图元表**构造实体解析器（点 → `position`；线类 → `a/b`；圆类 → `center/radius`），旧的 `pointEntityResolver` 仅留给单测。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run apps/web packages/scene-graph`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/spatialTools.ts apps/web/src/spatialTools.test.ts apps/web/src/planarMeasurementVisuals.ts apps/web/src/planarMeasurementVisuals.test.ts apps/web/src/App.tsx packages/scene-graph/src/operations.ts
git commit -m "feat(web): offer tangent-line angles and circle metrics, with readable labels"
```

---

### Task 7: 切线缺省画长一点

**Files:**
- Modify: `packages/scene-graph/src/operations.ts:1258-1264`（`curveTangentHalfLength`）
- Test: `packages/scene-graph/src/curveTangents.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/scene-graph/src/curveTangents.test.ts（追加）
it("draws a curve tangent longer by default, but never overrides an explicit half length", () => {
  const document = createEmptyDocument("conics")
  document.primitives = [
    { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
    parameterTangent("tan-default", "circle-1", 0),
    { ...parameterTangent("tan-fixed", "circle-1", 0), halfLength: 1 }
  ]
  const settled = recomputeDerivedObjects(document)
  const span = (id: string) => {
    const tangent = settled.primitives.find((primitive) => primitive.id === id) as { a: { x: number; y: number }; b: { x: number; y: number } }
    return Math.hypot(tangent.b.x - tangent.a.x, tangent.b.y - tangent.a.y)
  }
  // 半径 2 的圆：缺省半长 2 ⇒ 原来画 4，现在 ×1.5 ⇒ 6。
  expect(span("tan-default")).toBeCloseTo(6, 6)
  // 显式 halfLength = 1 的照旧（画 2）。
  expect(span("tan-fixed")).toBeCloseTo(2, 6)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/scene-graph/src/curveTangents.test.ts`
Expected: FAIL —— `expected 4 to be close to 6`

- [ ] **Step 3: 实现**

```ts
/**
 * 曲线来源的切线缺省半长系数：`1` 时切线恰好"与曲线相称"，但那在圆上显得太短
 * （用户口径"把切线画长一点点"）；`1.5` 让它明显长出曲线之外，又不会横贯视野。
 * **函数来源不乘**：函数切线的半长是定义域半宽，乘了会画到定义域之外。
 */
const CURVE_TANGENT_LENGTH_FACTOR = 1.5

function curveTangentHalfLength(source: PrimitiveSpec): number {
  const base = ((): number => {
    if (source.type === "circle" || source.type === "arc") return Math.max(source.radius, 1)
    if (source.type === "ellipse" || source.type === "hyperbola") return Math.max(Math.abs(source.radiusX), Math.abs(source.radiusY), 1)
    if (source.type === "parabola") return Math.max(Math.abs(source.focalParameter) * 2, 1)
    if (source.type === "function") return Math.max((source.domain[1] - source.domain[0]) / 2, 1)
    return 2
  })()
  return source.type === "function" ? base : base * CURVE_TANGENT_LENGTH_FACTOR
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/scene-graph/src`
Expected: 全绿（既有切线段期望若写死了旧长度，**按新长度更新期望**，并在提交信息里说明）

- [ ] **Step 5: 提交**

```bash
git add packages/scene-graph/src/operations.ts packages/scene-graph/src/curveTangents.test.ts
git commit -m "feat(scene-graph): draw curve tangents half again as long by default"
```

---

### Task 8: 浏览器级验证（e2e）

**Files:**
- Create: `e2e/planar-derived-intersections.spec.ts`

- [ ] **Step 1: 写 e2e**

```ts
import { expect, test } from "@playwright/test"

test("intersects a tangent with a line, creates the intersection, and measures the angle", async ({ page }) => {
  await page.goto("/")
  const ribbon = page.getByRole("region", { name: "功能区" })
  await page.getByRole("button", { name: "固定功能区" }).click()
  const algebra = page.locator(".algebra-panel")
  const canvas = page.locator("svg[aria-label='几何画布']")

  // 圆 + 圆上一点的切线
  await ribbon.getByRole("button", { name: "添加圆" }).click()
  await algebra.getByText("圆 1", { exact: true }).click()
  await page.getByRole("button", { name: "创建曲线切线" }).click()

  // 一条与切线相交的直线（切点在 (r,0)，切线竖直；这条直线横着穿过它）
  await ribbon.getByRole("button", { name: "添加直线" }).click()
  await algebra.getByText("直线 1", { exact: true }).click()
  // …按属性栏把两端点设成跨过切线（实施时用实际字段名）…

  // 交点在画布上出现，并且可以点它生成交点图元
  await expect(canvas).toHaveAttribute("data-preview-count", /[1-9]/)
  await expect(page.locator(".status-bar-prompt")).toContainText("交点")

  // 选中切线与直线 → 量夹角 → 数字常驻画布
  await algebra.getByText("切线 1", { exact: true }).click()
  await algebra.getByText("直线 1", { exact: true }).click({ modifiers: ["Shift"] })
  await page.locator('[aria-label="平面测量工具"]').getByRole("button", { name: "夹角（两条线）", exact: true }).click()
  await expect(page.locator("[data-measurement-label]")).toHaveText(/夹角：/)
})
```

> 实施提示：按钮名、属性栏字段名与 `data-*` 读数以**实际界面**为准（先用 DOM 探针确认，再写死断言）；探针不提交。

- [ ] **Step 2: 跑 e2e**

Run: `npx playwright test e2e/planar-derived-intersections.spec.ts`
Expected: 全绿

- [ ] **Step 3: 提交**

```bash
git add e2e/planar-derived-intersections.spec.ts
git commit -m "test(e2e): intersect a tangent with a line and measure their angle"
```

---

### Task 9: 文档收口与全量门禁

**Files:**
- Modify: `docs/project-progress.md`、`docs/feature-catalog.md`、`README.md`
- Modify: `docs/superpowers/specs/2026-09-18-derived-primitive-intersections-design.md`（状态行改"已交付"）

- [ ] **Step 1: 全量门禁**

Run: `npm.cmd run typecheck` → 4 workspace 通过
Run: `npm.cmd test` → 记录文件数/用例数
Run: `npm.cmd run lint` → 0 error
Run: `npm run build --workspace @draw/web` → 通过
Run: `npx playwright test` → 记录通过数（全量，不是单文件）

- [ ] **Step 2: 回填文档**

- `docs/project-progress.md` 顶部"最后更新"加一节，写清：用户口径三句、五处副本收敛为一张表、`analysisSet` 排除理由、测量实体化、切线 1.5 倍、**实测**的门禁数字。
- `docs/feature-catalog.md`：切线/法线/割线/导函数/积分可求交；平面测量新增"夹角（两条线）""点到直线距离""圆的面积/周长/半径"；写明"切线的交点在它画出来的那一段内"与"切线不提供长度度量"。
- `README.md` 验证基线数字更新到本次实测值。

- [ ] **Step 3: 提交并推送**

```bash
git add -A
git commit -m "docs: record the derived-primitive intersections slice"
git push origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
```
（推送前先 `git fetch origin` 核对 divergence；另一会话可能并发推送同一仓库。）

---

## Self-Review

**1. Spec 覆盖**

| spec 章节 | 对应任务 |
| --- | --- |
| §3.1 真源放 dsl | Task 1 |
| §3.2 每个新类型采样什么 + 退化规则 | Task 2 |
| §3.3 五处副本收敛 | Task 1（①④）、Task 3（②③⑤） |
| §3.4 实体感知测量 + 5 个新组合 | Task 4、Task 5、Task 6 |
| §3.5 切线缺省长度 ×1.5 | Task 7 |
| §3.6 `analysisSet` 排除 | Task 1（表里没有它 + 测试断言 `false`） |
| §6 测试策略 5 层 | Task 1/2/3（前三层）、Task 4/6（第四层）、Task 8（第五层） |
| §7 性能实测 | Task 9 Step 1（全量门禁时记录；若配对/采样明显变慢，回填读数并按实测决定是否优化） |

**2. Placeholder 扫描**：Task 8 的两处"实施提示"与 Task 6 的三处字段名依赖真实 DOM/属性栏，已明确写出"先用探针确认再写死断言"，不是"以后再填"；其余步骤都给了可执行代码。

**3. 类型一致性**：`SampledPrimitiveType`（Task 1）→ `SampledPrimitive`（Task 2）→ `isSampledPrimitiveType` 在 Task 3 三处使用；`MeasurableEntity` / `EntityResolver` / `pointEntityResolver`（Task 4）→ Task 6 使用；`MEASUREMENT_METRICS` / `Measurement3Metric`（Task 5）→ Task 6 的 `METRIC_NAMES` 必须补齐两个新键。命名在全文一致。
