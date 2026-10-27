# 2026-10-26 文字题可靠性 · 第一阶段修复执行台账

> 本文件是任务书 §7 要求的执行记录：每项任务写**实际基线、改了什么、测试与退出码、是否调用真实模型、剩余问题**。
> "现在时"的读数为 `docs/current-status.md`；本条记录只覆盖本轮实际做过的事，不写没跑过的结论。

## 0. 实际基线（T00）

- 仓库根：`D:\数学画布\mathcanvas-main`（工作目录 `D:\数学画布` 本身不是 git 仓库）。
- HEAD：`bdf2c48 docs: 补长度连等的能力条目与收尾读数`（`main`，跟踪 `origin/main`）。
- 工作区既有差异（与本轮无关，未触碰）：`apps/desktop/src-tauri/Cargo.toml` 已修改、`coverage/` 未跟踪。
- **任务书提到的 `c57f683` / `5be2223` 在本仓库不存在**（`git cat-file` 报 `Not a valid object name`），
  因此不 cherry-pick，按实际代码重新实现。
- 工具链：Node 24.15.0 / npm 11.12.1 / vitest 4.1.11 / TypeScript 5.9.2。
- 仓库内没有 `AGENTS.md`。

### 0.1 先核实"哪些修复已经存在"

| 项 | 实际代码里的状态（本轮开始时） | 结论 |
| --- | --- | --- |
| A1 长度连等 | `lengthEquality.ts`（d02aafd）已做整条链解析，但分数系数被整条跳过、`-AB=…` 会丢负号、`AB+CD=5` 只读后半截、括号里的重述被切掉 | 补齐 |
| A2 等价闸门 | `promptNormalization.ts` 已有长度语义比较，但"原文读不完整 ⇒ 跳过检查"，`AB=AC=0 → AB=AC` 会被接受 | 补齐 |
| A3 矩形对角线折叠 | `namedFold.ts` / `rectangleFold.ts` **不存在**；`readFoldTransformations` 只认显式折后三角形 | 新增 |
| A4 Worker 澄清 | `draftStore.stage` 已有 `draftDocument === null` 闸门与 `needs_more_information` 映射，但没有验收级测试 | 补测试 + 复核 |

## 1. A1 长度表达式完整读取

**改动**

- `packages/agent-core/src/lengthEquality.ts`
  - 系数改为有理数 `{numerator, denominator}`：`2/3 AB=CD=2` → AB=3、CD=2；`V·分母/分子` 避免 `2/(2/3)=3.0000000000000004`。
  - 扫描器改为"从线段项向右看到中文/标点边界"，再检查左邻算符与右接算符：
    `-AB=CD=2`、`AB+CD=5`、`AB/CD=2`、`0AB=CD=2`、`AB=CD=1e999` **整条**落未核验。
  - 括号窗口切分：`（即 AD=AB=2CD=2）` 里的连等照旧进题设（不再按 `（` 截断）。
  - 守住既有语义：`AE=2/5 AD` 仍产出同一个 `segmentRatio`；`∠ABC=60°`、`AB²=4`、`P-ABCD`、
    `|AB|=3`、`|AB|=2|AC|`、`则SA=.` 不被误读（前两轮回归暴露了这六类，已逐条钉住）。
- `packages/agent-core/src/lengthEquality.test.ts`：新增 13 条（分数系数、边界、括号重述）。
- `packages/agent-core/src/diagramObligations.test.ts`：新增 5 条题设账用例。

**验证**

- `npx vitest run packages/agent-core/src/lengthEquality.test.ts` → 25/25 passed。
- `npx vitest run packages/agent-core/src/diagramObligations.test.ts` → 102/102 passed。
- `clauseFamiliesThirdPass.test.ts` + `diagramObligations.goal.test.ts` 同批 141/141 passed。

**剩余**

- 加法/乘法整式仍按"不支持"落未核验（任务书不要求通用代数）；根式系数（`√2 AB=…`）不支持。

## 2. A2 改写必须保持全部条件

**改动**

- `packages/agent-core/src/promptNormalization.ts`
  - 新增三态读取 `notLength / ok / unreadable`：连等层**整条拒绝**时判 `unreadable`，
    改写一律拒绝（`AB=AC=0 → AB=AC` 不再被接受，理由"原文的长度条件无法完整读取"）。
  - 规范形按约束计算：线段**成对**（`AB=CD` 与 `AD=BC` 不再撞键）、比例方向归一到 `≥1`、
    固定长度/比例闭环做一致性检查（`AB=2，AB=3` 判"固定长度自相矛盾"）。
  - 点名改用项目撇号/下标词法（`POINT_NAME_SOURCE`）并用 `canonicalPointName` 归一（`B′` 与 `B'` 同名）。
  - `applyNormalisation` 改为绑定原文区间：先在原文里枚举出现位置，认领互不重叠的区间，
    从右往左替换；**重叠的两条都不采用**并如实记 `skipped`（避免出现 `AB=AC（等长）=2` 这种半截文本）。
    新增 `applyNormalisationWithReport` 返回 `applied / skipped`。
- `packages/agent-core/src/promptNormalization.test.ts`：新增 8 条（任务书反例、配对、方向、矛盾、撇号、重复/重叠）。

**验证**

- `npx vitest run packages/agent-core/src/promptNormalization.test.ts` → 22/22 passed。
- 全量 `packages/agent-core` + `apps/web/src/agent`：**226 文件 / 2367 passed / 1 todo**，exit 0
  （该跑包含 A1+A2 之后的源码；A4 的新测试文件是之后新增的，单独跑过，见 §4）。

**剩余**

- `AD:AB=1` 这类"比例=数值"写法今天的读取器仍不覆盖；因为没有被连等层判为 `unreadable`，
  它继续走旧的关系词族闸门（与改动前一致）。这是已记录的缺口，不是本轮引入的放宽。
- `applyNormalisationWithReport` 的 `skipped` 目前没有接到界面/报告，只在本层可见。

## 3. A3 矩形对角线折叠与同名点状态（核心层）

**新增**

- `packages/agent-core/src/namedFold.ts`
  - `StateId` / `EntityId` / `FoldStateRef` / `NamedFoldTransition`：显示名与状态分离
    （没改名时显示名仍是 `B`，内部是 `B@s0` / `B@s1`）。
  - 两种语序归一到同一份结构：`沿对角线 AC 把 △ABC 折起`（hinge-first）与
    `将 △ABC 沿 AC 折起`（face-first），另收 `…使点 B 到达点 B′` 与 `…至 △AB′C`。
  - 折角只认**紧跟动作词**的数字；没有就是 `{kind:"unknown"}`，不默认 90°。
  - `uniqueFoldDisplayName` 在需要生成显示名时避开题面已有的 `B′/B′′/B₁`。
  - 折痕不在折片、点名重复、折后点名与折前同名 ⇒ `invalid` 并留原文。
- `packages/agent-core/src/rectangleFold.ts`
  - 读矩形环 + 两条边长（只认环上的边；缺边/只给对角线 ⇒ `unsupported` 并说缺哪条）。
  - 折痕必须是对角线；折片必须是折痕两侧之一；动点必须一致。
  - 垂直关系只认折痕两侧的平面；其他平面垂直 ⇒ `unsupported`（不据此取 90°）。
  - `buildRectangleFold`：内部坐标系由点名/边长/折痕决定（不匹配原题字符串），
    折后动点绕折痕旋转；`branch=±1` 两个镜像分支；**折角未知返回 `needs_angle` + 具体问题**。
  - `verifyRectangleFold`：折前矩形判据（非退化、平行四边形闭合、相邻边垂直、共面、边长），
    折后折痕不动、折片刚性、已知折角对得上、两平面垂直（题面明写时）。
  - `evaluatePerpendicular` / `evaluateLength`：给残差，不硬证。
- `packages/agent-core/src/rectangleFold.test.ts`（18 条）：两种语序、状态分离、显式改名、
  B′ 避让、用户案例精确值、无折角不默认 90°、显式 60°、改名/改尺寸/另一条对角线、
  缺边/非对角线/不相干垂直、篡改坐标四类负例、假目标残差。

**用户案例的确定性结论（已由测试钉住）**

- 折后 B=(16/5, 8/5, ±4/√5)；BD²=68/5；BD=2√85/5。
- (B₁−D)·(C−A)=12（两个镜像分支都是 12）⇒ **BD⊥AC 不成立**。

**验证**

- `npx vitest run packages/agent-core/src/rectangleFold.test.ts` → 18/18 passed。
- `npx tsc -p packages/agent-core/tsconfig.json --noEmit` → exit 0。
- `npx eslint`（新增/改动文件）→ exit 0。

### 3.1 计划入口与 planner 安全闸（本轮第二轮补）

**新增** `packages/agent-core/src/rectangleFoldPlan.ts`

- `readRectangleFoldGoals`：**只把问句区**（`求证 / 证明 / 求` 之后）里的"两线段垂直"与"某线段的长"当目标；
  题设区的 `平面 ABC ⊥ 平面 ACD` 不会被误读成待证结论（已由用例钉住）。
- `evaluateRectangleFoldGoals`：在**折后**坐标上回答目标；垂直给残差，长度给数值；
  折后点按 `apexAs` 映射，避免"文档里的 B′"与"算出的折后位置"张冠李戴。
- `solveRectangleFold(prompt)`：
  1. 非本族 ⇒ `none`；读不全 ⇒ `unsupported`（说缺什么）；
  2. 折角未知 ⇒ `clarification`（问折角，**不默认 90°**）；
  3. 目标被确定性否定 ⇒ `clarification`（说明哪条不成立 + 可给的距离），**不出计划**；
  4. 其余 ⇒ `plan`：`solid.create_face`（固定片）+ `solid.fold`（折片，折前坐标显式给出）。
- 生成计划前先跑 `verifyRectangleFold` 自检；不通过就 `unsupported`，不把半对的构造交出去。

**接线** `apps/web/src/agent/modelPlanner.ts`

- 在 `plan()` 里、**发出 provider 请求之前**调用 `solveRectangleFold`：
  - `needs_fold_angle` ⇒ 直接返回澄清信封（问折角）；
  - `goal_does_not_hold` ⇒ 直接返回澄清信封（说明目标不成立 + 距离）；
  - 只对 `workspace === "geometry3d"` 生效；其余题面照旧交给模型。
- 这样"用户案例不生成可提交草稿"在 **model planner 这条生产路径**上有确定性证据，
  而且命中的两族终态**一次模型调用都不发**（省费用，也不让模型把不成立的目标圆过去）。

**验证**

- `rectangleFoldPlan.test.ts` 7/7：目标解析（不误读平面垂直）、用户案例澄清（残差 12 + 2√85/5）、
  长度题计划经 `compilePlan` 编出折后 B′=(16/5, 8/5, −4/√5)、改名/尺寸/另一条对角线、
  缺折角澄清、无目标仍出计划。
- `modelPlanner.test.ts` 新增 3 条：缺折角与目标否定都**不发请求**、非本族照旧调用模型。

**剩余（重要）**

- `localPlanner` 还没有本族的通用意图（浏览器无 provider 时走不到这条构造）。
- 未支持：连续两次矩形折叠、折角未知的联立求解在矩形分支上的复用、非矩形四边形折叠。
- 构造坐标把 `ring[0]` 放原点、`ring[0]→ring[1]` 放 x 轴（内部坐标系）；与画布现有对象的相对位置无关。

### 3.2 折前 / 折后状态核验（本轮第三轮补）

**改动** `packages/agent-core/src/diagramVerification.ts`

- `preFoldStateOf(plan, drawn)`：从**真实动作**重建折前状态 —— 只认**单次**、且**显式给了
  `vertices`** 的 `solid.fold`（折前坐标是计划自己声明的，内核按它算折后位置）。
  没给坐标的折（按点名从文档找点）或多次折叠一律返回 `null`，**不猜**，按原口径核验最终文档。
- 状态归属：`fixedLength / equalLength / segmentRatio / midpoint / pointOnSegment /
  planarAngle / perpendicular / parallel` 这些**折前图形条件**，只要点到了会动的那个点，
  就用折前坐标核；`planePerpendicular` / `dihedral` / 折后距离等仍用最终文档。
- **折后别名**：题面写 `平面 ABC ⊥ 平面 ACD` 时，折后的 `ABC` 指 `A B′ C`。
  文档里没有折前名字时，把 `apex` 别名到 `apexAs` 的坐标（文档里真有该名字时以它为准）。
- 每条判据的 `reason` 标明「按**折前状态**核验」，面板上看得见用的是哪个状态。

**为什么必须做**（两条实测）：

- 计划把折后点改名后，最终文档里没有 `B`：旧的单一状态核验把 `AB=4` 报成"点名缺失：B"。
- **跨折痕的量会随折而变**：矩形对角线 `BD=2√5`（折前 √20）与折后 `B′D=2√85/5` 是两个数；
  拿最终文档核折前条件会把对的判错。用例同时断言「折后 B′D 与 2√5 相差 > 0.5」，
  证明 `BD=2√5` 的通过只可能来自折前坐标。

**同步更新的旧用例（原先钉住的是缺口本身）**

- `diagramFoldPoints.test.ts`：`AE=1` 从"点名缺失：A"改为**折前状态通过**；
  新增跨折痕判别 `AB=2`（折前 2、折后 √3）与折后 `PE=1`（不带折前注记）。
- `foldedTriangleClauses.test.ts`：`AC=3` / `BC=4` / `CD=1` 从"点名缺失：C"改为
  **折前状态通过**；`C'D⊥平面 ABD` 仍按折后核、仍如实报矛盾（残差 1/√17）。
- `pointOnConic.test.ts` 的"缺名"理由保持不变：`missing` 的判据仍是"点名表**建出来了**"
  （不是"表非空"），本轮第一版曾把空表也算成"建出来了"，被这条用例当场抓回。

**验证**

- `rectangleFoldStateVerification.test.ts` 3/3；上述三个旧文件相关用例全绿；
  全量 `packages/agent-core` + `apps/web/src/agent`：**2401 passed / 1 todo**，exit 0；
  `npm run typecheck` exit 0；`eslint .` exit 0。

**剩余**

- 折后条件里"点在折片上的位置"这类需要状态链的量仍未覆盖。
- `localPlanner` 仍未接本族通用意图。

### 3.3 矩形义务与用户案例的草稿态（本轮第四轮补）

**改动**

- `diagramObligations.ts`：新增 `rectangle` 义务（`targets` = 环上四点），收两种语序：
  `矩形 ABCD 中` / `长方形 ABCD`（前置形状名）与 `四边形 ABCD 是矩形`；
  `面/侧面 … 是矩形` 那条旧句型也改为落 `rectangle`（原来拆成三个 `perpendicular`）。
- `diagramVerification.ts`：新增矩形判据 —— **非退化**（面积 > 0）、**顶点闭合**（`A+C = B+D`）、
  **共面**（D 到平面 ABC 的距离）、**相邻边两两垂直**（环上四条边向量，注意不是"顶点到两个邻居"
  那种写法，那是量对角线）。角不对时给归一化点积，结构与共面不对时给长度残差。
  `rectangle` 进 `PRE_FOLD_KINDS`：折前状态核。
- `obligationIR.ts`：`rectangle` 进已判种类表，容差按绝对长度（残差是闭合/共面）。

**结果**

- 用户案例（`矩形 ABCD`、`AB=4`、`BC=2`、`AB⊥BC`、`BD=2√5`、两平面垂直、折起）现在
  **全部 checks `passed`**，`diagramVerification.status === "passed"` —— 题设账干净，
  折前条件用折前坐标、折后条件用折后坐标、矩形用四条判据一起核。
- 假目标（`求证 BD⊥AC`）仍在 `modelPlanner` 的请求前安全闸被拦成澄清，**不生成可提交草稿**。
- 负例：把折片折前坐标里的 B 挪成不闭合 ⇒ `rectangle` 判 `failed`（不是只查相邻边垂直）。

**验证**

- `rectangleFoldStateVerification.test.ts` 4/4（含"整体 passed"与"不闭合 ⇒ rectangle failed"）。
- `faceShapeReaders.test.ts` 的"矩形 ⇒ 三个直角"按新事实翻转成"一条 `rectangle` 义务"
  （旧拆法在三维里不成立：斜四边形也能凑出三个直角）；正方形/菱形两条不变。
- 全量 `packages/agent-core` + `apps/web/src/agent`：**2402 passed / 1 todo（230 文件）**，exit 0；
  `npm run typecheck` 0；`eslint .` 0；`docs-consistency` 0；`@draw/web` build 0。

**剩余**

- 连续两次矩形折叠、折角未知的联立求解在矩形分支上的复用未做。

### 3.4 本地通用族意图（本轮第四轮补）

- `localPlanner` 新增 `RECTANGLE_FOLD` 意图（触发：`矩形` + 折起/翻起/翻折/折叠，`allowWhenAsking`）：
  `build` 调 `solveRectangleFold(input.prompt)`，三种终态各自落地 ——
  出计划（原样返回动作链）/ 缺折角（澄清问角度）/ 目标不成立（澄清说明哪条不成立 + 距离）；
  读不全（缺边、折痕不是对角线）把原因交给用户。
- **不逐字匹配原题**：边长、点名、折痕（AC 或 BD）都从题面读；代表题仍走上游既有夹具（本意图排在它们之后）。
- 用例：`localPlanner.test.ts` 新增 4 条（完整题设出计划、缺折角、假目标、改名/改尺寸仍命中）。

**结果**

- 浏览器**无 provider** 时也能走到这条确定性构造（`createLocalPlanner` 的路径）。
- 仍需浏览器 e2e 证明"预览 → 确认 → 撤销"（T08 未做）。

**验证**

- `localPlanner.test.ts` 63/63。

### 3.5 浏览器闭环（T08 本族，第五轮补）

新增 `e2e/agent-rectangle-fold.spec.ts`（3 条，真实浏览器 + WebGL 画布 + 生产路径）：

1. **完整题设 + 长度目标**：本地通用意图 → 协调器 → 编译器 → 隔离草稿 → 「等待你确认」；
   确认面板写明"只占一步撤销"；**确认前画布对象数为 0**（主文档没变）；确认后对象 >0 并截图
   `test-results/rectangle-fold-preview.png`；`Ctrl+Z` **一步**回到 0。
2. **目标 `BD⊥AC` 不成立**：界面出现澄清正文（"不成立……" + 距离），
   **没有**「确认改动」面板、**没有**「确认并提交」按钮 —— 假目标不生成可提交草稿。
3. **缺折角**：澄清正文问"折角"，同样没有确认面板 —— 不默认 90°。

验证：`npx playwright test e2e/agent-rectangle-fold.spec.ts --workers=1` → **3 passed**（约 7.7s）；
`npm run typecheck`（含 e2e tsconfig）0；`eslint e2e/agent-rectangle-fold.spec.ts` 0；
翻折/连等相关 e2e 子集（本族 + fold-preview + fold-chain + chain-equality + exam-solid）→ **7 passed**（约 12.1s），
说明 `localPlanner` 新增的通用意图没有抢走既有代表题的路径。

**边界**：这是**本地确定性规划器**的浏览器证据，不是真实模型成功率；
「缺折角 / 假目标」两条的文案与状态来自 `agentRunner` 的 `needs_more_information` 分支，
没有 provider 在场。

## 4. A4 Worker 不得把澄清包装成成功

**核实**

- `draftStore.stage` 已有 `if (!compiled.ok || compiled.draftDocument === null)` 的失败分支；
  澄清问题在"无 error 诊断"时映射为 `needs_more_information`，否则保留原诊断码。
- `workerRuntime` 成功路径的 `document` 来自 `commitTransaction`，契约层 `readCompileResult`
  也拒绝缺 `document` 的回包；`compileInWorker` 成功分支因此不会产出 `draftDocument: null`。

**新增测试** `apps/web/src/agent/stagedClarification.test.ts`（3 条）

1. `ok:true + draftDocument:null + 澄清` ⇒ `ok:false`、`needs_more_information`、问题原文保留、
   预览 hash/版本/候选文档不变。
2. `ok:true + draftDocument:null + 无澄清` ⇒ 仍失败、草稿不动。
3. in-process 与生产 Worker（`createWorkerCompileStrategy` + `inlineWorker`）对同一份计划：
   同一原因码（`unsafe_omission`）、同一澄清正文（含"半径"）、失败前后哈希相同、版本不推进。

**验证**

- `npx vitest run apps/web/src/agent/stagedClarification.test.ts` → 3/3 passed。

**剩余**

- 该 fixture 走的是"参数审计同时给出问题与 error 诊断"的路径，因此界面看到的是 `unsafe_omission`
  诊断（正文即问题），而不是 `needs_more_information`；后者的"只有问题、没有 error 诊断"路径
  由第 1 条 stub 用例守住。两条路径是**不同**的编译产物，这里如实分开记录。

## 4.5 T01 `eval:reliability` 入口（第六轮补）

**新增**

- `scripts/reliability-eval/runner.mjs` + `vitest.reliability.config.ts` + `apps/web/src/agent/fixtures/reliabilityEval.eval.test.ts`；
  `package.json` 增加 `eval:reliability`，默认 `npm test` 明确排除这个文件（与 solid eval 同一条纪律）。
- 三种模式互斥：
  - `--offline`（缺省）：确定性本地规划器，**不产生费用**；
  - `--replay FILE`：回放记录的**逐轮信封**，记录里没有的轮次不会被补出来（缺一轮即标记未完成）；
  - `--allow-paid --max-requests N`：真实 provider，必须另有 `DEEPSEEK_API_KEY`，否则 **exit 2 拒绝启动**（实测）。
- 链路是生产那一条：`createAgentRuntime`（真实 `DraftStore` + 编译器/Worker 兜底 + 真实协调器）。
  每条用例用**干净文档与干净会话**，跑到「待确认 / 澄清 / 失败」终态，**从不自动确认**；
  `writeDocument` 调用次数逐条断言为 **0**。
- 报告：每条用例一个**原子写入**的 JSON（`case-<id>.json`）+ `summary.json` + `replay.json`；
  记录终态、verification、澄清问题、请求数、耗时、逐轮信封；费用记 `null` / `costKnown: false`（**不写 0**）。
- 题单目前是 **dev-smoke 14 条**（矩形折叠 6 / 表达变式 3 / 常规 3 / 负例 3，其中 1 条因已知缺陷跳过，
  见 §4.7），**不是** T02 的验收题单；题单已外置并带独立 oracle（§4.6）。
  分母与"未执行"在 summary 里如实列出（`notRun`、`incomplete`）。

**第一跑抓到的真实缺陷（已修）**

- 首跑 `rect-fold-length` 拿到 `draftDocument` 却没有 `diagramVerification`：`draftStore.stage`
  只在 `planHasVerifiableFigure(actions) || readFoldTransformations(prompt)` 时核验，而**没有折后点名**的
  `沿对角线 AC 把 △ABC 折起` 两者都不满足 ⇒ 这一族"折了却没核验"从后门通过。
- 修法：`draftStore.stage` 增加 `readNamedFold(prompt).status === "ok"` 这一支（核验条件与 `checked` 条件同时加）。
  这不是评测专用补丁 —— 产品草稿面板同样因此拿到核验报告。

**实测读数**

- `npm run eval:reliability -- --offline` → **3 tests passed**；summary：**4/4 passed、requests=4、incomplete=0、costUsd=null**；
  另有 `mechanism-cancel.json` 与 `mechanism-budget.json`。
- **取消**：用一个"进门后挂住"的规划器把取消点钉在规划返回之后 ⇒ `cancelAccepted=true`、
  终态 `cancelled`、事件停在 `planning`、`liveWrites=0`（迟到的计划没有被暂存或提交）。
- **预算中断**：第一份计划是退化棱柱（编译期拒绝并给修复请求），`generation` 上限给 1 ⇒
  修复轮被总预算拒绝：终态 `failed`、**规划器只被问了一次**、`liveWrites=0`，
  账本尾条为 `budget exhausted: budget_repair；额度：generation 还剩 0、network 还剩 7`。
- 用上一次运行产出的 `replay.json` 回放 → **1 test passed**（4/4，不补轮次）。
- `--help` 打印三种模式与费用口径；`--allow-paid --max-requests 2`（无密钥）→ **exit 2**，
  消息为 "live mode requires DEEPSEEK_API_KEY; refusing to start (no automatic spend)"。

**剩余**

- **T02 题单与独立 oracle 未做**：当前 4 条是开发冒烟，不能当质量分母。
- **真实模型基线未跑**（无凭据/费用授权）；live 模式的逐轮**原始响应**没有落盘（只有信封），
  真实成本也仍无法可靠计量 ⇒ 质量与费用门槛保持**未完成**。
- 请求数目前只归并"规划轮次"（含协调器修复轮）；**工具续轮 / 传输重试 / 降级**的请求数
  要等真实模型路径接通后再逐项并入 summary。

| 任务 | 状态 | 说明 |
| --- | --- | --- |
## 4.6 题单外置与独立判据（第八轮补）

**题单外置**

- 新增 `test-fixtures/reliability/dev-smoke.json`：6 条 **dev-smoke**（不是验收题单），每条带
  `provenance`（来源 + `reviewStatus: "unreviewed"`）、`requiredOutputs`、可选 `oracle`。
- runner 支持 `--cases FILE`（缺省即上面那份）；评测代码不再内联题文，题单可替换、可冻结。
- 三条矩形折叠题（用户案例 / 改名改尺寸 / 另一条对角线）各带**独立 oracle**：
  折后点坐标、边长、对角线、点积残差、两平面垂直；两条澄清题与立方体题没有 oracle。

**独立判据**（`apps/web/src/agent/fixtures/reliabilityOracle.ts`）

- 只读候选文档里的 `point3.label/position`，用**自己的一套向量运算**核 `distance / dot /
  point-coordinate / planes-perpendicular / point-count`；不 import 任何 agent-core 解析/核验模块。
- 缺一个点名 ⇒ 该条失败并说清缺谁；候选文档缺失 ⇒ `not_applicable`（**不算通过**）。
- 打分口径改为：`passed = 期望终态 ∧ requiredOutputs ∧（独立 oracle 通过或 not_applicable）`；
  逐条报告里新增 `independent`（status + 每条 fact 的实测值与 oracle 值）。

**实测读数**

- `npm run eval:reliability -- --offline` → **3 tests passed**；summary **13/14 ran、13 passed、1 skipped、incomplete=1**、
  `firstAttemptPassed=13`、`repairedPassed=0`、`costUsd=null`；6 条带独立 oracle 的题 `independent: "passed"`。
- 跳过的那条是**已知缺陷**（`rect-fold-chain`），见 §4.7 —— 它**不算通过**，并计入 `incomplete`。
- 用该次运行的 `replay.json` 回放 → **3 tests passed**（可重放部分 13/13；被跳过的题没有轮次，不会被补出来）。
- `reliabilityOracle.test.ts`（默认单元，3/3）：距离/点积/坐标/平面垂直全过、篡改坐标逐条失败、
  缺点名失败、候选缺失 `not_applicable`。

**剩余**

- 独立 oracle 目前覆盖矩形折叠一族（点/长度/点积/平面垂直）、球/棱柱的种类计数；**验收题单（60 题）与人工复核未做**。
- 评分尚未区分"首次成功"与"修复后成功"的**真实轮次**（当前以规划轮次近似），也没有冻结系统提示词/模型/预算。

## 4.7 已知缺陷：`segmentRatio` 把共享端点的两段当成"点分线段"

**发现方式**

扩展 dev 题单时加入表达变式 `AB=2BC=4`（与用户案例同一几何）。预期出计划，实际编译失败：

- `parseDiagramObligations` 给出 `segmentRatio targets=[A,B,B,C]`（两段 `AB`、`BC` 共享端点 `B`）；
- `diagramVerification` 的 `segmentRatio` 分支用 `e === eAgain` 判断"**一个点把一条线段分开**"，
  于是要求 `|AB| + |BC| = |AC|`；
- 矩形里 `|AB|=4`、`|BC|=2`、`|AC|=√20` ⇒ 残差 **1.5279**，`diagram_condition_failed`，三轮修复后失败。

**为什么是产品缺陷**

- 卷面写法 `AB=2BC`（两段共享顶点）是受支持的比例表达；它**不**蕴含 `B` 在 `AC` 上。
- 同一个编码也确实用于 `DE=2EA`（`E` 在 `DA` 上把线段分开）。**语法无法区分这两种意图**，
  当前实现用"名字连续重复"当唯一判据，于是共享端点被误判。

**当前处置（不掩盖）**

- 该题在题单里标 `knownIssue`，评测**跳过执行**并在 summary 里进 `skipped` 与 `incomplete = 1`；
  它**不算通过**，也不会被从分母里删掉；其余 13 条照常跑。

**2026-10-27 已修**（完整读数见 §10；下面这段是当时的修复方向，按它实施的记录在 §10.1）

**修复方向（下一步，带回归）**

1. 给 `segmentRatio` 增加显式来源：`splitPoint: true` 由**分点语义的读取器**设置；
   核验器改用该标志而不是 `e === eAgain`。
2. 通用两段比例读取器（`AB=2BC`、冒号式、链式）显式标 `splitPoint: false`。
3. 回归两则：`AB=2BC=4` 必须按两段比例通过；`DE=2EA` 仍必须要求 `E` 落在线段 `DA` 上
   （反例：`E` 偏离或在反方向 ⇒ failed）。
4. 修好后把 `rect-fold-chain` 的 `knownIssue` 去掉，`incomplete` 回到 0。

## 5. T01–T10 的状态

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| T00 基线与台账 | **完成** | 本文件 + `docs/current-status.md` 追加 |
| T01 `eval:reliability` 完整链路评测 | **部分** | 入口 / 三种模式 / 原子报告 / 离线回放 / 取消 / 预算中断 / 题单外置 / **独立 oracle 回代**（§4.5–4.6）；**2026-10-27 起 dev-smoke 14 条全部执行、14 通过、`incomplete = 0`（无跳过）**（§10.2）；真实模型基线与工具续轮等请求归并**未完成** |
| T02 开发集 20 题 / 验收集 60 题 | **部分** | **2026-10-27 第二块：dev-smoke 扩到 22 条**（常规 5 / 翻折 7 / 表达变式 5 / 负例 5），22/22 执行且全部通过，16 条带独立 oracle（§11）；**仍未到任务书的分母口径（20 条开发集 + 60 条验收集）、`reviewStatus` 全是 `unreviewed`（没有独立复核）**，不能当验收 |
| T03 原文来源与覆盖 | **部分**（既有） | 本轮只保证 A1 的括号窗口与 `sourceText/start/end` 一致；未做区间映射表 |
| T04 统一对象身份和状态 | **部分** | `namedFold` 只覆盖单折；IR 级状态契约未接入 |
| T05 状态执行/求解/回代 | **部分** | 矩形单折的构造、计划与回代已做；`coupledFolds` 未接矩形分支 |
| T06 Worker 与草稿链路 | **部分** | A4 复核 + 测试；无折后点名的折已纳入草稿核验（§4.5） |
| T07 最多两轮共享修复 | **未开始** | 预算与协调器本轮未改 |
| T08 浏览器闭环 | **部分** | 本族 3 条 e2e + 5 spec 子集 7 passed；完整浏览器回归与真实模型路径未跑 |
| T09 冻结新题真实验收 | **未开始** | 无真实模型凭据/费用授权，保持未完成 |
| T10 交付 | **部分** | 源码头；桌面包、远程推送未做 |

## 6. 最终门禁读数（2026-10-26，本机）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | **exit 0**（workspaces + e2e + scripts） |
| `npx vitest run packages/agent-core apps/web/src/agent --maxWorkers=1` | **2409 passed / 1 todo**，exit 0（第八轮独立判据后；2388 → 2398 → 2401 → 2402 → 2406 → 2409） |
| `npx vitest run scripts/docs-consistency --maxWorkers=1` | exit 0 |
| `npx eslint .` | exit 0 |
| `npm run build --workspace @draw/web` | exit 0（`✓ built in 4.83s`；仅有 Vite 的既有 chunk 体积提示） |
| `npx playwright test e2e/agent-fold-preview.spec.ts --workers=1` | exit 0（既有翻折预览回归） |
| `npx playwright test e2e/agent-rectangle-fold.spec.ts --workers=1` | **3 passed**（本族：预览/确认/撤销、假目标澄清、缺折角澄清） |
| `npx playwright test` 翻折/连等子集（5 个 spec） | **7 passed**（既有代表题未被新意图抢走） |
| `npm run eval:reliability -- --offline` | **3 tests passed**；summary **13/14 ran、13 passed、1 skipped、incomplete=1、firstAttemptPassed=13、costUsd=null**；6 条独立 oracle 通过；另写 cancel / budget 机制报告 |
| `npm run eval:reliability -- --replay <replay.json>` | **3 tests passed**（可重放部分 13/13，不补轮次） |
| `npm run eval:reliability -- --allow-paid --max-requests 2`（无密钥） | **exit 2**（拒绝启动，不发生任何付费请求） |

注意：A1/A2/A3/A4 的用例都在上面那次全量单元里；没有跳过、没有提高超时、没有放宽任何断言。

补充：`apps/web/src/agent/stagedClarification.test.ts` 第一版用 `StagedCompileResult` 作 `stage` 的返回类型，
`npm run typecheck` 报了 2 条（`StageResult` 才含 `{code,message}`），改成 `StageResult` 后 exit 0 —— 这条也记下来，
因为它说明"只跑 vitest 不跑 tsc"会漏掉这类类型谎言。

### 6.1 2026-10-27（§4.7 修复后复跑，本机）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | **exit 0**（workspaces + e2e + scripts） |
| `npx vitest run`（全量） | **495 文件 / 5241 通过 + 1 todo / 0 失败**，exit 0（158.7 s）。**一处如实**：同一命令的首跑报了 2 条失败且没留下文件名（当时后台还在跑 `eval:reliability`，属于本仓记录过的并行抖动）；立即复跑即全绿，两条读数都在 §10.3 |
| `npx vitest run packages/agent-core`（本次改动面） | 214 项通过（6 个文件：`lengthEquality` / `diagramVerification` / `diagramObligations` / `obligationIR` / `planCompiler.namedPoints` / `foldedTriangleClauses`） |
| `npx eslint .` | **exit 0**（0 error / **17** warning，均为既有未用变量：`planar-constraints` / `polynomial` / `sections3d` 等） |
| `npx vitest run scripts/docs-consistency` | **8 文件 / 20 项**通过（§4.7 的文档改动之后复跑） |
| `npm run eval:reliability -- --offline` | **3 tests passed**；summary **14/14 ran、14 passed、0 skipped、incomplete=0、firstAttemptPassed=14、costUsd=null**；8 条独立 oracle 通过（`rect-fold-chain` 也在其中，`independent: "passed"`） |

**注入验证（两侧都做过，改回源码后逐字还原）**：把核验器那一行改回 `const split = sharedMiddle`
（= 旧行为）⇒ 矩形 `AB=2BC=4` 那条新用例变红；改成 `const split = false && …`（= 只比长度比）
⇒ `DE=2EA` 离轴反例那条变红。两条都不是"写完就绿"的假判据。

### 6.2 2026-10-27 第二块（题单 22 条 + 两种新 oracle 事实）

| 命令 | 结果 |
| --- | --- |
| `npm run eval:reliability -- --offline` | **22/22 ran、22 passed、0 skipped、incomplete=0、firstAttemptPassed=22**；16 条带独立 oracle 全部 `passed`；`costUsd: null` |
| `npx vitest run apps/web/src/agent/fixtures/reliabilityOracle.test.ts` | **6 passed**（新增 4 条：`segment-ratio` / `angle` 的正例与反例、两种新事实的缺点名） |
| `npx vitest run`（全量） | **495 文件 / 5244 通过 + 1 todo / 0 失败**，exit 0（178.0 s） |
| `npm run typecheck` | **exit 0** |
| `npx eslint .` | **exit 0**（0 error / 17 warning，既有未用变量） |
| `npx vitest run scripts/docs-consistency` | **8 文件 / 20 项**通过（本节写完后复跑） |

**回到 §5 的 T02**：题单从 14 条扩到 22 条并按"常规 5 / 翻折 7 / 表达变式 5 / 负例 5"记账，
但 `reviewStatus` 仍是 `unreviewed`、也没有 60 题验收集 ⇒ **T02 仍是"部分"**，不能当验收。

### 6.3 2026-10-27 第三块（§11.5 缺口①②④修掉，题单 24 条）

| 命令 | 结果 |
| --- | --- |
| `npm run eval:reliability -- --offline` | **24/24 ran、24 passed、0 skipped、incomplete=0**；**18 条**带独立 oracle 全部 `passed`；`costUsd: null` |
| `npx vitest run`（全量） | **495 文件 / 5249 通过 + 1 todo / 0 失败**，exit 0（176.0 s） |
| `npm run typecheck` | **exit 0** |
| `npx eslint .` | **exit 0**（0 error / 17 warning，既有未用变量） |
| `npx vitest run scripts/docs-consistency` | **8 文件 / 20 项**通过（本节写完后复跑） |

## 7. 真实模型与费用

- 本轮**没有**任何真实模型调用：所有测试用确定性夹具/stub；`eval:reliability` 只跑过 `--offline` 与 `--replay`。
- 费用：**未知**（报告的 `costUsd` 为 `null`、`costKnown: false`）—— 没有计费证据，**不写成 0**。
  没有读取或使用任何历史额度；live 模式在缺少 `DEEPSEEK_API_KEY` 时直接 exit 2。

## 8. 提交与远程

本地功能提交（`main`，未推送；另有台账/文档提交未逐一列出）：

| 提交 | 内容 |
| --- | --- |
| `4aee620` | A1 长度边界 + A2 等价闸门 + A3 核心层（`namedFold`/`rectangleFold`）+ A4 验收 |
| `529f45b` | A3 计划入口（`rectangleFoldPlan`）+ `modelPlanner` 请求前安全闸 |
| `88f0839` | 折前/折后状态核验 |
| `b6ce249` | `rectangle` 义务 + 用户案例整题 `passed` |
| `cbc50cd` | `localPlanner` 矩形折叠通用族意图 |

此后还有 8 个提交：`eb472d6`（台账）、`5d38a2d`（本族 e2e）、`406747d`（e2e 读数）、
`bf5654e`（`eval:reliability` 入口）、`183439a`（取消/预算机制）、`1fb1ab5`（题单外置 + 独立 oracle）、
`bf512a6`（首次/修复后口径）、`6885de1`（dev 题单扩到 14 条 + 已知缺陷），见 §4.5–4.7。

- **2026-10-27 00:31（+08:00）首次推送失败**：`git fetch origin` 与 `git push origin main` 都在
  `github.com:443` 连接阶段超时（`curl 28 ... Could not connect to server`，退出码 128）。
  当时 `origin/main` 的本地引用仍是 `bdf2c48`（**过期**），不能用它判断远端没有新提交。
- **随后重试成功**（同一轮，网络恢复）：先 `git fetch origin`（exit 0），再 `git push origin main`
  → **`bdf2c48..aa3f3578 main -> main`**（非强制、快进）。推送后 `origin/main = aa3f3578`，
  `git rev-list --left-right --count origin/main...main = 0 0`；本地 14 个提交已全部到达远程。
  远端在 fetch 时没有新提交，因此没有覆盖任何他人工作。
- **离线备份**：`D:\数学画布\mathcanvas-main-push-20261027.bundle`（`bdf2c48..main`，143 KB，
  含上述 14 个提交）。它只是恢复手段，不再是唯一通道。
  ```bash
  git fetch /path/to/mathcanvas-main-push-20261027.bundle main:main
  git fetch origin && git log --oneline origin/main -3   # 推送前仍要先确认远端没有新提交
  git push origin main                                   # 禁止强推
  ```
- 既有的 `apps/desktop/src-tauri/Cargo.toml` 修改与 `coverage/` 未触碰、未提交。

## 9. 下一步（按优先级）

1. ~~**修 §4.7 的 `segmentRatio` 共享端点缺陷**：加显式 `splitPoint` 来源，回归 `AB=2BC=4` 与 `DE=2EA` 两侧；
   修好后去掉 `rect-fold-chain` 的 `knownIssue`，`incomplete` 回到 0。~~ **2026-10-27 已完成**，见 §10。
   剩余边界（如实）：`AB=2BC` **不带绝对长度锚点**时仍按定比分点读（`splitPoint: true`）——
   与 `DE=2EA` 语法完全同形，见 §10.4。
2. ~~**（下一块）** 把 dev 题单补到 20 条（任务书分布：常规 5 / 翻折 7 / 表达变式 5 / 负例 3），并给常规/表达题补更多 oracle 类型。~~
   **2026-10-27 已完成并超出（24 条：常规 5 / 翻折 8 / 表达变式 6 / 负例 5，新增 `segment-ratio` 与 `angle` 两种 oracle 事实）**，见 §11 与 §12。
   下一块按剩下的缺口与 T01 剩余项排：(a) 无长度锚点的 `AB=2BC` 与定比分点同形（§10.4，需要"读法依赖候选图"的新耦合，先想清楚再动）；
   (b) T01 的逐轮原始响应归档与工具续轮/重试/降级的请求归并；(c) 连续两次矩形折叠与折角未知的联立求解在矩形分支的复用。
3. **T01 `eval:reliability`** 的剩余项：真实模型基线、逐轮原始响应、工具续轮/重试/降级的请求归并。
4. 连续两次矩形折叠、折角未知的联立求解在矩形分支上的复用。
5. 远程可达后按"先 fetch、再推送"的顺序上推本地提交。

## 10. 2026-10-27 §4.7 修复记录：`segmentRatio` 的显式来源

### 10.1 改了什么（4 处代码 + 1 处题单）

1. **义务带上来源**：`DiagramObligation` 增可选 `splitPoint?: boolean`（`ObligationDraft` 的 `Pick<>` 同步扩一项）。
   它不是"从形状猜出来的"，而是**读取器写下的**：`true` = 这条比例在给共享点定位（定比分点），
   `false` = 两条线段的长度比（题面没说那个点在哪条线上）。
2. **读取器各自声明**：
   - `lengthEquality.relationsOf`（链式，`AB=2BC=4` / `DE=2EA` 都走这里）：**有绝对长度锚点** ⇒ `splitPoint: false`；
     **没有锚点** ⇒ `true`。理由：带 `=4` 的是尺寸陈述（两条边各多长），不带锚点的连续两段比例才是卷面上的定比分点写法。
   - 冒号式 `AE:AD=2:5`、倍数 + 后置长度 `AD=2AB=2`（`[A,D,A,B]` 形状）、分数式 `AE=2/5 AD` ⇒ `false`；
     纯倍数 `X=nY` ⇒ `true`（保持它原来的读法）。
3. **核验器只读来源**（`diagramVerification` 的 `segmentRatio` 支）：
   `const sharedMiddle = e === eAgain`；`const split = sharedMiddle && item.splitPoint !== false`。
   两个要点：① 只有"中间点名重复"这种形状**才可能**走分点支（否则 `AE:2/5 AD` 的 `AE/AD` 会被误算成 `AE/ED`）；
   ② 来源缺省时仍按旧形状推断，只为兼容手工构造的义务（不走读取器的那条路）。
4. **IR 往返不丢字段**：`claimEvidence.ObligationGeometry` 增 `splitPoint`，`obligationIR` 的
   `claimOf` / `toLegacyObligationSet` 各补一行 —— 否则 `obligationIR.test.ts` 那条
   "IR 还原必须与 `parseDiagramObligations` **逐字段相等**"的判据当场变红（它确实先红了，见 10.2）。
5. **题单**：`test-fixtures/reliability/dev-smoke.json` 去掉 `rect-fold-chain` 的 `knownIssue`。

**选了什么、为什么不选另一个**：另一条路是"让核验器按图形上下文猜"（例如问 `B` 是不是已经是多面体顶点）——
那要引入"题面读法依赖候选图"的新耦合，同一个题面配不同的图会读出不同的条件，违反本仓"判据只从原话来"的纪律。
所以选"读取器声明来源、核验器只读标志"。

### 10.2 RED → GREEN

| 用例（文件） | 先红（未修时） | 转绿（修完后） |
| --- | --- | --- |
| `lengthEquality.test.ts`「anchored chain ratio `AB=2BC=4` is a two-segment ratio」 | `expected undefined to be false`（草稿上没有这个字段） | 通过 |
| `lengthEquality.test.ts`「unanchored `DE=2EA` keeps split point」 | `expected undefined to be true` | 通过 |
| `diagramVerification.test.ts`「矩形 `AB=2BC=4` 按两段比例判」 | `segmentRatio` 判 `failed`（要求 `|AB|+|BC|=|AC|`） | 通过（比值 2 成立、不要求共线） |
| `diagramVerification.test.ts`「`DE=2EA` 离轴反例必须 failed」 | 用例本身先红了两次：先是阿波罗尼斯方程的判别式算错（`disc = −2`），改成 `4ac` 后 `|ED|/|EA|` 恰好 2 且 `y ≠ 0` | 通过（判 `failed`） |
| `obligationIR.test.ts`「IR 还原逐字段相等」 | `splitPoint` 在 IR 往返里丢了 ⇒ `- "splitPoint": true` | 通过（`claimEvidence` + `obligationIR` 各补一处） |

**注入验证**（改完源码后逐字还原）：`const split = sharedMiddle`（旧行为）⇒ 矩形那条变红；
`const split = false && …`（只比长度比）⇒ `DE=2EA` 那条变红。两侧都不是"写完就绿"的假判据。

### 10.3 门禁读数

见 §6.1（2026-10-27 复跑表）：`typecheck` exit 0、全量单测 **495 文件 / 5241 通过 + 1 todo / 0 失败**、
`eslint` 0 error / 17 warning（既有）、`docs-consistency` 8 文件 / 20 项、
`eval:reliability --offline` **14/14 ran、14 passed、incomplete 0、costUsd=null**。

### 10.4 剩余边界与没做的事（如实）

- **`AB=2BC` 不带绝对长度锚点**时仍按定比分点读（`splitPoint: true`）：它与 `DE=2EA` **语法完全同形**，
  读取器只能挑一侧；挑的是保守侧（fail-closed）：会把矩形上这种写法判成 `failed`，而不是悄悄放过。
  要按"`B` 是不是已有顶点"分开，需要引入上面说过的那个新耦合，属于后续任务。
- **真实模型调用 0 次**：没有 `DEEPSEEK_API_KEY`，`--allow-paid` 直接 exit 2；费用记 `null` 不写 0。
- **T02 的 20/60 题、独立复核、工具续轮/重试/降级的请求归并**：仍未做（下一块）。
- **e2e 本轮未跑**：本次改动只动读取器 / 核验器与题单，浏览器路径没变；上一轮本族 e2e 3 passed 仍是既有读数。

### 10.5 提交与远程（2026-10-27）

| 提交 | 内容 |
| --- | --- |
| `50a0d68` | 代码 + 用例 + 题单：`splitPoint` 来源、核验器改读标志、四则回归、去掉 `knownIssue` |
| 紧随其后的文档提交 | 本文件 §4.7 / §5 / §6.1 / §9 / §10、`docs/current-status.md`、`CHANGELOG.md`、`docs/feature-catalog.md`、`docs/project-progress.md` |

推送按本仓纪律走"先 `git fetch` 再看 ahead/behind、然后 `git push`（禁止强推）"。本轮推送结果见 §8 末尾追加的那条。

**推送记录（2026-10-27，+08:00）**：`git fetch origin` 之后 `git rev-list --left-right --count origin/main...main` 为 `0 2`（远端无新提交 ⇒ 不覆盖别人），
`git push origin main` → **`92e2ed05..1193e85a main -> main`**（快进、非强制），推送后为 `0 0`。

## 11. 2026-10-27 第二块：dev 题单扩到 22 条 + 两种新 oracle 事实

### 11.1 题单分布（`test-fixtures/reliability/dev-smoke.json`，22 条）

| 类别 | 条数 | 用例 id | 与任务书的关系 |
| --- | --- | --- | --- |
| 常规构图 | 5 | `cube`、`sphere`、`prism`、`tetra-regular`（正四面体，棱长 2）、`planar-point`（平面点） | 任务书要 5 ✔ |
| 翻折 | 7 | `rect-fold-length`、`-renamed`、`-other-diagonal`、`-square-true-goal`、`-face-first`、`-bd-triangle-bcd`（3×6，折痕 BD，折 △BCD）、`-other-flap`（4×2，折痕 BD，折的是另一侧 △ABD） | 任务书要 7 ✔ |
| 表达变式 | 5 | `rect-fold-chain`（长度 + 连等各写一次）、`-ratio-only`（只给 `AB=2BC=4`）、`-fold-later`（`将 △ABC 沿 AC 折起` 后置语序）、`-side-prefix`（`边长 AB=4、BC=2`）、`-tight-spacing`（`平面 ABC⊥平面 ACD` 无空格） | 任务书要 5 ✔ |
| 负例 | 5 | `-false-goal`、`-no-angle`、`-missing-side`、`-unsupported-sum`、`-unrelated-planes` | 任务书要 3，**多 2 条**：这两条是既有回归，删掉会丢覆盖 |

`notice` 里写的是这同一组数，题单自己就能对账。**每一题都带 `provenance.source` 与 `reviewStatus: unreviewed`** ——
它们是开发冒烟，不是 T02 的验收题单（那条要 20/60 题 + 独立复核，仍未做）。

### 11.2 两种新 oracle 事实（`reliabilityOracle.ts`）

| 事实 | 口径 | 为什么加 |
| --- | --- | --- |
| `segment-ratio` | `\|ab\| / \|cd\| = value`（相对容差 1e-6） | §4.7 那条缺陷的形状就是"两段之比"；产品侧改成只比长度比之后，**oracle 侧也必须能独立量出同一个比值**，否则这条判据只在产品内部自说自话 |
| `angle` | `∠((b−a), (d−c))`，单位度 | 翻折题最有用的不变量是"折片与折痕的夹角折叠前后不变"（`∠(AB′, AC) = ∠BAC = 26.565…°`），它不依赖折起多少度，能把"折片没被拉长/压扁"独立钉住 |

**RED → GREEN**：三条新用例先在 `evaluateOracle` 上真红（未知 kind 掉进 `point-coordinate` 那支 ⇒ 判 `failed`、
且缺点名时给出的是一句空话 `缺点名：。`）；补齐两支 + 名字检查后 **6/6 通过**，其中两条各自带一个反例
（比值写错、折错的图 ⇐ 都必须 `failed`）。

顺带一处诊断改进：`primitive-count` 不指定 `type` 时，`detail` 现在会**列出实际都有哪些图元类型**
（`point3×1` 这种）。这一条不是装饰 —— 本轮就是靠它查清"平面点在候选文档里是 `point3` 而不是 `point`"。

### 11.3 新题是怎么选进来的（探针 → 只收真的过了的）

先写**探针题单**（不提交），逐条跑 `--offline` 看真实终态，只有"计划成立 + 题设核验 passed + 独立 oracle passed"
的才进正式题单：

| 探针写法 | 终态 | 处置 |
| --- | --- | --- |
| `长方形 ABCD 中，AB=6，BC=3，沿对角线 BD 把 △BCD 折起…` | clarification | **不收**：`长方形` 这个同义词在折起求解器里不认（缺口 ①） |
| `矩形 ABCD 中，AB:BC=2:1，AB=4，…` | clarification（缺少边） | **不收**：折起求解器只认"逐条给出长度"，"比例 + 一条边"读不出（缺口 ②） |
| `矩形 ABCD 中，AB=4，BC=2，且 AB=2BC，…` | failed | **不收**：`AB=2BC` 无长度锚点 ⇒ 按定比分点读（§10.4 的已知边界，缺口 ③） |
| `画一个点，坐标是 (1, 2)。` | plan，但点是 **(1, 0)** | **不收**：本地规划器只取第一个数字（缺口 ④）；换成 `画一个点。` 后进题单 |
| 其余 8 条（正四面体 / 平面点 / 3×6 折 △BCD / 折另一侧 △ABD / `AB=2BC=4` / 后置语序 / `边长…` / 无空格垂直） | plan + `passed` | **收进题单** |

### 11.4 读数（2026-10-27，本机）

| 命令 | 结果 |
| --- | --- |
| `npm run eval:reliability -- --offline` | **22/22 ran、22 passed、0 skipped、incomplete=0、firstAttemptPassed=22**；**16 条**带独立 oracle 且全部 `passed`；`costUsd: null`、`costKnown: false` |
| `npx vitest run apps/web/src/agent/fixtures/reliabilityOracle.test.ts` | **6 passed**（新增 4 条：两种事实的正例 + 两种反例 + 缺点名） |
| 全量单测 / `typecheck` / `eslint` / `docs-consistency` | 见 §6.2 |

### 11.5 这一块**没做**的事（如实）

- **T02 的 20/60 题与独立复核**：仍是 22 条开发冒烟，题单里的 `reviewStatus` 全部是 `unreviewed`
  —— 没有第二个人复核过这些题面与 oracle，所以**不能当验收**。
- **真实模型**：0 次调用（无凭据）。题单现在能在 live 模式下跑，但没有跑过。
- **下面四个缺口没修**（下一块的候选，按发现顺序）：① `长方形` 同义词；② 折起求解器只认"逐条长度"；
  ③ 无长度锚点的 `AB=2BC` 与定比分点同形；④ 本地规划器忽略"坐标是 (1,2)"。
- **本轮 e2e 未跑**（同 §10.4：改动只在题单、oracle 与上一块的解析/核验）。

## 12. 2026-10-27 第三块：把 §11.5 的三个缺口修掉（题单 22 → 24）

### 12.1 三个缺口与修法

| 缺口 | 根因（查实的位置） | 修法 | 反例（都写了用例） |
| --- | --- | --- | --- |
| ① `长方形` 不被认 | `readRectangleFold` **本来**就同时认 `矩形\|长方形`；缺的是**意图表**里只写了 `矩形`（`LOCAL_INTENTS`）⇒ 整句落到"本地规划器只认识几条固定指令" | 在**匹配层**（`matchLocalIntent`）把形状同义词归一：`normalized.replaceAll("长方形", "矩形")`。放这一处而不是给每条意图再抄一份同义词 | 固定夹具仍按原样命中（`exact` 那条比较的是归一化文本，夹具里没有"长方形"）；`matchLocalIntent` 对其它意图的行为不变 |
| ② 折起求解器只认"逐条给长度" | `readRectangleFold` 只收集 `fixedLength`，比例形（`AB:BC=2:1`）被忽略 ⇒ 判"缺少边 BC" | 新增 `adjacentRatio()`：比例的两段必须分别落在**相邻的一对边**（a 边 = `ring[0]→ring[1]`，b 边 = `ring[1]→ring[2]`，对边等价），且**恰好缺一条边**时才用它补另一条（`r = \|a\|/\|b\|`，两段顺序决定 r 的算法） | `AB:CD=2:1`（两条**对边**之比）**不**用来补边，仍然报"缺少边 BC"；两条边都缺时比例给定不出尺度，也仍然报缺 |
| ④ 本地规划器忽略"坐标是 (1,2)" | `PLANAR_POINT` 只把原话里第一个数字当边长，点永远在 `(size, 0)` ⇒ `(1,2)` 变成 `(1,0)`（`y` 被悄悄丢掉） | 先认 `(x, y)` 写法，认不出才退回示例值 | 无坐标的 `画一个点` 仍是示例值（原用例不动） |

**缺口③（无长度锚点的 `AB=2BC` 与定比分点同形）本轮没修**，理由写在 §10.4：要分开它得引入"读法依赖候选图"的新耦合。
它现在仍走保守侧（判 `failed`），题单里也没有把它当成通过。

### 12.2 RED → GREEN

| 用例 | 先红 | 转绿 |
| --- | --- | --- |
| `rectangleFold.test.ts`「比例 + 一条边 ⇒ 另一条边由比例确定」 | `expected 'unsupported' to be 'ok'` | 通过（`sides` = `{a: 4, b: 2}`） |
| `rectangleFold.test.ts`「比例方向反过来」 | 同上 | 通过（`AB:BC=1:2，AB=4` ⇒ `b = 8`） |
| `rectangleFold.test.ts`「两条对边之比不据此补边」 | **先绿**（旧行为本来就不补）—— 它的作用是钉住"别顺手放宽" | 通过 |
| `localPlanner.test.ts`「用题面给的坐标」 | `expected { alias: 'point', … } to match object { points: [{ x: 1, y: 2 }] }` | 通过 |
| `localPlanner.test.ts`「长方形折起命中同一意图」 | `expected null not to be null` | 通过（计划里有 `solid.fold`） |

### 12.3 题单与读数

两个缺口修好后，这两条从"探针里没过的"变成**正式题单**用例（几何由独立脚本重新推导，不让产品自证）：

| 新用例 | 题面写法 | 独立 oracle |
| --- | --- | --- |
| `rect-fold-oblong-word` | `长方形 ABCD 中，AB=6，BC=3，沿对角线 BD 把 △BCD 折起…` | `\|C′A\|=5.531726674375732`、`\|C′B\|=3`、`\|C′D\|=6`、`∠(BC′, BD)=63.43494882292201°`、`\|C′B\|/\|C′D\|=0.5`、两平面垂直、点数 ≥ 4 |
| `rect-fold-ratio-plus-side` | `矩形 ABCD 中，AB:BC=2:1，AB=4，沿对角线 AC…` | 与 4×2 那族同一组数：`\|AB′\|=4`、`\|B′C\|=2`、`\|B′D\|=3.687817782917155`、`∠(AB′, AC)=26.56505117707799°`、`\|B′A\|/\|B′C\|=2`、两平面垂直、点数 ≥ 4 |

题单因此 **22 → 24 条**（常规 5 / 翻折 8 / 表达变式 6 / 负例 5）。

| 命令 | 结果 |
| --- | --- |
| `npm run eval:reliability -- --offline` | **24/24 ran、24 passed、0 skipped、incomplete=0**；**18 条**带独立 oracle 且全部 `passed`；`costUsd: null` |
| `npx vitest run packages/agent-core/src/rectangleFold.test.ts apps/web/src/agent/localPlanner.test.ts packages/agent-core/src/rectangleFoldPlan.test.ts` | **93 passed** |
| 全量单测 / `typecheck` / `eslint` / `docs-consistency` | 见 §6.3 |

### 12.4 没做的事

- **缺口③**：仍未修（§10.4 的理由），题单里没有它。
- **真实模型 0 次**、**本轮 e2e 未跑**、**T02 的 20/60 题与独立复核**：与 §11.5 相同，未变。
- 一次如实记录：`rect-fold-oblong-word` 的 oracle 角度我第一版写成 `63.43505117707799°`（把 `180 − 116.565…`
  的心算做错了），运行时被独立判据当场挡下（实测量 `63.43494882292201°`）。**这正是 oracle 该有的样子** ——
  它挡的不只是产品的错，也挡题单自己的错。
