> **路线更新：** 本文是较窄的第一版见证搜索路线，已被 `2026-10-04-agent-full-next-phase-design.md` 与 `2026-10-04-agent-full-next-phase-implementation-plan.md` 扩展为完整阶段路线；保留本文作为 N2/N4 的早期拆解。

# 下一轮 Agent 升级设计：约束驱动的示意图见证生成与真实模型评测

> 日期：2026-10-04
> 当前基线：`b1ee3d3`（欠定立体示意图的逐条题设核验已上线）
> 关联实现：`docs/superpowers/specs/2026-10-04-underdetermined-diagram-agent-design.md`

## 1. 为什么进入下一轮

本轮已经解决“错误候选图不能无声通过”的问题：系统能从用户原话建立一组题设核验，并在候选图上计算残差；欠定图只要满足题设，可以作为一组示意图确认。

但候选坐标仍主要由模型或固定夹具提供。下一轮要解决的是：**当题面允许自由点、但模型不会稳定选值时，系统能在受支持的题型范围内自动生成并筛选一组可读的见证图；同时用真实 provider 测出 Agent 的实际成功率。**

不把目标扩大成“所有高中题自动证明”。静态示意图、动态约束和形式证明仍然是三种不同产品能力。

## 2. GitHub 外部调研得到的可借鉴原则

### GeoGebra

GeoGebra 的 GitHub 镜像包含数学应用源码，并同时提供 Web/Desktop 构建路径；它适合作为“几何对象、动态关系、用户交互”的产品参照，而不是直接复制实现。下一轮应继续保持“文档对象 + 派生拓扑 + 动态关系”分层，不把 Agent 候选坐标直接写成不可追溯的渲染状态。

### FreeCAD

FreeCAD 将自己定位为参数化 3D 建模器：修改参数会沿模型历史传播，并依赖 OpenCASCADE 几何内核。可借鉴的是**参数/历史/几何内核分离**：Agent 先生成参数化见证，再由独立几何内核物化和检查；不要让模型直接负责维护拓扑或增量重算。

### mathlib4 / Lean

mathlib4 是 Lean 的数学库，包含数学基础设施和可证明的数学理论。它说明“数值示意图验证”和“形式证明”必须是不同层；本项目下一轮不把 Lean 引入运行时，而是为将来接入证明后端预留结论类型：`instance_verified`、`sampled`、`formally_proved`，不能把前两种升级成第三种。

## 3. 下一轮产品合同

### 3.1 候选图的三种结果

- `verified_instance`：存在一组具体坐标，所有已支持题设通过；可确认，文案是“满足题设的一组示意图”。
- `unverified_instance`：图可画但至少一条题设无法解析/无法计算；只可预览，不可正常确认。
- `no_witness`：候选池耗尽或题设矛盾；返回冲突条件和下一步，不生成残图。

### 3.2 自由点策略

自由点只影响候选搜索，不降低题设门槛。候选排序按以下顺序：

1. 所有题设残差和拓扑合法性必须通过；
2. 避免退化、极短边、极大长宽比、意外重合和不必要的特殊对称；
3. 画面比例、标签可读性、数值复杂度优先；
4. 固定随机种子或确定性候选顺序，重跑结果稳定。

每个被系统选定的自由值都进入可见 assumptions，写明“本图示例取值”，不能改写成题设给定值。

## 4. 系统架构

### 4.1 题设中间表示（Obligation IR）

将当前 `DiagramObligation` 扩为带来源、角色和可执行性的统一结构：

```ts
type ObligationRole = "given" | "goal" | "free_choice"
type Judgeability = "supported" | "unsupported" | "ambiguous"

interface GeometryObligation {
  id: string
  role: ObligationRole
  kind: string
  sourceText: string
  targets: string[]
  expected?: number | string
  judgeability: Judgeability
  tolerance?: { kind: "absolute" | "relative" | "angular"; value: number }
}
```

抽取器只负责来源和结构，不做求解；判据层只接受结构化目标，不再重新解析自然语言。

### 4.2 见证生成器

新增 `WitnessSearch`，输入 Obligation IR、图形族和确定性种子，输出有限候选及每次失败原因。第一批只做：

- 直角底面 + 垂足/高线的棱锥、棱柱；
- 等长/定长/中点/比例分点；
- 线面垂直、面面垂直、内二面角；
- 明确点名的 `solid.create_polyhedron`。

不做通用非线性方程求解。优先使用解析构造；解析构造失败后才使用小范围确定性参数网格。任何候选都必须回到同一 `verifyDiagramObligations` 验收，搜索器不能自证成功。

### 4.3 反例与冲突解释

每次 `no_witness` 保留：候选数、失败最多的题设、最大残差、退化原因和建议。把“模型算错了”“题设矛盾”“系统尚不支持”三者分开，禁止统一显示“作图失败”。

### 4.4 真实 provider 评测

新增真实题集，至少分为：

- 欠定但可构造；
- 条件矛盾；
- 有未支持表达式；
- 顶点顺序容易打乱；
- 需要数值求解的二面角/比例题；
- 只要求静态图但含“任意”字样；
- 明确要求普遍证明或动态保持关系。

每题记录：provider/model、首轮通过、最多三轮通过、最终候选状态、题设覆盖率、未核验率、成本、延迟、人工图面审查结果。离线 `deterministic_local` 继续作为回归信号，但不能混入真实 provider 指标。

## 5. 分阶段实施

### R1：Obligation IR 与题集

先把当前散落在抽取器、关系核验和确认 UI 的结构统一起来；加入 30~50 道内部题集及人工标注，不改变现有确认语义。

**出口：** 每道题都有 givens/goals/free choices；未知条件可追溯；没有空报告成功。

### R2：确定性见证搜索

在 Geometry Kernel 旁新增独立搜索模块；解析模板优先，网格搜索有预算、有种子、有失败报告。搜索结果必须经过现有残差和拓扑核验。

**出口：** 对首批题型，正确题稳定产出 `verified_instance`；矛盾题稳定产出 `no_witness`；不支持题稳定产出 `unverified_instance`。

### R3：真实 provider benchmark

接入带脱敏日志的 benchmark runner；先人工运行，不把 provider 接入 CI。建立 pass@1/pass@3、成本、延迟和人工正确率基线，再决定是否调整提示词、工具循环或模型。

**出口：** 有可重复的真实 provider 报告，且报告能区分“图合法”“题设全覆盖”“人工认为图可读”。

### R4：再决定是否做动态约束或形式证明

只有 R2/R3 证明候选生成和题设覆盖已经稳定，才评估：

- 把题设持久化为文档约束，拖动时投影求解；
- 对部分目标接入符号/形式证明后端；
- 把 draft 工具升级为模型可见的多轮草稿循环。

## 6. 发布门槛

下一轮不以“模型能画出一张图”为通过标准，而以以下证据为准：

- 题设覆盖率不低于 95%（其余必须明确未支持）；
- 支持题型的 `verified_instance` 不允许含 failed/unverified check；
- 欠定静态题可确认，普遍证明题不会被静态样图冒充；
- 真实 provider 有 pass@1/pass@3、成本和延迟基线；
- 真实浏览器正反例均覆盖；
- 所有旧门禁保持通过。

## 7. 明确不做

不引入“看起来合理”的视觉评分来覆盖数学失败；不把 GeoGebra/FreeCAD/Lean 的整体代码或许可证直接带入本项目；不把形式证明承诺写进静态图确认文案；不在没有真实 provider 数据时宣称 Agent 准确率提升。