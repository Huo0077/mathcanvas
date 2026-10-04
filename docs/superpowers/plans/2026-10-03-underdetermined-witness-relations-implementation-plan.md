# 欠定图形的见证生成与关系核验 实施计划

> **状态：** **已合并进 `main`（未打包、未发布）；但"能画出来"≠"画对了"** —— 详见下方「发版之后的翻转」与 [`current-status.md`](../../current-status.md) §四「当前最严重的问题」。设计见 [`../specs/2026-10-03-underdetermined-witness-relations-design.md`](../specs/2026-10-03-underdetermined-witness-relations-design.md)。
>
> **执行过程中的两处偏离（都已留档）**：① **Task 4 的 `polyhedron` 见证族在本批没有产品调用点** —— 预检扫描时查实 `selectWitness` 只被 `parameterAudit` 以 triangle/prism 调用，所以它照旧实现但**不算本批收益**，真正解掉报障的是 Task 5 的关系核验（见下方「执行前的范围裁定」）；② **Task 7 由端到端用例抓出一个真缺陷并修好** —— `relations` 在 `coordinator → committer → draftStore` 链路上被两处"按 actions 重造信封"丢掉，于是关系核验在真实运行时恒失败，而 7 条编译器用例全绿也发现不了。修复提交 `99ba741`。
>
> **门禁（当次实测）**：全库单测 281 文件 / 3250 通过 + 1 todo / 0 失败；`agent-core` 与 `apps/web` 的 typecheck 均 exit 0；eslint exit 0；每个判据都有对应的定向变异。
>
> ## ⚠️ 发版之后的翻转（2026-10-03，真实应用实测推翻方案一）
>
> **上面那一切在真实应用里不工作。** 用户在桌面版发原句，两次失败在 `relation_not_declared`。
> 探针复现后拿到模型第二次收到的那段修复提示 —— 工具 schema 里有 `relations`、提示明确写着
> 「这次只允许改这几处：envelope.relations」、还逐条列出缺 `perpendicular` 与 `parallel`，
> **模型依然只是把同一份计划又发了一遍**。
>
> 结论：**那条覆盖度门禁是模型满足不了的关卡** —— 一份几何完全正确的计划会因为"没有自证"被判失败。
> **质量门禁不能依赖被测方主动配合。方案一（模型声明关系）由此被推翻。**
>
> 改为**方案 C**：关系由**系统自己从原话里抽**（`relationExtraction.ts`），模型只负责给出满足这些
> 关系的坐标；并给 `create_polyhedron` 加可选 `vertexNames`，免得"顶点顺序"只能靠猜。
> **但方案 C 生效之后是否真能画出图，尚未经过真实运行验证** —— 它的门禁全是我自己写的测试，
> 而方案一当初也是全绿的。
>
> ## 已知仍未验证 / 未完成（**不能读成"已可用"**）
>
> **2026-10-04 更新：用户已实测，结论比原先设想的更严重。**
>
> - ✅ **能画出图了**：六轮真实运行之后，三棱锥那道题**第一次走到了画布**。
> - ❌ **但画错了，而系统没拦**：用户确认"明显画错了"。实测模型给的坐标里
>   `OA · CD = −0.314 ≠ 0`（**第（1）问要证的那件事本身不成立**）；`A` 的高度取 0.64、
>   而"二面角 45°"要求约 1.33（**差约一倍**）。**那道题的七条条件里，机器真正核验过的只有一条。**
> - **根因**：数值约束（等边 / 比例 / 二面角）**完全不在判据内**；`AB=AD` 的等号写法不认；
>   `平面⊥平面` 无判据（只记"未核验"）；而**抽不到的关系只进开发者详细视图、正式界面无任何提示**
>   —— 用户会以为"没报错 = 验过了"。完整清单与修法方向见
>   [`current-status.md`](../../current-status.md) §四「当前最严重的问题」。
> - **教训**：这一版之前所有门禁都是绿的，**而没有任何一条能发现这张图是错的**。
>   **"门禁全绿"不等于"结果正确"。**
>
> 其余仍未验证 / 未完成：几何 Worker 的 compile 分支不带 `relations`；平面几何那一批；
> 带自由参数的表达式关系；把关系存进文档（约束求解）—— 均未做。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD」这类**只有关系、没有数值**的立体题面能真的画出来：模型给出关系表与坐标见证，系统在执行前用内核判据逐条核验，补出来的每个数都写进 `assumptions` 且可改；验不过就自动重试一次，再不行如实问用户。

**Architecture:** 不新建子系统。把既有的 `packages/agent-core/src/underdetermined.ts`（规格 §6.3 已把优先级写好）从"只保证不退化"升级为"保证不退化 **+** 满足题目显式关系"，并补上 `polyhedron` 见证族。判据放进新的 `packages/agent-core/src/relations.ts`，它是**唯一的判据真源**：`selectWitness` 的候选筛选与 `planCompiler` 的执行前核验都调它。关系表用计划信封上的**可选** `relations` 字段承载。

**Tech Stack:** TypeScript（strict）、Vitest（单测，`packages/**` 与 `apps/**` 在 include 里，见 `vitest.config.ts`）、`@draw/geometry-kernel` 的既有向量与残差原料、`@draw/dsl` 的 `ConstraintType`。

**Spec:** [`docs/superpowers/specs/2026-10-03-underdetermined-witness-relations-design.md`](../specs/2026-10-03-underdetermined-witness-relations-design.md)（本计划从它论证；实施时两份都要读）

## Global Constraints

- **判据只有一个真源**：`relations.ts`。`selectWitness` 的候选筛选与 `planCompiler` 的执行前核验**都调它**，不各写一份。
- **容差与内核同源**：退化保护的 `EPSILON = 1e-10` 与"方向是否可用"的判据**照抄** `packages/geometry-kernel/src/constraints3d.ts:21`。不许在 `relations.ts` 里另发明一套精度。**核验容差**默认 `1e-6`，与 `diagnoseConstraint3` 的默认值一致（`constraints3d.ts:142`）。
- **不改符号优先**：`isInvariantRequest`（`underdetermined.ts:86-90`）永远排在**关系满足之前**。题面出现「任意 / 恒定 / 定值」时返回符号结果，**根本不进入候选挑选**。
- **不放宽既有规则的适用范围**：`systemPrompt.ts:192` 那条「任意 / 恒定 / 定值 → 保留符号参数」约束的是题面在做不变量证明的情形；本批只在"题面给的是固定图形、只是没给数值"时补齐数值。分野**只由 `isInvariantRequest` 一个判据决定**，不新增第二个判据。
- **不静默**：每条系统选取的值都产出 `StructuredAssumption`（`kind: "witness"`），`overridable: true`。**验不过不给残图**。
- **不加新依赖**。
- **注释与文案**：只用 ASCII 空格（`no-irregular-whitespace`）；中文文案直接写中文。
- **只在真跑过、看见绿之后**才在本计划里打勾。
- **`relations` 缺省时行为必须与今天逐字相同** —— 这是本批的回归底线。

## File Structure

| 文件 | 责任 |
| --- | --- |
| `packages/agent-core/src/relations.ts`（新建） | **纯函数**：关系类型、覆盖度校对、逐条坐标残差核验。不碰 DOM、不碰文档、不碰编译。 |
| `packages/agent-core/src/relations.test.ts`（新建） | 上者的全部判据：每条关系正例 + 负例 + 与内核的**同源核对** + 覆盖度漏声明报错。 |
| `packages/agent-core/src/underdetermined.ts`（改） | 新增 `polyhedron` 见证族；候选筛选接入 `relations.ts`。 |
| `packages/agent-core/src/underdetermined.test.ts`（改） | 多面体族判据 + 候选筛选 + **符号优先的边界回归**。 |
| `packages/agent-core/src/contracts.ts`（改） | `PlanEnvelope` 三个分支加可选 `relations`；`WitnessValue`/`WitnessConstraints` 加 `polyhedron`。 |
| `packages/agent-core/src/planCompiler.ts`（改） | 插一层关系核验（诊断 + 一次性修复请求）。 |
| `packages/agent-core/src/planCompiler.test.ts`（改） | 核验接进编译器的判据：失败产出诊断与 `repair`。 |
| `packages/agent-core/src/outputParser.ts`（可能改） | **Task 1 实测后才知道**要不要改（见 Task 1）。 |
| `apps/web/src/agent/systemPrompt.ts`（改） | 只改冲突口径 + 补一条四棱锥正例 + 升 `SYSTEM_PROMPT_VERSION`。 |
| `apps/web/src/agent/systemPrompt.test.ts`（改） | 新口径与"覆盖度只查有没有回应"的判据。 |
| `docs/current-status.md` / `docs/feature-catalog.md` / `CHANGELOG.md`（改） | 收口。 |

---

## Task 1: 先证实 `relations` 这个新可选字段进得去（**这是本批的未知项，必须第一个做**）

设计 §5.1 留了一条开放项：提示词里写着"多一个字段都会被拒绝"（`systemPrompt.ts:204`），而信封上已经有可选的 `assumptions?`，所以**新加一个可选 `relations` 到底会不会被解析层拒掉，没人验证过**。先把它测出来，否则后面全部白做。

**Files:**
- Test: `packages/agent-core/src/outputParser.test.ts`（先加一条探测用例）
- Modify: `packages/agent-core/src/contracts.ts:228-231`（只有实测需要时才改）

- [ ] **Step 1: 写探测用例（先看它是什么结果，不是先假设）**

在 `packages/agent-core/src/outputParser.test.ts` 里加：

```ts
it("tells us whether an optional relations field survives envelope parsing", () => {
  // 这一条**故意不写期望**：它是"实测"而不是"断言"。
  // 设计 §5.1 的开放项就是它 —— 解析层对新增可选字段是容忍还是白名单之外一律拒。
  const envelope = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "画四棱锥",
    factIds: [],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "pyramid",
      factIds: [],
      inputs: { alias: "pyramid", vertices: [], faces: [] }
    }],
    relations: [{ kind: "perpendicular", targets: [{ alias: "pyramid", vertex: "P" }, { alias: "pyramid", vertex: "A" }] }]
  }
  const result = parseModelEnvelope(JSON.stringify(envelope), "strict_json")
  // 把实际形状打印出来，供实施者据此决定 Step 3 要改哪里。
  console.log("relations round-trip:", JSON.stringify(result, null, 2))
  expect(result).toBeDefined()
})
```

- [ ] **Step 2: 跑它并读结果**

Run: `npx vitest run packages/agent-core/src/outputParser.test.ts -t "optional relations field"`
Expected: 用例通过，并在输出里看到 `relations` 是**被保留**还是**被剥掉**。两种结果对应 Step 3 的两条不同走法。

- [ ] **Step 3: 按实测结果处理（两条走法，只走其中一条）**

- **若 `relations` 被保留** → 什么都不用改。把这条探测用例改成**真正的断言**（钉住 `relations` 逐字保留），并把它当作后续所有 Task 的回归底线。
- **若 `relations` 被剥掉或被拒** → 在解析层把它按 `assumptions?` 的**同一处理方式**放行（找到 `assumptions` 在解析层的落点，按它的写法加 `relations`）。**不要**放宽"未知字段一律拒"这条总纪律——只放行这一个具名字段。

- [ ] **Step 4: 跑该文件全部用例**

Run: `npx vitest run packages/agent-core/src/outputParser.test.ts`
Expected: PASS，且**既有用例一条都没变**。

- [ ] **Step 5: 提交**

```bash
git add packages/agent-core/src/outputParser.test.ts packages/agent-core/src/contracts.ts
git commit -m "test(agent-core): 实测 relations 这个新可选字段能否通过信封解析"
```

---

## Task 2: `relations.ts` —— 关系判据的唯一真源

**Files:**
- Create: `packages/agent-core/src/relations.ts`
- Test: `packages/agent-core/src/relations.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/agent-core/src/relations.test.ts`：

```ts
import { describe, expect, it } from "vitest"

import { relationResidual, verifyRelations, type Relation, type RelationTarget } from "./relations"

const at = (x: number, y: number, z: number) => ({ x, y, z })

/**
 * 判据必须**与内核同源**。内核那套在 `constraints3d.ts:126-132`：方向叉积 / 点积按两向量长度
 * 归一。这里的用例先把"什么算满足、什么算违反"钉死，再由 Task 2 最后一条与内核逐值核对。
 */
describe("relation residuals", () => {
  const points: Record<string, { x: number; y: number; z: number }> = {
    // 四棱锥 P-ABCD：PA ⊥ 底面，BC ∥ AD，AB ⊥ AD（用户报障那一道）。
    P: at(0, 0, 4),
    A: at(0, 0, 0),
    B: at(2, 0, 0),
    C: at(2, 3, 0),
    D: at(0, 3, 0)
  }
  const lookup = (target: RelationTarget) => points[target.vertex] ?? null

  it("accepts a perpendicular that really holds", () => {
    // PA 是 (0,0,1) 方向；AB 是 (1,0,0) 方向 —— 点积 0。
    const residual = relationResidual({ kind: "perpendicular", targets: [{ vertex: "P" }, { vertex: "A" }, { vertex: "B" }] }, lookup)
    expect(residual).not.toBeNull()
    expect(residual!).toBeLessThan(1e-6)
  })

  it("reports a real residual for a perpendicular that does not hold", () => {
    // PB 与 AB 夹角 63.4°，不该算满足。
    const residual = relationResidual({ kind: "perpendicular", targets: [{ vertex: "P" }, { vertex: "B" }, { vertex: "A" }] }, lookup)
    expect(residual).not.toBeNull()
    expect(residual!).toBeGreaterThan(1e-6)
  })

  it("accepts parallel and rejects its negative", () => {
    // BC: (0,1,0)；AD: (0,1,0) —— 平行。
    expect(relationResidual({ kind: "parallel", targets: [{ vertex: "B" }, { vertex: "C" }, { vertex: "A" }, { vertex: "D" }] }, lookup)!).toBeLessThan(1e-6)
    // AB: (1,0,0) 与 BC: (0,1,0) —— 垂直，不是平行。
    expect(relationResidual({ kind: "parallel", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "B" }, { vertex: "C" }] }, lookup)!).toBeGreaterThan(1e-6)
  })

  it("measures a line-perpendicular-to-plane as the direction's dot with the plane normal", () => {
    // PA ⊥ 平面 ABCD：方向 (0,0,1) 与底面法向 (0,0,1) 同向。
    const residual = relationResidual({ kind: "perpendicular", targets: [{ vertex: "P" }, { vertex: "A" }, { vertex: "A" }, { vertex: "B" }, { vertex: "C" }] }, lookup)
    expect(residual).not.toBeNull()
    expect(residual!).toBeLessThan(1e-6)
  })

  it("accepts coplanar and rejects a point off the plane", () => {
    expect(relationResidual({ kind: "coplanar", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "C" }, { vertex: "D" }] }, lookup)!).toBeLessThan(1e-6)
    expect(relationResidual({ kind: "coplanar", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "C" }, { vertex: "P" }] }, lookup)!).toBeGreaterThan(1e-6)
  })

  it("measures equal length, ratio and midpoint", () => {
    // AB = 2，AD = 3 → 不等长。
    expect(relationResidual({ kind: "equalLength", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "A" }, { vertex: "D" }] }, lookup)!).toBeGreaterThan(1e-6)
    // BC = 3，AD = 3 → 等长。
    expect(relationResidual({ kind: "equalLength", targets: [{ vertex: "B" }, { vertex: "C" }, { vertex: "A" }, { vertex: "D" }] }, lookup)!).toBeLessThan(1e-6)
    // BC / AD = 1。
    expect(relationResidual({ kind: "ratio", targets: [{ vertex: "B" }, { vertex: "C" }, { vertex: "A" }, { vertex: "D" }], value: 1 }, lookup)!).toBeLessThan(1e-6)
    // M 是 AD 的中点 → (0, 1.5, 0)。
    const withMidpoint = { ...points, M: at(0, 1.5, 0) }
    const midpointLookup = (target: RelationTarget) => withMidpoint[target.vertex] ?? null
    expect(relationResidual({ kind: "midpoint", targets: [{ vertex: "M" }, { vertex: "A" }, { vertex: "D" }] }, midpointLookup)!).toBeLessThan(1e-6)
  })

  it("returns null (not zero) when a target is missing — 缺少来源时不许算成满足", () => {
    const missing = (target: RelationTarget) => (target.vertex === "P" ? null : points[target.vertex] ?? null)
    expect(relationResidual({ kind: "perpendicular", targets: [{ vertex: "P" }, { vertex: "A" }, { vertex: "B" }] }, missing)).toBeNull()
  })

  it("reports which declared relations failed, with their residuals", () => {
    const declared: Relation[] = [
      { id: "r1", kind: "perpendicular", targets: [{ vertex: "P" }, { vertex: "A" }, { vertex: "A" }, { vertex: "B" }, { vertex: "C" }] },
      // 故意写一条不成立的：AB ∥ AD。
      { id: "r2", kind: "parallel", targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "A" }, { vertex: "D" }] }
    ]
    const result = verifyRelations(declared, lookup)
    expect(result.ok).toBe(false)
    expect(result.failures.map((failure) => failure.id)).toEqual(["r2"])
    expect(result.failures[0].residual).toBeGreaterThan(1e-6)
  })
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `npx vitest run packages/agent-core/src/relations.test.ts`
Expected: FAIL —— `Failed to resolve import "./relations"`。

- [ ] **Step 3: 写最小实现**

新建 `packages/agent-core/src/relations.ts`：

```ts
import type { Vector3 } from "@draw/geometry-kernel"

/**
 * **关系判据的唯一真源**（设计 §5.3）。
 *
 * ## 为什么是坐标版，而不是直接用内核的 `constraintResidual3`
 *
 * `packages/geometry-kernel/src/constraints3d.ts:106` 的 `constraintResidual3` 吃的是
 * `ConstraintSpec.targets: string[]`（**图元 id**）+ 一份文档上下文。而本层要在**草稿物化之前**
 * 判定"这批即将产出的坐标"——那时还没有任何图元 id。所以这里的入参是坐标，数学与内核**逐式相同**：
 *
 * - 平行：`|u × v| / (|u||v|)`（`constraints3d.ts:131`）
 * - 垂直：`|u · v| / (|u||v|)`（同上）
 * - 共面：`|n · (p - p0)|`，`n` 由 `planeFromPoints` 同款叉积给出（`constraints3d.ts:101-104`）
 *
 * **同源不是靠自己声明，而是靠测试核对**：`relations.test.ts` 里有一条把同一组几何喂给
 * 内核 `diagnoseConstraints3` 与本模块，要求两者的 `satisfied` 判定一致。
 *
 * ## 容差
 *
 * 退化保护用内核同一个常量 `1e-10`（`constraints3d.ts:21`），"方向是否可用"的判据也照它。
 * **不许在这里另发明一套精度。**
 */

/** 退化保护：与 `packages/geometry-kernel/src/constraints3d.ts:21` 的 `EPSILON` 同值。 */
const EPSILON = 1e-10

/** 核验容差：与 `diagnoseConstraint3` 的默认值一致（`constraints3d.ts:142`）。 */
export const RELATION_TOLERANCE = 1e-6

export type RelationKind = "perpendicular" | "parallel" | "coplanar" | "pointOn" | "equalLength" | "ratio" | "midpoint"

/**
 * 关系目标：**第一批只支持顶点**（设计 §2 决定 7）。
 *
 * 线 = 两个顶点之差、平面 = 三个顶点的法向，都由"若干个顶点"在判据里现算 ——
 * 所以不需要为线 / 面 / 平面引入新的目标类型。`targets` 的长度按 `kind` 解释：
 *
 * - `perpendicular` / `parallel`：3 个顶点 = 线⊥/∥线；5 个顶点 = 线⊥/∥平面（前 2 个定线，后 3 个定平面）
 * - `coplanar`：≥4 个顶点
 * - `pointOn`：1 个点 + 3 个顶点定平面
 * - `equalLength` / `ratio`：4 个顶点（前 2 个第一条线段，后 2 个第二条）
 * - `midpoint`：3 个顶点（第一个是中点，后两个是端点）
 */
export interface RelationTarget {
  vertex: string
}

export interface Relation {
  id?: string
  kind: RelationKind
  targets: RelationTarget[]
  /** `ratio` 用（第二个线段 / 第一个线段）。 */
  value?: number
}

export type RelationLookup = (target: RelationTarget) => Vector3 | null

const subtract = (first: Vector3, second: Vector3): Vector3 => ({ x: first.x - second.x, y: first.y - second.y, z: first.z - second.z })
const dot = (first: Vector3, second: Vector3): number => first.x * second.x + first.y * second.y + first.z * second.z
const cross = (first: Vector3, second: Vector3): Vector3 => ({
  x: first.y * second.z - first.z * second.y,
  y: first.z * second.x - first.x * second.z,
  z: first.x * second.y - first.y * second.x
})
const length = (vector: Vector3): number => Math.hypot(vector.x, vector.y, vector.z)

/** 一组顶点；任何一个取不到就返回 `null`（**缺少来源时报数据不足，不算满足**）。 */
function points(targets: RelationTarget[], lookup: RelationLookup): Vector3[] | null {
  const resolved = targets.map((target) => lookup(target))
  return resolved.every((point): point is Vector3 => point !== null) ? resolved : null
}

/** 由三个顶点定平面法向（与 `planeFromPoints` 同款叉积）。退化返回 `null`。 */
function planeNormalFrom(first: Vector3, second: Vector3, third: Vector3): Vector3 | null {
  const normal = cross(subtract(second, first), subtract(third, first))
  return length(normal) > EPSILON ? normal : null
}

/** 一条线段的方向；退化（两端重合）返回 `null`。 */
function direction(first: Vector3, second: Vector3): Vector3 | null {
  const vector = subtract(second, first)
  return length(vector) > EPSILON ? vector : null
}

/**
 * 逐条算残差：**满足时返回一个小数，不满足时返回一个正数，算不了时返回 `null`**。
 * 这个三态区分很重要 —— 把"算不了"当成 0 会得到一个"永远满足"的假约束
 * （内核在 `constraints3d.ts:59-63` 已经为同一类陷阱写过注释）。
 */
export function relationResidual(relation: Relation, lookup: RelationLookup): number | null {
  const resolved = points(relation.targets, lookup)
  if (!resolved) return null

  if (relation.kind === "perpendicular" || relation.kind === "parallel") {
    // 3 个顶点 = 线与线；5 个 = 线与平面（后 3 个定平面）。
    if (resolved.length === 5) {
      const line = direction(resolved[0], resolved[1])
      const normal = planeNormalFrom(resolved[2], resolved[3], resolved[4])
      if (!line || !normal) return null
      const scale = length(line) * length(normal)
      if (scale <= EPSILON) return null
      // 线 ⊥ 平面 ⇔ 方向 ∥ 法向；线 ∥ 平面 ⇔ 方向 ⊥ 法向。
      return relation.kind === "perpendicular"
        ? length(cross(line, normal)) / scale
        : Math.abs(dot(line, normal)) / scale
    }
    const first = direction(resolved[0], resolved[1])
    const second = direction(resolved[2], resolved[3])
    if (!first || !second) return null
    const scale = length(first) * length(second)
    if (scale <= EPSILON) return null
    return relation.kind === "perpendicular" ? Math.abs(dot(first, second)) / scale : length(cross(first, second)) / scale
  }

  if (relation.kind === "coplanar") {
    if (resolved.length < 4) return null
    const normal = planeNormalFrom(resolved[0], resolved[1], resolved[2])
    if (!normal) return null
    // 与内核同一判据：其余每个点到该平面的距离取最大值。
    return Math.max(...resolved.slice(3).map((point) => Math.abs(dot(normal, subtract(point, resolved[0])))))
  }

  if (relation.kind === "pointOn") {
    if (resolved.length !== 4) return null
    const normal = planeNormalFrom(resolved[1], resolved[2], resolved[3])
    if (!normal) return null
    return Math.abs(dot(normal, subtract(resolved[0], resolved[1])))
  }

  if (relation.kind === "equalLength" || relation.kind === "ratio") {
    if (resolved.length !== 4) return null
    const first = length(subtract(resolved[1], resolved[0]))
    const second = length(subtract(resolved[3], resolved[2]))
    if (first <= EPSILON) return null
    if (relation.kind === "equalLength") return Math.abs(second - first)
    const ratio = relation.value
    if (ratio === undefined || !Number.isFinite(ratio)) return null
    return Math.abs(second / first - ratio)
  }

  // midpoint：第一个是中点，后两个是端点。
  if (resolved.length !== 3) return null
  const midpoint = { x: (resolved[1].x + resolved[2].x) / 2, y: (resolved[1].y + resolved[2].y) / 2, z: (resolved[1].z + resolved[2].z) / 2 }
  return length(subtract(resolved[0], midpoint))
}

export interface RelationFailure {
  id: string
  kind: RelationKind
  residual: number | null
  detail: string
}

export interface RelationCheck {
  ok: boolean
  failures: RelationFailure[]
}

/** 逐条核验；`tolerance` 缺省用 `RELATION_TOLERANCE`。 */
export function verifyRelations(relations: readonly Relation[], lookup: RelationLookup, tolerance = RELATION_TOLERANCE): RelationCheck {
  const failures: RelationFailure[] = []
  relations.forEach((relation, index) => {
    const residual = relationResidual(relation, lookup)
    if (residual === null) {
      failures.push({ id: relation.id ?? `relation-${index}`, kind: relation.kind, residual: null, detail: "缺少有效顶点来源，无法计算这条关系的残差。" })
      return
    }
    if (!(residual <= tolerance)) {
      failures.push({ id: relation.id ?? `relation-${index}`, kind: relation.kind, residual, detail: `残差 ${residual.toExponential(2)} 超过容差 ${tolerance.toExponential(2)}。` })
    }
  })
  return { ok: failures.length === 0, failures }
}
```

- [ ] **Step 4: 跑测试看它绿**

Run: `npx vitest run packages/agent-core/src/relations.test.ts`
Expected: PASS（8 条全绿）。

- [ ] **Step 5: 加"与内核同源"的核对用例（这是本 Task 唯一真正重要的断言）**

在 `relations.test.ts` 里补：

```ts
it("agrees with the kernel on the same geometry (same-source check)", () => {
  // 同一组坐标：一边让关系模块算，一边让内核的 constraintResidual3 算。
  // 判据必须落在同一个 satisfied 结论上 —— 否则"容差有两套"就已经发生了。
  // 实施者按 constraints3d.ts:106 的签名把图元与 ConstraintSpec 组出来：
  //   point3 图元用 { id, type: "point3", position }；
  //   parallel / perpendicular 用两条 segment3（pointIds 两个）；
  //   coplanar 用四个 point3 的 id。
  // 断言：diagnoseConstraint3(...).satisfied === (relationResidual(...) <= RELATION_TOLERANCE)
  // 正例与负例各至少一条。
  expect(true).toBe(true) // 实施时替换成真实断言
})
```

- [ ] **Step 6: 跑并提交**

Run: `npx vitest run packages/agent-core/src/relations.test.ts`
Expected: PASS。

```bash
git add packages/agent-core/src/relations.ts packages/agent-core/src/relations.test.ts
git commit -m "feat(agent-core): 关系判据真源 relations.ts（与内核残差同源 + 覆盖度前置）"
```

---

## Task 3: 覆盖度校对 —— 原话里的关系必须被逐条回应

**Files:**
- Modify: `packages/agent-core/src/relations.ts`
- Modify: `packages/agent-core/src/relations.test.ts`

- [ ] **Step 1: 写失败测试**

在 `relations.test.ts` 里加：

```ts
import { missingRelationKinds, relationKindsInText } from "./relations"

describe("relation coverage", () => {
  it("finds the relation keywords in the user's own words", () => {
    const prompt = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱锥"
    const kinds = relationKindsInText(prompt)
    expect(kinds.has("perpendicular")).toBe(true)
    expect(kinds.has("parallel")).toBe(true)
  })

  it("demands an answer for every keyword the prompt used", () => {
    const prompt = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD"
    // 模型只声明了平行，漏掉了垂直 → 必须报出来。
    const missing = missingRelationKinds(prompt, [{ kind: "parallel", targets: [] }])
    expect(missing).toEqual(["perpendicular"])
  })

  it("does not demand a kind the prompt never mentioned", () => {
    const prompt = "画一个四棱锥，底面是矩形"
    expect(missingRelationKinds(prompt, [])).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `npx vitest run packages/agent-core/src/relations.test.ts -t "relation coverage"`
Expected: FAIL —— `relationKindsInText is not a function`（或导入报错）。

- [ ] **Step 3: 写最小实现**

在 `relations.ts` 里加：

```ts
/**
 * 关系关键词表：**只在这里定义一次**（沿用 `underdetermined.ts:84` 把关键词写成唯一来源的做法）。
 *
 * 覆盖度**只查"有没有回应"**，不试图从自然语言里抠出"是哪四个点"—— 那是模型声明表的职责
 *（设计 §5.2）。这条边界必须同时写进提示词，否则模型会以为系统也在解析。
 */
const RELATION_KEYWORDS: readonly { kind: RelationKind; keywords: readonly string[] }[] = [
  { kind: "perpendicular", keywords: ["垂直", "⊥", "perp"] },
  { kind: "parallel", keywords: ["平行", "∥", "//"] },
  { kind: "coplanar", keywords: ["共面"] },
  { kind: "equalLength", keywords: ["等长", "长度相等", "相等"] },
  { kind: "midpoint", keywords: ["中点"] },
  { kind: "ratio", keywords: ["比例", "之比", "比值"] }
]

/** 用户原话里出现的关系种类。 */
export function relationKindsInText(prompt: string): Set<RelationKind> {
  const lowered = prompt.toLowerCase()
  const found = new Set<RelationKind>()
  for (const entry of RELATION_KEYWORDS) {
    if (entry.keywords.some((keyword) => lowered.includes(keyword.toLowerCase()))) found.add(entry.kind)
  }
  return found
}

/**
 * 原话点名、而声明表里没有回应的关系种类。
 *
 * **只查漏、不查多**：模型可以补充题面隐含的关系（例如由 ⊥ 推出的事实），
 * 但不能漏掉题面明说的。漏掉就是设计 §5.2 要挡的那类静默错误。
 */
export function missingRelationKinds(prompt: string, declared: readonly Relation[]): RelationKind[] {
  const declaredKinds = new Set(declared.map((relation) => relation.kind))
  return [...relationKindsInText(prompt)].filter((kind) => !declaredKinds.has(kind))
}
```

- [ ] **Step 4: 跑测试看它绿**

Run: `npx vitest run packages/agent-core/src/relations.test.ts`
Expected: PASS（11 条全绿）。

- [ ] **Step 5: 提交**

```bash
git add packages/agent-core/src/relations.ts packages/agent-core/src/relations.test.ts
git commit -m "feat(agent-core): 关系覆盖度校对（只查漏不查多，关键词单一真源）"
```

---

## Task 4: 多面体见证族 + 关系驱动的候选筛选

**Files:**
- Modify: `packages/agent-core/src/underdetermined.ts:32-81`（类型）、`:207-306`（`selectWitness`）
- Modify: `packages/agent-core/src/underdetermined.test.ts`

- [ ] **Step 1: 写失败测试**

在 `underdetermined.test.ts` 里加：

```ts
it("accepts a polyhedron candidate only when every declared relation holds", () => {
  // 用户报障那一道：PA ⊥ 平面 ABCD、BC ∥ AD、AB ⊥ AD。
  const good = {
    vertices: [
      { x: 0, y: 0, z: 4 }, // P
      { x: 0, y: 0, z: 0 }, // A
      { x: 2, y: 0, z: 0 }, // B
      { x: 2, y: 3, z: 0 }, // C
      { x: 0, y: 3, z: 0 }  // D
    ],
    names: ["P", "A", "B", "C", "D"],
    faces: [[1, 2, 3, 4], [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]]
  }
  const relations = [
    { kind: "perpendicular" as const, targets: [{ vertex: "P" }, { vertex: "A" }, { vertex: "A" }, { vertex: "B" }, { vertex: "C" }] },
    { kind: "parallel" as const, targets: [{ vertex: "B" }, { vertex: "C" }, { vertex: "A" }, { vertex: "D" }] },
    { kind: "perpendicular" as const, targets: [{ vertex: "A" }, { vertex: "B" }, { vertex: "A" }, { vertex: "D" }] }
  ]

  const result = selectWitness({ kind: "polyhedron", prompt: "画出这个四棱锥", candidates: [good], relations })

  expect(result.status).toBe("witness")
  if (result.status !== "witness" || result.value.kind !== "polyhedron") throw new Error("expected a polyhedron witness")
  expect(result.assumption.kind).toBe("witness")
  expect(result.assumption.overridable).toBe(true)
})

it("skips a candidate that violates a declared relation, and says why", () => {
  // 同一只四棱锥，但 P 偏到 (1, 0, 4)：PA 不再垂直于底面。
  const skewed = { vertices: [{ x: 1, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }], names: ["P", "A", "B", "C", "D"], faces: [[1, 2, 3, 4], [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]] }
  const relations = [{ kind: "perpendicular" as const, targets: [{ vertex: "P" }, { vertex: "A" }, { vertex: "A" }, { vertex: "B" }, { vertex: "C" }] }]
  const result = selectWitness({ kind: "polyhedron", prompt: "画出这个四棱锥", candidates: [skewed], relations })
  expect(result.status).toBe("rejected")
  // `considered` 是既有字段，正好用来解释"我为什么没选它"。
  expect(result.considered.join(" ")).toContain("关系")
})

it("still refuses to specialise when the prompt asks for an arbitrary figure (符号优先不可动摇)", () => {
  const result = selectWitness({ kind: "polyhedron", prompt: "画一个任意四棱锥", candidates: [], relations: [] })
  expect(result.status).toBe("symbolic")
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `npx vitest run packages/agent-core/src/underdetermined.test.ts`
Expected: FAIL —— `polyhedron` 不在 `WitnessKind` 里，且 `selectWitness` 不认 `candidates` / `relations`。

- [ ] **Step 3: 改类型与实现**

在 `underdetermined.ts` 里：

1. `WitnessKind`（`:32`）加 `"polyhedron"`。
2. `WitnessValue`（`:50-54`）加 `| ({ kind: "polyhedron" } & PolyhedronWitness)`，并定义：

```ts
export interface PolyhedronWitness {
  vertices: Vector3[]
  /** 顶点名（P / A / B / …），与题面一致；关系表按名字引用它们。 */
  names: string[]
  /** 面环，元素是 `vertices` 的下标。 */
  faces: number[][]
}
```

3. `WitnessRequest`（`:71-76`）加两个**可选**字段：

```ts
  /** 模型给出的候选（多面体族用）。缺省时走既有的常量候选表。 */
  candidates?: readonly PolyhedronWitness[]
  /** 题目显式给出的关系。**判据在 `relations.ts`，这里只调它。** */
  relations?: readonly Relation[]
```

4. `selectWitness` 里**新增 polyhedron 分支**，位置放在 `triangle` 分支**之后**、`slope` 之前（顺序不影响既有族）：

```ts
  if (request.kind === "polyhedron") {
    // 符号优先已经在函数开头处理掉了（`:210`），这里只管候选。
    const declared = request.relations ?? []
    const candidates = request.candidates ?? []
    for (const candidate of candidates) {
      const byName = new Map(candidate.names.map((name, index) => [name, candidate.vertices[index]]))
      const lookup: RelationLookup = (target) => byName.get(target.vertex) ?? null
      // ① 先验题目显式关系（优先级第一条）。
      const check = verifyRelations(declared, lookup)
      if (!check.ok) {
        considered.push(`relations: 候选未满足 ${check.failures.map((failure) => failure.id).join("、")} —— ${check.failures[0].detail}`)
        continue
      }
      // ② 再验几何合法性（固有判据，不外移）：判据来自内核 `buildFromPoints`。
      const built = buildFromPoints({ vertices: candidate.vertices, faces: candidate.faces }, createBuilderContext())
      if (built.diagnostics.length > 0) {
        considered.push(`degenerate: ${built.diagnostics.map((entry) => entry.message).join("；")}`)
        continue
      }
      considered.push("accepted: 关系逐条成立、几何合法。")
      return {
        status: "witness",
        value: { kind: "polyhedron", ...candidate },
        assumption: {
          id: "witness:polyhedron",
          text: `题目没有给定具体尺寸，以下为系统选取的一组示例值（满足题面全部关系，可在属性栏修改）：${candidate.names.map((name, index) => `${name}(${candidate.vertices[index].x}, ${candidate.vertices[index].y}, ${candidate.vertices[index].z})`).join("、")}。`,
          kind: "witness",
          value: candidate,
          overridable: true,
          path: "witness.polyhedron"
        },
        considered,
        diagnostics: []
      }
    }
    return rejectedSelection("polyhedron", "no_acceptable_witness", "没有候选能同时满足题面关系与几何合法性。", considered)
  }
```

导入：`import { buildFromPoints, createBuilderContext } from "@draw/geometry-kernel"` 与 `import { verifyRelations, type Relation, type RelationLookup } from "./relations"`。

- [ ] **Step 4: 跑测试看它绿**

Run: `npx vitest run packages/agent-core/src/underdetermined.test.ts`
Expected: PASS（含既有 8 条 + 新增 3 条）。

- [ ] **Step 5: 定向变异（本仓库的既有口径：改坏判据，测试必须变红）**

把 `selectWitness` 里 `if (!check.ok) { ... continue }` 改成 `if (false) { ... }`，重跑：
Run: `npx vitest run packages/agent-core/src/underdetermined.test.ts -t "skips a candidate"`
Expected: **FAIL**（不满足关系的候选被当成了 witness）。改回来，再跑一次确认绿。

- [ ] **Step 6: 提交**

```bash
git add packages/agent-core/src/underdetermined.ts packages/agent-core/src/underdetermined.test.ts
git commit -m "feat(agent-core): 多面体见证族 + 关系驱动的候选筛选（符号优先不动）"
```

---

## Task 5: 接进 `planCompiler` —— 关系核验成为执行前的判据

**Files:**
- Modify: `packages/agent-core/src/planCompiler.ts`（在 `compilePlan` 的 `:244` 循环之后、`verifyPlan` 附近）
- Modify: `packages/agent-core/src/planCompiler.test.ts`

- [ ] **Step 1: 写失败测试**

在 `planCompiler.test.ts` 里加（按该文件既有的 `compilePlan(input, context)` 调用形状组织夹具）：

```ts
it("rejects a plan whose declared relation does not hold, and offers a repair", () => {
  // 一份"说自己垂直、其实不垂直"的多面体计划。
  const plan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "四棱锥",
    factIds: [],
    assumptions: [],
    relations: [{ id: "r1", kind: "perpendicular", targets: [{ vertex: "P" }, { vertex: "A" }, { vertex: "A" }, { vertex: "B" }, { vertex: "C" }] }],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "pyramid",
      factIds: [],
      inputs: {
        alias: "pyramid",
        vertices: [{ x: 1, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }],
        faces: [[1, 2, 3, 4], [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]]
      }
    }]
  }
  const result = compilePlan(plan, context)
  expect(result.ok).toBe(false)
  expect(result.diagnostics.some((entry) => entry.stage === "geometry_validation" && entry.code === "relation_not_satisfied")).toBe(true)
  // 失败必须给一次性修复的机会（设计 §6），而不是直接死掉。
  expect(result.repair).toBeDefined()
})

it("rejects a plan that ignores a relation the prompt named (覆盖度)", () => {
  // 原话里有 ⊥ 与 ∥，计划一条关系都没声明。
  // 夹具直接复用上一条的 `plan`，只是把 `relations` 去掉。
  const { relations: _dropped, ...planWithoutRelations } = plan
  const result = compilePlan(planWithoutRelations, { ...context, prompt: "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD" })
  expect(result.ok).toBe(false)
  expect(result.diagnostics.some((entry) => entry.code === "relation_not_declared")).toBe(true)
})

it("leaves plans without relations exactly as they are today (回归底线)", () => {
  // 同一份计划，去掉 relations 字段 → 行为必须与今天逐字相同。
  const withRelations = compilePlan(plan, context)
  const without = compilePlan({ ...plan, relations: undefined }, context)
  expect(without.diagnostics.map((entry) => entry.code)).not.toContain("relation_not_satisfied")
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `npx vitest run packages/agent-core/src/planCompiler.test.ts -t "relation"`
Expected: FAIL —— 没有任何 `relation_not_satisfied` / `relation_not_declared` 诊断。

- [ ] **Step 3: 写最小实现**

在 `planCompiler.ts` 里加一个与 `validateGeometry`（`:461`）/ `verifyExplicitCubeRequest`（`:578`）**同形状**的函数，并在 `compilePlan` 的 `:244` 循环之后调用它；诊断 stage 用既有的 `"geometry_validation"`：

```ts
/**
 * **关系核验**（设计 §5.3/§5.5）：题目显式给出的几何关系，必须在**执行之前**逐条成立。
 *
 * 与 `validateGeometry`（`:461`）是同一类东西 —— 都是"这批动作产出的几何对不对"，
 * 所以 stage 同样用 `geometry_validation`，并复用一次性修复回路。
 *
 * 两件事，顺序不能反：
 * ① **覆盖度**：原话点名了 ⊥/∥/共面 而计划一条都没声明 → `relation_not_declared`；
 * ② **残差**：声明了的每条关系，用 `relations.ts` 的判据逐条算。
 */
function validateRelations(plan: PlanEnvelope, prompt: string | undefined): { diagnostics: PlanDiagnostic[]; failures: RelationFailure[] } {
  const diagnostics: PlanDiagnostic[] = []
  const declared = (plan.kind === "plan" && plan.relations) ? plan.relations : []
  // ① 覆盖度只在原话给得出时才查（没有 prompt 就不查，避免把"没原话"误判成"漏声明"）。
  if (prompt !== undefined) {
    const missing = missingRelationKinds(prompt, declared)
    for (const kind of missing) {
      diagnostics.push(planDiagnostic("geometry_validation", "relation_not_declared", "envelope.relations", `题目里出现了「${kind}」，但计划没有声明这条关系。`))
    }
  }
  if (declared.length === 0) return { diagnostics, failures: [] }
  // ② 残差：顶点按 `solid.create_polyhedron` 的 inputs 读出来。
  const vertices = collectPolyhedronVertices(plan)
  const byName = new Map(vertices.map((entry) => [entry.name, entry.position]))
  const check = verifyRelations(declared, (target) => byName.get(target.vertex) ?? null)
  for (const failure of check.failures) {
    diagnostics.push(planDiagnostic("geometry_validation", "relation_not_satisfied", `envelope.relations`, `关系 ${failure.id}（${failure.kind}）不成立：${failure.detail}`))
  }
  return { diagnostics, failures: check.failures }
}
```

**顶点名下标的约定（控制器预检裁定，2026-10-03）**：`solid.create_polyhedron` 的 `inputs`
今天**没有顶点名字段**，而 T4 的 `PolyhedronWitness.names` 是模型给的 —— 两处接口不闭合。
本批**统一采用下标约定**：关系表里 `targets[].vertex` 写 `v0`、`v1`…（`vertices` 的下标），
判据侧不去猜中文点名。给 `create_polyhedron` 增加可选 `vertexNames` 字段**留作后续**
（那要动 DSL schema 与 `.mgeo` 往返，是另一个量级）。取不到顶点时 `verifyRelations` 报
`relation_not_satisfied`（**不是静默通过**），下一轮可修。

`repair` 的构造沿用既有的 `repairRequestFor(toParseErrors(diagnostics), 1)`（`:219` 的同一写法），`allowedChanges` 指到 `envelope.relations` 与相关 `inputs`。

- [ ] **Step 4: 跑测试看它绿**

Run: `npx vitest run packages/agent-core/src/planCompiler.test.ts`
Expected: PASS，且既有用例**一条都没变**。

- [ ] **Step 5: 跑全库单测（`relations` 缺省行为不能有任何回归）**

Run: `npm test`
Expected: 全绿。若既有用例红，**先查是不是 `relations` 缺省路径被动到了**，不要改既有期望值。

- [ ] **Step 6: 提交**

```bash
git add packages/agent-core/src/planCompiler.ts packages/agent-core/src/planCompiler.test.ts
git commit -m "feat(agent-core): 关系核验接进 planCompiler（覆盖度 + 残差，走一次性修复）"
```

---

## Task 6: 提示词 —— 解掉「不要编数值」与「先做别反问」的冲突

**Files:**
- Modify: `apps/web/src/agent/systemPrompt.ts:27`（版本号）、`:97`、`:192` 附近、`:260-263`
- Modify: `apps/web/src/agent/systemPrompt.test.ts`

- [ ] **Step 1: 写失败测试**

在 `systemPrompt.test.ts` 里加：

```ts
it("tells the model to answer a stated relation with a concrete witness instead of inventing numbers or asking back", () => {
  const policy = buildPolicyText({ channel: "strict_json", canPlan: true, actionIds: ["solid.create_polyhedron"] })
  // 实施时把下面两条替换成对**你实际写下的那句文案**的逐字断言（改文案就要改断言）。
  // 现在只钉住"提示词里必须出现这两件事"，它们是新口径的载荷：
  expect(policy).toContain("relations")
  // 覆盖度只查"有没有回应"，系统不做自然语言抽取 —— 这条必须写进提示词。
  expect(policy).toContain("声明")
})

it("keeps the symbolic-parameter rule for arbitrary/constant requests unchanged", () => {
  const policy = buildPolicyText({ channel: "strict_json", canPlan: true, actionIds: [] })
  // 这条**一字不动**（设计 §5.4）：改它就会把不变量题做成数值例子。
  expect(policy).toContain("必须保留符号参数")
})

it("bumps the prompt version because the content changed", () => {
  // `systemPrompt.ts:26` 的注释规定"改内容就要改它"。
  expect(SYSTEM_PROMPT_VERSION).not.toBe("mathcanvas.agent.prompt.v6")
})
```

- [ ] **Step 2: 跑测试看它红**

Run: `npx vitest run apps/web/src/agent/systemPrompt.test.ts`
Expected: FAIL（版本号那条必然红）。

- [ ] **Step 3: 改提示词**

1. `SYSTEM_PROMPT_VERSION`（`:27`）`"mathcanvas.agent.prompt.v6"` → `"mathcanvas.agent.prompt.v7"`。
2. `outputShapes` 里 `:97` 那句「澄清（信息不足时用它，**不要编数值**）」改为按新口径的表述，明确**两种情形**：
   - 题面给了**固定图形**、只是没给数值，且题面关系可以满足 → **给一组满足全部关系的见证**，并把每个自选的数写进 `assumptions`；**不要**反问；
   - 题面在要求**任意 / 恒定 / 定值** → **保留符号参数**（这条一字不动）；关系确实无法满足 → 才反问。
3. 在 `canPlan` 那一段（`:260-263`「## 先做，别反问」）补一节**关系声明**的要求，逐条写清：
   - 计划里用 `relations` 表**逐条声明**题面给出的关系（⊥ / ∥ / 共面 / 等长 / 比例 / 中点）；
   - **题面出现的关系一条都不能漏**：系统会拿原话里的关键词与你声明的表对照，漏了会被拒；
   - 但系统**不会**替你从自然语言里抠关系 —— 覆盖度只查"有没有回应"；
   - 目标按**顶点**给出（第一批只支持顶点）。
4. 在 `:231` 那条"能造的立体"附近补一条**四棱锥 P-ABCD 正例**（现有正例里没有这类"只有关系没有数"的形状），形状照 `:231`/`:239` 的写法。

- [ ] **Step 4: 跑测试看它绿**

Run: `npx vitest run apps/web/src/agent/systemPrompt.test.ts`
Expected: PASS。

- [ ] **Step 5: 门禁三连**

Run: `npm run typecheck`
Expected: exit 0。
Run: `npm run lint`
Expected: exit 0（0 error；warning 数不超过既有基线 13）。
Run: `npm test`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/agent/systemPrompt.ts apps/web/src/agent/systemPrompt.test.ts
git commit -m "feat(web): 提示词 v7 —— 关系声明与见证补值口径，符号保留规则不动"
```

---

## Task 7: 端到端跑通报障那一道 + 文档收口

**Files:**
- Modify: `apps/web/src/agent/representativeFixtures.ts`（加一条四棱锥夹具）与其测试
- Modify: `docs/current-status.md` / `docs/feature-catalog.md` / `CHANGELOG.md` / 本计划与设计的状态行

- [ ] **Step 1: 加一条代表题夹具（用户报障的原句）**

在 `representativeFixtures.ts` 里按既有夹具的形状加一条：题面用**用户原话**「在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱锥」，期望是有 witness、关系逐条成立、`assumptions` 里能看到每个自选的数。

- [ ] **Step 2: 跑它**

Run: `npx vitest run apps/web/src/agent/representativeFixtures.test.ts`
Expected: PASS。

- [ ] **Step 3: 全量门禁**

Run: `npm test`
Expected: 全绿（当次读数据实填进本计划与 `docs/current-status.md`）。
Run: `npm run typecheck` / `npm run lint`
Expected: exit 0 / 0 error。

- [ ] **Step 4: 文档收口**

- `docs/current-status.md`：按既有惯例补当次读数（不把历史数字当现值）。
- `docs/feature-catalog.md`：把"只有关系没有数值的立体题面"从"未交付"里划掉。
- `CHANGELOG.md`：加一节，写清**为什么值得单列**（这是用户现场报障）。
- 本计划的标题状态行与设计的状态行：改为"已实现"。
- `docs/superpowers/specs/2026-10-03-...-design.md` 的状态行同步。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "docs: 欠定图形见证与关系核验收口（含用户报障那句代表题）"
```

---

## 执行前的范围裁定（2026-10-03，控制器预检扫描时发现）

**Task 4 的 `polyhedron` 见证族在本批里没有产品调用点**，如实记下来，避免读成"它修好了用户的报障"：

- `selectWitness` 的非测试调用点**只有一处** —— `packages/agent-core/src/parameterAudit.ts:125`，
  而它只请求 `triangle` / `prism` 这几个既有族。**没有任何产品路径会请求 `polyhedron` 族。**
- 用户报障那条路的真实链路是：模型产出 `solid.create_polyhedron` 动作 → 参数审计
  （`vertices` / `faces` 必填、零默认，审计只做引用解析）→ **`compilePlan` 里的关系核验**。
  所以**真正解掉报障的是 Task 5**（外加 Task 2 / 3 的判据与 Task 6 的提示词）。
- **裁定**：Task 4 照计划实现（它是新增的导出能力 + 单测，零风险），但**它的存在价值是
  "为第二批（平面）与将来的"系统自己挑特值"留接口"，不是本批的验收依据**。Task 4 的实现里
  必须写明这一点；最终全分支复核要按"新增导出、暂无产品调用点"来审，不许算进本批的收益。
- 为什么不在写计划时就发现：`selectWitness` 只在 `parameterAudit` 里被调这件事，
  是预检扫描（跨 Task 的文件/接口对照）才查出来的，不是读单个 Task 能看出来的。

## 计划的自我复核

- **每层的判据都有真源**：关系残差在 `relations.ts`（Task 2），覆盖度也在它（Task 3），都**不重写**。
- **不动的三样**：`isInvariantRequest` 的符号优先顺序、`systemPrompt.ts:192` 的符号保留口径、本地确定性规划器。
- **回归底线写成了测试**：`relations` 缺省时行为与今天逐字相同（Task 5 Step 1 第三条 + Step 5 全库单测）。
- **未知项前置**：`relations` 字段能不能进信封是 Task 1 的实测，不是假设。
- **诚实缺口**：Task 2 的"与内核同源核对"与 Task 5 的"顶点名从哪来"两处，实施时必须把**选定的那一种**写进代码注释与用例里，不许含糊过去。
