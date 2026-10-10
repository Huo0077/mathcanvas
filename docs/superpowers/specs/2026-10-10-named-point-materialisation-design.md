# 题面点名的点由系统兜底补建设计（"O 为 BD 的中点"那一类）

> **状态：2026-10-10 设计已获批，尚未实施。** 实施计划待写（写完后进本文件的 §四 判据逐条落地）。
> 本文只解决一件事：**题面点名了一个点，而模型给的计划里根本没有这个对象** —— 于是那条题设永远
> 无法核验、整轮运行必然失败。相关现场与历次修复见 [`CHANGELOG.md`](../../../CHANGELOG.md) 2026-10-05 两条
> 与 [下一步计划](../plans/2026-10-10-selftest-followups-and-release-plan.md) §1。

## 理解写回（先确认目标，再谈做法）

**用户要的结果**：把高中题面**原样**粘进 Agent（例如"在三棱锥 A−BCD中，平面 ABD⊥平面 BCD，且 AB=AD，
O为 BD的中点。"），画布上出现一张**符合题意**的图，而不是一条"题设尚未核验"。

**为谁**：高中学生与教师。他们不会为了迁就系统去改写题面 —— 题面里的 `O`、`E` 是题目的一部分，
"请补充明确点名"这句话对他们没有可操作性（他们**已经**点名了）。

**成功标准**（可测）：
1. 上面那句话 + **只有一笔 `solid.create_polyhedron`** 的计划 ⇒ 编译结果 `passed`，且编译后的文档里
   **真的多出一个标签为 `O` 的点**，它落在 `BD` 的中点上（判据由测试读落盘坐标自己算）。
2. 题设唯一确定了构造的两种点都覆盖：**中点**（参数 0.5）与**比例分点**（`DE=2EA` ⇒ 参数 2/3）。
3. **确定不了的一律不猜**：端点名不在 `vertexNames` 里、棱不唯一、构造不唯一的题设种类 ⇒ 不补建，
   保持今天的 fail-closed，并且**把话说清缺谁**。
4. 关着见证搜索开关的旧路径对**既有黄金样本**逐字不变（见 §六 那条语义收窄的说明）。
5. 每个新判据都过一次**变异**（破坏它，看该红的是不是真红）。

**不是**"让系统替模型画图"。见 §五「明确不做」。

## 一、现场与根因（2026-10-10 查实）

### 1.1 用户这台机器上的真实运行读数

数据源：应用自己的库 `%APPDATA%\com.mathcanvas.desktop\projects.db`（**复制后只读查询**，原库未动）。
会话 `conversation-muv4mnkx-5`，题面为上面那一句：

| 时间 | 暂存动作数 | 结果 |
| --- | --- | --- |
| 2026-10-05 18:48 | 1 笔 | `cannot confirm: verification is incomplete: O为 BD的中点：点名缺失…未核验。` |
| 2026-10-05 19:48 | 4 笔 | 同上（逐字相同） |
| 2026-10-05 19:56 | 1 笔 | 同上 |
| 2026-10-05 19:57 | 3 笔 | 同上 |
| 2026-10-10 12:33 | 1 笔 | 同上 |
| 2026-10-10 12:34:13 | 1 笔 | 同上 |
| 2026-10-10 12:34:25 | 1 笔 | 同上 |

两次日期、七次运行、**报文逐字不变**。2026-10-10 那三次跑的是当天 12:30 打出来的桌面端 3.3.0
（不是旧包）。这几轮都是**模型在规划**：`providers.json` 的 `activeProfileId = ds`，且 run-1 里有真实
工具调用 `scene.inspect`（`toolCallId = call_00_pAlUWFI52T3gZ1H0zgiV5038`）；本地规划器也**没有**能接住
这句话的入口（`freeApexIntentFor` 要求"…自由点 X，画示意图"整句；`solidShapeIntentFor` 被
`V0A_TERRITORY` 明确排除"三棱锥"）。

### 1.2 根因链（每一步都有位置）

1. **题设由系统自己抽**：`O为 BD的中点` 命中 `diagramObligations.ts` 的句型（`midpoint`，targets `[O,B,D]`）。
   模型无权改这一条（提示词明说"关系由系统自己读，你不需要声明它们"）。
2. **核验要求这个名字在点名表里**：`diagramVerification.ts` 的 `candidatePoints` 从
   `solid.create_polyhedron` 的 `vertexNames` + 带 `label` 的点建表；`calculate` 一发现某个点名不在表里
   就 `return null`，报告据此写成"点名缺失、图形退化或角度无法计算，未核验"。
3. **门禁一步不让**：`completionGate.ts` 判 `verification_incomplete`；`coordinator.ts` **直接落到
   `failed`**，并**刻意不发起修复**（门禁给不出"允许改哪几处"）。有修复额度的只有 schema 不合法与编译
   失败两条路。
4. **没有任何一处要求"题面点到的点必须真的建出来"**：提示词那两句的重心是"让**坐标**满足关系、
   用 `vertexNames` 说出**顶点**名"。`dynamic.create_bound_point` 只出现在动作菜单里，作为**可选工具**，
   不是**必需动作**。
5. **话指错了对象**：`agentRunner.ts` 把门禁那句话端给用户——"请补充明确点名，或改用受支持的条件表达"。

### 1.3 "为什么模型没建 O" 是**排除法**得出的（如实标注）

模型的原始计划文本**按设计不落库**（会话表里只放消息与运行事件），所以没有直接读法。三条读数把结论夹死：

- 报文是"点名缺失…"而**不是**"候选图缺少唯一、可靠的顶点名映射" ⇒ 点名表**建出来了**（说明计划里
  有一笔 `solid.create_polyhedron`，且 `vertexNames` 合法）；
- 同一份报告里 `AB=AD` 与 `平面 ABD⊥平面 BCD` **都 passed**（否则门禁会优先报 `verification failed`，
  或把多条未核验串在一起）⇒ `A/B/C/D` 都在表里、且不退化；
- 计划只有 **1 笔**，而唯一能一次造出 `A/B/C/D` 又让表非空的动作就是 `solid.create_polyhedron`。

⇒ 表里有 `A/B/C/D`、缺 `O`，且**没有任何一笔动作在建 O**。

### 1.4 为什么 2026-10-05 的三次修复没碰到它

那三次修的是**"模型做对了的时候系统要看得见"**：核验认 `label`、`label` 缺省取 `alias`、菜单加
`dynamic.create_bound_point`。没有一次管**"模型没做的时候怎么办"**。而那条端到端用例
（`diagramVerification.test.ts` 里"实体 + 绑在 BD 中点的 O ⇒ 通过"）是**手工把 O 那一笔写进计划**再断言
通过的 —— 它证明的是"只要模型那样做就行"，所以对这种现场**永远是绿的**。

## 二、现状事实（读代码得出，不是推断）

| 事实 | 位置 |
| --- | --- |
| 未核验的原因三件事混成一句（点名缺失 / 退化 / 算不出角度） | `packages/agent-core/src/diagramVerification.ts`（`calculate` 返回 `null` 那一支的理由文本） |
| 点名表只认 `vertexNames` + 带 `label` 的点；名字必须是题面点名形状 | 同上 `candidatePoints` |
| `midpoint` 判据语义：`targets = [中点, 端点1, 端点2]`，比"到两点中点距离 ≈ 0" | 同上（`item.kind === "midpoint"`） |
| `segmentRatio` 判据语义：`targets = [D, E, E, A]` + 比值 `DE/EA`，且要求 E 在**线段** DA 上 | 同上（`item.kind === "segmentRatio"`） |
| 门禁只认"全部 passed"；缺证据不放行 | `packages/agent-core/src/verification/completionGate.ts` |
| 门禁失败**不发修复**（`validating` 只允许到 `awaiting_confirmation` / `compiling` / `failed`） | `packages/agent-core/src/coordinator.ts`（门禁那一支） |
| 用户看到的那句话 | `apps/web/src/agent/agentRunner.ts`（`verification is incomplete` 那一支） |
| 提示词两条重心：关系由系统读、用 `vertexNames` 说顶点名；**没有**"点名必须建出来" | `apps/web/src/agent/systemPrompt.ts`（"题面只给了关系、没给数值时"那一节） |
| 已有的"两遍编译"救援结构：追加/替换 → 再跑**同一个** `compileOnce` → 第二遍必须 `passed`，否则返回第一遍 | `packages/agent-core/src/planCompiler.ts`（`compilePlan` / `rescuedByWitnessSearch`） |
| 救援的生成物要回写 `materialisedActions`（草稿层再核验对着它） | 同上（R37② 那条注释） |
| `dynamic.create_bound_point` 支持 `hostEdge: { from, to }`（按点名定棱，顺序无关，唯一命中才成） | `packages/agent-core/src/actionRegistry.ts`、`packages/scene-graph/src/actions/index.ts`（`resolveEdgeByNames`） |
| `parameter` 的**默认是 0.4**（普通动点）；中点**必须显式给 0.5** | `packages/agent-core/src/actionRegistry.ts` |
| 黄金样本契约：关开关时**逐字相同**，且 off 路径上 `materialisedActions` **根本不存在** | `packages/agent-core/src/planCompiler.offPath.golden.test.ts` |

## 三、设计

### 3.1 触发：五条同时成立才补（缺一不补）

1. 题面在场（`context.prompt`），且解析出了题设；
2. 编译成功、物化出了候选文档（`draftDocument !== null`）；
3. 题设核验 `status !== "passed"`，且**确实存在一条**"点名不在表里"的题设；
4. 那条题设的种类**唯一确定**该点的构造：`midpoint`（参数 `0.5`）或 `segmentRatio`
   （比值 `r` 的点：参数 `r/(1+r)`，`from` 取题设里**分子那一侧的端点** —— `DE=2EA` 即
   `hostEdge = { from: "D", to: "A" }`、参数 `2/3`）；
5. 构造所需的两只端点名**都在**那一只多面体的 `vertexNames` 里，且两支点之间**恰好一条棱**
   （由 `resolveEdgeByNames` 判定）。

任何一条不成立 ⇒ **不补**：保持今天的 fail-closed（未核验 → 门禁拦），只把话说清（§3.4）。

### 3.2 怎么补

- **宿主只认那一只** `solid.create_polyhedron` —— 与核验器建点名表用的是同一只、同一份 `vertexNames`。
  不新写第二份"哪只实体、哪些顶点"的判断（本仓"同一个判断不许写两遍"）。
- 补的动作就是一笔 `dynamic.create_bound_point`：
  `{ alias: 点名, host: { scope: "draft", alias: 宿主alias }, hostEdge: { from, to }, parameter, label: 点名 }`。
  `parameter` **显式给出**（不依赖 0.4 那个默认）。
- **要么全补、要么不补**：多条题设同时缺点名时，只有**每一条**的构造都能唯一确定才补；任何一条算不出来
  ⇒ 整批不补（宁可失败，不半补）。
- 补建后的核验走**同一个** `verifyDiagramObligations` —— "是系统自己生成的"不构成任何豁免。

### 3.3 算数：两遍编译 + 显形

- 复用既有结构：把补的动作追加到计划末尾 → 再跑**同一个** `compileOnce` → **第二遍核验必须真的
  `passed`**，否则丢弃、把第一遍的结果原样交回。
- 补建是系统替用户做的选择 ⇒ **必须显形**：`assumptions` 加一句人话（例："系统按题设把 O 建在棱 BD 的
  中点上（棱上参数 0.5）"），并回写 `materialisedActions`（草稿层的再核验对着这一份）。
- 面板那边照既有的"系统替你选了哪些值"呈现，不新增一套说法。

### 3.4 失败时把话说清

- 核验理由**拆开**：缺点名时说清**缺谁**（"点名缺失：O —— 题面点到了它，图上没有这个对象"）；
  退化 / 算不出角度保持原话。
- 运行器那句用户话术改成按缺什么说；只有真的**解析不出 / 不支持**时才保留"请补充明确点名"。

### 3.5 开关与默认

**默认路径生效，不挂实验开关**：这是修缺陷，不是实验特性（它不扩大"系统替用户选值"的范围——
补建的点由题设唯一确定，且写进 assumptions）。见证搜索那条救援照旧挂在它自己的开关后面，语义不动。

## 四、判据（每一条都要有红→绿→变异）

1. **RED（今天必红）**：题面 `在三棱锥 A-BCD中，平面 ABD⊥平面 BCD，且 AB=AD，O为 BD的中点。`
   + 只有一笔 `solid.create_polyhedron`（`vertexNames` = A/B/C/D）的计划 ⇒ 断言
   ① 编译结果 `diagramVerification.status === "passed"`；② 编译后的文档里**存在**一个 `label === "O"` 的点；
   ③ 该点到 B 与到 D 的距离相等（测试**自己按坐标算**，不读面板结论）。
2. **反例三条**（每条都要红过）：端点名没写进 `vertexNames` / 计划里没有多面体 / 文档里已有一个 `O`
   （重名）⇒ **不补**、仍 `unverified`、不产出草稿。
3. **比例分点**：`DE=2EA` 那一句 ⇒ 补出来的点参数为 `2/3`，测试自己按坐标算 `DE/EA = 2`。
4. **黄金样本逐字不变**：现有 `planCompiler.offPath.golden.test.ts` 全绿（它同时钉住 off 路径上不出现
   `materialisedActions`——见 §六）。
5. **浏览器证据**：同一句题面提交之后，画布上确有标签 `O`，且用例读**落盘坐标**独立回代
   `|OB| = |OD|`；截图落 `docs/evidence/` 并目视核对。
6. **变异**：① 把补建的 `parameter` 从 `0.5` 改成 `0.4` ⇒ 第 1 条真红；② 去掉"确定不了就不补"⇒ 第 2 条真红。
7. **门禁**：定向用例 + 全库非 Lean + `typecheck` + `lint` + 全量 e2e + 黄金样本，四件套文档同步，
   单独 commit + push + `git ls-remote` 核对。

## 五、明确不做

- **不补构造不唯一的点**（交点、只说了"在棱上"、点到面的关系）——那需要几何求解，不是补一笔动作。
- **不放行未核验**（门禁不松口）。
- **不给模型第二次机会**（"缺的点交回模型修"是另一条路，等真出现"只有模型能定的点"时再单独设计）。
- **不动**见证搜索开关的语义与默认，**不动** `candidatePoints` 的语义。
- **不要求用户改写题面**。

## 六、与既有契约的关系（一条语义收窄，逐字写清）

黄金样本第 ④ 条断言写的是"off 路径上 `materialisedActions` **根本不存在**"。本设计让系统在**默认路径**上
也能补建，因此这条断言的**含义**收窄为：**对那 6 条既有输入**不出现。

- 为什么不破坏基线：那 6 条输入的题面只需要 `P/A/B/C/D` 顶点名，没有一个"题面点到、图上没有"的点
  ⇒ §3.1 第 3 / 4 条不成立，新路径**不触发**，结果逐字不变（实施时以实跑为准，红了就先查是不是真的触发）。
- 这条收窄必须同时写进本次的 CHANGELOG：**契约的含义变了就要说清**（本仓规矩）。

## 七、风险与回退

| 风险 | 处置 |
| --- | --- |
| 补错了点（参数 / 方向算反） | 不猜：第二遍核验必须 `passed` 才采用；`DE=2EA` 这类方向由题设点序定，并有第 3 条判据按坐标自算比值 |
| 宿主不是那一只多面体（模板实体 / 已有文档里的对象） | 不补（§3.1 第 5 条） |
| 触发过宽（把本该未核验的题变成"系统画了一张图"） | 只在"题设唯一确定"的两类上开；每一类都有反例判据 |
| 黄金样本被改动 | 先跑基线；若真红了，先查是不是"新路径被触发"（那就是触发过宽，要收紧），而不是直接改基线 |
| 回退 | 这一层是**追加式**的救援：删掉新的救援分支即回到今天的行为；`materialisedActions` 与 assumptions 都是既有的形状 |
