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

## 5. T01–T10 的状态

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| T00 基线与台账 | **完成** | 本文件 + `docs/current-status.md` 追加 |
| T01 `eval:reliability` 完整链路评测 | **未开始** | 需要新的 runner + 逐题原子报告 + 离线回放 |
| T02 开发集 20 题 / 验收集 60 题 | **未开始** | 未生成、未独立复核，不冒充 |
| T03 原文来源与覆盖 | **部分**（既有） | 本轮只保证 A1 的括号窗口与 `sourceText/start/end` 一致；未做区间映射表 |
| T04 统一对象身份和状态 | **部分** | `namedFold` 只覆盖单折；IR 级状态契约未接入 |
| T05 状态执行/求解/回代 | **部分** | 矩形单折的构造与回代已做；未接 `planCompiler` / `coupledFolds` |
| T06 Worker 与草稿链路 | **部分** | A4 复核 + 测试；A3 尚未过界 |
| T07 最多两轮共享修复 | **未开始** | 预算与协调器本轮未改 |
| T08 浏览器闭环 | **未开始** | 本轮未跑 e2e |
| T09 冻结新题真实验收 | **未开始** | 无真实模型凭据/费用授权，保持未完成 |
| T10 交付 | **部分** | 源码头；桌面包、远程推送未做 |

## 6. 最终门禁读数（2026-10-26，本机）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | **exit 0**（workspaces + e2e + scripts） |
| `npx vitest run packages/agent-core apps/web/src/agent --maxWorkers=1` | **2406 passed / 1 todo（230 文件）**，exit 0（第四轮本地通用意图后；2388 → 2398 → 2401 → 2402 → 2406） |
| `npx vitest run scripts/docs-consistency --maxWorkers=1` | exit 0 |
| `npx eslint .` | exit 0 |
| `npm run build --workspace @draw/web` | exit 0（`✓ built in 4.83s`；仅有 Vite 的既有 chunk 体积提示） |

注意：A1/A2/A3/A4 的用例都在上面那次全量单元里；没有跳过、没有提高超时、没有放宽任何断言。

补充：`apps/web/src/agent/stagedClarification.test.ts` 第一版用 `StagedCompileResult` 作 `stage` 的返回类型，
`npm run typecheck` 报了 2 条（`StageResult` 才含 `{code,message}`），改成 `StageResult` 后 exit 0 —— 这条也记下来，
因为它说明"只跑 vitest 不跑 tsc"会漏掉这类类型谎言。

## 7. 真实模型与费用

- 本轮**没有**任何真实模型调用：所有测试用确定性夹具/stub。
- 费用：**0**。没有读取或使用任何历史额度。

## 8. 提交与远程

- 本轮**没有** `git commit`、没有 `git push`。
- 没有 `git fetch` 核对远程新增提交；推送前必须先 fetch 并检查，禁止强推。

## 9. 下一步（按优先级）

1. **状态感知的题设回代**：让 `verifyDiagramObligations` 能按"折前 / 折后"分别核验
   （折前条件用折片 `vertices` 的折前坐标，折后条件用最终文档）—— A3 收口的最后一块。
2. `localPlanner` 的本族通用意图（无 provider 的浏览器路径也能用上确定性构造）。
3. 把 `solveRectangleFold` 的 `needs_fold_angle` / `goal_does_not_hold` 接到协调器的
   澄清分支（现在 planner 已经返回澄清信封，但协调器/UI 的文案与"不新建 run"的行为要端到端验）。
4. 浏览器闭环（T08）与 `eval:reliability`（T01）后再谈 T02/T09。
5. 文档：状态感知核验完成后更新 `feature-catalog` 的翻折能力条目与 `current-status` 读数。
