# 无限长切线 + 数值精确形式转换：实施计划

> **状态（2026-09-18）**：**8 个任务全部完成并推送**（A 两片 + B 六片）。两处实施过程中的偏离都已在进度文档写明：①二次无理数那一层原本按 spec 的"有界枚举"实现，**实测最坏 114.9 ms/值**，改为反解 n 后 0.561 ms；②浏览器用例抓到 patch 层第五份度量名副本（漏周长/半径，按钮点了没反应），已修并补了防漂移的用例。最终门禁：单测 126 文件 / 1511 用例、lint 0 error / 14 warning、生产构建通过、Playwright 113/113。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让切线默认画成无限长并按无界直线求交；在右侧属性栏最上方加一个「精确形式」面板，把文档里每个有效测量的数值转成分数 / π 的有理倍数 / 二次无理数。

**Architecture:** A 部分只改"切线段写多长"（一处规则 + 一个常量，删掉被取代的 1.5 倍常量）；B 部分是新增的内核纯函数模块 `exact-forms.ts`（连分数 + π 倍数 + 二次无理数有界枚举）加一个只读展示块（放在 `PropertiesBar` 最上方，数据直接取已有的 `sceneDocument.measurements`，不需要新 prop）。顺带把已有三份的"度量中文名"映射收敛成一处。

**Tech Stack:** TypeScript strict、npm workspaces（`@draw/dsl` / `@draw/geometry-kernel` / `@draw/scene-graph` / `apps/web`）、React 19 + Vite 7、Vitest（jsdom）、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-18-exact-number-conversion-design.md`

## Global Constraints

- 不新增任何运行时依赖；`packages/*` 不得 import three.js。
- 修改仓库文件一律用文件编辑工具，**不要**用 PowerShell 文本管道改写源码。
- 一次性探针跑完即删，绝不提交；探针自身的编码/字段错误要先修对再下结论。
- 不改 `schemaVersion`；旧文档（字段层面）逐位不变。
- 每片结束跑门禁：`npm.cmd run typecheck`（4 workspace）、`npm.cmd test`、`npm.cmd run lint`（0 error）、`npm run build --workspace @draw/web`、`npx playwright test`（全量）。
- 数值识别的纪律：**误报比漏报更糟** —— 容差取紧，识别不出就如实说"未识别"。

---

## Part A：切线无限长（2 个任务）

### Task A1: 缺省即无限长，并删除被取代的 1.5 倍常量

**Files:**
- Modify: `packages/scene-graph/src/operations.ts`（`recomputeTangent` / `recomputeCurveTangent` / `curveTangentHalfLength` / `lineEndpoints`）
- Modify: `packages/geometry-kernel/src/planar-constraints.ts:1164-1176`（`tangentSegment` 的文档注释：它写着"用线段而不是无界直线是刻意的"，这条已被用户口径推翻）
- Test: `packages/scene-graph/src/curveTangents.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 常量 `INFINITE_TANGENT_EXTENT`（scene-graph 内部）；切线 / 法线的 `a/b` 在无 `halfLength` 时跨 ±10000

- [ ] **Step 1: 写失败测试**（`curveTangents.test.ts` 追加；**同时删掉**上一轮那条"缺省半长 = 1.5 × 直径"的断言，它守的行为已被取代）

```ts
it("draws a tangent as an infinite line unless an explicit half length trims it", () => {
  const document = createEmptyDocument("conics")
  document.primitives = [
    { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
    parameterTangent("tan-infinite", "circle-1", 0),
    { ...parameterTangent("tan-trimmed", "circle-1", 0), halfLength: 1 },
    { id: "fn-1", type: "function", expression: "x", domain: [-2, 2], samples: 32 },
    { id: "tan-fn", type: "tangent", sourceId: "fn-1", x: 0, point: { x: 0, y: 0 }, slope: 1, a: { x: -2, y: -2 }, b: { x: 2, y: 2 }, status: "approximate" }
  ]

  const settled = recomputeDerivedObjects(document)
  const span = (id: string) => {
    const tangent = find(settled, id)
    if (tangent.type !== "tangent") throw new Error("expected a tangent")
    return Math.hypot(tangent.b.x - tangent.a.x, tangent.b.y - tangent.a.y)
  }

  // 缺省无限长：a/b 跨 ±10000（圆与函数来源都一样）。
  expect(span("tan-infinite")).toBeGreaterThan(19000)
  expect(span("tan-fn")).toBeGreaterThan(19000)
  // 显式 halfLength 仍然是"修剪"：半长 1 ⇒ 全长 2。
  expect(span("tan-trimmed")).toBeCloseTo(2, 6)
  // 无限长仍然以切点为中心（不能偏到一边去）。
  const infinite = find(settled, "tan-infinite")
  if (infinite.type !== "tangent") throw new Error("expected a tangent")
  expect((infinite.a.y + infinite.b.y) / 2).toBeCloseTo(0, 6)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/scene-graph/src/curveTangents.test.ts`
Expected: FAIL —— `expected 6 to be greater than 19000`（当前缺省半长是 1.5 × 半径 = 3 ⇒ 全长 6）

- [ ] **Step 3: 实现**

`operations.ts`：删掉 `CURVE_TANGENT_LENGTH_FACTOR` 与 `curveTangentHalfLength`，改成

```ts
/**
 * 缺省切线的"无限长"延伸量（世界单位，沿切向两侧各伸这么远）。
 *
 * 用户口径："切线长度还要增长一点，**最好是无限长**"。真正写一个无穷大进文档没有意义
 * （导出、检查器、既有代码都按线段读 `a/b`），所以用**固定的大长度**表达"无限"：
 * 1e4 世界单位远大于任何实际视野（默认 1 格 = 1 世界单位），画面外那部分由 SVG 的 viewBox 裁掉。
 *
 * **刻意不按视口算**：视口一变就改文档，缩放与取景会污染脏状态、撤销历史与"保存过没有"。
 */
const INFINITE_TANGENT_EXTENT = 10000

/** 以 `point` 为中心、沿单位方向两侧各伸 `extent` 的线段（斜率为 0 时按竖直处理由调用方决定）。 */
function extendedTangentEndpoints(point: Coordinate, slope: number, vertical: boolean, extent: number): { a: Coordinate; b: Coordinate } {
  const direction = vertical ? { x: 0, y: 1 } : (() => {
    const length = Math.hypot(1, slope)
    return { x: 1 / length, y: slope / length }
  })()
  return {
    a: { x: point.x - direction.x * extent, y: point.y - direction.y * extent },
    b: { x: point.x + direction.x * extent, y: point.y + direction.y * extent }
  }
}
```

- `recomputeTangent`（函数来源）第 1245 行：`...lineEndpoints({ x: primitive.x, y }, slope, source.domain, vertical)` 改成
  `...extendedTangentEndpoints({ x: primitive.x, y }, slope, vertical, primitive.halfLength ?? INFINITE_TANGENT_EXTENT)`。
  （函数来源的切线在界面上不显示「切线半长」框，所以实际总是走无限长；`lineEndpoints` 若因此没有别的调用点就一并删掉。）
- `recomputeCurveTangent`：`tangentSegment(tangent, primitive.halfLength ?? curveTangentHalfLength(source))` 改成
  `tangentSegment(tangent, primitive.halfLength ?? INFINITE_TANGENT_EXTENT)`。
- `planar-constraints.ts` 的 `tangentSegment` 注释里"用线段（而不是无界直线）是刻意的"改为说明"可见长度由调用方决定，缺省是'无限长'的大长度"。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/scene-graph/src packages/geometry-kernel/src`
Expected: 全绿（`curveTangents.test.ts` 里其它"切点位置 / 锚点跟随"的用例不受影响）

- [ ] **Step 5: 提交**

```bash
git add packages/scene-graph/src/operations.ts packages/scene-graph/src/curveTangents.test.ts packages/geometry-kernel/src/planar-constraints.ts
git commit -m "feat(scene-graph): draw tangents as infinite lines unless trimmed"
```

### Task A2: 属性栏文案与浏览器级证据

**Files:**
- Modify: `apps/web/src/components/PropertiesBar.tsx`（「切线半长」那一行的 label）
- Modify: `e2e/planar-derived-intersections.spec.ts`（断言无限长，而不是像素）

- [ ] **Step 1: 改文案**

```tsx
<Field label="切线半长（留空＝无限长）">
```
（`aria-label` 仍是 `切线半长`，既有测试与选择器不受影响。）

- [ ] **Step 2: e2e 追加断言**

在既有 e2e（`e2e/planar-derived-intersections.spec.ts`）里，创建切线之后加一条：

```ts
// 切线是"无限长"：它的 a/b 远超视口，而不是恰好与圆相称的短线段。
const tangentPoints = await page.evaluate(() => {
  const store = (globalThis as unknown as { __drawSceneStore?: { getState: () => { document: { primitives: { type: string; a?: { x: number; y: number }; b?: { x: number; y: number } }[] } } } }).__drawSceneStore
  const tangent = store?.getState().document.primitives.find((primitive) => primitive.type === "tangent")
  return tangent?.a && tangent.b ? Math.hypot(tangent.b.x - tangent.a.x, tangent.b.y - tangent.a.y) : null
})
expect(tangentPoints).toBeGreaterThan(19000)
```

> 实施提示：若页面没有暴露 `__drawSceneStore`（先探一下 `window` 上有什么，不要在计划里假设），就改用已有的 `data-*` 读数或"切线与直线的交点在远离切点处仍然存在"来断言 —— **断言的对象是"无限长"，不是某个具体像素**。

- [ ] **Step 3: 跑 e2e**

Run: `npx playwright test e2e/planar-derived-intersections.spec.ts`
Expected: 全绿

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/PropertiesBar.tsx e2e/planar-derived-intersections.spec.ts
git commit -m "test(web): show the tangent length field as optional, and prove infinite tangents"
```

---

## Part B：数值精确形式面板（6 个任务）

### Task B1: 内核 `exact-forms.ts` —— 整数与分数

**Files:**
- Create: `packages/geometry-kernel/src/exact-forms.ts`
- Create: `packages/geometry-kernel/src/exact-forms.test.ts`
- Modify: `packages/geometry-kernel/src/index.ts`（导出新模块）

**Interfaces:**
- Consumes: `polynomial.ts` 的 `rational()` / `rationalToString()`
- Produces: `ExactForm`、`ExactFormReading`、`exactFormOf(input, tolerance?)`（Task B2/B3 扩展它，Task B5 使用）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest"
import { exactFormOf } from "./exact-forms"

describe("exact form recognition: integers and fractions", () => {
  it("recognises integers and fractions", () => {
    expect(exactFormOf(3).form).toMatchObject({ kind: "integer", text: "3" })
    expect(exactFormOf(0.75).form).toMatchObject({ kind: "rational", text: "3/4" })
    expect(exactFormOf(-3.5).form).toMatchObject({ kind: "rational", text: "-7/2" })
    expect(exactFormOf(1 / 3).form).toMatchObject({ kind: "rational", text: "1/3" })
    // 浮点误差的经典例子：0.1 + 0.2 = 0.30000000000000004 ⇒ 仍然是 3/10。
    expect(exactFormOf(0.1 + 0.2).form).toMatchObject({ kind: "rational", text: "3/10" })
  })

  it("reports the residual and refuses values that are not exact forms", () => {
    const reading = exactFormOf(0.75)
    expect(reading.value).toBeCloseTo(0.75, 12)
    expect(Math.abs(reading.residual!)).toBeLessThanOrEqual(1e-9)
    // 0.1234567 不是分母 ≤ 64 的分数。
    expect(exactFormOf(0.1234567).form.kind).toBe("unrecognised")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/geometry-kernel/src/exact-forms.test.ts`
Expected: FAIL —— `Failed to resolve import "./exact-forms"`

- [ ] **Step 3: 实现**

```ts
/**
 * 把测量出来的浮点数还原成**精确形式**：整数 / 分数 / π 的有理倍数 / 二次无理数。
 *
 * 用户口径："能够识别到图中的小数，并且在功能内输出分数形式，无理数也能输出"。
 *
 * 两条纪律：
 * 1. **误报比漏报更糟**：容差取紧（相对 1e-9 + 绝对 1e-12），认不出就返回 `unrecognised`，
 *    绝不把 0.33333 硬说成 π/9 之类；
 * 2. **纯函数**：不读文档、不碰状态，因此画布、导出、单测可以共用同一份判据。
 *
 * 分数的约分与格式化复用 `polynomial.ts` 的 `rational` / `rationalToString`，不另写一套。
 */
import { rational, rationalToString } from "./polynomial"

export type ExactForm =
  | { kind: "integer"; text: string }
  | { kind: "rational"; text: string }
  | { kind: "pi-multiple"; text: string }
  | { kind: "surd"; text: string }
  | { kind: "unrecognised"; text: string }

export interface ExactFormReading {
  form: ExactForm
  /** 精确形式的浮点值（与输入比较用）。 */
  value: number
  /** |输入 − 精确形式|；未识别时为 null。 */
  residual: number | null
}

const UNRECOGNISED_TEXT = "未识别为精确形式（数值近似）"
const DEFAULT_RELATIVE_TOLERANCE = 1e-9
const DEFAULT_ABSOLUTE_TOLERANCE = 1e-12
const MAX_DENOMINATOR = 64

function toleranceFor(input: number, tolerance?: number): number {
  if (tolerance !== undefined) return tolerance
  return Math.max(DEFAULT_ABSOLUTE_TOLERANCE, Math.abs(input) * DEFAULT_RELATIVE_TOLERANCE)
}

/**
 * 连分数展开求**最佳有理逼近**：返回分母不超过 `maxDenominator` 的渐近分数。
 * 负数取绝对值算、最后补符号（`Math.floor` 对负数的行为与连分数约定不一致，分开处理最稳）。
 */
export function bestRational(input: number, maxDenominator: number): { numerator: bigint; denominator: bigint } | null {
  let value = Math.abs(input)
  if (!Number.isFinite(value)) return null
  let previousNumerator = 0n
  let numerator = 1n
  let previousDenominator = 1n
  let denominator = 0n
  for (let step = 0; step < 64; step += 1) {
    const whole = Math.floor(value)
    const nextNumerator = BigInt(whole) * numerator + previousNumerator
    const nextDenominator = BigInt(whole) * denominator + previousDenominator
    if (nextDenominator > BigInt(maxDenominator)) break
    previousNumerator = numerator
    numerator = nextNumerator
    previousDenominator = denominator
    denominator = nextDenominator
    const fraction = value - whole
    if (fraction < 1e-15) break
    value = 1 / fraction
  }
  if (denominator === 0n) return null
  return rational(input < 0 ? -numerator : numerator, denominator)
}

export function exactFormOf(input: number, tolerance?: number): ExactFormReading {
  const limit = toleranceFor(input, tolerance)
  const unrecognised: ExactFormReading = { form: { kind: "unrecognised", text: UNRECOGNISED_TEXT }, value: input, residual: null }
  if (!Number.isFinite(input)) return unrecognised

  const rounded = Math.round(input)
  if (Math.abs(input - rounded) <= limit) return { form: { kind: "integer", text: String(rounded) }, value: rounded, residual: Math.abs(input - rounded) }

  const fraction = bestRational(input, MAX_DENOMINATOR)
  if (fraction) {
    const value = Number(fraction.numerator) / Number(fraction.denominator)
    if (Math.abs(input - value) <= limit) return { form: { kind: "rational", text: rationalToString(fraction) }, value, residual: Math.abs(input - value) }
  }

  return unrecognised
}
```

在 `packages/geometry-kernel/src/index.ts` 里按既有写法导出 `./exact-forms`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/geometry-kernel/src/exact-forms.test.ts`
Expected: 4 条断言全绿

- [ ] **Step 5: 提交**

```bash
git add packages/geometry-kernel/src/exact-forms.ts packages/geometry-kernel/src/exact-forms.test.ts packages/geometry-kernel/src/index.ts
git commit -m "feat(kernel): recognise integers and exact fractions from measured decimals"
```

### Task B2: π 的有理倍数

**Files:**
- Modify: `packages/geometry-kernel/src/exact-forms.ts`、`packages/geometry-kernel/src/exact-forms.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe("exact form recognition: rational multiples of pi", () => {
  it("recognises the angles a teaching canvas actually produces", () => {
    expect(exactFormOf(Math.PI).form).toMatchObject({ kind: "pi-multiple", text: "π" })
    expect(exactFormOf(Math.PI / 4).form).toMatchObject({ kind: "pi-multiple", text: "π/4" })
    expect(exactFormOf(2 * Math.PI).form).toMatchObject({ kind: "pi-multiple", text: "2π" })
    expect(exactFormOf(-3 * Math.PI / 2).form).toMatchObject({ kind: "pi-multiple", text: "-3π/2" })
    expect(exactFormOf(Math.PI / 6).form).toMatchObject({ kind: "pi-multiple", text: "π/6" })
  })

  it("does not mistake a fraction for a pi multiple", () => {
    // π/4 ≈ 0.785398：分母 ≤ 64 的分数逼近误差远大于容差，所以它必须走 π 这一族。
    expect(exactFormOf(0.75).form.kind).toBe("rational")
    // 分母超过上限的角度倍数应当如实未识别。
    expect(exactFormOf(Math.PI / 100).form.kind).toBe("unrecognised")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/geometry-kernel/src/exact-forms.test.ts`
Expected: FAIL —— `expected 'unrecognised' to match object { kind: 'pi-multiple', ... }`

- [ ] **Step 3: 实现**

```ts
const MAX_PI_DENOMINATOR = 12

/** π 的有理倍数文本：`π`、`-π`、`2π`、`π/4`、`-3π/2`。 */
function formatPiMultiple(numerator: number, denominator: number): string {
  const sign = numerator < 0 ? "-" : ""
  const magnitude = Math.abs(numerator)
  const coefficient = magnitude === 1 ? "π" : `${magnitude}π`
  return denominator === 1 ? `${sign}${coefficient}` : `${sign}${coefficient}/${denominator}`
}
```

在 `exactFormOf` 的分数之后、未识别之前插入：

```ts
  // 角的单位是弧度（两个画布统一过），所以 π 的有理倍数是角最常见的精确形式。
  const piFraction = bestRational(input / Math.PI, MAX_PI_DENOMINATOR)
  if (piFraction && piFraction.numerator !== 0n) {
    const numerator = Number(piFraction.numerator)
    const denominator = Number(piFraction.denominator)
    const value = (numerator / denominator) * Math.PI
    if (Math.abs(input - value) <= limit) {
      return { form: { kind: "pi-multiple", text: formatPiMultiple(numerator, denominator) }, value, residual: Math.abs(input - value) }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/geometry-kernel/src/exact-forms.test.ts`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add packages/geometry-kernel/src/exact-forms.ts packages/geometry-kernel/src/exact-forms.test.ts
git commit -m "feat(kernel): recognise rational multiples of pi"
```

### Task B3: 二次无理数 `(a + b√n)/c`

**Files:**
- Modify: `packages/geometry-kernel/src/exact-forms.ts`、`packages/geometry-kernel/src/exact-forms.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe("exact form recognition: quadratic surds", () => {
  it("recognises the surds a teaching canvas produces", () => {
    expect(exactFormOf(Math.SQRT2).form).toMatchObject({ kind: "surd", text: "√2" })
    expect(exactFormOf(Math.SQRT2 / 2).form).toMatchObject({ kind: "surd", text: "√2/2" })
    expect(exactFormOf(2 + Math.sqrt(3)).form).toMatchObject({ kind: "surd", text: "2+√3" })
    expect(exactFormOf((1 + Math.sqrt(5)) / 2).form).toMatchObject({ kind: "surd", text: "(1+√5)/2" })
    expect(exactFormOf(-Math.sqrt(3) / 2).form).toMatchObject({ kind: "surd", text: "-√3/2" })
    expect(exactFormOf(3 * Math.sqrt(2)).form).toMatchObject({ kind: "surd", text: "3√2" })
  })

  it("refuses transcendentals and long decimals", () => {
    expect(exactFormOf(Math.E).form.kind).toBe("unrecognised")
    expect(exactFormOf(0.1234567).form.kind).toBe("unrecognised")
  })

  it("keeps the residual inside the tolerance for every family", () => {
    for (const value of [0.75, 1 / 3, Math.PI / 4, Math.SQRT2, (1 + Math.sqrt(5)) / 2]) {
      const reading = exactFormOf(value)
      expect(reading.form.kind).not.toBe("unrecognised")
      expect(Math.abs(reading.residual!)).toBeLessThanOrEqual(Math.max(1e-12, Math.abs(value) * 1e-9))
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/geometry-kernel/src/exact-forms.test.ts`
Expected: FAIL —— `√2` 等全部落到 `unrecognised`

- [ ] **Step 3: 实现**

```ts
const MAX_SURD_RADICAND = 99
const MAX_SURD_DENOMINATOR = 12
const MAX_SURD_COEFFICIENT = 12
const MAX_SURD_INTEGER = 24

function isSquareFree(value: number): boolean {
  for (let factor = 2; factor * factor <= value; factor += 1) {
    if (value % (factor * factor) === 0) return false
  }
  return true
}

/** `(a + b√n)/c` 的文本：`√2`、`3√2`、`√2/2`、`-√3/2`、`2+√3`、`(1+√5)/2`。 */
export function formatQuadraticSurd(a: number, b: number, radicand: number, divisor: number): string {
  const root = `√${radicand}`
  const radicalPart = Math.abs(b) === 1 ? root : `${Math.abs(b)}${root}`
  if (a === 0) {
    const signed = b < 0 ? `-${radicalPart}` : radicalPart
    return divisor === 1 ? signed : `${signed}/${divisor}`
  }
  const body = b === 0 ? `${a}` : `${a}${b > 0 ? "+" : "-"}${radicalPart}`
  return divisor === 1 ? body : `(${body})/${divisor}`
}
```

在 π 那一族之后插入（**有界枚举**：平方自由 n ≤ 99，c ≤ 12，b ∈ [-12,12]\{0}，a ∈ [-24,24]；
先扫 `a = 0` 的纯根式 —— 它最常见，能最快命中）：

```ts
  // 二次无理数 (a + b√n)/c：课堂上的 √2、√2/2、(1+√5)/2、2+√3 都在这一族里。
  // 枚举是**有界**的（约 70 万个候选，每个只做几次浮点运算），不会卡住渲染。
  for (const pure of [true, false]) {
    for (let radicand = 2; radicand <= MAX_SURD_RADICAND; radicand += 1) {
      if (!isSquareFree(radicand)) continue
      const root = Math.sqrt(radicand)
      for (let divisor = 1; divisor <= MAX_SURD_DENOMINATOR; divisor += 1) {
        for (let coefficient = -MAX_SURD_COEFFICIENT; coefficient <= MAX_SURD_COEFFICIENT; coefficient += 1) {
          if (coefficient === 0) continue
          const integers = pure ? [0] : Array.from({ length: MAX_SURD_INTEGER * 2 + 1 }, (_, index) => index - MAX_SURD_INTEGER)
          for (const whole of integers) {
            const value = (whole + coefficient * root) / divisor
            if (Math.abs(input - value) > limit) continue
            return { form: { kind: "surd", text: formatQuadraticSurd(whole, coefficient, radicand, divisor) }, value, residual: Math.abs(input - value) }
          }
        }
      }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/geometry-kernel/src`
Expected: 全绿

- [ ] **Step 5: 记录真实耗时**（spec §6 要求）

Run: `node -e "const {exactFormOf}=require('./packages/geometry-kernel/dist/exact-forms.js')"` 不适用（无构建产物）；
改用一条临时单测打印 `performance.now()` 差值，把读数写进进度文档后**删掉该探针**（探针不提交）。

- [ ] **Step 6: 提交**

```bash
git add packages/geometry-kernel/src/exact-forms.ts packages/geometry-kernel/src/exact-forms.test.ts
git commit -m "feat(kernel): recognise quadratic surds such as sqrt(2)/2 and the golden ratio"
```

### Task B4: 度量中文名收敛到一处（三份副本 → 一份）

**Files:**
- Create: `apps/web/src/measurementLabels.ts`
- Modify: `apps/web/src/planarMeasurementVisuals.ts:22`、`apps/web/src/components/AlgebraView.tsx:24`、`apps/web/src/measurementVisuals.ts:42`

**Interfaces:**
- Produces: `measurementMetricLabel(measurement: Measurement3): string`、`MEASUREMENT_METRIC_LABELS: Record<Measurement3["metric"], string>`（Task B5 使用）

- [ ] **Step 1: 建共享模块**

```ts
import type { Measurement3 } from "@draw/dsl"

/**
 * 度量名 → 中文。**只在这里定义一次**：平面画布数字、右侧属性栏、对象列表、立体几何标注
 * 以前各抄了一份（三份），加一个度量名就要改三处 —— 这正是本仓库"名单副本漂移"的老毛病。
 */
export const MEASUREMENT_METRIC_LABELS: Record<Measurement3["metric"], string> = {
  length: "长度", distance: "距离", angle: "角度", area: "面积", volume: "体积", perimeter: "周长", radius: "半径", dihedral: "二面角"
}

/** 二面角有内 / 外角两种说法，其余直接查表。 */
export function measurementMetricLabel(measurement: Measurement3): string {
  if (measurement.metric !== "dihedral") return MEASUREMENT_METRIC_LABELS[measurement.metric]
  return measurement.dihedralKind === "exterior" ? "二面角外角" : "二面角内角"
}
```

- [ ] **Step 2: 三处改成引用它**

- `planarMeasurementVisuals.ts`：删掉本地 `METRIC_NAMES`，`planarMeasurementText` 里改用 `measurementMetricLabel(measurement)`（注意它现在的分支是 `metric === "dihedral" ? 内外角 : 查表`，与共享函数完全同义）。
- `AlgebraView.tsx`：删掉本地 `measurementLabels`，改用共享常量。
- `measurementVisuals.ts`（3D）：删掉本地 `names`，改用 `measurementMetricLabel(measurement)`。

- [ ] **Step 3: 跑测试确认行为不变**

Run: `npx vitest run apps/web/src`
Expected: 全绿（这是纯收敛，不该有任何断言变化）

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/measurementLabels.ts apps/web/src/planarMeasurementVisuals.ts apps/web/src/components/AlgebraView.tsx apps/web/src/measurementVisuals.ts
git commit -m "refactor(web): one source of truth for the measurement metric names"
```

### Task B5: 属性栏最上方的「精确形式」块

**Files:**
- Modify: `apps/web/src/components/PropertiesBar.tsx`（在 `<section className="panel-section properties" aria-label="属性检查器">` 之后、第一个 `shows("data")` 之前插入）
- Test: `apps/web/src/components/PropertiesBar.test.tsx`（若无此文件，则在承载面板测试的既有文件里追加一组）

**Interfaces:**
- Consumes: Task B1-B3 的 `exactFormOf`、Task B4 的 `measurementMetricLabel`
- Produces: 面板 DOM（`data-exact-form-panel` / `data-exact-form-row` / `data-exact-form-kind` / `data-exact-form-text`），Task B6 的 e2e 依赖

- [ ] **Step 1: 写失败测试**

```tsx
it("lists an exact form for every valid measurement, above everything else", () => {
  const document = createEmptyDocument("conics")
  document.primitives = [{ id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 }]
  document.measurements = [
    { id: "m-area", kind: "measurement3", sourceIds: ["circle-1"], metric: "area", value: Math.PI * 4, unit: "u²", precision: "numeric-approximation", status: "valid", explanation: "" },
    { id: "m-degenerate", kind: "measurement3", sourceIds: ["circle-1"], metric: "perimeter", value: undefined, unit: "u", precision: "numeric-approximation", status: "degenerate", explanation: "" }
  ]

  render(<PropertiesBar {...propsWith({ sceneDocument: document })} />)

  const panel = screen.getByLabelText("数值转换")
  const rows = within(panel).getAllByTestId("exact-form-row")
  // 无效测量不出行。
  expect(rows).toHaveLength(1)
  expect(rows[0].dataset.exactFormKind).toBe("pi-multiple")
  expect(rows[0].dataset.exactFormText).toContain("4π")
  expect(within(rows[0]).getByText(/面积/)).toBeTruthy()
  // 面板在属性检查器的第一个位置。
  expect(panel.compareDocumentPosition(screen.getByLabelText("属性检查器")) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy()
})
```

> 实施提示：`propsWith(...)` 是占位写法 —— 该文件既有的测试是怎么构造 props 的，就照那个来（先读同目录既有测试），**不要**新造一套渲染辅助。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run apps/web/src/components`
Expected: FAIL —— 找不到 `数值转换`

- [ ] **Step 3: 实现**

在 `PropertiesBar` 内、`<section … aria-label="属性检查器">` 的第一个孩子位置插入：

```tsx
{/**
  * 数值转换（用户口径："旁边增加一个数据转换功能，能够识别到图中的小数，并且在功能内输出分数形式，
  * 无理数也能输出，该功能入口在右侧属性栏最高处"）。
  *
  * 只读**测量值**：不碰图元几何、不改文档、不进撤销历史。放在最上面，所以不依赖当前选中什么。
  */}
<div className="primitive-properties" aria-label="数值转换" data-exact-form-panel="true">
  <h3>精确形式</h3>
  <p className="footer-note">识别文档里每个有效测量的数值：整数 / 分数 / π 的有理倍数 / 二次无理数；识别不出就如实标"未识别"。</p>
  {exactFormRows.length === 0
    ? <p className="footer-note">还没有测量：先在画布上量一个长度、角度或面积。</p>
    : <div className="metric-grid">{exactFormRows.map((row) => (
        <span key={row.id} data-testid="exact-form-row" data-exact-form-row="true" data-exact-form-kind={row.reading.form.kind} data-exact-form-text={row.reading.form.text}>
          {row.name}（{row.sources.join("、")}）· {row.value.toFixed(3)} {row.unit} · <strong>{row.reading.form.text}</strong>
          {row.reading.residual !== null && <small> · 差值 {row.reading.residual.toExponential(1)}</small>}
          <button type="button" aria-label={`复制 ${row.name}的精确形式`} onClick={() => { void navigator.clipboard?.writeText(row.reading.form.text) }}>复制</button>
        </span>
      ))}</div>}
</div>
```

计算行（同一个组件函数体内，靠近其它派生值）：

```tsx
const exactFormRows = sceneDocument.measurements
  .filter((measurement) => measurement.status === "valid" && typeof measurement.value === "number" && Number.isFinite(measurement.value))
  .map((measurement) => ({
    id: measurement.id,
    name: measurementMetricLabel(measurement),
    sources: measurement.sourceIds,
    value: measurement.value as number,
    unit: measurement.unit ?? "",
    reading: exactFormOf(measurement.value as number)
  }))
```

> 纪律：**包一层 try/catch 或让 `exactFormOf` 本身永不抛**（它是纯函数，输入非有限时返回未识别）—— 面板不能把整个属性栏带崩。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run apps/web/src`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/PropertiesBar.tsx apps/web/src/components/PropertiesBar.test.tsx
git commit -m "feat(web): show exact forms of every measurement at the top of the inspector"
```

### Task B6: e2e + 文档收口 + 全量门禁

**Files:**
- Create: `e2e/exact-forms.spec.ts`
- Modify: `docs/project-progress.md`、`docs/feature-catalog.md`、`README.md`、`docs/superpowers/specs/2026-09-18-exact-number-conversion-design.md`、`docs/superpowers/plans/2026-09-18-exact-number-conversion.md`

- [ ] **Step 1: 写 e2e**

```ts
import { expect, test } from "@playwright/test"

test("converts measured values into exact forms at the top of the inspector", async ({ page }) => {
  await page.goto("/")
  const ribbon = page.getByRole("region", { name: "功能区" })
  await page.getByRole("button", { name: "固定功能区" }).click()
  const algebra = page.locator(".algebra-panel")
  const canvas = page.locator("svg[aria-label='几何画布']")

  // 半径 2 的圆 ⇒ 面积 4π、周长 4π（同名同值不同单位，顺带验证面板按行列出）。
  const box = (await canvas.boundingBox())!
  await ribbon.getByRole("button", { name: "添加圆", exact: true }).click()
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.5)
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5)
  await algebra.getByText("圆 1", { exact: true }).click()
  await page.getByRole("spinbutton", { name: "圆心 X" }).fill("0")
  await page.getByRole("spinbutton", { name: "圆心 Y" }).fill("0")
  await page.getByRole("spinbutton", { name: "半径" }).fill("2")
  await page.locator('[aria-label="平面测量工具"]').getByRole("button", { name: "面积", exact: true }).click()

  const panel = page.locator('[aria-label="数值转换"]')
  await expect(panel).toBeVisible()
  const row = panel.locator("[data-exact-form-row]").first()
  await expect(row).toHaveAttribute("data-exact-form-kind", "pi-multiple")
  await expect(row).toHaveAttribute("data-exact-form-text", "4π")
  await expect(row).toContainText("12.566")
})
```

- [ ] **Step 2: 跑 e2e**

Run: `npx playwright test e2e/exact-forms.spec.ts`
Expected: 全绿

- [ ] **Step 3: 全量门禁**

Run: `npm.cmd run typecheck` → 4 workspace 通过
Run: `npm.cmd test` → 记录文件数 / 用例数
Run: `npm.cmd run lint` → 0 error
Run: `npm run build --workspace @draw/web` → 通过
Run: `npx playwright test` → 记录通过数（全量）

- [ ] **Step 4: 回填文档**

- `docs/project-progress.md`：新增一节（用户两句口径、A 的规则与"1.5 被取代"的如实说明、B 的算法与容差纪律、二次无理数的枚举耗时读数、每片的 RED→GREEN 证据、门禁数字）。
- `docs/feature-catalog.md`：切线/法线默认无限长（**与其它曲线的交点数因此变多，这是定义使然**；填半长可修剪）；属性栏最上方的「精确形式」面板（识别范围与"未识别"的诚实标注）。
- `README.md`：基线数字与能力清单更新。
- spec / plan 状态行改「已交付」。

- [ ] **Step 5: 提交并推送**

```bash
git add -A
git commit -m "docs: record the infinite-tangent and exact-form slice"
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
| §3.1 缺省即无限长的规则 | A1 |
| §3.2 用 ±10000 表达无限、不跟视口联动 | A1 |
| §3.3 影响面（含删掉 1.5 倍常量与注释更新） | A1、A2 |
| §3.4 函数来源同样无限长、退化对象照旧 | A1 |
| §4.1 `exactFormOf` 接口与四个候选族 + 容差 + 文本规范 | B1（整数/分数）、B2（π）、B3（二次无理数） |
| §4.2 面板位置、结构、读数、空状态、复制、共享度量名 | B4、B5 |
| §4.3 数据流（只读测量值） | B5 |
| §4.4 错误与退化（无效测量不出行、未识别如实标、异常不外泄） | B5（测试里含退化用例） |
| §5 测试策略（内核、面板、e2e、A 的测试） | B1-B3、B5、B6、A1、A2 |
| §6 风险（误报、枚举耗时、交点数变多） | B1/B3 的反例用例、B3 Step 5 的耗时读数、B6 的功能目录说明 |
| §7 兼容性 | A1（旧文档逐位不变）、B5（只读、不改存储） |

**2. Placeholder 扫描**：A2 与 B5 各有一处"实施提示"（页面是否暴露 store、渲染辅助怎么构造），都明确写了"先探明再写死/照既有测试来"，不是"以后再填"。除此之外每个代码步骤都给了可执行代码。

**3. 类型一致性**：`exactFormOf` / `ExactFormReading` / `ExactForm` 在 B1 定义、B2/B3 扩展、B5 使用；`bestRational` / `formatPiMultiple` / `formatQuadraticSurd` 在 B1-B3 定义并在同族内使用；`measurementMetricLabel` 在 B4 定义、B5 使用；`INFINITE_TANGENT_EXTENT` 只在 A1 内使用。命名全文一致。
