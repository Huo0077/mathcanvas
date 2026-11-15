# 画图工程实施技术附录（T01–T18）：修改方向、测试与参考

<!-- progress-scope: active-reference -->
> **文档角色（2026-11-15 对齐）**：T01–T18画图工程技术附录；局部任务细节服从主计划与机器合同。实时状态仅维护在[当前状态](../../current-status.md)；执行总顺序以[完整实施主计划](2026-11-15-main-restart-master-plan.md)为准，[机器任务合同](2026-11-15-implementation-task-ledger.json)只定义依赖/文件/验收，不另维护完成率。历史数字不能代替本轮证据。
<!-- /progress-scope -->

**版本事实（2026-11-15对齐）**：代码基线59ea3613、重启提交be033b71；旧范围59ea3613..d8743a32的47提交此前已备份并舍弃。重启提交/同步是已发生的操作，不再作为未来任务反复执行；本文实现细节待实际验收。本次对齐不提交/推送，不包含新功能或付费授权。

> **给执行者：** 按任务逐项执行，先复现、再最小修正、最后独立验收。采用 writing-plans / systematic-debugging / test-driven-development / verification-before-completion 流程；本轮未授权并行代理，不自行分派。所有复选框是未来实施清单，不是本轮完成项。

**目标**：从59ea3613出发，使审核后的冻结36题达到数学、实际显示和交互全链路通过，再用独立未见题验证可推广性。

**架构**：沿用已有ObligationIR、确定性路由、几何内核、solver、隔离草稿与确认流程。模型只提供有来源的语义/构造提案；确定性模块生成候选；独立校验器检查最终场景，而不是相信模型或构造器自报成功。

**技术栈**：TypeScript / Vitest / Playwright / Tauri-Rust；不在首批增加CAS、SMT、Python运行时或更换模型供应商。

**设计依据**：[总体设计](../specs/2026-11-15-drawing-reliability-design.md)；[P0–P8阶段计划](2026-11-15-drawing-reliability-repair-plan.md)；[本轮实现审计](../../audit/2026-11-15-drawing-implementation-audit/README.md)；[官方参考](../../research/2026-11-15-drawing-repair-implementation-references.md)。

日期：2026-11-15；代码基线：59ea36133c47971f4252e71f7a0f5ba003dd1028；v4.3.0。

**状态：设计深化，待批准实施。** 本手册补充现有计划，不新建进度体系。功能阶段仍由[当前状态](../../current-status.md)唯一维护，P0–P8未开始。T01–T18是阶段内部工作包，不表示新增18个阶段。

## 审查修订入口（优先于原批次）

配套[审查修复技术附录](2026-11-15-review-driven-next-implementation-plan.md)覆盖已确认的漏小问错误放行、凭据/文件/资源安全、保存恢复、E2E漂移、最终轮次计分与CI。按完整主计划先执行R00/R01-A/R09-A/R10，随后G1/G2，再进入本手册T01–T18；第十一节的画图批次已相应调整。全部新R任务未开始。

## 一、结论与优先级

当前问题不能归结为“模型不够强”。上一轮36题中，25题有草稿、4题通过旧宿主，完整题设证书不可用；这些数字不是本轮复测，也不等于完整正确率。新做的8个只读解析探针没有模型调用、没有改变应用代码，只确认和细化整改位置。

**先做的顺序（审查修订）**：

1. R00固定用户选定的59ea3613；R01先阻断未选问/漏条件的错误认证，不等待大IR升级。
2. R09先修最终轮次计分，R10前置CI信任边界；R02–R06关闭凭据、网络、原生文件、资源与数据丢失风险。
3. R07/R08/R11对齐题图复核、实体绑定、生产UI和干净测试；原T01黄金合同可同步整理，但不拿文档完成抵销安全缺陷。
4. 再推进角链/比例、符号曲线、辅助点、立体/折叠的确定性构造，以及独立数学/视觉验收。
5. 最后做已授权未见题/多轮评测与安装发布；拒绝删除失败题、放宽门禁或无限重试。

**100%目标的边界**：先争取冻结36题在明确合同下36/36，而不是承诺任意输入。缺条件/不支持/无可靠解时诚实停下；安全澄清不计作出图成功。若审核发现题文缺配图才能构造，保留原输入在分母并另设完整输入版本，不能事后删题凑100%。

## 二、具体发现：观察、机制和未证实之处分开

| 编号 | 已核对事实 | 应修正方向 | 不应得出的结论 |
| --- | --- | --- | --- |
| F01 | parseLengthChains('DE=2EA')返回splitPoint:true；lengthEquality.ts:136以无绝对长度锚点决定分点语义 | 比例与共线/在线段内分离；只有明确位置关系才能增加分点义务 | 尚未确定36题中多少题受影响 |
| F02 | ∠ADB=∠ADC=60°只提取部分关系，残留“∠ADB=”；GK-S06同样复现 | 建立角/长度有类型的等式链，完整保留源区间 | 不能靠忽略残留让验收变绿 |
| F03 | legacy部分情况下有parts但IR不保留；新审查另确认裸条件/设/且可能从源解析就被吞掉并错误passed | 先R01阻断原始解析错误放行，再T02完整scope迁移与roundtrip | 有legacy不能证明安全；仍不声称所有小问在所有输入中都丢失 |
| F04 | GK-P01符号标准式没有生成conicAxes；后备读取又要求文字“原点” | 先识别标准式实体，再绑定长轴/离心率求参数 | 只有焦点/离心率时仍可能欠定，不能删掉所有中心检查 |
| F05 | GK-P08圆方程已解析为圆心(0,2)、半径1；残留扫描把已消费区间替成空格 | 保留原文诊断，高亮未消费范围；另补符号双曲线及相切约束 | **不是原题漏公式，也不是已证实规范化删公式** |
| F06 | candidateConic要求新画圆锥曲线恰好一条 | 义务指定实体ID，再映射到图元ID | 不可改成取第一条，不可让辅助圆冒充主曲线 |
| F07 | JT-P02的“P在x=-1上运动”被标未解析 | 将宿主直线/轨迹作为依赖对象，而非临时坐标 | 一帧正确不证明拖动全过程正确 |
| F08 | 已有拓扑/残差/预算/取消/规范化守卫 | 复用安全机制，补接口与能力缺口 | 不从零重写第二套平行框架 |
| F09 | 通用acceptance为空时调用方不传；runAcceptance([])返回not_supported；另有diagram核验 | 建立画图专属完整合同和聚合门禁，保留非画图请求兼容 | 34题空通用列表不等于34题完全没验收 |
| F10 | agentRunner注入的是structured-only render evidence | 增加真实渲染/可见性证据 | 结构估计不等于截图或端到端通过 |
| F11 | JT-P08旧局部oracle名称包含EC=2CF，实际谓词仅检查E/F在椭圆上 | 审核断言谓词与源义务映射，补独立比例负例 | 名称写了某条件不等于实际验证该条件 |

证据见[只读结果](../../audit/2026-11-15-drawing-implementation-audit/read-only-probes.json)与代码索引。F05修正上一版初步判断。JT-P01“模型推导混入”的线索仍须追踪，不能预先认定已有改写守卫失效。

## 三、修改边界：保留什么，新增什么

### 3.1 现有模块与责任

| 范围 | 已有入口（基线位置） | 修正责任 |
| --- | --- | --- |
| 原文→IR | obligationIR.ts:217/269/304/318 | 扩展来源/scope/实体，不制造第二解析真值 |
| 分问/关系 | numberedProblem.ts:11；diagramObligations.ts:2150；lengthEquality.ts:116–136 | 分问条件、关系类型、源区间和不支持项 |
| 改写链 | promptNormalization.ts:277；planCompiler.ts:786–813 | 原文、格式映射、推导分离与接线 |
| 多曲线核验 | diagramVerification.ts:483 | 明确实体引用，替代全局唯一猜测 |
| 确定性路由 | deterministicProblemRoute.ts:13；agentRunner.ts:529 | 能力路由/构造意图与模型提案共入口 |
| 平面内核 | geometry-kernel/src/conic-line.ts:196等 | 复用交点/切线/残差，补参数与绑定 |
| 立体/折叠 | solid-builders.ts:296；solver/；foldSystem.ts:69 | 参数化、拓扑、状态、求解结果语义 |
| 调度/传输 | coordinator.ts:262；modelPlanner.ts:749 | 既有预算内的局部修复和停滞检测 |
| 验收/提交 | taskAcceptance.ts:110；draftStore.ts:348；committerAdapter.ts:119 | 最终候选绑定、过期撤销、原子确认 |

精确路径/符号/行号与内容hash见[source-map.json](../../audit/2026-11-15-drawing-implementation-audit/source-map.json)。行号只适用于59ea3613，实施后按符号和diff重定位。

### 3.2 拟新增职责模块（不是已创建源码）

- agent-core/src/problemContract.ts：演进ObligationIR，源版本、scope、实体和覆盖账本；不能独立再解析一次题文。
- agent-core/src/drawingIntent.ts：必需对象和构造依赖DAG；类型/循环/宿主验证。
- agent-core/src/reliabilityDiagnostics.ts：稳定诊断枚举与修复策略；用户文案与机器分流分离。
- agent-core/src/verification/drawingCertificate.ts：覆盖/数学证据聚合、版本绑定；复用diagramVerification基础判据。
- 各模块同名.test.ts；题目fixture放test-fixtures/reliability/，不散落产品代码。
- 数值辅助优先扩展geometry-kernel现有numeric/exact-forms；责任确实独立才拆新文件。

共享文件planCompiler/obligationIR/diagramVerification不得无协调同时修改。先冻结接口，再按题族实施；不要求推翻现有目录或大范围改名。

## 四、贯穿全链路的数据合同（拟定接口草案）

先以类型/契约测试审查边界，再写求解器。下列新增名字均在此定义；几何载荷继续引用项目实际GeometryDocument/ObligationIR，不另造图元表示。

~~~ts
// problemContract.ts的接口草案：现有IR的迁移适配，不是第二套题设。
export type SourceRef = {
  documentHash: string; start: number; end: number;
  coordinateSpace: "original-utf16";
};
export type Scope = {
  id: string; parentId?: string;
  kind: "shared" | "subquestion" | "branch";
};
export type EntityBinding = {
  entityId: string; scopeId: string; stateId: string;
  label: string; aliases: readonly string[];
  primitiveIds: readonly string[];
};
export type ObligationEvidence = {
  obligationId: string; source: readonly SourceRef[];
  status: "passed" | "failed" | "unknown" | "not_supported";
  residual?: number; tolerance?: number; reasonCode: string;
};
export type Coverage = {
  requiredIds: readonly string[]; checkedIds: readonly string[];
  unresolvedSource: readonly SourceRef[];
  missingEntityIds: readonly string[];
};
export type CandidateBinding = {
  sourceHash: string; contractHash: string; candidateHash: string;
  scopeId: string; baseRevision: string; validatorVersion: string;
};
export type SolveOutcome =
  | { kind: "verified_instance"; binding: CandidateBinding;
      evidence: readonly ObligationEvidence[]; branchesComplete: boolean }
  | { kind: "proven_unsat"; conflictingIds: readonly string[];
      proofMethod: "exact-contradiction" | "certified-interval" }
  | { kind: "underdetermined"; freeParameterIds: readonly string[] }
  | { kind: "not_supported"; unsupportedIds: readonly string[] }
  | { kind: "unknown"; reason: "budget" | "timeout" | "numerical" | "search-incomplete" }
  | { kind: "cancelled" };
export type MathGateInput = {
  binding: CandidateBinding; coverage: Coverage;
  evidence: readonly ObligationEvidence[];
};
export type MathGateDecision = {
  status: "passed" | "blocked";
  blockers: readonly string[]; binding: CandidateBinding;
};
export declare function evaluateMathGate(input: MathGateInput): MathGateDecision;
~~~

**实现要求**：

- 原文索引采用JS UTF-16区间；规范化长度变化必须映回原文。重复片段按区间定位，不能只用indexOf找到第一次。
- obligation ID由源版本、scope、关系类别、源区间和拆分子序号稳定决定，不依赖候选/当前数组顺序。别名只在同scope/state解析；歧义返回unknown。
- requiredIds来自审核合同或保守源片段覆盖，不能以“解析器恰好认出多少”作分母；零条件不默认通过。
- 新证据是版本化旁路数据；旧存档默认“未完整核验”，不得把旧passed当新证书。
- 已有no_witness/not-found映射unknown或保留原状态；有独立数学证据才能进入proven_unsat。branchesComplete默认false，一个实例不证明分支完备。
- evaluateMathGate先查绑定/实体/源覆盖，再逐条要求必要义务passed；重复ID、缺ID、NaN、无穷残差、未支持都阻断。数学passed不等于端到端passed。

**失效分层**：题文/语义scope/几何参数改变使数学证据失效；相机/标签/字体/DPI只失效视觉证据，除非同时改变几何；场景基版本或会话改变阻断旧候选提交。不要改相机就重问模型，也不要改了几何还保留绿标。

## 五、工作包索引与完成纪律

| 工作包 | 对应阶段 | 交付能力 |
| --- | --- | --- |
| T01 | P0 | 黄金合同、正确分母、生产/评测同入口 |
| T02 | P1 | 原文来源、IR分问、实体/状态、兼容 |
| T03 | P2 | 比例语义纠正、链式角关系 |
| T04 | P2 | AST、符号标准式、参数域 |
| T05 | P1/P2/P6 | 多实体绑定与原文诊断 |
| T06 | P3/P4 | 必需对象与构造依赖 |
| T07 | P3 | 平面/圆锥曲线构造 |
| T08 | P3/P7 | 函数、导数、轨迹与动态依赖 |
| T09 | P4 | 立体参数化与合法拓扑 |
| T10 | P4 | 折叠状态与合法分支 |
| T11 | P3/P4/P6 | 尺度、稳健谓词、残差 |
| T12 | P5 | 求解状态、局部修复与预算 |
| T13 | P6 | 独立完整验收与变异负例 |
| T14 | P5/P6 | hash、失效、取消与提交安全 |
| T15 | P7 | 真实画布与可读性 |
| T16 | P7 | 确认撤销、重载、拖动与图像输入 |
| T17 | P8 | 变式、未见题、多轮与成本 |
| T18 | P8 | 发布、回滚与可观测性 |

**每张任务卡都执行以下闭环**：

- [ ] 将该卡具体反例落为自动测试，记录输入和预期失败原因。
- [ ] 单跑确认RED；未按预期复现就继续调查，不先改实现。
- [ ] 实现最小修正，不夹带无关重构。
- [ ] 单跑GREEN + 模块回归 + 指定负例；不删断言或失败样本。
- [ ] 独立审查题意/数学/兼容性，确认生产调用点接线。
- [ ] 记录修改文件、退出码、证据/未做项与回滚点；获得提交授权后按工作包小步提交。

每包可能需多个小提交，不作无依据的工期或成功率提升承诺。以下命令是未来实施步骤，不表示本轮已执行。

## 六、基础与语义工作包 T01–T06

### T01 — 黄金合同、同入口回放和不可作弊的分母

**依赖**：无。**输入→输出**：36题原文/来源/hash → 人工审核合同、独立预期对象、可回放结果。

**修改**：scripts/reliability-eval/runner.mjs、apps/web/src/agent/fixtures/reliabilityEval.eval.test.ts。
**拟新增**：test-fixtures/reliability/drawing-contracts-36.json；scripts/reliability-eval/drawingContracts.test.ts。

**怎么改**：每题记录caseId/inputHash/inputMode/sharedScope/subquestions/requiredEntityIds/requiredObligations/displayPolicy/freeChoices/unsupportedReasons；条件给sourceSpan和独立预期值，不能从模型候选反向生成“黄金答案”。两位独立审阅者核对，缺第二位就标待审。生产入口与评测均经过真实parse→compile→verify→draft装配；仅传输、时间和存储可注入。冻结集与旧offline冒烟是不同集合。

**oracle专项审查**：JT-P08旧检查名称含EC=2CF但实际只核E/F在椭圆上（见实现审计）。先逐项对照名称/谓词/源条件，补缺失比例断言及“点仍在曲线上但比例错误”的负例；不改旧成绩冒充旧版已经完整验收。

**RED案例**：删GK-S02的E/F/P、把JT-P06第二问从分母移走、把partial记passed、把题文改字但不改hash，契约检查均必须失败；无来源的假定不能进入givens。

**实现草图**（测试算法而非新增生产代码）：

~~~ts
const total = frozenCases.length; // 固定36，不能改成完成题数
const passCount = runs.filter(r => r.math === "passed"
  && r.visual === "passed" && r.interaction === "passed").length;
const incomplete = frozenCases.filter(c => !runs.some(r => r.caseId === c.id));
// 未完成留在总分母并单列；两种口径不得混为一谈。
const report = { total, passCount, incomplete: incomplete.map(c => c.id) };
~~~

**命令**：npm.cmd exec -- vitest run scripts/reliability-eval/drawingContracts.test.ts --testTimeout=30000。
**验收/回滚**：36份合同审核齐全，关键失败有离线fixture，统一报表仍能还原旧25/36、4/36与证书null。新字段带schemaVersion，旧报告只读，不覆盖旧结果。完成“复制报告”不等于完成本任务。

### T02 — 原文、分问和实体状态无损传递

**前置安全要求**：先完成R01-A漏小问错误放行护栏；不能只做下述IR roundtrip而忽略裸条件/设/且的原解析负例。

**依赖**：T01。**输入→输出**：原文+现有legacy/IR → 带来源和scope的合同+旧接口适配。

**修改**：obligationIR.ts、numberedProblem.ts、diagramObligations.ts、promptNormalization.ts、planCompiler.ts；测试obligationIR.test.ts、promptNormalization.test.ts。
**拟新增**：packages/agent-core/src/problemContract.ts / problemContract.test.ts。

**怎么改**：先给IR补scope集合、当前选择及各义务scopeId，保留公共条件和每问专属条件；toLegacyObligationSet要能还原parts。不要给每问强行复制字符串再把新offset当原文位置。source map维护格式化前后区间，模型推导另存“proposed/derived”；既有规范化守卫保留。模型建议的参数必须经原题约束导出或标成自由选值。

**必须新增的RED**（使用已有API，不是伪造运行结果）：

~~~ts
import { expect, it } from "vitest";
import { parseObligationWithLegacy, toLegacyObligationSet } from "./obligationIR";
it("IR roundtrip preserves subquestion scopes", () => {
  const text = "四棱锥P-ABCD，PA⊥底面ABCD。（1）证明AD∥平面PBC；（2）若AD⊥DC，求AD。";
  const parsed = parseObligationWithLegacy(text);
  expect(parsed.legacy.parts).toHaveLength(2);
  expect(toLegacyObligationSet(parsed.ir).parts).toEqual(parsed.legacy.parts);
});
~~~

另加重复相同从句、LaTeX展开、A1/A₁、折前D/折后P、用户改题与模型新增“a=2”的反例。若只给出公共图，状态明确partial/scope=shared，不整题通过。

**命令**：npm.cmd exec -- vitest run packages/agent-core/src/obligationIR.test.ts packages/agent-core/src/promptNormalization.test.ts --testTimeout=30000。
**验收/回滚**：源区间真实、scope无损、旧存档和单问题行为兼容；必须审计所有IR消费者。新增字段在读取旧数据时显式缺证据，不合成虚假来源。

### T03 — 先修语义错误，再修链式角解析

**依赖**：T02来源合同；可在T01期间先写最小RED。**输入→输出**：关系文本 → 不添加额外题意的有类型原子义务。

**修改**：lengthEquality.ts、diagramObligations.ts、diagramVerification.ts；测试lengthEquality.test.ts、diagramObligations.test.ts、diagramVerification.test.ts。若复用性成立，新增relationChains.ts / relationChains.test.ts；长度、角度保留不同类型与单位，不能一个正则硬吃全部。

**方向A：长度比不是分点位置**。把lengthEquality.ts:136的“无数值锚点→splitPoint:true”取消为默认纯比例。共线、在线段内、内/外分由明确题文独立产生；即使共享端点，也不能从DE=2EA推得D/E/A共线。审计diagramObligations末尾的补丁和依赖此约定的solver，避免修改一处后又被别处补回错误语义。

最小数学反例：A=(0,0)、E=(1,0)、D=(1,2)，DE=2、EA=1，比例成立但不共线。加入“E在DA上”时，该候选才应被位置义务拒绝。

~~~ts
import { expect, it } from "vitest";
import { parseLengthChains } from "./lengthEquality";
it("a bare ratio does not invent collinearity", () => {
  const drafts = parseLengthChains("DE=2EA")
    .flatMap(c => c.ok ? c.drafts : []);
  expect(drafts).toContainEqual({
    kind: "segmentRatio", targets: ["D", "E", "E", "A"],
    value: 2, splitPoint: false
  });
});
~~~

旧测试若断言“裸比例必须共线”，应以这个独立反例明确记录纠错，不是删除测试迁就实现。保留真正“E在DA线段内、DE=2EA”的正例及线外反例。

**方向B：角等式链**。词法读取完整链，∠ADB=∠ADC=60°拆成两个定角义务（或定角+等角，但必须完整）；角顶点均为中间D。保留链的整体sourceSpan和子序号。拒绝长度=角度、非法角域和截断右侧；度转弧度只在计算边界一次处理。

测试：D=(0,0)、A=(1,0)、B=(1/2,√3/2)、C=(1/2,−√3/2)应两角60°；把C改成(0,−1)应一条失败；原题GK-S06不再残留“∠ADB=”。本任务通过仍不证明GK-S06整题完成。

**命令**：npm.cmd exec -- vitest run packages/agent-core/src/lengthEquality.test.ts packages/agent-core/src/diagramObligations.test.ts packages/agent-core/src/diagramVerification.test.ts --testTimeout=30000。
**验收/回滚**：裸比不推位置、明确位置照常核验、角链完整；不通过忽略unverified放行。回滚时保留新负例和问题记录，不能恢复错误数学结论作为成功状态。

### T04 — 表达式AST与符号圆锥曲线，不再只认数值模板

**依赖**：T02/T03。**输入→输出**：Unicode/LaTeX表达式与参数域 → 同语义AST、标准曲线实体和可求解参数约束。

**修改**：latexNormalisation.ts、diagramObligations.ts、obligationIR.ts；geometry-kernel/src/expression.ts、conic-parameters.ts；扩展latexNormalisation.chain.test.ts、obligationIR.test.ts，拟新增symbolicConicContract.test.ts。

**怎么改**：先只支持需求中的有限语法（常数、标识符、四则、整数幂、平方根、等式/不等式、分式），显式保存domain。不执行用户代码、不用eval。分母非零、根号非负、a>b>0等是合同的一部分；不能做x/x→1却丢x≠0。词法标准化后解析，参数值未定仍可识别“标准椭圆、中心原点”，不能先要求全数值才认曲线。

**GK-P01具体修正**：x²/a²+y²/b²=1、a>b>0 → 椭圆实体C与轴向；长轴4 → a=2；e=√2/2 → c=√2、b=√2。参数推导绑定C，不写回成原题。构造后独立检查a²−b²=c²、e=c/a及原式；第二问对象由T06/T07补，不止画椭圆和一点。

**GK-P08具体修正**：y²−x²/m²=1、m>0保留符号m；圆完成平方得(0,2)、r=1。渐近线x±my=0，到圆心距离2m/√(1+m²)=1 → m=1/√3。把m代回原条件，再生成双曲线/圆/渐近线及题目要求的切点。这个推导是独立参考，不允许在产品代码按题号写死m。

**RED矩阵**：x^{4}−2x^{3}；x²/a²；嵌套frac；a>b>0；圆锥坐标轴对换；仅给离心率的欠定题；除零/负半轴/非法根号；GK-P01/GK-P08；输入含未知函数名。解析成功不等于参数有唯一解。

**命令**：npm.cmd exec -- vitest run packages/agent-core/src/symbolicConicContract.test.ts packages/agent-core/src/latexNormalisation.chain.test.ts --testTimeout=30000。
**验收/回滚**：符号实体可识别、参数解可回代、非法域拒绝；已有表达式API兼容。参考R3作开发期对照，不默认加入Python运行时。

### T05 — 多实体绑定和忠实诊断

**依赖**：T02/T04。**输入→输出**：有scope/state的实体与义务 → 唯一且可审计的候选图元映射；原文诊断区间。

**修改**：diagramVerification.ts:483的candidateConic及其调用点、diagramObligations.ts:2309、planCompiler.ts；拟新增diagramEntityBinding.test.ts、diagramSourceDiagnostics.test.ts。

**怎么改**：每条曲线/圆/焦点/切线关系显式引用entityId；构造结果返回entityId→primitiveIds。解析阶段不能确定目标时返回binding_ambiguous，并列候选供澄清；不要核验时取第一个、最大图元或模型口头指定。旧单曲线模式可通过一个显式兼容绑定进入新逻辑。

**诊断修正**：保留原句sourceText、未识别子区间、已识别实体列表和具体reasonCode。leftover空白字符串仅内部检测，不能成为用户看到的“原题”；GK-P08应提示“圆已识别；符号双曲线/渐近线相切尚未核验”，不是“圆公式没给”。

**RED矩阵**：两个椭圆调换数组顺序，义务仍检查相同entityId；添加辅助圆不影响主椭圆验收；同名跨scope/state隔离；缺ID/多候选必须unknown；GK-P08诊断保留原圆式并准确标记缺口。JT-P03/JT-P07必须从病例回放验证，不能只过人造双圆例。

**命令**：npm.cmd exec -- vitest run packages/agent-core/src/diagramEntityBinding.test.ts packages/agent-core/src/diagramSourceDiagnostics.test.ts --testTimeout=30000。
**验收/回滚**：图元顺序不影响语义结果，错绑反例全部失败；可回退单实体兼容，但多实体无映射时必须unknown。

### T06 — 必需对象清单与构造依赖，不能只画主轮廓

**依赖**：T02/T05。**输入→输出**：合同entities/obligations → 经过类型和无环检查的构造意图DAG → 已物化对象映射。

**修改**：deterministicProblemRoute.ts、planCompiler.ts、solver/solverContracts.ts及真实action schema适配。
**拟新增**：drawingIntent.ts / drawingIntent.test.ts。

**怎么改**：required objects独立于模型动作清单生成；列出焦点、交点、比例点、辅助线、折后点及所需曲线。每个节点含nodeId/outputEntityId/operator/dependencyIds/scope/state/sourceRefs；算子只从已支持能力表中选择。先做依赖排序，再验证每个算子的输入类型/宿主存在，最后执行；失败报到具体节点。

**决策示例**：建椭圆C→生成焦点F₁/F₂→建题目所需直线→求交点→构造弦/切线。立体先主实体→边宿主→比例点E/F→辅助线→折叠状态。模型遗漏E时，用合同发现missing_entity，不等核验器给一条含糊“没画对”。

**RED矩阵**：GK-S02缺E/F/P，JT-P06缺焦点；依赖循环、重复实体ID、错类型宿主、引用折前状态作折后宿主、辅助对象存在但不显示。不能用孤立label伪造对象完成。

**命令**：npm.cmd exec -- vitest run packages/agent-core/src/drawingIntent.test.ts --testTimeout=30000。
**验收/回滚**：所有requiredEntityIds均有真实可核验图元或明确失败；DAG拓扑执行确定；增量重算接口可供T12使用。暂不支持算子就unknown，不让模型任意坐标绕过合同。

## 七、几何、数值与修复工作包 T07–T12

### T07 — 平面与圆锥曲线：先构造参数，再构造派生对象

**依赖**：T04/T05/T06。**输入→输出**：曲线实体+参数约束+意图DAG → 确定性图元、合法根/分支和独立回代证据。

**修改**：geometry-kernel/src/conics.ts、conic-parameters.ts、conic-line.ts、curve-intersections.ts；agent-core/src/deterministicProblemRoute.ts、planCompiler.ts。拟新增solver/planarDrawing.ts / planarDrawing.test.ts；已有模块能承载时复用，不重复建通用代数引擎。

**具体算法方向**：

1. 圆锥先转局部坐标，将平移/旋转显式建模，再用已知参数生成曲线。标准式决定中心/轴的事实不能靠“凑对角度”的候选猜。
2. 直线统一用P(t)=P₀+t·d，不强制y=kx+b，保留竖直线；使用已有intersectLineWithConic，不另写更弱的二次求根器。
3. 对所有实根做域/分支过滤，记录无交、相切、割线、单交点、退化；单交点不一定相切（抛物线轴向直线是反例）。
4. 焦点/弦/切点由曲线参数和依赖决定；核验时从最终坐标重新算F(P)、梯度与切向关系，不能只信构造器填的参数。
5. 参数未知先求约束；欠定但允许示意图时把选值标为free_choice，不冒充唯一数值答案。

**RED/黄金例**：椭圆x²/4+y²=1与x=0应有(0,±1)，与y=1相切于(0,1)，与y=2无交；竖直切线x=2；抛物线y=x²与x=1只有一个交点但非切线。再接GK-P01/GK-P08和JT-P03/JT-P07，验证多曲线、符号参数及第二问对象。

**命令**：npm.cmd exec -- vitest run packages/geometry-kernel/src/conic-line.test.ts packages/agent-core/src/solver/planarDrawing.test.ts --testTimeout=30000。
**验收/回滚**：18道平面题按审核scope/对象/数学合同逐条通过；本工作包未覆盖的函数交T08，不提前宣称18/18。错误分支、无根和辅助点缺失不得完整通过。新策略按能力关闭，不关闭检查器。

### T08 — 函数、导数和轨迹：显示近似与数学关系分开

**依赖**：T04/T06/T07。**输入→输出**：函数AST/定义域/动点宿主 → 曲线、导数相关对象、可更新依赖及有范围的证据。

**修改**：geometry-kernel/src/expression.ts、calculus.ts、function-evidence.ts、dynamic-points.ts、dependency-graph.ts；agent-core对应functionGraph/tangentAt/pointOnConic适配；拟新增solver/functionDrawing.test.ts。

**怎么改**：显示采样必须尊重定义域和间断点，禁止跨渐近线连线；导数、切线、交点由受支持表达式语义计算，不能以像素斜率代替。外点切线需解F(t)=f(t)+f′(t)(x₀−t)−y₀=0，再回代原条件；必须说明求解区间与是否穷尽根。unsupported导数不静默用有限差分包装为精确结果。

**轨迹建议**：JT-P02的宿主x=-1表示P(t)=(-1,t)，自由参数t有显示范围和题设域两种不同含义；渲染窗口不能擅自成为数学定义域。拖动后从参数重算依赖，而不是把P当任意二维自由点。

**RED矩阵**：f(x)=x²在x=1切线y=2x−1；竖直宿主运动；1/x在x=0处不连线；sqrt(x)不画x<0；双交点/无交点/导数不存在；拖动10个不同t后宿主关系均成立；改变定义域使旧证据失效。

**命令**：npm.cmd exec -- vitest run packages/agent-core/src/solver/functionDrawing.test.ts packages/geometry-kernel/src/function-evidence.test.ts --testTimeout=30000。
**验收/回滚**：对象/依赖/域正确，显示采样误差不污染数学判据；有限实例不证明全域单调/所有根。只关闭新算子，不恢复不受域约束的曲线拼接。

### T09 — 立体：参数化构造，禁止用坏拓扑换出图

**依赖**：T02/T06/T11数值策略。**输入→输出**：形状/尺寸/位置约束 → 可验证实体、辅助点和拓扑。

**修改**：solver/prism.ts、pyramid.ts、tetrahedron.ts、witnessSearch.ts、solverContracts.ts；geometry-kernel/src/solid-builders.ts。扩展solid-builders.test.ts和已有solver tests，拟新增solidDrawingContracts.test.ts。

**具体修正方向**：

- 直棱柱：底面合法环Vᵢ与非零法向高度h生成上下对应顶点，不逐顶点随机猜；斜棱柱须保留平移方向，不能套直棱柱模板。
- 垂足已知的棱锥：先底面/垂足，再顶点=垂足+h·单位法向；未知垂足或自由顶点必须求域，不擅自设成中心。
- 四面体等以距离/角度约束定局部坐标；镜像分支显式标记，原题有侧别就筛选。
- 多面体面环检查继续复用buildFromPoints：共面、简单环、共享边方向、连通、使用全部顶点、非零体积。对合法闭合流形每边两面；开放折纸面走不同结构，不能“放松闭合检查”通用放行。
- 不自动改变点的几何位置以修拓扑；若只是可证明的面方向/索引修正，修后重新验题设和拓扑。自交不能靠任意重排点掩盖。

**RED矩阵**：GK-S03的非共面/自交/方向/断连原始失败；棱柱上下点名错位；顶点共面；重复面；未使用孤立顶点；合法开放面不误判封闭体；GK-S02辅助点比例与宿主；已支持棱柱/棱锥不能退化。

**命令**：npm.cmd exec -- vitest run packages/geometry-kernel/src/solid-builders.test.ts packages/agent-core/src/solver/prism.test.ts packages/agent-core/src/solver/pyramid.test.ts --testTimeout=30000。
**验收/回滚**：立体相关对象、题设和拓扑全部有独立证据；构造失败不生成“已验收草稿”。T09/T10联合目标18/18，不用本卡少数正例替代整族。

### T10 — 折叠：状态谱系、铰链和分支可追溯

**依赖**：T02/T06/T09/T11。**输入→输出**：折前结构+铰链/约束+折叠顺序 → 状态图、变换、候选分支与保距/目标关系证据。

**修改**：solver/foldHinges.ts、coupledFolds.ts；geometry-kernel/src/foldSystem.ts、rotation3d.ts、solidGoalMeasurements.ts；planCompiler.foldBranches.test.ts、planCompiler.coupledFolds.test.ts。

**怎么改**：每次折叠记录parentState/hingeEntityId/movingFaceIds/angle/side/fixedEntities/pointMapping；同名点的显示标签不是身份。绕铰链作刚体旋转，铰链上点保持不动，运动面内部长度保持；折前D和折后P由mapping关联，不当作同一坐标对象。

目标折角与题文的二面角定义必须统一：法向夹角、内二面角、锐角线面角各自有约定，不能只取绝对值把两侧都判对。对θ与−θ、连续两折的先后顺序分别生成/筛选候选；题目只要求存在图时可返回一个明确分支，要求全部分支时不能把witness当完备枚举。

**RED矩阵**：零长铰链、铰链点漂移、折后边长改变、D/P错绑、反向折、顺序交换、180°退化、双折无进展。foldSystem的complete:false应一直表示有限数值搜索，not-found不得映射为无解。

**命令**：npm.cmd exec -- vitest run packages/agent-core/src/solver/foldHinges.test.ts packages/agent-core/src/planCompiler.foldBranches.test.ts packages/agent-core/src/planCompiler.coupledFolds.test.ts --testTimeout=30000。
**验收/回滚**：原点→变换→折后点可追踪，保距/角度/域独立回代，分支完整性如实标注。回滚到只支持单折时双折应not_supported，不偷偷扁平化成示意图。

### T11 — 数值可靠性：不要靠放大容差提高通过率

**依赖对齐**：以机器台账为准，T11先依赖T02/T03语义/量纲合同和已有内核建立策略，不等待T07–T10新构造器完成；构造器随后采用它。T01提供黄金测量来源。**输入→输出**：量纲/尺度/参数条件 → 稳健判据、归一化残差和可解释容差。

**修改**：geometry-kernel/src/numeric.ts、exact-forms.ts、conic-line.ts、solid-builders.ts；diagramVerification.ts；拟新增numericRobustness.test.ts。

**具体策略**：

1. 区分三种问题：拓扑符号判定（方向/内外/共线）、度量误差（长度/角度）、求解残差。禁止全库只用一个绝对epsilon。
2. 长度残差abs(L−L₀)/S，平面距离abs(n·(P−P₀))/(||n||S)，垂直残差abs(u·v)/(||u||||v||)，平行用叉积范数同尺度化；零向量先退化拒绝。S由图形包围尺寸/条件尺度确定，记录选择，不能由图窗像素决定。
3. 实现初始精度配置可从现有容差出发；每种判据在变式与扰动负例上校准后冻结版本，不能为一题单独放大。边界误差覆盖零时返回unknown/需更精细计算，不强行pass。
4. conic-line已有稳定二次根与回代机制，先新增极近切线/尺度变换反例定位缺口，再决定修改；不要因为旧通过率低就改成熟内核。
5. 必要时在几何谓词层引入误差过滤+精确回退。由浮点输入构造的“精确”运算只精确于该输入，不能反推出原题真正的有理/根式值。

**测试建议**：同构图在尺度10⁻³、1、10³，以及平移/旋转/点名置换下给出相同关系判定；定长度条件随缩放一起变换。近共线与真不共线、近相切与两交/无交、NaN/Infinity、零长法向、病态约束应有反例。

~~~ts
// 独立数学核验的基本原则示例：先退化检查，再无量纲残差。
const perpResidual = (u: number[], v: number[]) => {
  const lu = Math.hypot(...u), lv = Math.hypot(...v);
  if (!(lu > 0 && lv > 0) || !Number.isFinite(lu + lv)) return null;
  return Math.abs(u.reduce((s, x, i) => s + x * v[i]!, 0)) / (lu * lv);
};
~~~

示例不是完整稳健实现，超大输入仍需缩放防溢出；测试矩阵必须覆盖实际支持域。参考R1/R2解释责任边界，是否引入新库由spike结果决定。

**命令**：npm.cmd exec -- vitest run packages/geometry-kernel/src/numericRobustness.test.ts --testTimeout=30000。
**验收/回滚**：既有正确题不回归、尺度与反例稳定、容差可追溯；不把数值未决归为无解。每套策略有版本，改变后旧证书必须失效。

### T12 — 有界局部修复：修错误，不重复生成整题

**依赖**：T02/T06及构造器诊断。**输入→输出**：失败义务/节点/残差 → 单次受预算约束的局部修复或可解释终态。

**修改**：coordinator.ts、budget.ts、planCompiler.ts、apps/web/src/agent/modelPlanner.ts、agentRuntime.ts；拟新增reliabilityDiagnostics.ts / reliabilityDiagnostics.test.ts；扩展coordinator.test.ts、budget.test.ts。

| 故障码（拟定） | 优先动作 | 什么时候停止 |
| --- | --- | --- |
| syntax_unsupported | 返回源片段/支持边界，或确定性格式纠正 | 同义重写仍不支持，不能不停重试 |
| missing_entity | 由合同/DAG补宿主和点 | 缺必要条件或构造算子不支持 |
| binding_ambiguous | 显式实体映射/必要澄清 | 无法唯一确认题意 |
| topology_invalid | 修构造参数/可证等价面方向 | 不允许改题或删失败面 |
| residual_failed | 局部参数/合法分支再解 | 有界搜索耗尽或无进展 |
| unknown_numeric | 精度/区间策略升级一次受预算控制 | 仍未决就unknown |
| stale/cancelled | 丢弃旧候选，不请求修复 | 终态，零主场景写入 |
| transport_failure | 复用既有传输重试和幂等ID | 达到现有预算立即停止 |

**怎么改**：诊断增加obligationId/entityId/nodeId/sourceSpan/expected/actual/residual；将“缺点名但编译ok”的可修复状况与引擎不支持区分。candidateHash+failureSignature不变则停，参数改变但残差/覆盖无改善也纳入停滞指标。只重算受影响DAG，修后完整核验，不能跳过未变上游的证据有效性检查。

耗时数值搜索复用现有geometry worker边界，检查取消信号/时限；同步主线程死循环不能靠一个AbortSignal就变成可取消。先做worker超时、崩溃、迟到消息测试再调整调度，不重建第二套worker。

保留coordinator现有generation/network/tool预算和modelPlanner传输机制；先盘点每个实际native请求如何扣账，再修漏记或重复扣记。默认不增加次数；传输重试也占实际成本账本。上下文只传必要合同、故障子图和诊断，避免反复塞入全量trace；输入/输出token按请求实测而不是估算伪装实付。

**RED矩阵**：重复候选、未知算子、零预算、网络三次失败、schema修复叠加compile修复、取消中返回、节点重算后上游状态变化。结果遵循第四节SolveOutcome；not-found/预算耗尽不声称无解。

**命令**：npm.cmd exec -- vitest run packages/agent-core/src/coordinator.test.ts packages/agent-core/src/budget.test.ts packages/agent-core/src/reliabilityDiagnostics.test.ts --testTimeout=30000。
**验收/回滚**：不会无限循环、不会超预算、首轮/修复后分开统计；关闭局部修复仍保留安全终态。参考R3/R7只是状态和受限求解设计，不默认引入外部solver。

## 八、验收、交互与发布工作包 T13–T18

### T13 — 独立完整验收：不能靠构造器自证

**依赖**：合同从T02即设计；最终集成依赖T07–T12。**输入→输出**：审核必要条件/实体+最终图元 → 覆盖证据、逐条数学结果和门禁决策。

**修改**：diagramVerification.ts、verification/taskAcceptance.ts、completionGate.ts、taskVerification.ts、apps/web/src/agent/acceptance.ts、agentRunner.ts。
**拟新增**：verification/drawingCertificate.ts / drawingCertificate.test.ts、drawingMutation.test.ts。

**实现方向**：区分画图请求与非画图闲聊；只有画图合同才走完整数学门禁，不能让所有聊天因为没有几何条件而失败。画图时缺requiredIds、源片段未解释、缺点、类型错、scope错、unsupported/unknown都阻断完整通过；不能仅检查evidence.every(passed)，空数组的every也是真。

最小门禁核心草图：

~~~ts
// input/MathGateDecision见第四节；错误代码由实现时固定为枚举。
export function evaluateMathGate(input: MathGateInput): MathGateDecision {
  const blockers: string[] = [];
  const required = new Set(input.coverage.requiredIds);
  const checks = new Map<string, ObligationEvidence>();
  if (required.size === 0) blockers.push("empty_required_contract");
  if (required.size !== input.coverage.requiredIds.length) blockers.push("duplicate_required_id");
  for (const e of input.evidence) {
    if (checks.has(e.obligationId)) blockers.push("duplicate_evidence");
    if (e.residual !== undefined && !Number.isFinite(e.residual)) blockers.push("non_finite_evidence");
    checks.set(e.obligationId, e);
  }
  if (input.coverage.unresolvedSource.length) blockers.push("source_coverage_incomplete");
  if (input.coverage.missingEntityIds.length) blockers.push("required_entity_missing");
  for (const id of required) {
    if (!input.coverage.checkedIds.includes(id) || checks.get(id)?.status !== "passed") {
      blockers.push("obligation_not_passed:" + id);
    }
  }
  return { status: blockers.length ? "blocked" : "passed", blockers, binding: input.binding };
}
~~~

该片段只是覆盖聚合算法，不是完整可发布验收器：输入必须由独立validator生成，不能接受模型提交的checks；候选绑定由T14与当前实时状态比较。实现还须验证schema/sourceSpan、容差合法性、单位/域与证据对应关系。

**反例矩阵**：删必要点、删源条件、交换两条曲线、改折角、把failed改成unknown、空义务、重复ID、修改候选但沿用旧证据；所有都不能完整通过。给合法图加一个与题意无关的辅助对象不应错误改变数学结果，但显示布局另验。

**独立性要求**：从最终坐标/实体重算而不是读构造器“长度2”的声明；关键题用人工解析答案或第二算法回代。语义解析器自身也可能错，必须与T01人工合同比较；不能让同一个误解析同时污染生成和验收后互相赞同。

**命令**：npm.cmd exec -- vitest run packages/agent-core/src/verification/drawingCertificate.test.ts packages/agent-core/src/verification/drawingMutation.test.ts --testTimeout=30000。
**验收/回滚**：36/36数学合同+必要反例门禁；partial与完整通过在UI/报告分开。关闭证书时显示“未完整核验”，不能把旧host passed改个名字当新证书。

### T14 — 最终候选绑定、取消与原子提交

**依赖**：T02/T12/T13。**输入→输出**：source/contract/candidate与运行状态 → 可提交且未过期的草稿；或明确拒绝。

**修改**：apps/web/src/agent/draftStore.ts、agentRuntime.ts、agentRunner.ts；packages/agent-core/src/committerAdapter.ts、verification/renderEvidence.ts；扩展committerAdapter.test.ts，拟新增drawingCertificateStaleness.test.ts。

**具体方向**：hash来自规范序列化的真实源/合同/几何状态，排除时间戳等不影响语义字段，但保留所有影响约束/依赖的字段。使用独立几何/视觉绑定，不能混成“一次生成永远有效”。确认瞬间再比对runId、conversationId、baseRevision、candidateHash和证据版本；全部在同一提交事务内检查，避免检查后场景变化。

取消、用户改题/切会话、主场景改变、重开文件、旧版本证据都让旧结果不可提交。原子操作带幂等键，连点确认不得重复写图；冲突提示重算/重验，不静默把过期操作贴到新图上。

**RED矩阵**：生成后改长度、换scope、修改原文、改相机（只失效视觉）、确认前改基场景、双击确认、取消后迟到结果、存档恢复旧证书。每项断言sceneWrites与正确终态。

**命令**：npm.cmd exec -- vitest run packages/agent-core/src/committerAdapter.test.ts apps/web/src/agent/drawingCertificateStaleness.test.ts --testTimeout=30000。
**验收/回滚**：确认前零写入、确认一次、撤销一次、不跨会话；关闭新候选路由不得关闭旧有提交安全机制。

### T15 — 实际画布与可读性，不再把结构估计当视觉验收

**依赖**：T13/T14。**输入→输出**：候选场景+固定渲染环境 → 真实可见对象/标签/投影证据和人工走查。

**修改**：agentRunner.ts:661、renderLayoutInput.ts、verification/renderEvidence.ts、layoutModel.ts；根据真实渲染器调用链选择最小改动文件。
**拟新增**：e2e/drawing-reliability-render.spec.ts；真实render evidence适配和对应测试（与既有renderer一起定位，不凭空设一个未接线服务）。

**怎么改**：区分structuredOnly、rendered、humanReviewed三个证据级别，不相互升级。实际画布收集必需对象是否绘制、点名投影/边界、视窗内比例、关键标签相交、遮挡/隐藏线；立体相机只调整显示，不改变几何。自动布局首先满足硬条件（必需对象/点名可见），再优化间距；无法排好要降级为待人工确认，不改数学坐标凑好看。

**RED矩阵**：对象存在但画布外、关键点完全被遮挡、标签缺失/重叠、虚实线错误、函数间断连线、折叠状态重复标签、截图与候选hash不一致。四族至少各一正例一反例，再覆盖全部36题。

**可复现环境**：固定OS/浏览器/字体/视口/deviceScaleFactor/相机/动画状态和等待条件，记录版本；只用“sleep几秒”不算稳定等待。截图差异需人工审查，不能盲目更新快照或放大阈值。参考R5。

**命令**：npm.cmd exec -- playwright test e2e/drawing-reliability-render.spec.ts。
**验收/回滚**：真实显示证据与数学证据同候选，36题逐题检查；截图不证明数学关系。关闭新布局可回到旧布局，但视觉状态应回到未验，而非保留通过。

### T16 — 确认、保存、拖动与题图输入的完整用户流程

**依赖**：T14/T15。**输入→输出**：真实用户输入→草稿→确认/编辑/存档全过程结果。

**修改**：agentRuntime.ts、draftStore.ts、committerAdapter.ts及已有保存/动态依赖调用点；先用e2e暴露具体失败再改产品代码。
**拟新增**：e2e/drawing-reliability-lifecycle.spec.ts；带图输入的单独fixture集。

**必须走完的场景**：

1. 原题发送→生成隔离草稿→显示逐条未满足/通过→确认一次→撤销/重做；不能用直接写scene store冒充UI确认。
2. 保存、关闭、重开：图元、依赖、标签、scope保持；旧证书必须按版本和几何hash重新确认有效性。
3. 拖动约束点：由宿主参数重算依赖；自由编辑破坏题设时撤销通过标记并可撤销恢复。
4. 错题/缺条件/矛盾/取消：不产生误导性的“完整成功”与主场景写入；澄清后重跑仍关联新源版本。
5. 题图输入：单列OCR文本、配图几何、人工核对和最终送入合同的版本。低置信文字/点名/角标提示核对；不能把图片中的视觉比例当题目给定长度。

**RED矩阵**：重复提交、保存丢依赖、重载标签重名、拖动脱离宿主、取消后写入、旧截图证据复用、OCR把A₁读成A。浏览器与Tauri实际native环境分别验，离线mock不代表真实provider。

**命令**：npm.cmd exec -- playwright test e2e/drawing-reliability-lifecycle.spec.ts；后续全量npm.cmd run test:e2e。
**验收/回滚**：36题最小生命周期逐题有证据，四族复杂交互矩阵齐全；配图集另报，不混入题文模式分母。存档schema变更必须兼容旧文件，新增证据可弃但原图不能丢。

### T17 — 泛化与统计：防止“修好了这36个字符串”

**依赖**：T01/T13–T16；真实provider执行前另获预算授权。**输入→输出**：开发集、参数/语法变式、未见集、负例、配图集 → 分族分轮可审计报告。

**修改**：scripts/reliability-eval/runner.mjs、reliabilityEval.eval.test.ts；新增版本化fixtures与报告契约测试。

**建议测试分层**：

- 开发集36题原文和hash冻结；按scope记录，不删失败。
- 性质变式：一致改名、等价格式、旋转/平移、合法尺度变化、插入无关对象、重排对象数组；各变换必须同步更新期望条件，非等距仿射不能用于角度不变性质。
- 负例变异：条件矛盾、删点/错绑/改值、域外根、错折角、过期证据。错图必须被拦截，拒绝全部题并不算安全且可用。
- 未见题至少120，每族至少30；独立审题且事前冻结，不反馈黄金答案给planner。至少3次运行，逐轮报告首轮和有界修复后，不取最好一次。
- 配图/OCR集单列输入模式；same question重复执行按题聚合，不冒充更多独立题。

**门槛建议**：固定36题端到端36/36；未见题首轮≥95%、有界修复后≥99%，逐族检查；审核负例错误完整放行0。整数门槛写成ceil(p·N)：每族30题时99%意味着30/30，不能把29/30四舍五入为99%。按这些条件，120题按四族30均达99%将实际要求120/120。这是待批准门槛，不是本轮已实现。

**不确定性**：观测100%不是总体100%。在独立同分布近似成立且零失败时，一侧95%失败率上界=1−0.05^(1/n)：36题约7.98%，120题约2.47%；要把这个上界压到1%以下至少299个独立零失败样本。开发集/变式/重复同题通常不满足独立代表抽样，不能直接套公式作泛化证明。参考R6；实际报告预先固定算法并说明抽样假设。

**请求预算**：运行前列模型标识、每题/全批最大请求、token/金额/时长、暂停阈值；mock测试先证明无授权拒绝启动和预算停止。未知实际金额填unknown，预留上界不是结算；不能复用旧101次请求额度作为新授权。现有runner单次限制1..60 requests，批量实验需分批总账，不能直接绕过上限。

**RED矩阵**：缺题从分母移除、盲测失败转开发后仍叫盲测、只报最佳轮、错误加总相关样本、budget缺失仍调用provider。
**命令**：npm.cmd exec -- vitest run scripts/reliability-eval/drawingEvaluationContract.test.ts --testTimeout=30000（拟新增）；真实调用不在本轮执行。
**验收/回滚**：所有失败留账、成本可追、样本角色不可篡改；R4可在开发期评估，未经依赖审查不安装。

### T18 — 发布、灰度与长期维护

**依赖**：所有前置工作包出口证据与用户发布批准。**输入→输出**：候选版本+完整验收报告 → 可追溯发布/明确不发布与回滚方案。

**修改范围**：featureFlags.ts、发布门禁/scorecard/feature-catalog的能力说明，以及current-status.md的实时证据。代码改动依真实缺口定，不为了计划完整而空改发布流程。

**实施方向**：

- 开关至少能独立控制新合同路由、各题族构造器与新验收展示；关闭新路径不得把未验图显示成完整成功。
- 灰度以受支持题族、输入模式和明确用户范围开展，记录拒绝率/错误完整放行/成本/时延/无进展修复；不在后台默默多发模型请求。
- 发布报告绑定Git revision、依赖锁、模型版本/配置、判据版本、构建hash、Windows环境；no-bundle、安装包、冷启动和浏览器结果分开。
- 回滚演练覆盖关闭新构造路由、撤销跨版证书、恢复旧文件可读性、保持确认/撤销安全；不删除错误样本/审计。
- 问题进入固定故障码台账；新增每个题型需正例、反例、变式和真实画布，不再按用户题号堆special-case。

**发布阻断项**：任何错误完整放行、必要条件覆盖不完整、生产/评测路径分叉、未授权超预算、取消后写入、旧存档丢失、实际显示未验；不能用单元测试数量抵销。

**最终命令清单**（Windows仓库根执行，按环境真实记录退出码）：

~~~powershell
npm.cmd run test:docs -- --testTimeout=30000
npm.cmd run typecheck
npm.cmd test -- --testTimeout=30000
npm.cmd run test:rust
npm.cmd run eval:reliability -- --offline
npm.cmd run test:e2e
~~~

构建沿用仓库现有桌面脚本并记录实际命令，不猜发布配置；真实provider测试必须使用T17已批准的预算。todo/ignored/未跑项明示，超时先查负载/原因，不靠无限加时假装修复。

**验收/回滚**：基准、盲测、负例、交互、构建、成本和回滚均满足后才人工签收；否则保持未发布。当前阶段仍未开始，本手册不触发提交、推送或发布。

## 九、36题逐题落地索引

以下是**优先调查和最低验收方向**，不是36个根因都已确认。原始症状见[基线台账](../../audit/2026-11-15-drawing-baseline/case-triage.json)，详细诊断字段不能只看下表一行。每题通用必检：源合同/对象/数学/视觉/交互；表中列的是优先补项。

| 题号 | 基线失败阶段/终态 | 局部oracle | 优先工作包 | 最低修正/调查方向 |
| --- | --- | --- | --- | --- |
| GK-S01 | 待确认 | exact | T02/T13/T16 | 旧通过样本也补全scope、数学覆盖和实际确认证据 |
| GK-S02 | validating | missing_vertices | T06/T09/T13 | E/F/P物化并核验宿主、比例和原题长度 |
| GK-S03 | compiling | no_drawing | T09/T11 | 合法顶点/面环构造；共面、自交、方向、连通与体积 |
| GK-S04 | compiling | no_drawing | T06/T09/T12 | 从原compile轨迹定位算子/参数；不以重试代替构造 |
| GK-S05 | 待确认 | exact | T09/T13/T16 | 保留已通过路径，补全题设覆盖与UI生命周期 |
| GK-S06 | validating | exact | T03/T09/T13 | 角链完整读取；独立验全部必要关系 |
| GK-S07 | compiling | no_drawing | T09/T10/T12 | 先复现compile阻断，再区分拓扑、折叠与求解缺口 |
| GK-S08 | compiling | no_drawing | T06/T09/T12 | 先复现零图元的compile诊断并定位依赖/构造 |
| GK-S09 | validating | drawn | T09/T10/T13 | 已有图元不等于数学完成；核对scope和全部约束 |
| JT-S01 | compiling | no_drawing | T09/T12 | 重放compile失败，修具体构造/拓扑契约 |
| JT-S02 | compiling | no_drawing | T02/T06/T09 | 先核对别名/辅助点/构造状态，再修compile |
| JT-S03 | compiling | no_drawing | T02/T06/T09 | 源条件、必需实体与compile输入逐项对应 |
| JT-S04 | compiling | no_drawing | T09/T11/T12 | 复现立体构造失败并分离退化与数值未决 |
| JT-S05 | compiling | no_drawing | T02/T06/T09 | 具名对象、宿主与compile依赖，不凭文字补点 |
| JT-S06 | 待确认 | exact | T09/T13/T16 | 旧通过样本补完整覆盖和实际画布证据 |
| JT-S07 | compiling | no_drawing | T02/T06/T09 | 原输入到构造节点回放；补缺失实体/不支持算子 |
| JT-S08 | validating | exact | T02/T13 | 小问专属条件隔离；局部exact不代表整题 |
| JT-S09 | validating | drawn | T09/T10/T13 | 逐条验证立体/变换关系，不以drawn放行 |
| GK-P01 | validating | partial | T04/T06/T07 | 符号椭圆、长轴/离心率求参，补第二问对象 |
| GK-P02 | validating | partial | T04/T05/T07 | 从partial的未通过断言定位参数/对象绑定 |
| GK-P03 | validating | partial | T04/T05/T07 | 校对标准式/参数域与最终图元，不猜全局曲线 |
| GK-P04 | validating | partial | T04/T07/T08 | 按原题对象/函数域补未覆盖条件，先回放再定根因 |
| GK-P05 | compiling | no_drawing | T04/T07/T12 | 平面唯一compile失败题，先定位动作/表达式阻断 |
| GK-P06 | validating | partial | T04/T07/T08 | 原式到参数/函数对象完整转换并独立回代 |
| GK-P07 | validating | partial | T04/T05/T07 | 源条件与曲线实体绑定、参数域和缺失对象 |
| GK-P08 | validating | partial | T04/T05/T07 | m符号双曲线与圆的渐近线相切；修残留诊断 |
| GK-P09 | validating | drawn | T03/T04/T08 | LaTeX幂式与选择项scope，函数/辅助对象 |
| JT-P01 | validating | partial | T02/T04/T07 | 追踪推导来源；不预设归一化守卫已被绕过 |
| JT-P02 | validating | exact | T04/T08/T16 | P(t)=(-1,t)宿主与拖动依赖 |
| JT-P03 | validating | partial | T02/T05/T07 | 多个曲线实体明确引用，不选第一条 |
| JT-P04 | validating | exact | T04/T07/T13 | 保留局部正确关系，补全未支持/未覆盖义务 |
| JT-P05 | validating | exact | T04/T07/T13 | 局部exact转完整合同前补全部对象/条件 |
| JT-P06 | validating | incorrect | T02/T04/T06/T07 | 分问隔离、符号椭圆、焦点F₁/F₂及独立回代 |
| JT-P07 | validating | incorrect | T05/T07/T13 | 修多曲线绑定并拦截局部incorrect |
| JT-P08 | validating | partial | T04/T07/T13 | 补原题未覆盖关系，不能用partial判整题 |
| JT-P09 | 待确认 | drawn | T07/T13/T16 | 旧host通过但局部仅drawn，先补独立数学断言 |

## 十、覆盖矩阵：哪些证据不能互相代替

| 层级 | 必测正例 | 必测反例/边界 | 验收证据 | 对应任务 |
| --- | --- | --- | --- | --- |
| 来源/解析 | 原题及等价写法、分问/别名 | 改值、删条件、重复片段、跨scope | 源区间→义务审计、IR roundtrip | T01–T05 |
| 构造/数学 | 平面/函数/立体/折叠全部必要对象 | 错分支、域外根、缺焦点/辅助点、退化拓扑 | 独立残差/参数回代、构造DAG | T06–T11 |
| 验收 | 全覆盖合法图 | 缺义务、模型自报、错绑、NaN、过期证据 | 负例/变异拒绝表 | T13/T14 |
| 修复 | 可局部修复且有进展 | 重复失败、预算耗尽、网络/取消 | 每请求账本、失败签名、有限终态 | T12/T14 |
| 渲染 | 四族可读真实画布 | 不可见标签、遮挡、错虚实、越界 | 同版截图+实际render evidence+人工走查 | T15 |
| 交互 | 确认/撤销/保存/重载/拖动 | 连点重复提交、跨会话、旧证书、OCR混淆 | 浏览器与桌面各自E2E、sceneWrites | T16 |
| 泛化 | 冻结开发集+独立未见题 | 过拟合题号、盲测泄漏、删失败分母 | 分族分轮计数、区间、成本 | T17/T18 |

**性质测试必须保留数学语义**：旋转/平移保长度角度，尺度变化要同步变更尺寸，字符重命名要同时改所有引用。变异负例改变约束而不改图，目的是证明校验能抓错；不能拿“随机大扰动”代替边界附近错误检测。

## 十一、推荐交付批次：先小闭环，再扩大覆盖

### 第一批：审查风险止损（替换原“先六题”顺序）

优先实施[新方案](2026-11-15-review-driven-next-implementation-plan.md)R00、R01-A、R09-A、R10：基线、漏小问错误放行阻断、最终轮次计分和CI信任边界。随后R02–R06及R07/R08/R11分别关闭原生/数据保护与可信测试缺口。只读黄金合同整理可继续，但G1/G2未闭环不得发布或付费冲刺。

### 第二批：恢复原六题画图切片

- T01先审核GK-S06、GK-S03、GK-P01、GK-P08、JT-P02、JT-P06六道代表题；其余30题继续冻结/审阅，P0只有36题全审后才能完成。
- T02先落实原文/scope不丢失和不可擅改题意的最小合同；不为所有未来题型先建庞大框架。
- T03优先修可直接复现的角链与裸比例语义；T05先纠正GK-P08诊断展示。
- 同时写T13的最小负例：缺条件/缺点/过期证据不得完整通过。

**交付物**：真实RED→GREEN记录、六题源合同、两个明确语义缺陷修复、诊断勘误、负例门禁；没有任何“先承诺成功率翻倍”的验收条件。

### 第三批：从解析走到能正确构造

T04/T05/T06 → T07/T08；T09/T10并按共享合同推进；T11贯穿。每完成一类先跑原题+参数/语法变式+反例，不等18题全写完才测。目标平面18/18、立体18/18完整数学合同，但未达就按实际未达记录。

### 第四批：真实画布、交互与既有安全门禁集成

T12/T13/T14收口→T15/T16。验证真实生产入口，不只跑独立小函数；构建、候选、证据和截图必须同版。旧功能包括手工画图、拖动、保存、撤销都要回归。

### 第五批：独立泛化与发布

T17/T18还必须满足审查驱动G1/G2及G4发布前提，并等预算/抽样/门槛批准。记录每一失败，不把重试最高成绩当首轮能力。未达门槛时保持待发布，复现问题后进入新开发回归；换一批未见题继续评测。

## 十二、风险、取舍和明确不做事项

| 风险 | 具体控制 | 停止/回滚条件 |
| --- | --- | --- |
| 旧错误约定被测试“锁死” | 独立数学反例审核，保留旧失败说明和新测试 | 无法解释为何改期望时停止改实现 |
| IR/AST升级过大 | 增量字段与兼容适配，先有限语法/六题切片 | 同一语义在新旧两处独立解析则停止合并 |
| 更强构造掩盖更弱验收 | 先写负例；独立参考值；不自验自信 | 错图被完整放行立即阻断发布 |
| 数值问题靠调阈值掩盖 | 量纲/尺度、扰动反例、容差版本化 | 只对某题放松容差的补丁拒绝合入 |
| 外部solver带来包体/部署/未知结果 | R1/R3/R7先隔离spike、量化收益 | 无受限适用域/无回滚路径不引入 |
| 更多轮次造成成本失控 | 统一预算、停滞检测、实耗账本 | 无授权、超预算、重复无进展立即停 |
| 只修36题形成题号过拟合 | 无题号分支，改名/换数/未见题 | 题号/原句白名单决定通过则拒绝 |
| 文档重复漂移 | 当前状态唯一，手册只维护任务合同 | 没有运行证据不写完成或提升百分比 |

**不做**：把失败题删掉；把澄清当出图；只画公共底图说整题完成；把partial改pass；生成阶段看到黄金答案；用截图替代数学；用核心回放替代真实provider/桌面；用“不支持”大量拒绝有解题后声称100%；未经允许付费/推送/发布。

## 十三、每次修复的验收记录模板

~~~text
任务/题目ID、输入hash、scope：
用户看到的原失败：
源码位置/机制，观察与推断分别列：
独立数学反例或黄金期望：
改动文件与接口兼容影响：
RED命令、退出码、预期失败原因：
GREEN命令、通过/失败/跳过：
独立核验/变异负例/性质变式：
生产入口接线证据：
候选/数学/视觉/交互状态及证据hash：
首轮/修复后、请求/token/耗时/实际费用或unknown：
未做项、残余风险、审阅者：
回滚点/回滚验证：
达到哪一阶段退出条件（未达到则不能勾完成）：
~~~

## 十四、参考建议入口

[七份已核对的官方参考及采用边界](../../research/2026-11-15-drawing-repair-implementation-references.md)：

- R1/R2：精确判定/构造与稳健几何谓词，服务于T09/T11，不直接换整个内核。
- R3/R7：定义域/解集/unknown语义及受限求解，服务于T04/T10/T12；先离线对照，不默认集成。
- R4：生成与缩减最小反例，服务于T03–T11/T17；先利用已有Vitest。
- R5：可复现截图与人工审查，服务于T15/T16，不能替代数学。
- R6：成功率分母与统计不确定性，服务于T17/T18，不能将观测全过说成绝对可靠。

本手册给出具体实施方向，不声称所有提议都已用实验验证。8个解析探针、源码定位和官方资料核对属于本轮设计依据；真正功能修复须执行上述RED→GREEN、独立反例与生产集成验收。
