# 立体图形覆盖扩宽实施计划（形状数据化）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 每个任务都是 `- [ ]` 复选框、RED→GREEN、可独立复核的提交；**不要**擅自派生子智能体。
> **状态（2026-10-07）**：设计已获用户裁决（见 Spec），**尚未实施任何产品代码**。本文件是它的实施计划；写本文件时**没有**改动产品代码。
> **本仓约定**：计划放在 `docs/superpowers/plans/`（不是 skill 默认的 `docs/plans/`），因为设计、追踪表与门禁文档都按这个路径互相引用；工作直接在 `main` 上按块提交（本仓不用 worktree，见追踪表的更新纪律）。

**Goal:** 让 Agent 能画**大部分高中立体图形**（棱锥任意 3–6 边底面 / 棱柱任意底面 + 带撇顶面 / 台体 / 球与多面体的内切外接关系），且每张图都逐条核验题设；把"加一种形状要改四处"改成"加一种形状只加一条句式规则"。

**Architecture:** 四层共用一份 `SolidShapeSpec`（入口语法 → 候选池 → 内核构造 → 题设核验）；点名语法抽成内核底层的 `pointNames` 单一来源；内核构造器保持纯函数、确定性、拒绝即以值表达；球走**派生绑定 + `recomputeDerivedObjects` 重算**，不物化。

**Tech Stack:** TypeScript、geometry-kernel、scene-graph、agent-core、Vitest、Playwright、React（apps/web 入口层）。

**Spec:** [立体图形覆盖扩宽设计](../specs/2026-10-06-solid-shape-coverage-design.md)（四族范围、四层架构、S1–S6、明确不做、回退办法）。**残余风险与当前读数：** [当前状态](../../current-status.md) §一、[下一轮追踪](../../agent-next-round-progress.md)。

## Global Constraints

- **读不出判据的条件进 `unverified`**：任何判不了的条件必须在图上如实提示，**不许静默升级为通过**。
- **构造不出来就明确拒绝**：给机器可读 `code` + 人话理由，**绝不换一个题面没说的形状**（"特值化悄悄改题"的老毛病）。
- **开关关着时旧路径逐字不变**：每块都要有判据钉住，不是靠"我觉得没影响"。当前受保护的具体契约是 `planCompiler.offPath.golden.test.ts`（关旗逐字节相同）。
- **每块收口流程**：RED 要有**行为**失败证据（文件不存在/权限报错不算）→ 最小 GREEN → 定向 + 全库非 Lean + 全量 e2e → 浏览器真实坐标独立回代 → **变异验证**（把判据破坏掉，看该红的是真红）→ 同步 `current-status` / `agent-next-round-progress` / `feature-catalog` / `project-progress` / `README` 相应处 → 单独 commit + push + `git ls-remote` 核对远端 SHA。
- **不沿用任何历史读数**（包括本文件的基线），每块收口重测并报当次数。
- **付费 provider 与 Lean 真运行不在本计划内**；自动 Lean 是 V2 的事。

## 起点基线（2026-10-07 实测；仅作起点）

| 命令 | 读数 | 退出码 |
| --- | --- | --- |
| `npm.cmd exec vitest run -- --exclude scripts/proof-spike/lean4EndToEnd.test.ts --maxWorkers=2 --reporter=dot` | 330 文件 / 3878 通过 + 1 todo / 0 失败（146.74 s） | 0 |
| `npm.cmd run test:e2e` | 207 通过 / 0 失败（1.8 m） | 0 |
| `npm.cmd run typecheck` / `npm.cmd run lint` | exit 0 / 0 error · 13 warning | 0 |

## 文件职责与真实调用点（2026-10-07 逐条 `Test-Path` 核过）

| 文件/模块 | 责任与边界 | 本计划的测试/调用点 |
| --- | --- | --- |
| `packages/geometry-kernel/src/pointNames.ts`（**新建**） | 点名语法的**唯一**来源：一个大写字母 + 可选撇或下标；`isPointName` / `splitPointNames`。放最底层，因为内核自己（顶面命名）也要用，内核不能反向依赖 agent-core | `packages/geometry-kernel/src/pointNames.test.ts`（新建） |
| `packages/agent-core/src/diagramObligations.ts` | 原文 → given；现在的 `names()` 用 `[...value]` 拆字，带撇/带下标点名**根本不匹配** | `diagramObligations.test.ts` |
| `packages/agent-core/src/diagramVerification.ts` | 题设核验；`candidatePoints` 的点名映射现在只收 `/^[A-Z]$/` | `diagramVerification.test.ts` |
| `packages/geometry-kernel/src/witness/constructors.ts` | spec + 具体自由标量 → 坐标与面环；`deriveBasePolygon` 现在只收 3/4 边、四边形还要求直角在环首 | `packages/geometry-kernel/src/witness/constructors.test.ts` |
| `packages/agent-core/src/solver/witnessSearch.ts` | spec → 候选池；现在只认 `shape: "pyramid"`，棱柱被明确拒绝 | `packages/agent-core/src/solver/witnessSearch.test.ts` |
| `packages/agent-core/src/solver/shapeGrammar.ts`（**新建**） | 自然语言 → `SolidShapeSpec`；认不出返回 `null`（由规划器问路）。**必须放 agent-core**：离线本地规划器与离线 benchmark 的见证层要共用同一份解析 | 新建 `shapeGrammar.test.ts`；`apps/web/src/agent/localPlanner.test.ts` |
| `apps/web/src/agent/localPlanner.ts` | 入口接线；`freeApexIntentFor` 的窄正则被 `shapeGrammar` 取代 | `localPlanner.test.ts` + 浏览器 |
| `packages/scene-graph/src/recompute.ts`、`graph.ts` | 派生对象的**唯一**重算入口与依赖边 | S5 的 `recompute` 用例 |
| `packages/geometry-kernel/src/solidDerived.ts` | 已有 `solveCircumsphere3` / `solveInsphere3`（球关系复用，不新造求解器） | S5 用例 |
| `packages/dsl/src/schema.ts` | 实体类型（`cube/pyramid/cylinder/cone/polyhedron3/sphere`，**无台体**） | S4 走 `polyhedron3`，不新增图元 |

---

## S1：点名语法收口（接缝先行）

**为什么先做这块**：棱柱唯一的硬阻塞是"解析层产不出带撇点名"（已实测：`AA₁⊥平面ABCD` 三种写法都 `givens: []`）。先把点名语法收成一处，S3 才不是"在三处各打一个补丁"。

**出口**：带撇/带下标点名在**解析**与**核验**两侧都成立；**现有形状行为逐字不变**；变异（把 `isPointName` 改回 `/^[A-Z]$/`）必定变红。

- [ ] **Task 1.1 新建点名模块 + 行为 RED**
  - 文件：新建 `packages/geometry-kernel/src/pointNames.ts`、新建 `packages/geometry-kernel/src/pointNames.test.ts`
  - Step 1 写失败用例（`pointNames.test.ts`）：
    ```ts
    expect(splitPointNames("A′B")).toEqual(["A′", "B"])
    expect(splitPointNames("AA₁")).toEqual(["A", "A₁"])
    expect(isPointName("A₁")).toBe(true)
    expect(isPointName("A′")).toBe(true)
    expect(isPointName("A'")).toBe(true)
    expect(isPointName("AB")).toBe(false)
    expect(isPointName("A1")).toBe(false)   // ASCII 下标不是本仓的点名写法
    ```
  - Step 2 先按**今天的行为**写最小实现（`splitPointNames` 用 `[...value]`），让 RED 是**断言失败**而不是"模块不存在"：
    Run: `npm.cmd exec vitest run -- packages/geometry-kernel/src/pointNames.test.ts --reporter=dot`
    Expected: FAIL —— `splitPointNames("A′B")` 实收 `["A", "′", "B"]`（这正是 `diagramObligations.names()` 今天的行为）
  - Step 3 最小 GREEN：导出 `POINT_NAME_SOURCE = "[A-Z](?:[′']|[₁₂₃₄₅₆])?"`、`isPointName`（整串匹配）、`splitPointNames`（按该模式逐个取，不按码位切）
    Run: 同上 → PASS
  - Step 4 提交：`feat(agent): give point names one definition instead of three`

- [ ] **Task 1.2 解析器改用点名模块**
  - 文件：`packages/agent-core/src/diagramObligations.ts`（`names()` / `[A-Z]{2}` 片段）、`packages/agent-core/src/diagramObligations.test.ts`
  - RED 用例（**先写用例，跑出 `givens: []`，再改实现**）：`在三棱柱ABCD-A₁B₁C₁D₁中，AA₁⊥平面ABCD` 必须产出 1 条 given；`AA′` / `AA1` 两种写法各一条
    Run: `npm.cmd exec vitest run -- packages/agent-core/src/diagramObligations.test.ts --reporter=dot`
    Expected RED: 三条都实收 `givens: []`、`unverified` 残留 `["AA₁⊥平面ABCD"]`（与设计 §1.1 实测一致）
  - GREEN 后补**反例**：`isPointName("A1") === false` 那类写法仍走 `unverified`，**不许**被凑合解析成 `A₁`
  - 顺带改正 `witnessSearch.ts` 里那句不准确的注释（"经原话解析会压成单个大写字母"）—— 实测是**不匹配**，S3 会动到那个分支

- [ ] **Task 1.3 核验器点名映射改用点名模块**
  - 文件：`packages/agent-core/src/diagramVerification.ts`（`candidatePoints`）、`packages/agent-core/src/diagramVerification.test.ts`
  - RED：带 `A′` 的点名表此前映射不出来（`null` / 未核验），现在必须能映射并逐条核验
  - **不许顺手放宽**：映射不上时仍返回 `null` 表示"没有可靠映射"，与"点名表恰好是空的"保持今天的区分

- [x] **Task 1.4 内核顶面命名改用同一模块**（2026-10-07 完成）
  - 文件：`packages/geometry-kernel/src/witness/constructors.ts`（顶面命名处）
  - 判据：同一份词表被解析器、核验器、内核引用；内核产出的名字**逐个**满足共享定义（已有断言）。
  - **用户 2026-10-07 裁决：按扩语法处理** —— 底面已用 `A′` 时顶面叫 **`A′′`**（字母 + 至多两个后缀合法；三层不算）。
  - 落地：`derivedNameCandidates` 在词表内按"先一层、再两层"枚举；比较按 **规范字形**（`′` 与 `'` 归一）；**候选耗尽 ⇒ 明确拒绝**，不再造 `A′2` 这类词表外的名字。
  - 证据：端到端用例（底面自己带撇的棱柱 `A′B′C′-A′′B′′C′′`）`verified_instance`；变异（词表退回一层）⇒ **三层 4 条红**。

- [ ] **Task 1.5 逐字不变 + 定向回归 + 变异**
  - 定向（以**当次**实测为准，**不沿用**历史 171 条）：
    `npm.cmd exec vitest run -- packages/geometry-kernel/src/pointNames.test.ts packages/geometry-kernel/src/witness/constructors.test.ts packages/agent-core/src/diagramObligations.test.ts packages/agent-core/src/diagramVerification.test.ts packages/agent-core/src/planCompiler.test.ts apps/web/src/agent/draftStore.test.ts apps/web/src/agent/localPlanner.test.ts --reporter=dot`
  - 关旗逐字不变：`planCompiler.offPath.golden.test.ts` 必须仍逐字节相同
  - 全库非 Lean + `typecheck` + `lint`
  - **变异**：把 `POINT_NAME_SOURCE` 改回 `[A-Z]` ⇒ 带撇/带下标用例必须红；还原后复绿（**破坏性验证要保证改完仍能解析**，否则你看到的红是解析失败而不是判据命中）

- [ ] **Task 1.6 S1 收口**
  - 同步 `current-status` / `agent-next-round-progress`（S1 勾选与读数）/ `project-progress`（过程与失败尝试）
  - 单独 commit + push，`git ls-remote origin refs/heads/main` 与本地 HEAD 一致后才写"已上传"

---

## S2：`SolidShapeSpec` 骨架 + 棱锥路径迁移

**出口**：现有棱锥定向用例与新 spec 用例**逐字不变**地通过；新增 4/5/6 边底面正例；一条"无判据条件 ⇒ `unverified`"反例。**变一条就回退这一块。**

- [x] **Task 2.1 spec 类型 + 迁移 `derivePyramidStructure`**（2026-10-07 完成）
  - **载体**：`solidShapeSpec.ts`（类型 + YAGNI 注释，内核 barrel 导出）；搜索层候选池读 spec 的自由标量。
  - **内核侧（本批）**：新增 `constructShapeFromSpec(spec, choices)` —— "取值 → 内核请求"那张翻译表整体搬进内核（它整张都是内核词汇），编排层只交 spec + `ShapeScalarChoice[]`；未知 id 明确拒绝。
  - **编排层退场**：删掉 `requestFor` / `heightSpecFromSpec` / `statedLateralHeight` 与 `PyramidStructure.heightSpec`、`PrismStructure.statedHeight` 两个字段；`CandidatePlan` 改为"spec + 取值"。
  - **一处判断只写一遍**：内核导出 `shapeHeightIsFree(spec)`，"高是不是自由的"由它回答。
  - **判据**：自由标量从 spec 读（不再是写死的"两条底边 + 高"）✓；坐标护栏逐字通过 ✓；新用例钉住"spec + 取值与手工拼请求产出同一组坐标"与"未知 id 拒绝"。
  - **仍未做**：`derivePyramidStructure` 仍产出自己的结构再 `specFor` 成 spec（还差"直接产出 spec"这一跳，属收尾）。
- [x] **Task 2.2 内核 `deriveBasePolygon` 支持 n = 3–6**（2026-10-07 完成）
  - n = 5/6 走 `deriveRepresentativePolygon`（正 n 边形代表）；题面点名底面角度/平行、或给两个不同边长 ⇒ 仍拒绝（`unsupported-base-shape`）。
  - **接线也补上了**（原计划漏写这三道闸）：解析器平面子模式 3–6 点名、搜索层 `lineAndPlane` 5–8 targets、核验器线面判据按 3–6 点平面核共面。五棱锥/六棱锥现在端到端 `verified_instance`。
  - RED：`首批只支持三 / 四边形的底面，收到 5 个顶点。`；变异：短路"点名角度就拒绝" ⇒ 既有的五边形用例红（题面明说 `AB ⊥ AE` 却被画成正五边形）。
  - RED：五边形底面**今天**返回 `rejected` / `unsupported-base-shape`（设计 §1.1 已实测），新用例要求正例成立
  - 反例：n > 6 仍明确拒绝，且 `code` 逐条点名，**不换形状**
- [x] **Task 2.3 无判据条件反例**（2026-10-07 完成底面这一支）：题面含判不了/满足不了的条件 ⇒ **不给通过核验的候选**，且**说得出为什么**。实测：点名底面直角时候选池照常枚举 3 个、**每个都在构造期被拒**，理由带 `unsupported-base-shape` 与"满足不了它、不换一个题面没说的形状"。其余"读不出判据 ⇒ `unverified`"由既有 V0a 用例覆盖。
- [ ] **Task 2.4 收口**：全库 + e2e + 变异（把"自由标量从 spec 读"改回写死 ⇒ 新底面用例红），文档与 commit/push

---

## S3：棱柱

**出口**：斜棱柱 / 正棱柱 / 菱形底面 / 正六边形底面各有正反例；关开关旧路径不变。
**（2026-10-07 进度）**：正棱柱的底面已覆盖 **3–6 边**（六棱柱端到端 `verified_instance`；底面点名角度时拒绝）；**斜棱柱未做**（等"环外点名顶点"概念）、**菱形底面未做**（四边形现在只有"环首直角 ⇒ 矩形"一条路，菱形要"四边相等"这类约束的构造）。

- [x] **Task 3.1 解开 `searchWitness` 对 `prism` 的显式拒绝**（2026-10-07 完成，**只到直棱柱**）：旧注释里的两条依赖（解析层认不出 `A′`、核验器只认 `/^[A-Z]$/`）都已由 S1.2/S1.3 解开；现在 `prism` 走 `derivePrismStructure`，只有"任意多面体"一族仍在此提前返回。**斜棱柱不做** —— 内核的 `{kind:"points"}` 拉伸分支按设计不可用（底面顶点全在 z = 0），需先有"环外点名顶点"概念。
- [x] **Task 3.2 顶面环与带撇点名接通**（2026-10-07 完成）：题面 `AA′⊥平面ABC` ⇒ 底面环 `[A,B,C]` + 拉伸方向 `A → A′`，产出**通过核验**的候选（该文件 28/28）。题面写 `AA₁` 时如实拒绝并说清"按 `A′` 出题"（本批不做名字映射）。
- [x] **Task 3.3 反例**（2026-10-07 **底面共线那一半完成**）：`AB=1，BC=1，AC=2` ⇒ 底面三点共线 ⇒ **拒绝**，且拒绝的**种类**是 `no-candidate-constructed`（构造期被内核拒，不是"搜完没找到"、也不是"预算用尽"）。"底面是菱形"那一半仍归 S6 的语法（见 Task 6.x）。
- [ ] **Task 3.4 浏览器正例**：**阻塞**（2026-10-07 查实，当日调试轮把根因缩小）。现象：这句题面在界面**走得到规划**、`暂存草稿 1 action(s) 成功`，但**"确认改动"面板始终不出现**（30 s 超时仍无）；台体与五棱锥同样走见证搜索却照常出现。**四条证据**：① 报错字段是 `envelope.relations`（**模型信封**才有的字段）⇒ 失败的是**模型那一份**；② 浏览器插桩（已还原）：`flag:true, matched:["棱柱"]` ⇒ **本地规划器认领了这句题面**；③ 本地计划坐标 `A(0,0,0) B(2,0,0) C(1.2,2.7495,0)` + `z=2` 顶环，**退化"两点重合"说的不是它**；④ ⇒ **本地计划在更早一步被拒**，运行时问模型要一次修复，修复也错 ⇒ `run_failed`。对照：台体那句有"校验 checking the staged draft 成功"，棱柱这句**没有**。
  - **下一手**：单测里用 `compilePlan` 编译那份**已知**的本地计划（确定性复现）⇒ 把诊断落到具体规则；再对 `agentRuntime` 的暂存/校验边界插桩。若三次修法都不成立，按纪律停下来讨论架构。
  - 几何判据（三条侧棱彼此相等、每条与底面法向平行）已写在 `e2e/agent-prism-path.spec.ts`，暂以 `test.fixme` 挂着，**不写成通过**。
- [ ] **Task 3.5 收口**：待 3.4 解开后一并做。

---

## S4：台体（棱台 / 圆台）

**出口**：正例成立；上下底关系说不清的题面**明确拒绝**；文档写明圆台是多边形近似。

- [x] **Task 4.1 台体走 `polyhedron3`（底环 + 顶环）**，**不新增 DSL 图元**（2026-10-07 **内核侧完成**）：`constructFrustumWitness` + `FrustumConstructRequest`（`scale ∈ (0,1)`）；顶面 = 底面按**质心**相似缩小再平移；`constructShapeFromSpec` 增加 `family === "frustum"` 分支；`constructWitnessShape` 分派同步。变异（相似中心改成环首点）⇒ 用例红。
  - **搜索层（2026-10-07 完成）**：`WitnessSearchInput.spec?: SolidShapeSpec` —— 调用方给形状描述，搜索层按它枚举自由标量并交内核构造（family 与 shape 不一致 ⇒ 拒绝；没有 spec 的 `frustum` ⇒ 拒绝并说明需要什么）。**候选池抽成泛型**（对 spec 的每个自由标量做笛卡尔积），所以 `top-scale` 进网格**不需要改编排层**。端到端：`shape: "frustum"` + spec ⇒ `verified_instance`（用例自己量顶棱短于底棱、两底平行）。
  - **仍未做**：题面点名侧棱长度时**如实拒绝**（侧棱长 ≠ 高，要与相似比联立，本批不解）；**从题面产出这份 spec** 是 S6 的活。
- [x] **Task 4.2 反例**：上下底对应关系无法确定 ⇒ 拒绝并给 `code`；不许默认"按顺序对应"（2026-10-07 完成）：`constructShapeFromSpec` 的台体分支在**构造之前**逐一核对 `spec.top` 与 `spec.base` —— 点数不同 / 任一位对不上 ⇒ `unsupported-base-shape`；判据用命名约定（`A′` 对应 `A`），与 `withPrimes` **同源**。变异（短路判据）⇒ 两条反例红（没有它就会静默造出错配的图）。
- [x] **Task 4.3 圆台近似口径**（2026-10-07 完成）：内核 `roundFrustumShape` / `buildSolid("roundFrustum", …)`（**多边形近似**，注册标签"圆台近似"；两个半径相等 ⇒ 拒绝，那是圆柱）+ 文档路径（`roundFrustumPolyhedron` → 既有的 `solid.create_polyhedron`，**不加新图元**）+ 参数化动作 `solid.create_round_frustum`（三处共用同一个形状函数）+ **交给模型**（`spatial-modeling` 的 `actionIds` + 重签哈希 + 运行时清单 10 个）。**"近似"如实声明**：假设里给段数与**弦高误差**、对象标签写"（近似）"。证据：内核 37/37、`localPlanDefaults` 3/3、规划器 58/58、动作 214/214（12 文件）、**浏览器 1/1**。
  - **仍未做**：真实 provider 下的质量基线（模型自己选这三个数选得好不好）—— 需用户批准付费运行。
- [ ] **Task 4.4 收口**：全库 + e2e + 变异 + 文档 + commit/push

---

## S5：球与多面体的内切 / 外接关系（**风险最高，单列**）

**额外约束（设计 §4.1 已裁决，违反即停）**：球是**派生量**，走"派生绑定 + `recomputeDerivedObjects` 重算"，**"物化但不重算"被否决**（会静默过期）。解不出来时**如实报"没有外接球/内切球"**，不编一个球。

- [x] **Task 5.1 派生球接进依赖图**（`graph.ts` 的 `primitiveDependencies` / `getAffectedPrimitiveIds`）（2026-10-07 完成）：DSL 的 `SpherePrimitive.derivedFrom`（`{kind, solidId}`）+ 依赖图一条边（球 → 宿主实体；顶点 → 实体 → 球的传递闭包自动成立）+ `recompute.ts` 的球分支（**与 `solidStatusReport` 同一个求解器**，解不出来保留上一次几何、不伪造近似球）。判据自己算（盒子 `(1,2,3)`/`√14`；四面体移顶点后 `(1,1,2)`/`√6` 且球心到四顶点等距），`derivedSphereRule.test.ts` 4/4。
  - **上一批那条"缺口"已定性（2026-10-07）**：长方体 `2 × 4 × 6` 的内切球返回 `undefined` **既不是夹具绕向、也不是求解器错** —— 它**根本没有内切球**（到三对面的距离是 1/2/3，找不到到六面等距的点），而规格 §3.4 的口径正是"不满足时返回 `undefined`"，不许把最大内接球当成内切球交出去。用例改成：立方体（真有内切球）走正例，长方体显式钉住"没有内切球 ⇒ 保留占位几何"。
  - **创建球的动作（2026-10-07 完成）**：`derived.create_circumsphere` / `derived.create_insphere` 五层贯通（动作层类型 / `actionIds` / `actionRegistry`（`solidId` 走作用域引用）/ `actionInputs`（只收 `solidId`）/ `actions/index.ts` 的构造与分派 + `manifest` 能力映射）。**解不出对应球就拒绝整条动作**（不编球）；落盘带 `derivedFrom` 绑定 ⇒ 跟着宿主重算。`derivedSphereCompile.test.ts` 4/4；`actionAudit` 两条"承载不了"删除。
  - **交给模型（2026-10-07 完成）**：两个动作进入 `spatial-modeling` 的 `actionIds`，自述写明用法与拒绝口径（**不要改用 `solid.create_sphere` 编一个球**）；`EXPECTED_HASHES` 按纪律重签（`catalog.test.ts` 的 `hash_mismatch` 拦住过）；`agentRuntime.test.ts` 的可用动作清单更新到 9 个。**性质是行为变更**：模型工具箱变了，真实 provider 质量基线要重测。
  - **仍是缺口**：派生球在**面板与画布**上没有专门的呈现（落盘与渲染走 `sphere` 图元的既有路径）。
- [x] **Task 5.2 接进唯一重算入口**（2026-10-07 完成）：`recompute.ts` 的球分支 + 依赖图一条边（球 → 宿主；顶点 → 实体 → 球是传递闭包）；`derivedSphereRule.test.ts` 证明"改源多面体 ⇒ 球跟着变"，并且**过期看得出来**（见下）。
- [x] **Task 5.3 核验**（2026-10-07 完成）：`derivedSphereLink.ts` 从文档坐标**直接几何**复核 —— 外接球验"到各顶点等距且等于半径"、内切球验"到各面等距且等于半径"；**刻意不拿求解器复核它自己算的球**（那等于没复核），求解器只回答"宿主现在还有没有这种球"。非精确 ⇒ `outdated`（"画面上这一只是上一次能解出来的那一个"），直接几何不成立 ⇒ `violated`（两边数都写出来）。接进 `solidStatusReport` 成 `derived.sphere_stale`，**只在出问题时出现**。4/4 + 变异。
  - **仍是缺口**：界面上还没有这一行的**专门呈现**。
- [ ] **Task 5.4 若 `recomputeDerivedObjects` 这条路接不进去 ⇒ 停下报告**，不改走物化（设计 §八 已写死）
- [x] **Task 5.5（e2e 那一半）**（2026-10-07 **部分完成**）：新增代表题五（四棱锥 + 外接球，宿主走草稿内引用）与 `e2e/agent-derived-sphere.spec.ts`（1/1）：核验面板 `passed`、假说明写"球由内核算出来"、提交后**自己从落盘坐标算**"球心到五个顶点等距且等于半径"、对象列表里确认它在。
  - **没做成的一半如实记**：浏览器里"拖宿主 ⇒ 球跟着变"试了三次（拖顶点 / 拖实体 / 先选中再拖）**都没让实体动起来**，所以**不写成通过**；该性质在单元层有证据（`derivedSphereRule.test.ts` 的顶点移动用例 + 依赖链），缺的是这一版界面的操作路径。
  - **又撞上标签缺陷**（R10 已记、待裁决）：`vertexNames: ["P","A","B","C","D"]` 落盘成 `A…E`，所以几何判据走拓扑下标。

---

## S6：入口语法收口

**出口**：`shapeGrammar` 覆盖四族的常见自然语言说法；认得出与认不出**两类反例齐全**；"认不出一律问路、不改文档"有浏览器判据。

- [x] **Task 6.1 新建 `packages/agent-core/src/solver/shapeGrammar.ts`**（2026-10-07 **识别半边完成**）：`parseShapeClause` 认 `在[正|斜|直]?[三四五六]?（棱锥|棱柱|棱台）<点名表>中`，棱锥 = "锥顶-底环"、棱柱/棱台 = "底环-顶环"；逐条核（点名合法 / 环长 3–6 / 数词与环长一致 / 顶环与底环逐一对应 / 锥顶不是底环点），**任一条不成立返回 `null` = 问路**。**有意不认**：球与多面体的关系（S5 未落地，认了也造不出来）、没有 `在…中` 从句的说法（无点名表 ⇒ 产不出 spec）。变异（短路对应判据）⇒ 反例红。该文件 15/15。
  - **接线（2026-10-07 完成）**：`specForPrompt(prompt, givens)` —— 入口语法 + 形状推导 + 自由标量表接成一条线，规划器与离线 benchmark 共用。台体走这条（两个环只能来自入口语法）：`在四棱台ABCD-A′B′C′D′中，AB⊥AD` ⇒ spec ⇒ `verified_instance`。**交叉校验**：形状从句与"侧棱 ⊥ 底面"读出来的底环不是同一组顶点 ⇒ 问路（变异证明短路它就会静默用错底环）。
  - **仍未做**：接进 `localPlanner`（规划器仍走既有夹具）；"底面是菱形、侧棱垂直底面的四棱柱"这类**无点名表**的说法仍走既有夹具。
- [x] **Task 6.2 `localPlanner.freeApexIntentFor` 的窄正则退役，改调 `shapeGrammar`**（2026-10-07 **离线入口那一半完成**）：`planCompiler.witnessSearchInput`（**救援路径与离线入口共用**）改为先问 `specForPrompt`，认得出形状从句时族与 spec 都由入口语法给；认不出时退回原正则（行为逐字不变）。兜底也认 `棱台` ⇒ 报 `frustum`，于是读不出的台体题面得到的是**台体自己的**理由。端到端：`在四棱台ABCD-A′B′C′D′中，AB⊥AD` ⇒ `searchWitnessForPrompt` ⇒ `verified_instance`；变异（恢复成只用正则）⇒ 该用例红。
  - **界面路径（2026-10-07 完成，S6.3）**：`localPlanner` 新增意图 `solidShapeIntentFor`（挂既有实验开关，**关着一律不认**），放在**精确夹具之后**（夹具优先；棱柱的宽松夹具因此仍接走所有棱柱题面）并**避开 V0a 的地盘（整个三棱锥族）** —— 后者是被 V0a 两条既有用例逼出来的：最初的兜底把 V0a 刻意拒绝的自由点/空间条件题面也画了，那是行为变更。产出真的 `solid.create_polyhedron`；`localPlanner.test.ts` 57/57（+5），变异（短路兜底）⇒ 用例红。
  - **仍未做**：`freeApexIntentFor` 那条窄正则的退役（今天两条路并存，各有各的地盘）；"问路"的浏览器判据。
- [ ] **Task 6.3 反例**：分析题 / 非立体题 / 说法对不上的题 ⇒ 问路，**不产出草稿、不占撤销历史**
- [ ] **Task 6.4 浏览器正例**：读真实落盘坐标独立回代题设（每族至少一条）
- [ ] **Task 6.5 收口**：全库 + e2e + 变异 + 文档 + commit/push

---

## 每块收口清单（复制到每个块的状态更新里）

- [ ] RED 的失败原因是**行为**（不是缺文件/权限/TS 报错），且点名了原题条件或具体图元
- [ ] 定向测试 + 全库非 Lean + `typecheck` + `lint` 当次读数
- [ ] 浏览器正例读**真实落盘坐标**独立回代；反例不占撤销历史、草稿坐标逐字未变
- [ ] 关开关旧路径**有判据**钉住（至少 `planCompiler.offPath.golden.test.ts`）
- [ ] 变异验证：判据破坏 ⇒ 该红的是真红；还原后复绿
- [ ] 文档四处同步（current-status / agent-next-round-progress / feature-catalog / project-progress）
- [ ] 单独 commit + push + `git ls-remote` 与本地 HEAD 一致

## 明确不做（照设计 §七，避免"没说不算不做"）

正十二面体/正二十面体；圆柱与圆锥作为**独立诉求**（只作圆台前置）；椭球/双曲面等任意曲面；题目截图识图；GeoGebra `.ggb` 互操作；平面图形与圆锥曲线、函数图像与导数切线（本次不做，但应能复用 `SolidShapeSpec` 思路）。

## 风险与回退

| 风险 | 回退办法 |
| --- | --- |
| S2 迁移改坏现有棱锥路径 | S1、S2 各自独立 commit；S2 验收口径是"现有定向 + 新 spec 用例逐字不变"，变一条就回退该 commit |
| "形状数据化"过度设计 | 设计 §3.1 的 YAGNI 约束：只含首批四族真用得到的字段；新增顶层字段必须先有一块落地 |
| S5 派生球做成"过期数据" | 已裁决走 `recomputeDerivedObjects`；接不进去**停下报告**，不改走物化 |
| 入口扩宽后误认（把分析题当作图题） | 沿用既有 `isAnalysisQuestion` 纪律；"认不出就问路"优先于"多认一句" |
| 点名模块成为新的"同一判断写两遍" | Task 1.4 用引用面用例钉住三个调用方都从 `pointNames` 取 |
