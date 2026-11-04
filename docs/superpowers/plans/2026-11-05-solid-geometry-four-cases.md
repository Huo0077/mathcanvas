# 11 月 5 日四道立体几何题修复 Implementation Plan

> **执行说明：**按本计划逐任务实现；使用可用的执行计划、测试驱动开发与完成前验证规范。复选框用于跟踪尚未实施的工作。未经用户授权不启动子代理，不自动提交代码。

**Goal:** 让四个报告样例的题设可被可靠解析、构造与核验，并准确区分错误目标、命名歧义和未支持的求解。

**Architecture:** 扩展现有 `SolidShapeSpec → constructShapeFromSpec → witnessSearch → compilePlan → verifyDiagramObligations` 链路，复用既有 solid/dynamic 动作。底面坐标由内核解析生成，命名分点保留宿主绑定；翻折复用既有旋转与状态映射，不另造第二套几何引擎。待证/待求目标独立处理，不参与修正题设或构造。

**Tech Stack:** 现有 TypeScript 工作区、geometry-kernel、agent-core、Web UI、Vitest、Playwright；不新增外部依赖。

**Spec:** [修复设计与原报告复核](../specs/2026-11-05-solid-geometry-four-cases-design.md)，含四题完整数值基准；[原报告归档](../../audit/2026-11-05-solid-geometry-four-case-report.md)。

## Global Constraints

- 本计划编写基线为 `ebccf313`、2026-11-05；执行前记录实际 HEAD 和已有改动，不覆盖他人工作。
- 本期不修改全局阈值。无反例和负测不得扩大容差。
- 目标不得作为构造约束；数值实例验证不得标成 `formally_proved`。
- 原文、无法解析的残留、显式长度/角度/点名与折前后状态不得静默丢失。
- 点名遵守共享 `pointNames.ts`；不全局合并 A₁ 与 A′，不顺手扩大 ASCII A1 题面语法。
- 内核不得依赖 agent-core；witnessSearch 只编排，不增加几何判据。
- 第一阶段通过既有动作落地，不新增公开宏动作和外部依赖。
- 只在题设独立核验通过时提供可提交草稿；沿用既有只读/证明请求的提交权限。
- 本次文档交付不包含业务修复；下列复选框全部是待实施项。

---

## 1. 实施顺序、里程碑与工期

依赖：`T1 → T2 → T3 → T4 → T5`；`T3 → T6`；`T5 + T6 → T7 → T8`。T1 的四题证据决定具体修复点，若某项已经通过，只加回归，不重复实现。

| 阶段 | 任务 | 可交付结果 | 参考投入 |
|---|---|---|---|
| A：定基线 | T1–T2 | 四题可重复复现，输入关系/残留可追踪 | 1–1.5 人日 |
| B：静态立体 | T3–T5 | 梯形、菱形中心垂足、棱柱定比分点可成图并独立核验 | 2–3 人日 |
| C：翻折 | T6 | 原题澄清，明确修订题可作图且状态引用正确 | 1.5–2.5 人日 |
| D：闭环验收 | T7–T8 | 错误结论不误报，数值量测、两入口、提交撤销有证据 | 2–3 人日 |

合计约 **6.5–10 人日**（单人有效开发时间，非承诺交付日期）。如需扩展持久化/动作协议或状态模型，应先提交增量设计重新估算，不能暗中压缩测试。优先交付 T1–T5 的三道静态题，翻折与目标核验分批验收。

## 2. 文件与职责地图

路径均相对 `D:\draw\draw`；“新增”为拟定文件名，不表示当前已存在。

| 文件/目录 | 动作及职责 |
|---|---|
| `packages/agent-core/src/fixtures/solidGeometryFourCases.ts`（新增） | 原始题面、明确修订版、独立数值 oracle；生产代码不导入 |
| `packages/agent-core/src/solidGeometryFourCases.test.ts`（新增） | 解析→规划→编译→独立题设核验集成，记录逐阶段结果 |
| `packages/agent-core/src/solver/shapeGrammar.ts`、`.test.ts` | 入口语法及命名环守卫 |
| `packages/agent-core/src/lengthEquality.ts`、`.test.ts`；`diagramObligations.ts`；`obligationIR.ts` | 复用连等解析、来源与角色保真；只改已证实缺口 |
| `packages/geometry-kernel/src/witness/solidShapeSpec.ts` | 既有描述的最小扩展，不新增另一套顶层 spec |
| `packages/geometry-kernel/src/witness/constructors.ts`、`.test.ts` | 接入现有构造分支；保留未支持条件的拒绝行为 |
| `packages/geometry-kernel/src/witness/basePolygons.ts`、`.test.ts`（新增） | 抽取本期可复用梯形/带显式角菱形计算，不大规模搬迁旧代码 |
| `packages/geometry-kernel/src/witness/derivedBasePoints.ts`、`.test.ts`（新增） | 本期对角线交点与内部垂足的解析计算和拒绝语义 |
| `packages/agent-core/src/solver/witnessSearch.ts` | 消费扩展后的既有 spec，编排候选与独立核验 |
| `packages/agent-core/src/parametricSolidPlan.ts`、`.test.ts`（新增） | 确定性适配、命名拓扑、派生点与已有动作的连接 |
| `packages/agent-core/src/planCompiler.ts` | 仅在复现证明命名/绑定编译有缺陷时修改，不另做求解器 |
| `packages/agent-core/src/polygonFoldPlan.ts`、`.test.ts`（新增） | 梯形翻折入口、前后状态与澄清结果，复用 `foldChain.ts`、`namedFold.ts` |
| `packages/geometry-kernel/src/solidGoalMeasurements.ts`、`.test.ts`（新增） | 通用线面角、点面距、二面角坐标量测；无题号逻辑 |
| `packages/agent-core/src/diagramVerification.ts`、`claimEvidence.ts` | 优先复用既有判据与证据状态；不另建一套 truth 枚举 |
| `apps/web/src/agent/localPlanner.ts`、`modelPlanner.ts`、`systemPrompt.ts` | 两种入口共同使用可识别的确定性路径，模型不手算坐标 |
| `apps/web/src/components/agent/AgentWorkspace.test.tsx` | 核验题设、目标、澄清与提交权限的界面呈现；生产 UI 仅在现有呈现确需调整时小改 |
| `e2e/agent-solid-four-cases.spec.ts`（新增） | 浏览器草稿、命名点、数值结果、澄清、提交撤销、旧功能不退化 |

### 最小接口约定（提议，先写类型测试再落实）

以下不是新公开动作 schema。优先映射到现有类型；确需新增内部字段时同步所有消费方及序列化测试。

```ts
// 建议放在内核 witness/derivedBasePoints.ts，由 SolidShapeSpec 引用。
type DerivedBasePoint = {
  name: string
  kind: 'diagonal-intersection'
  lines: readonly [readonly [string, string], readonly [string, string]]
}
// SolidShapeSpec 可选增加 derivedBasePoints?: readonly DerivedBasePoint[]。
// apex.foot 保留点名：先解析 derivedBasePoints，再校验 foot 在已解底面平面上。
// 禁止仅为通过旧 base.includes(foot) 守卫把 O 加进底面边界环。
```

- 构造数值计算结果继续适配既有 `WitnessConstructResult`，拒绝码遵守已有诊断约定。
- `parametricSolidPlan.ts` 对外提供 `tryBuildParametricSolidPlan`；输入复用现有规划上下文/IR 类型，输出沿用项目已有确定性规划结果，不创建第二个 `PlanEnvelope`。
- `polygonFoldPlan.ts` 对外提供 `tryBuildPolygonFoldPlan`，返回现有计划或明确澄清/不适用结果。状态中的稳定实体 ID 与显示点名分离。
- `solidGoalMeasurements.ts` 建议提供 `linePlaneSine`、`pointPlaneDistance`、`dihedralCosine`；使用既有 `Vector3`，退化输入返回结构化拒绝，不返回 NaN。接入前先检索现有量测函数，可复用时不新增同义函数。
- `verified_instance`、`sampled`、`formally_proved` 等沿用 `ClaimEvidenceStatus`；“不支持”“歧义”沿用现有 judgeability，不新增不兼容状态。

## 3. 逐任务实施

每个任务先红测、后最小实现、再回归。测试已通过的既有能力只补集成覆盖，不为追求“红”破坏正确代码。每个任务结束附测试输出与差异摘要，建议独立提交点，但只有获用户授权才实际提交。

### T1：建立四题可重复基线与证据

**文件：**新增 fixtures 与 `solidGeometryFourCases.test.ts`；参考 `explicitSolidCompile.test.ts`、`explicitSolidConditions.test.ts` 现有测试工具。

**输入/输出：**输入原题全文与明确修订版；输出每题各阶段结果、given/goal 列表、残留、错误码和实际文档。oracle 从设计 §3 手工录入，不从被测求解器计算。

- [x] 复制四个原题，保留 Case 4 歧义；另设独立 ID 的 D→P、CD_pre 修订版，禁止覆盖原始题面。
- [x] 为 Case 1–3 写“题设齐全、构造满足、目标独立”的产品集成断言；Case 4 原文断言应澄清，修订版断言几何不变量。（T1 先落**特征化基线**：断言今天卡在哪一层；目标断言按 T2–T7 逐条替换，见证据 §5。）
- [x] 运行 `npx vitest run packages/agent-core/src/solidGeometryFourCases.test.ts`，保存当前失败阶段；不把断言永久改成预期报错来让测试变绿。（阶段实况见证据 §3；替换义务见证据 §5。）
- [x] 将已有 66 测试基线重跑并留证；分别记录未经模型的本地路径与可离线模拟的模型路径。（66/66 通过；本地路径已跑；模型路径与浏览器明确记为“未运行”。）
- [x] 输出最小复现清单：解析/IR/构造/编译/核验/界面各自是否通过。缺失题设不能算成功；未运行浏览器明确标记。

**验收：**每项缺陷有固定题面、当前错误和期望；后续任务知道修哪一层，而非沿用报告的推测。此任务不要求产品红测已修好。

### T2：补入口及关系保真，不重复实现解析器

**文件：**`solver/shapeGrammar.ts`、`.test.ts`，`lengthEquality.test.ts`，`diagramObligations.ts`、`obligationIR.ts` 及相关现有测试；共享点名函数只在新增测试证明字形层确有缺口时改动。

**输入/输出：**原题/排版规范化文本 → 既有 RecognisedShape 与 IR；每条 given/goal 的角色、来源、残留可追踪。

- [ ] 写参数化测试：原句、“如图，在…中”、“四棱锥…中”、插入底面描述、`A_1`/`A_{1}`/`A₁`、撇号；保持 ASCII A1 当前边界与上下环数量/重复点负测。
- [ ] 对 Case 1 的 PA=AB=AD=2 和 Case 4 的 AD=CD=1 断言每条长度均进入题设；对 BE=1 断言不是“中点”。
- [ ] 运行 `npx vitest run packages/agent-core/src/solver/shapeGrammar.test.ts packages/agent-core/src/lengthEquality.test.ts packages/agent-core/src/explicitSolidConditions.test.ts`，确认新增缺口红测。
- [ ] 最小补归一化/语法边界；复用 `parseLengthChains`、`splitPointNames`、`canonicalPointName`。不得用贪婪匹配吞掉后续题设。
- [ ] 同命令复跑；增加“目标不进入 givens”“无法理解内容继续显示残留”的断言；重跑 T1 检查失败阶段推进。

**验收：**四题输入对应的点名、数值、角色与原文一致；“如图”原本能用的情况无无谓改动。

### T3：扩展既有底面解析构造

**文件：**新增内核 `witness/basePolygons.ts`、`.test.ts`；修改 `witness/constructors.ts`、`.test.ts`；检查 `solidShapeSpec.ts` 的消费方。

**输入/输出：**既有底面点序和关系 → 有序、有限、共面的底面顶点与来源说明，或既有结构化拒绝。内核计算，agent 不手算。

- [ ] 写直角梯形红测：a=2、c=1、h=2（Case 1）；a=2、c=1、h=1（Case 4）；再测 a=5、c=2、h=3、改名/循环点序。
- [ ] 写菱形红测：s=2、θ=60°，以及 θ=75°；断言显式角不标成自选。补无显式角时原代表形状行为不变的测试。
- [ ] 写负测：零/负/非有限边、共线角、冲突边长/角度、已有未支持条件不得静默忽略。
- [ ] 运行 `npx vitest run packages/geometry-kernel/src/witness/basePolygons.test.ts packages/geometry-kernel/src/witness/constructors.test.ts`，确认真正能力缺口。
- [ ] 实现设计 §4.3 的解析公式，通过已解析关系判断坐标对应，不硬编码点名。接入现有分支，不删除已有两直角梯形或代表菱形行为。
- [ ] 同命令复跑；再运行 `npx vitest run packages/geometry-kernel/src/solid-builders.test.ts packages/agent-core/src/solver/trapezoidPrism.test.ts packages/agent-core/src/solver/examSolidVariants.test.ts`。

**验收：**显式题设全部满足，z=0 解析共面；没有额外把梯形造为矩形；没有通过改容差使非法输入变绿。

### T4：支持底面内部派生垂足，打通菱形底棱锥

**文件：**新增内核 `witness/derivedBasePoints.ts`、`.test.ts`；修改 `solidShapeSpec.ts`、`constructors.ts`、`.test.ts`，`shapeGrammar.ts` / IR 适配处，以及必要的 `witnessSearch.ts` 调用。

**输入/输出：**底面点位 + 对角线交点 O 的定义 + apex.foot=O → 带 O、P 名字的候选；旧顶点垂足输入保持兼容。

- [ ] 写 Case 3 红测，明确断言 O 不在 base 环里但可作为合法垂足，PO=√3 且垂直底面。
- [ ] 写交点负测：引用缺失、直线不唯一相交、重名覆盖已有底点、自引用、非共面；不得回退到 A 或自由高度。
- [ ] 运行 `npx vitest run packages/geometry-kernel/src/witness/derivedBasePoints.test.ts packages/geometry-kernel/src/witness/constructors.test.ts packages/agent-core/src/solidGeometryFourCases.test.ts`。
- [ ] 为现有 spec 增加最小派生定义；先求底面和 O，校验垂足，再构造 P。同步既有高度求解需要 foot 坐标的分支，防止只改入口检查却在后续仍用 base 下标取点。
- [ ] 底面环仍严格只有 A/B/C/D；O 作为辅助点带可追踪来源，后续 M 由 PC 中点生成。witness 层继续调用独立核验器。
- [ ] 同命令复跑，增加旧顶点垂足、侧棱定长/二面角求高分支回归，确保未破坏已有契约。

**验收：**Case 3 的已知条件编译后可独立核验；数值 A 到 PBD 距离为 √3；实现不以该答案反向调坐标。

### T5：确定性计划适配与棱柱命名分点

**文件：**新增 `parametricSolidPlan.ts`、`.test.ts`；按实际缺口修改 `planCompiler.ts`；回归 `planCompiler.rightPrism.test.ts`、`.prismMidpoints.test.ts`、`.pyramidMidpoints.test.ts`。

**输入/输出：**经校验的既有形状/关系输入 → 现有计划与命名拓扑；编译后的实际文档必须能再次核验。

- [ ] 写 Case 1/2/3 全链测试：主实体、辅助点、名字、宿主边、参数、编译后坐标和 given 核验，不能只查动作数量。
- [ ] 对 E 断言 hostEdge 是 `{from:'B',to:'B₁'}` 对应的真实命名边，parameter=1/3；反向边测试为 2/3。PB、PC、AC 中点均为 1/2。
- [ ] 运行 `npx vitest run packages/agent-core/src/parametricSolidPlan.test.ts packages/agent-core/src/solidGeometryFourCases.test.ts` 观察失败。
- [ ] 复用 `solid.create_prism` 或现有 polyhedron 构造动作与 `dynamic.create_bound_point`。明确 vertexNames，禁止默认名字覆盖题面；不得新增自由坐标点伪装绑定点。
- [ ] 补参数 0、1、越界值、缺失边、重复点名负测；端点是否允许沿用动作现有契约。重建宿主后检查 E 仍在同一边同一比例。
- [ ] 同命令复跑，并运行上述 3 个 planCompiler 回归文件；若旧路径已正确，不修改 actionRegistry/schema。

**验收：**Case 1–3 均能在无模型手算坐标时得到满足题设的草稿；点名未丢失；错误目标不改变候选。

### T6：梯形翻折、显式状态及一次澄清

**文件：**新增 `polygonFoldPlan.ts`、`.test.ts`；复用 `foldChain.ts` 的 `foldPointAboutHinge`、`namedFold.ts`；必要时最小修改 `diagramObligations.ts`/`diagramVerification.ts` 状态适配。

**输入/输出：**折前梯形 + AC 铰链 + D→P + 90°/面垂直条件 → 既有翻折动作和前后状态，或具体歧义说明。

- [ ] 红测原 Case 4：不得把 △PAC 的有序顶点对应静默用于变换，且不得给 CD 默认绑定折后边；输出一个合并澄清问题。
- [ ] 红测明确修订版：A/C 固定，D_pre→P_post，P=(1/2,1/2,±1/√2)，M 为 PB 中点；通过不变量允许刚体等价朝向。
- [ ] 运行 `npx vitest run packages/agent-core/src/polygonFoldPlan.test.ts packages/agent-core/src/foldChain.sequence.test.ts`。
- [ ] 复用 T3 底面，复用已有轴旋转生成折后位置。记录移动面、固定面、铰链、角度来源与镜像分支；不覆写 D_pre 的历史身份。
- [ ] 保留显式折前 CD 与折后 CP 两种不同引用；目标层无法确定状态则为 ambiguous，不假称题设不一致。
- [ ] 同命令复跑；增加 `rectangleFold.test.ts`、`rectangleFoldPlan.test.ts`、`rectangleFoldStateVerification.test.ts` 回归，以及顺逆旋转/不可用铰链/缺面负测。

**验收：**原题有明确待澄清结果；修订版满足刚性不变量和面垂直；老矩形翻折行为不变。

### T7：目标结果与题设核验分离，并接通两种规划入口

**文件：**如有缺口新增内核 `solidGoalMeasurements.ts`、`.test.ts`；复用 `diagramVerification.ts`、`claimEvidence.ts`；修改 Web 的 `localPlanner.ts`、`modelPlanner.ts`、`systemPrompt.ts` 及对应测试；`AgentWorkspace.test.tsx`。

**输入/输出：**题设已通过核验的实际文档 + 独立 goals → 有证据等级和数值/残差的目标结果，不能写回 givens。

- [ ] 红测 Case 1/2 的错误垂直/平行目标；断言“题设通过”可与“该目标有反例”并存，不展示“整题已证明”。Case 3 关系成立也不自动标正式证明。
- [ ] 红测四题数值量：1/√2、0、√3、acos(1/√3)；Case 4 数值仅在修订版且角约定明确时输出。量测区分线面角、二面角、平面夹角，不能统一取绝对点积。
- [ ] 运行 `npx vitest run packages/geometry-kernel/src/solidGoalMeasurements.test.ts packages/agent-core/src/solidGeometryFourCases.test.ts apps/web/src/agent/localPlanner.test.ts apps/web/src/agent/modelPlanner.test.ts apps/web/src/components/agent/AgentWorkspace.test.tsx`（若全量复用了旧量测模块，替换为实际测试文件，不创建空模块凑路径）。
- [ ] 最小接入既有证据体系；false 的提示给出满足题设的反例与非零残差，不能把“候选搜索失败”标成数学上不成立。未知/超时/未支持分别显示。
- [ ] 两入口在识别完整时调用同一确定性构造；未识别仍走原 fallback，禁止丢残留。模型提示只要求输出结构/动作参数，不要求手算顶点；不单靠提示词保证正确性。
- [ ] 补只读证明请求、用户显式画图、目标为假但题设可画、题设自身矛盾、解析未完成的 UI/权限测试；同命令复跑并增加 `systemPrompt.test.ts`。

**验收：**离线情况下四题结果清楚；模型路径离线桩不能绕过核验；不能无限重复同一澄清。正式证明和坐标核验在文案与数据里都不同。

### T8：浏览器闭环、回归与发布证据

**文件：**新增 `e2e/agent-solid-four-cases.spec.ts`；补充报告 `docs/audit/2026-11-05-solid-four-cases-implementation-evidence.md`（实施时创建，不在计划阶段假造）。

**输入/输出：**以上实现 → 可审查的测试记录、浏览器截图/trace、已知限制与回滚点。

- [ ] 先写浏览器验收：Case 1–3 显示正确草稿及给定尺寸/名字；Case 4 原文澄清，用户回答后修订版可成图。可提交的显式作图路径分别测试提交一次、撤销一次、重试不重复实体。
- [ ] 首跑 `npx playwright test e2e/agent-solid-four-cases.spec.ts`，先记录红测；依据 T1–T7 修复而非修改 oracle 迎合实现。
- [ ] 同命令复跑并检查截图：草稿非空、辅助点可见、名牌不丢失，错误目标警示与澄清可见；不能仅依赖截图替代数值断言。
- [ ] 运行现有矩形与折叠链浏览器回归：`npx playwright test e2e/agent-rectangle-fold.spec.ts e2e/agent-fold-chain.spec.ts`。
- [ ] 按下表执行类型/单元/文档/构建验证；失败如属环境问题留命令、时间、输出，修复环境后重跑，未重跑不得写“已通过”。
- [ ] 更新证据文档：实际 HEAD、每题各阶段状态、原题/修订题 ID、全部命令与结果、截图路径、已知限制。若运行在线模型，另记 provider/model/参数/费用，不能拿桩测试冒充在线结果。

**验收：**满足下列矩阵，题设与目标无误报；关闭实现前的所有阻断缺口，未支持范围有明确边界。

## 4. 回归与验收矩阵

| 类别 | 最低覆盖 | 通过标准 |
|---|---|---|
| 原始四题 | Case 1–3；Case 4 原文及修订版分别记录 | 前三题 givens 通过；Case 4 原文澄清、修订版可构造；不得声称四个原始待证目标全真 |
| 数学 oracle | 设计 §3 四套独立坐标与量值 | 核验量值与解析值一致；实现不依赖题号/答案常量 |
| 改名 | 每类至少一组非原字母；棱柱上下环对应保持 | 不触发专用字母分支；所有点可映射 |
| 比例缩放 | 同类量同比缩放 0.1、10、1000 | 角度不变，距离同比变化；有限且非退化 |
| 菱形角与分点 | 60°、75°；分点 1/3、2/5、1/2 | 显式值不被默认值替代 |
| 排版 | 文本/LaTeX 下标、Unicode 下标、合法撇号 | 来源与角色不变；不合并不同点 |
| 残留/矛盾 | 未支持子句、冲突长度、缺高度且请求唯一数值 | 残留显形；不编造数值，不误报 proved/unsat |
| 几何负测 | 缺环点、重复名、零面积、非有限值、越界分点、非共面突变 | 结构化拒绝，不能因放松容差通过 |
| 翻折状态 | 两镜像分支、固定铰链、CD_pre/CP_post、无解释的 CD | 状态不串用；未解释即澄清 |
| 画布行为 | 草稿、显式提交、撤销、取消、重试 | 不多提交、不留孤立对象；只读请求不自动写入 |
| 规划入口 | 本地确定性入口、模型入口离线桩 | 编译后相同题设成立；在线真实性另验 |

### 验证命令（从仓库根执行）

```text
npm run typecheck
npm test
npm run test:docs
npm run build
npx playwright test e2e/agent-solid-four-cases.spec.ts
npx playwright test e2e/agent-rectangle-fold.spec.ts e2e/agent-fold-chain.spec.ts
git diff --check
```

- 局部任务用其列出的定向命令；全量失败不得用定向绿测覆盖描述。
- Playwright 使用现有配置构建并启动预览，不假定用户开发服务已开；保存失败 trace。
- 数值断言沿用既有残差/容差规则，尺度与量纲一致；oracle 可用较严的 double 精度比较，产品阈值不能在测试内悄悄重定义。
- 在线 `npm run eval:explicit-solid` 不是上述离线测试替代品；只有确认密钥/费用/评估样例后运行。

## 5. 风险、降级与回滚

1. **共享构造分支影响旧题：**保留现有负测与代表形状语义；每项能力以独立提交点交付。不能为四题强行放开所有四边形。
2. **IR 无法表达派生点：**只加本期有消费方的字段，桥接旧验证类型时保留来源；不通过“手动塞坐标”绕过残留守卫。需要持久化 schema 变化时先补兼容设计与测试。
3. **绑定点显示正确但动态失效：**验收真实 host/edge/parameter 及宿主重建，不能以静态坐标替代。
4. **翻折分支或历史状态缺基础设施：**静态三题先交付；翻折保留具体澄清/未支持，不回退模型猜测并自动提交。不得绕开权限提供伪成功。
5. **目标系统能力不足：**坐标核验与正式证明分层交付；本期不接万能证明器。数值所求量未实现则明确未支持，并保持该项验收未完成。
6. **回滚：**按 T2/T3/T4/T5/T6/T7 的独立提交逆序撤销有问题的增量，避免整文件覆盖；先停新路径入口再回退类型消费者，保留原报告与证据。文档提供建议提交点，当前不实际提交。

## 6. 当前文档交付与后续执行边界

本次已找到并归档 11 月 5 日原报告，完成静态复核与独立数学核对。写计划时已有定向基线为 5 个测试文件、66 测试通过，**不是四题修复验收结果**。本计划未运行任何新增业务测试，因为相关实现/测试文件仍属拟新增。

执行建议：先做 T1，基于真实失败阶段收敛 T2–T5；三题静态闭环验收后再做 T6；最后补 T7–T8。业务实现启动前应确认本设计，尤其是 Case 4 的修订解释及“目标为假但可以正确作图”的交互边界。
