# 立体图形覆盖扩宽设计（形状数据化）

> **状态：2026-10-06 设计已获批，尚未实施。** 本文取代「V0a 只支持受限三棱锥」这一形状边界，
> 但**不取消** [V0a 的未完成项](../plans/2026-10-06-diagram-agent-auto-lean-implementation-plan.md)
>（浏览器逐点坐标回代、截图目检、全量回归）。两者是同一件事的两面：V0a 收口把**一条**路径做真，
> 本文把**这条路径变成能长大**的结构。实施计划见 `docs/superpowers/plans/` 下对应文件。

## 理解写回（先确认目标，再谈做法）

**用户要的结果**：Agent 现在**只会画三棱锥**（而且只在默认关闭的开关后、只认一句固定句式）。
要让它能处理**大部分立体图形的题**，并且画出来的图有逐条题设核验，不是"能画但没验"。

**为谁**：高中学生与教师。他们要的是"我说一句题，画布上出现一张符合题意的图"，
不是"我说一句题，系统告诉我它只认识三棱锥"。

**成功标准**（可测）：
1. 四族形状——**棱锥（任意 3–6 边底面）／棱柱（任意底面 + 带撇顶面）／台体（棱台、圆台）／球与多面体的内切外接关系**——
   各有单元正反例、浏览器正例（读文档里**真实提交的坐标**独立回代题设）与浏览器反例。
2. 入口能接住常见自然语言说法（"底面是菱形、侧棱垂直底面的四棱柱"），**认不出就问路，不编**。
3. 全量非 Lean 单测与全量 e2e 全绿；关开关时旧路径**逐字不变**且有判据钉住。
4. 每个新形状至少一次**变异验证**（把判据破坏掉，看该红的是不是真红）。

**不是**"支持所有立体图形"。见文末「明确不做」。

## 一、现状事实（读代码得出，不是推断）

| 事实 | 位置 |
| --- | --- |
| 见证搜索只认 `shape: "pyramid"`，棱柱走进去被**明确拒绝** | `packages/agent-core/src/solver/witnessSearch.ts`（`searchWitness` 的 `input.shape !== "pyramid"` 分支） |
| 内核构造器支持棱锥与棱柱，但底面只收 **3 或 4** 个点名顶点，四边形还要求直角在**环首** | `packages/geometry-kernel/src/witness/constructors.ts`（`deriveBasePolygon`） |
| 核验器的点名映射只接受 `/^[A-Z]$/`，而内核棱柱顶面点名写作 `A′` | `packages/agent-core/src/diagramVerification.ts`（`candidatePoints`） |
| 解析层**根本不匹配**带撇/带下标的点名：`AA₁`、`AA1`、`AA′` 三种写法下，`AA₁⊥平面ABCD` 都**一条 given 都产不出**，只作为 `unverified` 残留显形 | `packages/agent-core/src/diagramObligations.ts`（`names` = `[...value]` 与 `[A-Z]{2}` 片段） |
| 原文题设核验**只在** `solid.create_polyhedron` 后触发 | `packages/agent-core/src/planCompiler.ts:418` |
| 圆柱/圆锥**已有模板实体**（DSL 图元 + `buildSolidTemplate` + `solid.create_template`） | `packages/dsl/src/schema.ts`、`packages/geometry-kernel/src/solid-builders.ts`、`packages/agent-core/src/actionRegistry.ts` |
| 内核**已有** `solveCircumsphere3` / `solveInsphere3`，`sceneObservation` 已在给多面体报外接球/内切球读数 | `packages/geometry-kernel/src/solidDerived.ts`、`packages/agent-core/src/sceneObservation.ts` |
| DSL 的实体类型里**没有台体** | `packages/dsl/src/schema.ts`（`solidTypes` = cube/pyramid/cylinder/cone/polyhedron3/sphere） |
| Agent 入口只认一句固定句式，且藏在默认关闭的开关后 | `apps/web/src/agent/localPlanner.ts`（`freeApexIntentFor`）、`apps/web/src/agent/featureFlags.ts` |

### 1.1 已实测核对（2026-10-06，一次性探针，跑完即删）

上面那张表里有一条**我原先写错了**，探针纠回来，记在这里以免下次又照错的写：

| 喂进去的东西 | 实测结果 |
| --- | --- |
| `在三棱柱ABCD-A₁B₁C₁D₁中，AA₁⊥平面ABCD` | `givens: []`，残留 `["AA₁⊥平面ABCD"]` → **一条给定都产不出** |
| `在三棱柱ABCD-A1B1C1D1中，AA1⊥平面ABCD` | 同上（`givens: []`） |
| `在三棱柱ABCD-A′B′C′D′中，AA′⊥平面ABCD` | 同上（`givens: []`） |
| `searchWitness({ shape: "prism", … })` | `unverified_instance` / `unsupported-shape`，`candidates=0` |
| `constructWitnessShape` 五边形底面 | `rejected` / `unsupported-base-shape`：`"首批只支持三 / 四边形的底面，收到 5 个顶点。"` |

**我原先写的"`AA₁` 被压成两个 `A`、重名后被丢弃"是错的。** 真实行为是**根本不匹配**，
而那条条件作为 `unverified` 残留**如实显形**了 —— 这是 fail-closed，比"悄悄压成一个字母"好。
`witnessSearch.ts` 那句代码注释（"经原话解析会压成单个大写字母"）也不准确，
S3 动到那个分支时一并改正。

**这条纠错本身也是一条证据**：把设计建在"代码注释说了什么"上是不够的，注释也会说错。
所以 §四 每一块的出口都要求跑出真实读数，而不是引用注释。

**"只会三棱锥"的成因**：加一种形状要同时改**四处**——入口句式表、搜索层 `derivePyramidStructure`、
内核 `deriveBasePolygon`、核验器点名契约。四处各写一份判断，任一处漏改就不通
（棱柱现在就卡在"解析层产不出带撇点名"与"核验器只认单字母"这两处）。

## 二、已裁决的决策（用户四次裁决，记录在案）

| # | 决策 | 用户的裁决 |
| --- | --- | --- |
| 1 | 首批形状范围 | **只做立体几何**：棱锥（任意 3–6 边底面）、棱柱（任意底面 + `A′` 带撇顶面）、台体（棱台/圆台）、球与多面体的内切/外接关系。**不做**正多面体；圆柱/圆锥不作为独立诉求，只作圆台的前置 |
| 2 | 入口这一层做到什么程度 | **本地解析器扩宽到常见自然语言说法**；不依赖模型、不上网；认不出就问路 |
| 3 | 默认行为 | **先沿用现有开关**（设置 → 实验性功能 → 示意图见证搜索，默认关）；四类形状全部通过后再单独决定何时默认开 |
| 4 | 落地结构 | **方案 B：形状数据化**，四层共用一份 `SolidShapeSpec`，而不是继续逐个形状加构造分支 |

## 三、架构：一份描述，四层共读

### 3.1 `SolidShapeSpec`

放在 `geometry-kernel`（它是四层共用的词汇，且 agent-core 已依赖 kernel）：

```ts
export type SolidShapeFamily = "pyramid" | "prism" | "frustum" | "sphere-relation"

/** 题面没给、由搜索层在**固定小整数网格**上决定的标量。 */
export interface FreeScalar {
  /** 机器可读 id，会原样进 assumptions 给用户看。 */
  id: string
  kind: "base-edge" | "base-angle" | "height" | "top-scale" | "radius"
  /** 这个标量作用在哪些点名上（例如 ["A","B"]）。 */
  targets: string[]
  /** 候选值表：固定的小整数/小角度，**无连续优化、无 RNG**（沿用既有口径）。 */
  candidates: number[]
}

export interface SolidShapeSpec {
  family: SolidShapeFamily
  /** 底面环，按题面点名顺序。 */
  base: string[]
  /** 棱锥：顶点与垂足。 */
  apex?: { at: string; foot?: string }
  /** 棱柱 / 台体：顶面环。 */
  top?: string[]
  /** 已解析的题设关系（与既有 `WitnessRelation` 同一套，扩到 n 边与台体）。 */
  relations: WitnessRelation[]
  freeScalars: FreeScalar[]
}
```

**YAGNI 约束（写死在这里，防止"以后可能用得上"膨胀）**：只含首批四族真的用得到的字段。
新增一个 `kind` 是内核局部改动；新增一个顶层字段必须先有一次对应的形状块落地。

### 3.2 四层职责与"加一种形状"的代价

| 层 | 文件 | 职责 | 加新形状时 |
| --- | --- | --- | --- |
| 入口 | `packages/agent-core/src/solver/shapeGrammar.ts`（新）+ `apps/web/src/agent/localPlanner.ts` | 自然语言 → `SolidShapeSpec`；认不出返回 `null`，由规划器问路 | 加一条句式规则 |
| 搜索 | `packages/agent-core/src/solver/witnessSearch.ts` | spec → 候选池；自由标量**从 spec 读**，不再是写死的"两条底边 + 高" | 不改 |
| 内核 | `packages/geometry-kernel/src/witness/constructors.ts` | spec + 具体自由标量值 → 坐标 + 面环（纯函数、确定性、拒绝是值） | 只在几何真的新时加一个分支 |
| 核验 | `packages/agent-core/src/diagramVerification.ts` | 按**同一份点名表**逐条核验题设 | 不改 |

**入口语法归属 agent-core，不留在 apps/web**：离线本地规划器与离线 benchmark 的见证层
（`searchWitnessForPrompt`）必须共用同一份解析，否则两个读数不可比 —— 这正是本仓
"同一个判断不许写两遍"的同一条账。`localPlanner.freeApexIntentFor` 的窄正则被它取代。

### 3.3 最关键的接缝：点名语法只有一处

现在内核产出 `A′`、核验器只认 `/^[A-Z]$/`、解析器用 `[...value]` 拆字 —— 三处各写一份判断。
设计里抽成一个共用模块，落点 **`packages/geometry-kernel/src/pointNames.ts`**：
**必须放最底层**，因为三处调用方里有一处是内核自己（顶面命名），而内核不能反向依赖 agent-core。
agent-core 按既有方式从 `@draw/geometry-kernel` 引入。

```ts
/** 点名 = 一个大写字母 + 可选的撇或下标。 */
export const POINT_NAME_SOURCE = "[A-Z](?:[′']|[₁₂₃₄₅₆])?"
export function isPointName(value: string): boolean
/** 把 `A′B` 这样连写的点名串拆成 ["A′", "B"]。`[...value]` 做不到这件事。 */
export function splitPointNames(value: string): string[]
```

**三处都调它**：解析器的 `names()`、核验器的 `candidatePoints`、内核的顶面命名。
判据：把 `isPointName` 改回 `/^[A-Z]$/` ⇒ 棱柱与带撇点名的用例必须**变红**。

## 四、分块实施（每块 RED → GREEN → 定向 + 浏览器真验 → 更新文档 → 单独 commit/push）

| 块 | 内容 | 出口证据 |
| --- | --- | --- |
| **S1** | **接缝先行**：新增点名模块，解析器 `names()` 改用它，核验器 `candidatePoints` 与标签扫描改用它，让带撇/带下标点名在**解析**与**核验**两侧都成立 | 单元正反例；变异（把 `isPointName` 改回 `/^[A-Z]$/` ⇒ 红）；**现有形状行为逐字不变**（快照 + 171 条定向） |
| **S2** | `SolidShapeSpec` 骨架 + **棱锥路径迁移**：`derivePyramidStructure` 改为产出 spec，四层改读 spec；内核 `deriveBasePolygon` 支持 n=3–6 | 现有 171 条定向与新 spec 3/3 **逐字不变**；新增 4/5/6 边底面正例；一条"无判据条件 ⇒ unverified"反例 |
| **S3** | **棱柱**：解开 `searchWitness` 对 `prism` 的两条依赖（解析层区分 `A′`、核验器点名契约已在 S1 解开）；支持斜棱柱、正棱柱、任意 n 边底面 | 斜棱柱/正棱柱/菱形底面/正六边形底面正反例；关开关旧路径不变 |
| **S4** | **台体**：棱台与圆台走 `polyhedron3`（底环 + 顶环），**不新增 DSL 图元**；如实声明圆台是多边形近似 | 正例 + 明确拒绝"上下底关系说不清"的题面；文档里写明近似口径 |
| **S5** | **球与多面体的内切/外接关系**：复用 `solveCircumsphere3` / `solveInsphere3`，把读数落成文档里的球并核验题设 | 见 §4.1 的额外约束；外接球核验"到各顶点等距"、内切球核验"到各面相切" |
| **S6** | **入口语法收口**：`shapeGrammar` 覆盖四族的常见说法；认不出与认得出两类反例齐全 | 正反例表；"认不出一律问路、不改文档"的浏览器判据 |

### 4.1 S5 的额外约束（这一块风险最高，单列）

球是**派生量**：它由多面体算出来。若只是把球**物化**进文档，多面体一移动，球就成了过期数据 ——
那正是本仓最忌讳的"看起来算过"。

**裁决：走派生绑定 + 重算路径**，因为仓库里已经有一整套现成机制，不需要新发明：

- `packages/scene-graph/src/recompute.ts` 的 `recomputeDerivedObjects(document, changedIds)` 是
  "改了一处之后把该跟着变的对象按拓扑序重算一遍"的**唯一入口**；
- 依赖边由 `packages/scene-graph/src/graph.ts` 的 `primitiveDependencies` / `getAffectedPrimitiveIds` 提供；
- 同类先例是 `circle3`（轨道圆）、`section`（截面）、`intersection*` 一族，
  它们都由"源实体变了 ⇒ 自己重算"这条路维护。

所以 S5 的落点是：新增一个**派生球**（由源多面体的顶点解外接球、或由各面解内切球），
把它接进依赖图与 `recomputeDerivedObjects`，并核验题设。**"物化但不重算"这一条被否决**，
理由就是上面那句：它会静默过期。

解不出来时（`solveCircumsphere3` / `solveInsphere3` 返回非 `exact`）**如实报"没有外接球/内切球"**，
不编一个球 —— 这两条读数 `sceneObservation` 已经在报，新路径沿用同一份结论。

## 五、错误处理（三条硬规则，扩到新形状）

1. **读不出判据的条件进 `unverified`**：题面里任何一条我们判不了的条件，必须在图上如实提示，
   **不许静默升级为通过**。现有 `diagramVerification` 的 `unverified` 通道原样继承。
2. **构造不出来就明确拒绝**：给出机器可读 `code` + 人话理由，**绝不换一个题面没说的形状**。
   这是"特值化悄悄改题"的老毛病，写在各构造器文件头。
3. **开关关着旧路径逐字不变**：每个块都要有"关着时行为不变"的判据，不是靠"我觉得没影响"。

## 六、测试策略

- **内核构造器**：确定性用例（同输入连跑 N 次逐字节相同）；结构化拒绝的 `code` 逐条点名。
- **每块浏览器正例**：读文档里**真实提交的坐标**（`.mgeo` 草稿 / 导出的文档），
  在测试里**独立回代**题设（例如自己算 `AD · (AB × AC) ≈ 0`），不读系统自报的结论。
- **每块浏览器反例**：错参数必须拒绝，且**不占撤销历史**、草稿坐标逐字未变。
- **变异验证**：每块至少一次"把判据破坏掉，看该红的是不是真红"。
- **全量回归**：非 Lean 全量单测 + 全量 e2e。**本设计定稿时（`3968a99`）的实测基线**是：

  | 命令 | 读数 | 退出码 |
  | --- | --- | --- |
  | `npm.cmd exec vitest run -- --exclude scripts/proof-spike/lean4EndToEnd.test.ts --maxWorkers=2 --reporter=dot` | **328 文件 / 3831 通过 + 1 todo / 0 失败**（115.32 s） | 0 |
  | `npm.cmd run test:e2e` | **199 通过 / 0 失败**（1.1 m） | 0 |

  这两个数与 `current-status.md` 里记的 325 文件 / 3769、e2e 196 **不一样**，
  因为那两条是更早时刻的读数、之后合并进了 curriculum / benchmark / lean4 那几批提交。
  **每块收口都重跑并如实报当次数**，不沿用任何历史数字（包括本节这两个）。

## 七、明确不做（写进文档，避免"没说不算不做"）

- 正十二面体 / 正二十面体（高中几乎不考）。
- 圆柱 / 圆锥作为**独立诉求**（只作为圆台的前置顺带做掉）。
- 椭球、双曲面等任意曲面。
- 题目截图识图、GeoGebra `.ggb` 互操作。
- 平面图形与圆锥曲线、函数图像与导数切线：**本次不做**（用户明确只选了立体几何），
  但它们应当能复用本文的 `SolidShapeSpec` 思路 —— 那是另一份 spec 的事。

## 八、风险与回退

| 风险 | 回退办法 |
| --- | --- |
| S2 迁移改坏现有棱锥路径 | S1、S2 各自独立 commit；S2 的验收口径是"现有 171 条定向 + 新 spec 3/3 逐字不变"，变一条就回退该 commit |
| "形状数据化"过度设计 | §3.1 的 YAGNI 约束：只含首批四族真的用得到的字段 |
| S5 的派生球做成"过期数据" | §4.1 已裁决走 `recomputeDerivedObjects` 的派生重算路线；若该路径接不进去，**停下报告**，不改走物化 |
| 入口语法扩宽后误认（把分析题当作图题） | 沿用既有 `isAnalysisQuestion` 纪律；"认不出就问路"优先于"多认一句" |
