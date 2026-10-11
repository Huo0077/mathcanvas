# 声明式图形构造（乙案）实施计划

> **给执行者**：用 `executing-plans` 技能按任务逐条实施。**每个任务都要先红后绿**，
> 每完成一个任务就单独提交一次（本仓纪律）。
>
> **前置**：设计文档 [`docs/superpowers/specs/2026-10-11-declarative-figure-construction-design.md`](../specs/2026-10-11-declarative-figure-construction-design.md)
> 已过目。本计划只覆盖设计 §8 的**一期**（平面度量图形的构造），二期（分点与折）另行计划。

**Goal:** 让内核按题面条件**构造**平面图形的坐标，而不是让模型手写坐标 —— 第一个可验证的读数：
用户那句题面里的 `B`、`C`、`D` 能被系统自己造出来。

**Architecture:** 复用已有的 `specForPrompt → searchWitness` 通路（不新造平行词表）。
今天的卡点是 `parseShapeClause` 只认立体家族（`prism` / `pyramid` / `frustum`），
而那句题面是**裸的平面图形 + 度量条件**，于是 `specForPrompt` 返回 `unrecognised`，
构造从未发生。本计划给这条通路添一个新 family：**由度量条件钉死的平面图形**。

**Tech Stack:** TypeScript（严格模式）/ vitest / npm workspaces。
几何在 `packages/geometry-kernel`，题面解析与构造规格在 `packages/agent-core`。

**本仓的既定命令**（每一步都用它们，别用 `npx`）：
- 定向测试：`npm.cmd exec vitest run <路径>`
- 全库非 Lean：`npm.cmd exec vitest run -- --exclude scripts/proof-spike/lean4EndToEnd.test.ts --maxWorkers=2`
- 类型：`npm.cmd run typecheck`；风格：`npm.cmd run lint`；浏览器：`npm.cmd run test:e2e`

---

## Task 0（**先做这个，它决定后面几个任务怎么写**）：探明这组条件能不能解出来

设计文档 §4 假设"闭式优先 + 有界求根"可以沿用 —— **那是假设，不是读数**。
这一条不落实，Task 3 的代码就是凭空写的。

**Files:**
- Create: `packages/agent-core/src/__planarConstructionProbe__.test.ts`（跑完即删）

**Step 1: 写探针**

拿用户那句题面已经解析出来的五条几何条件（不要重新解析，直接构造 `givens`）：

```ts
import { describe, it } from "vitest"
import { parseDiagramObligations } from "./diagramObligations"

const PROMPT = "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。"

describe("probe: 平面四边形的闭式构造", () => {
  it("prints whether the five conditions pin the quadrilateral", () => {
    const parsed = parseDiagramObligations(PROMPT)
    console.log(JSON.stringify(parsed.givens.filter((g) => !g.sourceText.includes("PC")), null, 1))
  })
})
```

**Step 2: 跑它，读题设**

Run: `npm.cmd exec vitest run packages/agent-core/src/__planarConstructionProbe__.test.ts`
Expected: 打出五条（`fixedLength AB=8`、`fixedLength AD=5√3`、`planarAngle BAD=30`、
`planarAngle ADC=90`、`fixedLength CD=3`），**没有** `PC=4√3`。

**Step 3: 手工把解算清楚，写成断言**

在**同一支探针**里加一段：按"先放 A 在原点、AB 沿 x 轴"的顺序，
闭式算出 `B = (8, 0)`、`D = (5√3·cos30°, 5√3·sin30°)`、`C` 由 `∠ADC = 90°` 与 `CD = 3`
两个解取**不让四边形自交**的那一个（`C = (9, √3)`），然后**逐条回代**：

```ts
const A = { x: 0, y: 0 }, B = { x: 8, y: 0 }
const D = { x: 5 * Math.sqrt(3) * Math.cos(Math.PI / 6), y: 5 * Math.sqrt(3) * Math.sin(Math.PI / 6) }
const C = { x: 9, y: Math.sqrt(3) }
// 逐条回代：|AB|=8、|AD|=5√3、∠BAD=30°、∠ADC=90°、|CD|=3
```

**Step 4: 判定 —— 这一支是有读数的，不是"应该能"**

- **五条都能闭式解出且回代通过** ⇒ 走 **Task 3A**（闭式构造），本计划照原样执行；
- **有某几条只能靠有界求根**（例如 `∠ADC` 与 `CD` 联立出非线性）⇒ 走 **Task 3B**，
  并且**把读数抄进设计文档 §4**（把"假设"改成"实测"）；
- **闭式与求根都拿不到** ⇒ **停下来**，把读数报给用户再决定 —— 那意味着一期的工作量
  与设计文档 §4 写的不同，**不许**照着原假设硬写。

**Step 5: 删探针、提交**

```bash
rm packages/agent-core/src/__planarConstructionProbe__.test.ts
git add docs/superpowers/specs/2026-10-11-declarative-figure-construction-design.md
git commit -m "docs(spec): record whether the planar quadrilateral solves closed-form"
```

---

## Task 1：认出「平面四边形ABCD」这类形状从句

**Files:**
- Modify: `packages/agent-core/src/solver/witnessSearch.ts`（`parseShapeClause` 与其返回类型 `RecognisedShape`）
- Test: `packages/agent-core/src/solver/witnessSearch.test.ts`

**为什么**：探针实测（设计 §0.2）`specForPrompt` 对那句题面返回
`unrecognised`，理由是「没有『在…中』形状从句」。而那句题面**有**「平面四边形ABCD中」——
是识别器的词表里只有立体家族。

**Step 1: 写失败用例**

```ts
it("认出裸的平面四边形形状从句", () => {
  const recognised = parseShapeClause("平面四边形ABCD中，AB=8，AD=5√3")
  expect(recognised?.family).toBe("planar-figure")
  expect(recognised?.base).toEqual(["A", "B", "C", "D"])
})

it("不带『平面』二字的写法也认", () => {
  expect(parseShapeClause("四边形ABCD中，AB=8")?.base).toEqual(["A", "B", "C", "D"])
})

it("立体家族的识别逐字不变（护栏）", () => {
  expect(parseShapeClause("在四棱锥P-ABCD中，PA⊥平面ABCD")?.family).toBe("pyramid")
  expect(parseShapeClause("在斜三棱柱ABC-A′B′C′中")?.family).toBe("prism")
})
```

**Step 2: 跑，确认红**

Run: `npm.cmd exec vitest run packages/agent-core/src/solver/witnessSearch.test.ts`
Expected: 前两条 FAIL（`parseShapeClause` 返回 `null`）；第三条 PASS。

**Step 3: 加识别分支**

在 `parseShapeClause` 里**加一支**（不改既有任何一支）：匹配
`(?:平面)?\s*([A-Z]{3,}[A-Z0-9′'₁₂₃₄₅₆₇₈₉]*)\s*中`，环长 ≥3，
返回 `{ family: "planar-figure", base: [点名…] }`。
`RecognisedShape` 的 `family` 联合加 `"planar-figure"`。

**Step 4: 跑，确认绿（含既有全部用例）**

Run: `npm.cmd exec vitest run packages/agent-core/src/solver/witnessSearch.test.ts`
Expected: 全 PASS。

**Step 5: 提交**

```bash
git add packages/agent-core/src/solver/witnessSearch.ts packages/agent-core/src/solver/witnessSearch.test.ts
git commit -m "feat(agent-core): recognise a bare planar figure clause"
```

---

## Task 2：把题设推成一份平面构造规格

**Files:**
- Modify: `packages/agent-core/src/solver/witnessSearch.ts`（`specForPrompt` 的分派 + 新增 `specForPlanarFigure`）
- Test: `packages/agent-core/src/solver/witnessSearch.test.ts`

**为什么**：`specForPrompt` 现在按家族分派；新家族要有自己的规格构造器。
**条件不需要模型复述** —— 直接从 `givens` 筛。

**Step 1: 写失败用例**

```ts
it("把针对环上点名的度量条件筛进规格，且不放进无关条件", () => {
  const prompt = "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3"
  const givens = parseDiagramObligations(prompt).givens
  const result = specForPrompt(prompt, givens)
  expect(result.status).toBe("ok")
  if (result.status !== "ok") return
  expect(result.spec.family).toBe("planar-figure")
  expect(result.spec.base).toEqual(["A", "B", "C", "D"])
  expect(result.spec.relations).toHaveLength(5)
})

it("环外的点名条件不进规格（护栏：PC=4√3 属于折，不属于平面四边形）", () => {
  const prompt = "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3，且PC=4√3"
  const result = specForPrompt(prompt, parseDiagramObligations(prompt).givens)
  expect(result.status).toBe("ok")
  if (result.status !== "ok") return
  expect(result.spec.relations.map((r) => r.kind)).not.toContain("fixed-length-PC")
})
```

**Step 2: 跑，确认红**（今天返回 `unrecognised`）

**Step 3: 实现**

`specForPrompt` 在 `parseShapeClause` 之后加：
```ts
if (recognised.family === "planar-figure") {
  return { status: "ok", spec: specForPlanarFigure(recognised, givens), recognised }
}
```
`specForPlanarFigure`：把环上的点名放进 `base`，把 `givens` 里 **targets 全部落在 `base` 内**
的度量条件（`fixedLength` / `planarAngle` / `segmentRatio` / `equalLength` /
`perpendicular` / `parallel`）放进 `relations`，**其余一律不收**（环外条件属于别的阶段）。

**Step 4: 跑，确认绿**

**Step 5: 提交**

```bash
git add packages/agent-core/src/solver/witnessSearch.ts packages/agent-core/src/solver/witnessSearch.test.ts
git commit -m "feat(agent-core): turn metric clauses into a planar construction spec"
```

---

## Task 3A：闭式构造（**Task 0 判定为"闭式可解"时走这一支**）

> **Task 3 的第一步已量过（2026-10-11 探针实测，跑完即删）**：拿 Task 2 造出的那份规格
> 直接喂 `searchWitness`，结果是
>
> ```
> status: "unverified_instance"
> reasons: ["no-candidate-constructed: 1 个候选都在构造期被拒，没有得到任何可核验的坐标。",
>           "missing-apex: 棱锥的形状描述里没有顶点。（1 个候选）"]
> ```
>
> **读数是**：`specForPrompt` 那一半通了（规格原样造出来了，见下面那五条关系），
> 但**内核那一半没有平面这一支** —— 候选池把 `planar-figure` 交给了**棱锥**的构造器，
> 于是被"没有顶点"拒掉。所以这一任务**不是"复用既有的就行"**，
> 要在内核的候选构造里**新增一条按 `family` 分派的平面分支**。
> 这条读数把 Task 3 从"可能很小"改判成"确实要写内核代码"，也把它的形状钉死了。

**Files:**
- Modify: `packages/geometry-kernel/src/witness/constructors.ts`（新增 `constructPlanarPolygon`）
- Test: `packages/geometry-kernel/src/witness/constructors.test.ts`
- Modify: `packages/agent-core/src/solver/witnessSearch.ts`（`searchWitness` 里 `planar-figure` 那一支）

**Step 1: 写失败用例**

```ts
it("由 AB、AD、∠BAD、∠ADC、CD 造出平面四边形，且逐条回代", () => {
  const built = constructPlanarPolygon({ ring: ["A", "B", "C", "D"], conditions: [/* 五条，见 Task 0 的读数 */] })
  expect(built.ok).toBe(true)
  if (!built.ok) return
  expect(length(built.positions.A, built.positions.B)).toBeCloseTo(8, 9)
  expect(length(built.positions.A, built.positions.D)).toBeCloseTo(5 * Math.sqrt(3), 9)
  expect(length(built.positions.C, built.positions.D)).toBeCloseTo(3, 9)
  expect(interiorAngle(built.positions.B, built.positions.A, built.positions.D)).toBeCloseTo(30, 9)
  expect(interiorAngle(built.positions.A, built.positions.D, built.positions.C)).toBeCloseTo(90, 9)
})

it("C 有两个解时取不让四边形自交的那一个", () => {
  // 另一支让 BC 与 DA 相交，必须是它被排除
})

it("构造器不自证：回代用的是最终坐标", () => { /* … */ })
```

**Step 2–4: 红 → 实现 → 绿**（实现照 Task 0 的读数：闭式优先，落位顺序"先 A、AB 沿 x 轴"）

**Step 5: 提交**

```bash
git add packages/geometry-kernel/src/witness/constructors.ts packages/geometry-kernel/src/witness/constructors.test.ts packages/agent-core/src/solver/witnessSearch.ts
git commit -m "feat(geometry-kernel): construct a planar polygon from its metric conditions"
```

---

## Task 3B：有界求根（**Task 0 判定为"有几条只能求根"时走这一支**）

与 Task 3A 同文件、同判据，只把拿不到闭式的那几条换成求根，**照抄既有那一套**：
固定步数扫描找符号变化区间 + 二分、取最小正根、无 RNG、容差与 `solveDihedralHeight` 同一条。
**不许**引入通用非线性求解器（设计 §9）。

---

## Task 4：失败三分（欠定 / 矛盾 / 未覆盖）

**Files:**
- Modify: `packages/geometry-kernel/src/witness/constructors.ts`
- Test: `packages/geometry-kernel/src/witness/constructors.test.ts`

**Step 1: 三条失败用例各写一条**

```ts
it("欠定：只说 AB=8 与 ∠BAD=30° ⇒ 说清还缺哪一类条件", () => { /* 文案含"缺"与"长度/角" */ })
it("矛盾：∠ADC=90° 与 ∠ADC=60° 同时给 ⇒ 说清是哪两条、差多少", () => { /* 文案含两条原文与实测值 */ })
it("未覆盖：环里出现立体才有的条件 ⇒ 说清这一族还没有构造器", () => { /* 列出认得哪几族 */ })
```

**Step 2–4: 红 → 实现 → 绿。三种结局**不许含糊**：不许把"构造不出"降级成"未核验"、
不许把"没找到"升级成"矛盾"。**

**Step 5: 提交**

```bash
git commit -am "feat(geometry-kernel): tell underdetermined, contradictory and unsupported apart"
```

---

## Task 5：管线接线与**坐标来源标注**（设计的 §6 取舍落点）

**Files:**
- Modify: `packages/agent-core/src/planCompiler.ts`（`diagramWitnessSearch` 那一支：把新家族接进候选替换）
- Test: `packages/agent-core/src/planCompiler.test.ts`

**Step 1: 两条护栏用例**

```ts
it("构造成功时用构造的坐标，而不是模型给的", () => {
  // 模型故意给错坐标；构造成功 ⇒ 落盘的是构造出来的那一组
})
it("构造不出时不许静默采信：退回模型坐标，但报告里标明来源", () => {
  // 断言报告里出现"未经条件构造"一类的标注
})
```

**Step 2–4: 红 → 实现 → 绿**

**Step 5: 提交**

```bash
git commit -am "feat(agent-core): use constructed coordinates and always label their source"
```

---

## Task 6：管线级证据 —— B、C、D 真的出现在图上

**Files:**
- Test: `apps/web/src/agent/agentRuntime.test.ts`（或既有的见证搜索管线用例文件）

**Step 1: 写用例**：拿用户那句题面，跑装配好的运行时，断言落盘的文档里
**确实存在**名为 `B`、`C`、`D` 的点，且 `C` 同时满足 `∠ADC = 90°` 与 `CD = 3`。
今天的形态是：图上只有 `A`、`E`、`F`、`P`（设计 §0.3 实测）。

**Step 2–4: 红 → 接通 → 绿**

**Step 5: 提交**

```bash
git commit -am "test(web): the planar quadrilateral is constructed, not hand-authored"
```

---

## Task 7：收口

**Step 1: 全量门禁**

```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd exec vitest run -- --exclude scripts/proof-spike/lean4EndToEnd.test.ts --maxWorkers=2
npm.cmd run test:e2e
```
Expected: typecheck exit 0；lint **0 error / 13 warning**（与基线逐条相同）；
全库非 Lean 0 失败；e2e 0 失败（负载敏感的性能用例若红，**孤立复跑**后再下结论）。

**Step 2: 变异**：把构造短路成"用模型坐标" ⇒ Task 5 的两条护栏用例**必须真红**；还原复绿。

**Step 3: 文档同步**：`docs/current-status.md` 顶部加一条（含读数与仍是缺口的部分）；
`CHANGELOG.md` 加一节；设计文档状态行改成"一期已实施"。

**Step 4: 提交**（文档单独一个提交）

---

## 明确不在这份计划里

- **二期**：定比分点（`E`、`F`）与折（`AEF → PEF`）—— 另立计划；
- **三期**：把坐标从模型输出里拿掉；
- 模型选错动作那一类（`create_polyhedron` 画平面片）；
- 立体家族的构造（形状从句那条既有支**不动**）。
