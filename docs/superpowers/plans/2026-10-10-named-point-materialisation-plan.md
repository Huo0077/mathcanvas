# 题面点名的点由系统兜底补建 —— 实施计划

> **状态：2026-10-10 已执行（Task 1–6）。** 唯一没做到的是 **Task 6 Step 8 里的浏览器证据**：
> 这句话没有本地规划器入口，浏览器里没有 provider 时 e2e 到不了这条路径 —— 原因与替代证据
> （读编译后文档坐标自己算的独立回代）见 [`CHANGELOG.md`](../../../CHANGELOG.md) 同日那条。

> **设计：** [题面点名的点由系统兜底补建设计](../specs/2026-10-10-named-point-materialisation-design.md)（2026-10-10 已获批）。
> 本文只做一件事：把那份设计的 §三 / §四 拆成可逐步执行、每步都有期望结果的任务。
> 本仓的收口清单照旧：**RED → 最小 GREEN → 变异 → 定向 + 全库非 Lean + typecheck + lint + 全量 e2e
> → 黄金样本逐字不变 → 同步文档 → 单独 commit + push + `git ls-remote` 核对**。

**目标：** 让"题面点名了 O、模型只交了多面体"这一类题在**默认路径**上通过核验（今天必然失败）。
**架构：** 在 `planCompiler` 既有的"两遍编译救援"结构里加一条**确定性补建**（只做中点与比例分点——
它们的构造由题设唯一确定），第二遍核验必须真的 `passed` 才采用；核验理由拆开说清缺谁，运行器话术随之改准。
**技术栈：** TypeScript / vitest（`npm.cmd test`）/ Playwright。

---

### Task 1：RED —— 补建判据的用例（先看它红）

**Files:**
- Create: `packages/agent-core/src/planCompiler.namedPoints.test.ts`

**内容（四条）：**
1. **主用例**（今天必红）：题面 `在三棱锥 A-BCD中，平面 ABD⊥平面 BCD，且 AB=AD，O为 BD的中点。`
   + 只有一笔 `solid.create_polyhedron`（`vertexNames = ["A","B","C","D"]`，坐标取既有用例里那组
   使 `AB=AD` 与面面垂直成立的坐标）⇒ 断言
   ① `ok === true`；② `diagramVerification.status === "passed"`；③ 候选文档里**存在** `label === "O"` 的点；
   ④ 用**文档里的坐标自己算** `|OB| = |OD|`（不读面板结论），且 O 落在线段 BD 上。
2. **反例**：同一份计划但**不写 `vertexNames`** ⇒ 不补建、仍 `unverified`、`materialisedActions` 不存在。
3. **反例**：计划里**没有多面体**（例如只有一笔 `solid.create_template`）⇒ 同上。
4. **反例**：**基线文档里已经有一个位置不对的 `O`** ⇒ 系统不补第二个，结果仍被拒（`ok === false`）。
5. **比例分点**：题面 `…DE=2EA…` ⇒ 补出来的 `E` 参数为 `2/3`；用坐标自己算 `DE/EA = 2`。

**Step 1：写用例** ／ **Step 2：跑它，确认怎么红**
```
npm.cmd exec vitest run packages/agent-core/src/planCompiler.namedPoints.test.ts --reporter=dot
```
**期望：** 主用例与比例分点那两条 **FAIL**（"O 不在文档里"）；反例三条 **PASS** ——
它们是**回归钉子不是 RED**（本仓如实申报这一类的规矩），实施完仍必须绿。

### Task 2：GREEN —— 核验层说清"缺谁"

**Files:**
- Modify: `packages/agent-core/src/diagramVerification.ts`
  （导出 `missingNamedPoints(set, plan, candidate, base?)`；`verifyDiagramObligations` 里
  `calculate` 返回 `null` 且**有点名不在表里**时，理由写成"点名缺失：O —— 题面点到了它，图上没有这个对象"，
  原来的混合句作为兜底保留）

**Step 3：实现** ／ **Step 4：跑 Task 1 的用例 + 既有核验用例**
```
npm.cmd exec vitest run packages/agent-core/src/diagramVerification.test.ts packages/agent-core/src/planCompiler.namedPoints.test.ts --reporter=dot
```

### Task 3：GREEN —— 编译器里的确定性补建

**Files:**
- Modify: `packages/agent-core/src/planCompiler.ts`
  （新增 `rescueWithMaterialisedPoints`：五条触发条件见设计 §3.1；宿主只认那一只 `solid.create_polyhedron`；
  补一笔 `dynamic.create_bound_point`（`hostEdge` + 显式 `parameter`）；追加后**再跑同一个 `compileOnce`**，
  第二遍不 `passed` 就丢弃；成功时 `assumptions` 加一句人话、回写 `materialisedActions`。
  `compilePlan` 里**默认路径**先试它，再走既有那条挂开关的见证搜索救援）

**Step 5：实现** ／ **Step 6：定向 + 黄金样本（必须逐字不变）**
```
npm.cmd exec vitest run packages/agent-core/src/planCompiler.test.ts packages/agent-core/src/planCompiler.offPath.golden.test.ts packages/agent-core/src/planCompiler.namedPoints.test.ts --reporter=dot
```

### Task 4：用户看到的话（③）

**Files:**
- Modify: `apps/web/src/agent/agentRunner.ts`（门禁那支：理由里是"点名缺失"时，不再对用户说"请补充明确点名"）
- Test: `apps/web/src/agent/agentRuntime.test.ts`（加一条：缺点的报文 → 新话术）

### Task 5：变异（判据真的会咬人）

**Step 7：两处变异，各自验红、还原验绿**
1. 把补建的 `parameter` 从 `0.5` 改成 `0.4` ⇒ Task 1 主用例真红；
2. 去掉"构造不唯一就不补"那一支（让它硬补）⇒ Task 1 反例真红。

### Task 6：门禁与文档

**Step 8：** `npm.cmd run typecheck` / `npm.cmd run lint` / 全库非 Lean /
`npm.cmd run test:e2e`（浏览器侧：本仓没有 provider 时走本地规划器，而这句话**没有**本地入口 ⇒
浏览器证据做不了，原因如实写进 CHANGELOG **与**设计文档的"仍未做"）。

**Step 9：** 同步 `CHANGELOG.md`、设计文档状态行、`docs/current-status.md` 页头与 §四 口径，
单独 commit + push + `git ls-remote` 核对。
