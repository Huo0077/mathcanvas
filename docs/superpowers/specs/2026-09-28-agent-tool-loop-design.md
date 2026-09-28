# MathCanvas Agent 工具闭环优化设计

日期：2026-09-28。

状态：**待用户确认的设计与实施基线；本文件只描述目标，不代表已经开始改动。**

## 1. 目标

解决当前 Agent 无法稳定调用工具、无法按要求准确绘图、无法根据中间结果继续修正的问题。

目标不是继续堆叠提示词，而是把 Agent 从“一次性生成 Plan JSON”升级为“结构化目标 → 观察 → typed tool call → 草稿增量更新 → 语义验证 → 视觉验证 → 局部修复 → 用户确认”的闭环。

## 2. 当前问题基线

1. `toolRegistry.ts` 声明了阶段工具，但 `modelPlanner.ts` 的原生工具通道实际上只发送 `plan_set_plan`。
2. `scene.inspect`、`scene.search_entities` 等观察工具没有形成模型可连续调用的循环。
3. 原生计划工具使用宽松的 `additionalProperties: true`，动作字段、枚举和引用约束没有进入 provider schema。
4. 场景初始观察主要返回实体标签和 ID；更详细的事实只有在工具调用后才能取得，而当前没有真实工具循环。
5. 当前执行链有语义编译和草稿确认，但没有截图、布局检查和视觉反馈。
6. 整个运行最多共享一次修复机会，复杂任务中的多个局部错误无法被逐步修正。
7. `agent.worker.ts` 仍然对任何请求返回 `agent.unavailable`，与主线程运行时形成双路径语义。
8. 工具目录中存在声明但未实现的工具，模型可能看到无法执行的能力。

## 3. 非目标

- 本阶段不替换 Geometry DSL、Scene Graph 或 Geometry Kernel。
- 不允许模型直接写入真实文档。
- 不把“模型调用成功”当作“任务完成”。
- 不引入隐式的第二个 LLM 修复 Agent。
- 不记录 hidden chain-of-thought。
- 不在没有用户确认的情况下提交草稿。

## 4. 目标架构

### 4.1 任务规格化

模型先产生小型 `TaskSpec`，只描述意图、工作区、约束、假设和验收条件；它不直接携带整份动作计划。

```ts
interface TaskSpec {
  intent: "create" | "modify" | "delete" | "measure" | "explain" | "recreate"
  workspace: "conics" | "geometry3d" | "cad"
  target?: string
  constraints: readonly Constraint[]
  assumptions: readonly string[]
  acceptance: readonly AcceptanceCheck[]
  clarification?: readonly string[]
}
```

### 4.2 Typed tool loop

模型可以按阶段获得真实工具：

- 观察：`scene.inspect`、`scene.search_entities`、`scene.describe_entities`、`scene.dependencies`、`scene.measure`、`scene.check_relations`
- 创建/修改：由 `actionRegistry.ts` 生成严格的领域工具 schema
- 草稿：`draft.begin`、`draft.stage`、`draft.preview`、`draft.verify`、`draft.discard`
- 视觉：`render.capture`、`render.inspect_layout`
- 提交：只由 Host/UI 执行，模型不可见

### 4.3 单一真源

动作登记表负责生成：

1. provider tool schema；
2. 本地运行时参数校验；
3. 工具目录描述；
4. system prompt 中的简短能力说明；
5. 测试夹具和能力版本号。

未实现工具不进入模型工具列表。

### 4.4 增量草稿

每个工具调用绑定：

```ts
interface ToolExecutionIdentity {
  runId: string
  stepId: string
  toolCallId: string
  draftVersion: number
  baseDocumentHash: string
}
```

写草稿必须幂等；provider 重试不能重复创建对象。

### 4.5 双重验证

语义验证负责检查：对象类型、尺寸、引用、拓扑、关系、参数和任务验收条件。

视觉验证负责检查：对象是否在视口内、标签是否重叠、对象是否被裁剪、视图是否为空、布局是否满足参考图要求。

只有语义验证和必要的视觉验证都通过，才能进入用户确认。

### 4.6 局部修复

错误必须带有 `stepId`、工具名、参数路径、根因、可安全重试动作和停止条件。

- schema 错误：只重试当前工具调用；
- 几何错误：只修当前步骤；
- 视觉错误：优先调用布局/视角工具；
- 连续修复超过上限：停止并向用户说明缺失信息，不再盲目重试。

## 5. 运行状态

```text
created
→ observing
→ planning
→ acting
→ verifying
→ repairing
→ awaiting_confirmation
→ completed
```

异常状态：`waiting`、`failed`、`cancelled`、`interrupted`。

## 6. 关键不变量

- 模型不能直接提交真实文档。
- 每个工具调用都有严格 schema 和运行时校验。
- 工具结果必须包含 `status`、`summary`、`next_actions`、`artifacts`、`payload`、`diagnostics`。
- 草稿结果必须包含真实 diff、对象 ID、draft version 和 preview hash。
- 任何“成功”都必须有语义验证证据。
- 视觉任务必须有截图或明确说明当前 provider 不具备视觉能力。
- 观察、执行、验证使用同一个 document/draft binding。
- 工具目录、schema、dispatcher 不允许互相漂移。

## 7. 验收基线

至少覆盖以下任务族：

1. 创建：立方体、正四面体、斜棱柱、圆锥曲线。
2. 依赖：先建实体，再建中点、动点、截面和派生对象。
3. 修改：移动、更新参数、修改截面、删除未引用对象。
4. 拒绝：退化尺寸、错误工作区、错误引用、被引用对象删除。
5. 视觉：截图、视口适配、标签避让、对象不裁剪。
6. 恢复：工具参数错误、编译失败、视觉失败、provider 中断。

每个任务记录：`pass@1`、`pass@3`、无效参数率、工具重试次数、语义验证通过率、视觉验证通过率、平均延迟和成本。
