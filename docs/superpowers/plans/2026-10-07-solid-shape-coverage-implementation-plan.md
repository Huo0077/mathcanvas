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

- [ ] **Task 1.4 内核顶面命名改用同一模块**
  - 文件：`packages/geometry-kernel/src/witness/constructors.ts`（顶面 `A′` 的生成处）
  - 判据：同一份 `POINT_NAME_SOURCE` 同时被解析器、核验器、内核引用 —— 用一条**引用面**用例钉住（三个模块都从 `pointNames` 取，而不是各自写字面量）
  - **2026-10-07 已落地一半**：撇字符改从 `POINT_NAME_PRIME` 取；正常路径产出的名字**逐个**满足共享定义（已有断言）。
  - **⚠️ 未勾，因为有一步需要裁决**：`withPrimes` 的**冲突回退**产 `A′2` / `A′′`，两者都不在共享定义里 ⇒ 核验器把整张表判为不可靠（"底面本身带撇"的棱柱拿不到逐条核验，fail-closed）。两条修法：**① 扩语法**（允许第二个后缀）或 **② 明确拒绝**这种底面并给 `code`。**选哪条要用户裁决**；在裁决前这块保持未勾，且那两个不合格名字已被断言逐字钉住（记录不等于认可）。

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

- [ ] **Task 2.1 spec 类型 + 迁移 `derivePyramidStructure`**（**载体已落地，内核侧读取待做**）
  - **2026-10-07 已完成的部分**：`solidShapeSpec.ts`（类型 + YAGNI 注释，内核 barrel 导出）；搜索层候选池与 `requestFor` 改成读 spec；高的来源从 spec 的 `relations` 读回（不再夹带 `WitnessHeightSpec`）；坐标护栏逐字通过（全库 3895 通过、用例数不变）。
  - **仍未做**：内核 `constructWitnessShape` 侧读 spec / `derivePyramidStructure` 直接产出 spec（现在还是"结构 → specFor → spec"这一跳）。
  - 文件：`packages/geometry-kernel/src/witness/solidShapeSpec.ts`（已建）、`packages/agent-core/src/solver/witnessSearch.ts`（已改）、`packages/geometry-kernel/src/witness/constructors.ts`
  - 判据：自由标量从 spec 读，不再是写死的"两条底边 + 高"（搜索层这一半已做到）
  - RED：坐标快照（已立，见 `S2 迁移护栏（坐标逐字不变）`）
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

- [x] **Task 3.1 解开 `searchWitness` 对 `prism` 的显式拒绝**（2026-10-07 完成，**只到直棱柱**）：旧注释里的两条依赖（解析层认不出 `A′`、核验器只认 `/^[A-Z]$/`）都已由 S1.2/S1.3 解开；现在 `prism` 走 `derivePrismStructure`，只有"任意多面体"一族仍在此提前返回。**斜棱柱不做** —— 内核的 `{kind:"points"}` 拉伸分支按设计不可用（底面顶点全在 z = 0），需先有"环外点名顶点"概念。
- [x] **Task 3.2 顶面环与带撇点名接通**（2026-10-07 完成）：题面 `AA′⊥平面ABC` ⇒ 底面环 `[A,B,C]` + 拉伸方向 `A → A′`，产出**通过核验**的候选（该文件 28/28）。题面写 `AA₁` 时如实拒绝并说清"按 `A′` 出题"（本批不做名字映射）。
- [ ] **Task 3.3 正反例**：题面说"侧棱垂直底面"却给了不垂直的构造 ⇒ 必须拒绝；"底面是菱形"这类说法由 S6 的语法接住，S3 先用显式 spec 驱动
- [ ] **Task 3.4 浏览器正例**：读草稿里**真实落盘的坐标**独立回代（自己算底面各边相等 / 侧棱与底面法向平行），不读面板结论；反例必须不占撤销历史
- [ ] **Task 3.5 收口**：全库 + e2e + 变异 + 文档 + commit/push

---

## S4：台体（棱台 / 圆台）

**出口**：正例成立；上下底关系说不清的题面**明确拒绝**；文档写明圆台是多边形近似。

- [ ] **Task 4.1 台体走 `polyhedron3`（底环 + 顶环）**，**不新增 DSL 图元**（`packages/dsl/src/schema.ts` 不动）
- [ ] **Task 4.2 反例**：上下底对应关系无法确定 ⇒ 拒绝并给 `code`；不许默认"按顺序对应"
- [ ] **Task 4.3 圆台近似口径**：沿用 `ROUND_SOLID_SEGMENTS` 的多边形近似，并在文档与面板上**如实声明是近似**
- [ ] **Task 4.4 收口**：全库 + e2e + 变异 + 文档 + commit/push

---

## S5：球与多面体的内切 / 外接关系（**风险最高，单列**）

**额外约束（设计 §4.1 已裁决，违反即停）**：球是**派生量**，走"派生绑定 + `recomputeDerivedObjects` 重算"，**"物化但不重算"被否决**（会静默过期）。解不出来时**如实报"没有外接球/内切球"**，不编一个球。

- [ ] **Task 5.1 派生球接进依赖图**（`packages/scene-graph/src/graph.ts` 的 `primitiveDependencies` / `getAffectedPrimitiveIds`）
- [ ] **Task 5.2 接进唯一重算入口**（`packages/scene-graph/src/recompute.ts`）：改源多面体 ⇒ 球跟着变；**过期读数必须不可能出现**
- [ ] **Task 5.3 核验**：外接球核验"到各顶点等距"、内切球核验"到各面相切"；非 `exact` ⇒ `unverified` + 面板明说
- [ ] **Task 5.4 若 `recomputeDerivedObjects` 这条路接不进去 ⇒ 停下报告**，不改走物化（设计 §八 已写死）
- [ ] **Task 5.5 收口**：全库 + e2e + 变异（让球不再跟随源多面体 ⇒ 用例红）+ 文档 + commit/push

---

## S6：入口语法收口

**出口**：`shapeGrammar` 覆盖四族的常见自然语言说法；认得出与认不出**两类反例齐全**；"认不出一律问路、不改文档"有浏览器判据。

- [ ] **Task 6.1 新建 `packages/agent-core/src/solver/shapeGrammar.ts`**：四族常见说法（含"底面是菱形、侧棱垂直底面的四棱柱"这类），认不出返回 `null`
- [ ] **Task 6.2 `localPlanner.freeApexIntentFor` 的窄正则退役**，改调 `shapeGrammar`（离线本地规划器与离线 benchmark 共用同一份解析）
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
