# G3-DS 最终版真实作图能力实施档案

> **文档状态：** Final implementation dossier / 待实施
>
> **创建日期：** 2026-11-17
>
> **当前代码基线：** `92981ebd17b5c4522612e917876e2560be30d00f`
>
> **当前最新真实 DS 结果：** 冻结36题完整合同 `0/36`；1 partial、35 failed；2题生成非空候选；77次原生请求；主画布0写入。
>
> **最终目标：** 让 DS 稳定把题目文字和必要题图转换成正确、完整、可渲染、可交付的图像。本文不是测试结果，不表示 G3-DS 已完成。

---

## 0. 执行摘要

当前系统的主要问题不是“没有足够多的防御”，也不是“模型只需要更多重试”，而是责任划分错误：

```text
当前：DS 一次生成完整施工单 → 严格解析 → 失败或残缺图
目标：DS 提出构造策略 → 内核建立约束 → 内核求解和建图 → DS 根据反馈继续 → 独立验收 → 真实渲染
```

最终采用 **混合路线 B→C**：

1. 保留当前主画布安全、证书、CAS、候选 hash 和独立合同；
2. 把 DS 从“一次性完整施工单生成器”改为“动作级构造策略代理”；
3. 新增实体图、约束图、可求变量和内核观察状态；
4. 将当前硬拒绝分成 `accepted / repairable / blocked` 三态；
5. 先用现有几何内核补齐二维、函数、圆锥、基础立体能力；
6. 再扩展到折叠、多状态、多分支；
7. 最后重新进行真实 DS 36 题测评。

**最终成功指标不是 `plan_valid`，而是 `diagram_correct_and_rendered`。**

---

## 1. 最终产品目标

### 1.1 用户目标

用户输入题目后，系统应稳定完成：

```text
题目理解
→ 实体识别
→ 条件和小问解析
→ 构造策略选择
→ 几何约束建立
→ 内核求解
→ 候选图生成
→ 数学合同验证
→ 真实画布渲染
→ 用户确认交付
```

### 1.2 一题成功的必要条件

一题只有同时满足以下条件才算 DS 作图成功：

- 题目点名的点、线、面、立体、函数、曲线和辅助对象完整；
- 对象名称、归属的小问和状态正确；
- 长度、比例、垂直、平行、角度、相切、共线、共面和拓扑关系成立；
- 折叠前后、正负分支、多状态、多小问没有污染；
- 生产证书通过；
- 独立完整合同通过；
- 真实画布渲染与候选同版；
- 隔离工作区中的确认、撤销、重载通过；
- 不把缺失题图或不可确定条件猜成答案。

### 1.3 冻结36题最终退出门槛

```text
36/36 DS 实际参与
∧ 36/36 图像对象完整
∧ 36/36 完整数学合同通过
∧ 36/36 生产证书通过
∧ 36/36 同候选真实渲染通过
∧ 36/36 隔离确认/撤销/重载通过
```

未见题、题图缺失题和新变式另报，不从冻结36题结果推断任意新题100%。

---

## 2. 当前问题基线

### 2.1 当前真实 DS 结果

来自 `docs/audit/2026-11-17-g3-ds-live-retest-92981/`：

| 指标 | 结果 |
|---|---:|
| 冻结题 | 36/36 |
| 完整合同 | 0/36 |
| partial | 1 |
| failed | 35 |
| 非空候选 | 2/36 |
| 请求 | 77 |
| usage | 输入211,368 / 输出140,132 tokens |
| 读工具+提交计划混批 | 0 |
| 主画布写入 | 0 |

### 2.2 当前失败边界

主要失败码：

- `undeclared_entity_ref`：DS 的关系引用了未声明或无法绑定的实体；
- `missing_required_parameter`：DS 没有提供当前策略所需的数学参数；
- `cross_scope_violation`：公共条件、小问和状态引用混乱；
- `invalid_schema`：结构化施工单字段不完整或类型错误；
- `invalid_json`：原生工具参数或模型输出损坏；
- `envelope_invalid`：模型把 answer、clarification 和 construction strategy 混在一起；
- `unresolved_construction`：策略被接受但没有生成对应图元；
- `not_supported`：生产验证无法确认候选，但当前候选本身也未完整通过独立合同。

### 2.3 已完成内容不能被误判为最终能力

已完成但不等于真实 DS 作图完成：

- DS0：脱敏基线和阶段诊断；
- DS1：`DsDrawingIntent` 和提示词瘦身；
- DS2：部分几何策略和求解器；
- DS3：证书双向校验和有界修复；
- DS4：同候选渲染、hash 链和隔离交付；
- Task 0–5：失败驱动工具协议、参数来源、候选评测和渲染门禁；
- `92981ebd`：工具/提示词合同加固和内核能力扩展。

这些证明的是工程部件存在，不证明 DS 能够稳定从真实题目生成正确图像。

---

## 3. 方案选择

### 3.1 路线 A：继续加强当前完整施工单

**做法：**继续增加 schema 字段、提示词示例、修复提示和重试次数。

**优点：**改动小，短期容易增加合法施工单数量。

**缺点：**无法解决：

- DS 一次性理解整题困难；
- 复杂多问和多状态难以一次表达；
- 内核无法从部分约束补全对象；
- 缺参数时没有求解循环；
- 施工单合法不等于图像正确。

**结论：**不作为主路线，仅保留兼容入口。

### 3.2 路线 B：动作级 DS + 现有内核增强

**做法：**DS 每次只提交一个小构造动作，内核执行后返回对象、约束和残差。

**优点：**

- 能逐步构图；
- 失败可以局部修复；
- 不要求模型一次性输出全部坐标和依赖；
- 可以复用当前 `DrawingIntent`、solver、certificate 和 render chain；
- 可在不破坏主画布安全的情况下探索候选。

**缺点：**需要新增状态机、动作协议和实体/约束图。

**结论：**推荐作为第一阶段主路线。

### 3.3 路线 C：完整约束几何内核

**做法：**建立完整的符号/数值约束系统，DS 仅提供语义和高层策略。

**优点：**长期最稳定，最接近真正的自动作图系统。

**缺点：**开发量最大，涉及自由度、无解、冗余约束、多根、多状态和数值稳定性。

**结论：**作为 B 路线的后续演进，不一次性重写全仓。

### 3.4 最终推荐

采用：

```text
路线 B 先落地
→ 路线 C 的约束内核逐族增强
→ 保留路线 A 兼容回退
```

推荐理由：不继续堆 prompt，也不直接引入第二套大型引擎；先让 DS 能通过动作级循环稳定使用现有内核，再按真实失败族增补求解能力。

---

## 4. 最终架构

### 4.1 DS 负责的内容

DS 负责：

- 读取题意；
- 识别实体和关系；
- 选择构造策略；
- 选择下一步动作；
- 解释内核返回的失败；
- 在多个合法分支中选择符合题意的分支；
- 在无法确定时请求澄清。

DS 不负责：

- 直接写入主画布；
- 手算全部立体坐标；
- 自己宣称约束满足；
- 直接提交标准答案坐标；
- 绕过独立证书。

### 4.2 内核负责的内容

内核负责：

- 建立实体图；
- 建立约束图；
- 管理 scope/state/branch；
- 维护待求变量；
- 解析求解；
- 数值求解；
- 生成对象；
- 返回残差和冲突原因；
- 生成候选分支；
- 对候选进行局部验证。

### 4.3 评测器负责的内容

评测器负责：

- 独立读取题目合同；
- 评估实体覆盖；
- 评估义务覆盖；
- 评估状态和分支完整性；
- 验证 candidate hash；
- 验证生产证书；
- 统计真实 DS 调用和交付链。

评测器不能向 DS 或内核暴露黄金合同答案。

---

## 5. 新数据模型

### 5.1 EntityGraph

新增：

```ts
export interface EntityNode {
  id: string
  kind: DrawingEntityKind
  label?: string
  scopeId: string
  stateId: string
  hostEntityId?: string
  sourceRefs: SourceRef[]
  status: "declared" | "derived" | "resolved" | "blocked"
  candidateHash?: string
}
```

### 5.2 ConstraintGraph

新增：

```ts
export interface ConstraintNode {
  id: string
  kind:
    | "distance"
    | "ratio"
    | "perpendicular"
    | "parallel"
    | "angle"
    | "incidence"
    | "collinear"
    | "coplanar"
    | "tangent"
    | "topology"
    | "fold_transform"
  targets: string[]
  scopeId: string
  stateId: string
  sourceRefs: SourceRef[]
  status: ConstraintStatus
  residual?: number
  conflictWith?: string[]
}
```

### 5.3 约束状态

```ts
type ConstraintStatus =
  | "satisfied"
  | "violated"
  | "unknown"
  | "repairable"
  | "inconsistent"
  | "underdetermined"
```

### 5.4 运行态

```ts
type DrawingRunPhase =
  | "understanding"
  | "planning"
  | "constructing"
  | "solving"
  | "repairing"
  | "verifying"
  | "awaiting_confirmation"
  | "blocked"
```

---

## 6. 新 DS 动作协议

### 6.1 动作闭集

```text
declare_entity
add_relation
choose_strategy
construct_base
construct_point
construct_line
construct_segment
construct_intersection
construct_circle
construct_conic
construct_tangent
construct_perpendicular
construct_parallel
construct_solid
construct_face
construct_fold_state
query_measurement
query_constraint_status
repair_entity
repair_constraint
finish_candidate
request_clarification
```

### 6.2 单动作原则

一次 DS 请求只完成一个构造目的。例如：

```json
{
  "action": "construct_intersection",
  "lineA": "AB",
  "lineB": "l",
  "output": "D"
}
```

内核返回：

```json
{
  "status": "resolved",
  "entity": "D",
  "position": {"x": 1.2, "y": 0.8, "z": 0},
  "constraints": [
    {"id": "incidence-1", "status": "satisfied"}
  ]
}
```

### 6.3 三态结果

每个动作和每轮候选都必须返回：

```text
accepted
repairable
blocked
```

- `accepted`：可以继续；
- `repairable`：内核给出可执行修复建议；
- `blocked`：确实缺信息、无解或存在不可接受矛盾。

不能把所有错误都当成最终拒绝，也不能把所有错误都放行。

---

## 7. 防御性校验重构

### 7.1 保留

保留：

- 主画布确认前零写入；
- CAS；
- candidate hash；
- 证书保鲜；
- 混合读/写工具原子拒绝；
- 题图缺失不猜；
- 标准答案不进模型；
- 完整合同不放宽；
- 旧失败证据不删除。

### 7.2 改造

| 当前规则 | 新处理 |
|---|---|
| 未声明实体立即失败 | 尝试建立实体占位或通过关系补全 |
| 缺少参数立即澄清 | 如果参数可由约束求解，建立待求变量 |
| DAG 缺失立即失败 | 返回可修复依赖缺口 |
| scope 不一致立即失败 | 尝试合法 shared/parent scope 继承 |
| 一步没有图元立即结束 | 返回 `unresolved_construction`，进入修复 |
| 只有最终验证 | 每一步返回约束和残差 |

### 7.3 不可放宽的硬阻断

以下情况必须 `blocked`：

- 题图缺失且题图包含唯一结构信息；
- 题目条件无法确定唯一合法构造，且没有用户确认的分支策略；
- 约束明确无解；
- 关键数学参数没有题面、推导或合法假设来源；
- 产生退化或自交实体；
- 旧候选证书 hash 失效；
- 试图将探索候选直接写入主画布。

---

## 8. 内核实施路线

### Kernel-R0：实体和约束基础设施

**文件：**

- Create: `packages/agent-core/src/entityGraph.ts`
- Create: `packages/agent-core/src/constraintGraph.ts`
- Create: `packages/agent-core/src/kernelObservation.ts`
- Modify: `packages/agent-core/src/dsDrawingIntent.ts`
- Modify: `packages/agent-core/src/obligationIR.ts`
- Test: `packages/agent-core/src/entityGraph.test.ts`
- Test: `packages/agent-core/src/constraintGraph.test.ts`

**退出条件：**实体、约束、scope、state、sourceSpan 可以独立序列化和回放。

### Kernel-R1：二维基础约束

优先实现：

- 点在线；
- 两线交点；
- 共线；
- 中点；
- 比例点；
- 距离；
- 垂直；
- 平行；
- 圆与线交点；
- 圆锥曲线与线交点。

**文件：**

- Modify: `packages/geometry-kernel/src/planar-constraints.ts`
- Modify: `packages/geometry-kernel/src/function-evidence.ts`
- Create: `packages/agent-core/src/solver/constraintSolve2d.ts`
- Test: `packages/agent-core/src/solver/constraintSolve2d.test.ts`

**退出条件：**解析解、无解、双解、退化和残差都有明确状态。

### Kernel-R2：函数、切线和圆锥曲线

实现：

- 表达式和定义域；
- 切线；
- 外点切线；
- 公切线；
- 焦点和离心率；
- 交点分支；
- 参数域检查。

必须返回：

```text
roots
selectedBranch
residual
domainStatus
constraintStatus
```

### Kernel-R3：立体构造

实现：

- 棱柱；
- 棱锥；
- 四面体；
- 垂足；
- 线面关系；
- 面面关系；
- 共面；
- 闭合拓扑；
- 命名顶点；
- 面环；
- 立体内部点。

优先覆盖当前 `GK-S05`、`GK-S01`、`JT-S03`、`JT-S07` 类失败族，不按题号写坐标。

### Kernel-R4：折叠和多状态

实现：

```text
pre_fold
post_fold
hinge
moving vertices
after vertices
fold angle
mirror branch
lineage
```

每个状态必须独立绑定 document hash 和 candidate hash。

---

## 9. DS—内核闭环

### 9.1 循环

```text
DS action
→ schema check
→ entity/constraint update
→ kernel solve
→ residual/observation
→ next action
→ local repair
→ full verification
```

### 9.2 修复限制

每次修复必须：

- 指向明确实体或约束；
- 保留旧候选；
- 重新检查全部题设；
- 记录是否有进展；
- 不能破坏已满足义务。

禁止：

- 删除失败约束；
- 降低容差；
- 重新随机生成整题；
- 按题号插固定坐标；
- 使用黄金合同作为生成输入。

---

## 10. 具体任务序列

### Task F0：冻结当前失败真源

**目标：**将 `898d31ae` 复测数据作为新的真实基线。

**文件：**

- Create: `docs/g3-final/retests/2026-11-17-92981/README.md`
- Link: `docs/audit/2026-11-17-g3-ds-live-retest-92981/README.md`
- Test: `apps/web/src/agent/fixtures/g3DsCaseTrace.test.ts`

**退出：**36题逐题有首失败边界、候选数量、约束覆盖、证书和输入图边界。

### Task F1：探索候选隔离层

**文件：**

- Create: `apps/web/src/agent/speculativeCanvas.ts`
- Create: `apps/web/src/agent/speculativeCanvas.test.ts`
- Modify: `apps/web/src/agent/draftStore.ts`
- Modify: `apps/web/src/agent/hostBridge.ts`

**退出：**探索动作可回滚，主画布在证书和用户确认前零写入。

### Task F2：动作级 DS ToolSpec

**文件：**

- Create: `apps/web/src/agent/dsActionTools.ts`
- Create: `apps/web/src/agent/dsActionTools.test.ts`
- Modify: `apps/web/src/agent/modelPlanner.ts`
- Modify: `apps/web/src/agent/systemPrompt.ts`
- Modify: `packages/agent-core/src/actionRegistry.ts`

**退出：**DS 不再被要求一次性输出完整施工单；动作级正反例和取消/重复调用测试通过。

### Task F3：实体图和约束图

**文件：**

- Create: `packages/agent-core/src/entityGraph.ts`
- Create: `packages/agent-core/src/constraintGraph.ts`
- Modify: `packages/agent-core/src/dsDrawingIntent.ts`
- Modify: `packages/agent-core/src/obligationIR.ts`

**退出：**`undeclared_entity_ref`、`cross_scope_violation` 和缺参数可以区分 repairable 与 blocked。

### Task F4：二维和函数求解

**文件：**

- Create: `packages/agent-core/src/solver/constraintSolve2d.ts`
- Modify: `packages/geometry-kernel/src/planar-constraints.ts`
- Modify: `packages/geometry-kernel/src/function-evidence.ts`
- Modify: `packages/agent-core/src/dsDrawingIntent.ts`

**目标样本：**`GK-P03`、`JT-P02`、`GK-P04`、`GK-P06`、`GK-P09`。

**退出：**对象和关系全满足；不以图元数量为成功。

### Task F5：立体约束求解

**文件：**

- Create: `packages/agent-core/src/solver/constraintSolve3d.ts`
- Modify: `packages/geometry-kernel/src/constraints3d.ts`
- Modify: `packages/geometry-kernel/src/measurements3d.ts`
- Modify: `packages/agent-core/src/dsDrawingIntent.ts`

**目标样本：**`GK-S01`、`GK-S05`、`JT-S03`、`JT-S07`。

**退出：**长度、垂直、平面、拓扑和命名实体同时通过。

### Task F6：折叠和多状态

**文件：**

- Modify: `packages/agent-core/src/foldChain.ts`
- Modify: `packages/agent-core/src/rectangleFoldStateVerification.ts`
- Modify: `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts`
- Test: `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts`

**退出：**live 与 offline 使用同一 scope/state/branch 评测接口。

### Task F7：局部修复循环

**文件：**

- Modify: `packages/agent-core/src/coordinator.ts`
- Modify: `packages/agent-core/src/coordinatorPorts.ts`
- Modify: `packages/agent-core/src/runState.ts`
- Modify: `apps/web/src/agent/modelPlanner.ts`
- Create: `packages/agent-core/src/repairProgress.ts`

**退出：**修复只能针对失败实体/约束；无进展自动停止；全量回归通过。

### Task F8：真实画布交付

**文件：**

- Modify: `packages/agent-core/src/dsCandidateBundle.ts`
- Modify: `apps/web/src/canvasEvidence.ts`
- Modify: `apps/web/src/agent/hostBridge.ts`
- Extend: `e2e/drawing-reliability-36-render.spec.ts`
- Extend: `e2e/drawing-reliability-lifecycle.spec.ts`

**退出：**数学候选、证书、截图、确认和重载使用同一 candidate hash。

### Task F9：分层 DS 复测

**顺序：**

1. 历史通过题；
2. 立体零候选题；
3. 已有 partial 题；
4. 函数/圆锥题；
5. 多状态题；
6. 题图依赖题；
7. 冻结36题。

**每题记录：**

```text
modelInvoked
actionValid
candidateCreated
repairCount
contractStatus
certificateStatus
renderStatus
commitStatus
```

---

## 11. 推荐实施路线

### 推荐：B→C 混合路线

```text
F0 失败基线
→ F1 探索隔离
→ F2 动作级工具
→ F3 实体/约束图
→ F4 二维/函数内核
→ F5 立体内核
→ F6 多状态
→ F7 修复循环
→ F8 真实交付
→ F9 分层DS复测
```

### 不推荐：直接引入外部大型几何引擎

原因：

- 许可证和部署风险；
- 外部实体模型与当前 DSL 不一致；
- 题意理解仍然需要本地 DS 接口；
- 调试成本高于逐族补齐现有内核。

### 可选：独立求解器原型

如果 F4/F5 在参数化约束求解上遇到瓶颈，可以做独立原型：

```text
TypeScript ConstraintGraph
→ JSON snapshot
→ 独立求解进程
→ JSON SolveResult
→ 回到 agent-core
```

要求：

- 不直接写主画布；
- 不提交密钥或题目原文；
- 明确许可证；
- 先以10个参数化关系样本验证；
- 原型成功前不引入产品运行时。

### 另一个可选路线：模板族编译器

对固定数学族建立参数化构造器：

```text
triangle
solid_prism
conic_tangent
folded_solid
function_tangent
```

但模板必须按实体和关系泛化，不能按题号查表。它适合提升冻结题稳定性，但必须配合 F2/F3/F4，否则仍会被题意解析阻断。

---

## 12. 测试门禁

### 每个任务必须完成

```text
RED
→ 最小实现
→ 定向 GREEN
→ 反例
→ 相关全量回归
→ 脱敏审计
→ 文档更新
→ 提交
→ 推送
```

### 核心测试命令

```powershell
npm.cmd exec -- vitest run <target-tests> --testTimeout=30000
npm.cmd run typecheck
npm.cmd run test:docs -- --testTimeout=30000
npm.cmd test -- --testTimeout=30000 --maxWorkers=4
npm.cmd exec -- playwright test e2e/drawing-reliability-36-render.spec.ts e2e/drawing-reliability-lifecycle.spec.ts --workers=1 --retries=0
npm.cmd run test:rust
```

### 真实 DS 复测门禁

未经以下条件不得调用 DS：

- 当前 revision 固定；
- 题集 hash 固定；
- profile revision 固定；
- 题图输入边界固定；
- 最大请求数固定；
- 每题请求上限固定；
- 输入大小和输出 token 上限固定；
- 官方价格可核对；
- 理论费用上界低于用户授权；
- 失败停止条件固定；
- 报告不写入原始模型正文或密钥。

---

## 13. 最终指标

### 工程指标

- 36题首失败边界覆盖率：100%；
- 运行日志 `unknown` 率：逐轮下降，不能伪装成成功；
- `unresolved_construction` 不得静默丢动作；
- 探索态主画布写入：0；
- 证书 hash 篡改拦截：100%。

### 作图指标

- 非空候选率：单独统计，不等于成功率；
- 实体完整率；
- 约束满足率；
- 完整合同通过率；
- 生产证书通过率；
- 真实渲染通过率；
- 受控交付通过率。

### 最终产品指标

```text
DS 真实参与率：36/36
完整图像率：36/36
数学正确率：36/36
真实画布率：36/36
隔离交付率：36/36
```

---

## 14. 风险与回滚

### 风险 1：探索态让错误候选过多

缓解：探索态隔离，不进入主画布；所有候选必须有 hash 和生命周期。

### 风险 2：repairable 变成无限修复

缓解：每题设置最大修复轮次、无进展检测和约束签名；无进展立即停止。

### 风险 3：内核引入错误几何

缓解：每个求解器都必须输出 residual、constraints 和反例；独立合同不由内核自报。

### 风险 4：多状态评测误报

缓解：所有 live/offline 统一使用 CandidateSet 和 PolicyEvaluation，不允许各自一套聚合逻辑。

### 风险 5：题图缺失导致系统无法作图

缓解：输入审计标记 `input_figure_missing`；缺图时澄清，不用模型猜图。

### 风险 6：外部 solver 许可证或部署问题

缓解：只做独立原型；许可证审查和性能证据通过后再决定是否采用。

---

## 15. 最终停点

在以下任一情况出现时停止扩展：

- 发现题图输入未固定；
- 真实 provider 费用无法可靠估计；
- 约束求解器反复生成不稳定结果；
- 生产证书和独立合同分叉；
- 候选 hash 或主画布安全出现回归；
- repair loop 没有进展；
- 真实 DS 成绩继续为0且没有新的失败边界信息。

停止不代表失败，而是避免继续消耗付费请求，把问题退回到可验证的内核任务。

---

## 16. 最终结论

G3 的最终任务不是把 DS 训练成一个会输出大 JSON 的模型，而是把系统改造成：

```text
DS 负责理解和策略
内核负责约束和求解
引擎负责逐步构造
验证器负责独立裁判
渲染器负责真实显示
用户负责最终确认
```

只有这条链路闭环，DS 才能稳定输出题目描述的正确图像。
