# MathCanvas Agent 工具闭环优化实施计划

> **For agentic workers:** Read the design spec before implementing. Execute tasks in order, use TDD for behavior changes, and run each task's focused tests before moving to the next task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MathCanvas Agent 从一次性 Plan JSON 生成器升级为可观察、可调用、可验证、可局部修复的 typed tool loop，同时保持草稿隔离和用户确认安全边界。

**Architecture:** 保留现有 `agent-core`、`actionRegistry`、`planCompiler`、`DraftStore` 和 `HostBridge`，新增一个由动作登记表驱动的工具协议层。模型通过阶段化 typed tools 进行观察和增量操作；本地编译器、语义验证器和视觉证据工具负责确定性执行；真实提交仍只能经过 Host/UI 的一次性确认。

**Tech Stack:** TypeScript、React、Vite、Vitest、Playwright、Tauri/Rust provider adapter、现有 Geometry DSL、Scene Graph、Geometry Kernel。

**Spec:** `docs/superpowers/specs/2026-09-28-agent-tool-loop-design.md`

## September 28, 2026 Current Execution Status (Paused)

### Completed

- Phase 0: baseline, task fixtures, deterministic judge, offline evaluator, and scorecard.
- First Phase 1 slice: execution contracts, verification report parser, action-schema draft, removal of unimplemented tools, read-tool validation.
- Read-only Phase 2 loop: Runtime, Coordinator, ToolPort, provider, Scene Dispatcher, tool result, continued planning, and isolated draft.
- Provider adapter coverage for OpenAI-compatible, Anthropic, and Ollama tool schemas and tool-result messages.
- User trace and deterministic geometry checks for cube center/edge constraints.

### Not completed at pause

- Model-facing `draft.begin`, `draft.stage`, `draft.preview`, and `draft.verify` tools.
- Complete registry/schema/parser/dispatcher single source of truth.
- General verification for sections, relations, deletion, and parameterized objects.
- `render.capture`, layout checks, reference comparison, and vision-provider input.
- Real-provider pass@1, pass@3, cost, latency, and consistency baseline.
- Final Agent Worker product strategy.

Resume from incremental draft tools and task-level verification. Do not redesign the verified read-only loop or return to a one-shot Plan JSON architecture.

## Global Constraints

- 未经用户确认，模型和工具都不得写入真实文档。
- `actionRegistry.ts` 是动作字段、引用、枚举、默认策略和工具 schema 的唯一真源。
- 未实现工具不得发布给模型。
- 所有 provider 输出和工具输入都必须经过运行时 schema 校验。
- 工具结果必须包含 `status`、`summary`、`next_actions`、`artifacts`、`payload` 和 `diagnostics`。
- 每个写草稿工具调用都必须绑定 `runId`、`stepId`、`toolCallId`、`draftVersion` 和 `baseDocumentHash`。
- 语义验证和视觉验证都没有通过时，不得进入 `awaiting_confirmation`。
- 不增加隐藏的第二个 LLM 修复循环。
- 每个任务必须先写失败测试，再实现最小行为，再运行聚焦测试。

## 文件责任地图

- `packages/agent-core/src/actionRegistry.ts`：动作输入字段、引用字段、枚举、默认策略和 schema 生成所需元数据。
- `packages/agent-core/src/toolRegistry.ts`：按阶段、工作区、能力版本发布模型可见工具。
- `packages/agent-core/src/toolDispatch.ts`：工具名、参数和执行器的唯一运行时分发入口。
- `packages/agent-core/src/contracts.ts`：TaskSpec、工具调用身份、工具结果、验证报告和草稿句柄契约。
- `packages/agent-core/src/coordinator.ts`：观察、行动、验证、修复、确认状态机。
- `packages/agent-core/src/verification/`：确定性任务验收和语义验证。
- `apps/web/src/agent/modelPlanner.ts`：provider 通道选择、原生工具循环、工具事件解析和取消。
- `apps/web/src/agent/systemPrompt.ts`：不变规则和阶段说明，不再承担完整 schema 真源。
- `apps/web/src/agent/agentRuntime.ts`：工具、草稿、观察、渲染证据和 HostBridge 的装配。
- `apps/web/src/agent/draftStore.ts`：增量草稿、版本、diff、preview hash 和幂等执行。
- `apps/web/src/agent/agent.worker.ts`：最终决定实现真实 Worker 协调器，或明确禁用该入口。
- `apps/web/src/agent/renderEvidence.ts`：渲染截图、视口状态和布局诊断。
- `apps/web/src/agent/visualVerifier.ts`：本地视觉/布局检查与 provider vision 输入适配。
- `apps/web/src/agent/fixtures/`：代表任务、错误任务、视觉任务和恢复任务夹具。

---

## Phase 0：冻结现状与评测基线

### Task 0.1：建立现状行为基线

**Files:**
- Create: `docs/research/2026-09-28-agent-tool-loop-baseline.md`
- Test: `apps/web/src/agent/modelPlanner.test.ts`
- Test: `packages/agent-core/src/toolRegistry.test.ts`
- Test: `packages/agent-core/src/toolDispatch.test.ts`

**Deliverable:** 明确当前 provider 实际收到的工具、工具目录中的未实现工具、一次运行的 repair 次数、场景观察字段和 Worker 行为。

- [ ] 记录 `planModelRequest` 的四种通道和当前 `native_tools` 实际发送的 schema 数量。
- [ ] 为“目录声明但分发器未实现”的每个工具记录现状结果和错误码。
- [ ] 为 `agent.worker.ts` 增加现状测试，明确它当前返回 `agent.unavailable`，避免后续误判为生产能力。
- [ ] 运行 `npm.cmd test -- --run apps/web/src/agent/modelPlanner.test.ts packages/agent-core/src/toolRegistry.test.ts packages/agent-core/src/toolDispatch.test.ts`。
- [ ] 将基线结果写入文档，不修改运行行为。

### Task 0.2：建立代表性任务集和评分表

**Files:**
- Create: `apps/web/src/agent/fixtures/agentTaskFixtures.ts`
- Create: `apps/web/src/agent/fixtures/agentTaskFixtures.test.ts`
- Create: `docs/acceptance/agent-tool-loop-scorecard.md`

**Deliverable:** 每个后续阶段都使用同一批任务比较 pass@1、pass@3、无效参数率、修复次数、语义验证率、视觉验证率、延迟和成本。

- [ ] 固定创建、依赖、修改、拒绝、视觉和恢复六类任务。
- [ ] 为每个任务写出输入、预期工具序列、预期对象类型、预期验收条件和允许的假设。
- [ ] 明确“模型调用成功但任务失败”属于失败，不以 revision 增长作为成功标准。
- [ ] 先运行现有测试，确认夹具只用于评测，不改变生产路径。

**阶段门槛：** 没有完成基线和评分表，不进入工具协议重构。

---

## Phase 1：统一工具协议和 schema 真源

### Task 1.1：定义严格的工具和验证契约

**Files:**
- Modify: `packages/agent-core/src/contracts.ts`
- Test: `packages/agent-core/src/contracts.test.ts`

**Interfaces:**

```ts
interface ToolExecutionIdentity {
  runId: string
  stepId: string
  toolCallId: string
  draftVersion: number
  baseDocumentHash: string
}

interface VerificationReport {
  status: "passed" | "failed" | "unknown" | "approximate" | "not_supported"
  checks: readonly VerificationCheck[]
  next_actions: readonly string[]
}
```

- [ ] 为 `ToolExecutionIdentity`、`VerificationReport`、`VerificationCheck`、`TaskSpec` 增加运行时可校验的类型。
- [ ] 为工具结果增加可选的 `diff`、`verification`、`draft` 字段，并保持旧工具结果兼容。
- [ ] 增加测试：缺少 `stepId`、版本号不一致、验证状态非法时必须拒绝。
- [ ] 运行 contracts 聚焦测试，确认旧的 `ToolResult` 测试仍通过。

### Task 1.2：从 action registry 生成严格输入 schema

**Files:**
- Modify: `packages/agent-core/src/actionRegistry.ts`
- Create: `packages/agent-core/src/actionSchemas.ts`
- Test: `packages/agent-core/src/actionSchemas.test.ts`

- [ ] 为每个动作生成 `additionalProperties: false` 的输入 schema。
- [ ] 将 `required`、`references`、`enumValues`、字段默认策略和工作区限制转成 schema 元数据。
- [ ] 为 `scope: "draft" | "document"`、alias、documentId、entityId、parameterId 建立闭集字段定义。
- [ ] 为坐标、长度、角度、向量和多边形增加有限数值与退化检查所需的 schema 信息。
- [ ] 测试未知字段、未知 action、非法 enum、错误引用形状和非有限数字都能在 provider 调用前失败。

### Task 1.3：让工具注册表只发布真实可执行工具

**Files:**
- Modify: `packages/agent-core/src/toolRegistry.ts`
- Modify: `packages/agent-core/src/toolDispatch.ts`
- Test: `packages/agent-core/src/toolRegistry.test.ts`
- Test: `packages/agent-core/src/toolDispatch.test.ts`

- [ ] 把“已声明但未实现”的工具从默认模型工具列表移除。
- [ ] 为每个已发布工具绑定一个明确的 dispatcher handler。
- [ ] 让注册表自动检查：每个发布工具必须有 schema、handler、阶段和工作区约束。
- [ ] 保留未知工具拒绝，但将错误结果补充 `root_cause_hint`、`safe_retry` 和 `stop_condition`。
- [ ] 测试发布工具集合与 dispatcher 集合一致，不允许出现“模型看得到但宿主不会执行”的工具。

**阶段门槛：** 工具目录、schema、dispatcher 三者集合一致；否则停止推进。

---

## Phase 2：接入真实 typed tool loop

### Task 2.1：扩展 provider 请求的工具发布协议

**Files:**
- Modify: `apps/web/src/agent/modelPlanner.ts`
- Modify: `apps/desktop/src-tauri/src/commands/providers.rs`
- Modify: `apps/desktop/src-tauri/src/providers/request.rs`
- Test: `apps/web/src/agent/modelPlanner.test.ts`
- Test: `apps/desktop/src-tauri/tests/provider_live.rs`
- Test: `apps/desktop/src-tauri/tests/provider_capability.rs`

- [ ] 将当前只发送 `PLAN_TOOL_SCHEMA` 改为发送当前阶段的完整 typed tool descriptors。
- [ ] 保留能力证据门槛：未验证 tools 能力的 provider 不得收到工具 schema。
- [ ] 对 native tool call 校验 tool name、tool call id、参数 schema 和当前阶段可见性。
- [ ] 对文本通道保留 JSON fallback，但把同一份 schema 的简化说明自动生成到 prompt，不再手写第二份动作菜单。
- [ ] 测试 provider 返回未发布工具、错误参数、重复 tool call 和取消事件时的处理。

### Task 2.2：实现有限轮次的观察—行动循环

**Files:**
- Modify: `packages/agent-core/src/coordinator.ts`
- Modify: `packages/agent-core/src/coordinatorPorts.ts`
- Modify: `apps/web/src/agent/modelPlanner.ts`
- Test: `packages/agent-core/src/coordinator.test.ts`
- Test: `apps/web/src/agent/pipeline.test.ts`

**Proposed interface:**

```ts
interface ToolLoopPolicy {
  maxToolCalls: number
  maxRepairsPerStep: number
  maxTotalRepairs: number
}

interface ToolCallOutcome {
  toolCallId: string
  toolId: string
  result: ToolResult<unknown>
}
```

- [ ] 将运行状态扩展为 `acting`、`verifying`、`repairing`，并保留现有确认和取消状态。
- [ ] 每轮最多执行一个有限工具调用批次，工具结果返回给模型继续决策。
- [ ] 每个工具调用都生成 `stepId`，并写入运行账本。
- [ ] 对 provider 重发的相同 `toolCallId` 做幂等处理，不重复写草稿。
- [ ] 将全局一次 repair 改为“每步有限 repair + 总预算上限”。
- [ ] 增加测试：先 `scene.search_entities` 再 `scene.describe_entities`，先创建实体再引用其真实 ID，工具错误后只修当前步骤。

### Task 2.3：实现 TaskSpec 到工具循环的边界

**Files:**
- Modify: `packages/agent-core/src/schemas.ts`
- Modify: `packages/agent-core/src/contextBuilder.ts`
- Modify: `apps/web/src/agent/systemPrompt.ts`
- Test: `packages/agent-core/src/schemas.test.ts`
- Test: `apps/web/src/agent/systemPrompt.test.ts`

- [ ] 为 `TaskSpec` 增加严格 envelope，区分意图、约束、假设、澄清和验收条件。
- [ ] 提示词只保留不变规则、阶段规则和错误摘要；动作字段说明由 schema 生成。
- [ ] 明确当前场景、草稿场景、历史消息和用户确认事实的优先级。
- [ ] 测试“信息足够时不澄清”“缺关键条件时澄清”“用户要求任意/恒定时保留符号参数”。

**阶段门槛：** 模型可以真实调用至少一个观察工具和一个草稿工具，并且结果能够回到下一轮上下文。

---

## Phase 3：增量草稿与确定性语义验证

### Task 3.1：扩展 DraftStore 的增量身份和 diff

**Files:**
- Modify: `apps/web/src/agent/draftStore.ts`
- Modify: `apps/web/src/agent/hostBridge.ts`
- Modify: `packages/agent-core/src/committerAdapter.ts`
- Test: `apps/web/src/agent/draftStore.test.ts`
- Test: `apps/web/src/agent/hostBridge.test.ts`

- [ ] 将 `runId`、`stepId`、`toolCallId`、`draftVersion` 和 `baseDocumentHash` 存入每次 stage 记录。
- [ ] 为每次增量 stage 返回真实创建、更新、删除对象 ID。
- [ ] 对相同 `toolCallId` 重放时返回原结果，不重复修改草稿。
- [ ] 对 stale document、stale draft version 和错误 preview hash 做显式拒绝。
- [ ] 测试用户确认前 live document 保持不变，确认后只提交当前 preview 对应的候选文档。

### Task 3.2：实现任务级语义验证器

**Files:**
- Create: `packages/agent-core/src/verification/taskVerification.ts`
- Create: `packages/agent-core/src/verification/verificationTypes.ts`
- Test: `packages/agent-core/src/verification/taskVerification.test.ts`
- Modify: `packages/agent-core/src/index.ts`

- [ ] 实现对象存在、对象类型、尺寸、引用、拓扑、关系和参数验收检查。
- [ ] 验证结果区分 `passed`、`failed`、`unknown`、`approximate`、`not_supported`。
- [ ] 每个失败检查返回 `path`、`stepId`、根因、可安全重试动作和停止条件。
- [ ] 测试立方体尺寸、正四面体边长、截面实体来源、平行/垂直关系和无效引用。
- [ ] 将验证结果接入协调器，验证未通过不得进入 `awaiting_confirmation`。

### Task 3.3：建立验证后才能声称成功的规则

**Files:**
- Modify: `packages/agent-core/src/coordinator.ts`
- Modify: `apps/web/src/agent/agentRunner.ts`
- Test: `packages/agent-core/src/coordinator.test.ts`
- Test: `apps/web/src/agent/agentRunner.test.ts`

- [ ] 禁止根据 revision 增长、draft stage 成功或模型文本声明推断任务成功。
- [ ] 成功事件必须携带 verification summary 和当前 draft/commit receipt。
- [ ] 失败、部分完成、近似结果和未知结果必须在账本与 UI 中区分。
- [ ] 测试“动作执行成功但验收失败”不会生成完成事件。

**阶段门槛：** 没有验证证据时，Agent 只能停在修复、等待或失败，不能报告完成。

---

## Phase 4：截图、布局和视觉证据

### Task 4.1：定义 render evidence 契约

**Files:**
- Create: `packages/agent-core/src/verification/renderEvidence.ts`
- Modify: `packages/agent-core/src/contracts.ts`
- Test: `packages/agent-core/src/verification/renderEvidence.test.ts`

- [ ] 定义截图 artifact、viewport、对象 bounds、裁剪、标签重叠和空画布诊断。
- [ ] 规定截图不进入长期记忆，只作为当前运行 artifact。
- [ ] 规定 provider 不支持 vision 时必须返回 `not_supported`，不能伪造视觉结论。
- [ ] 测试截图 artifact 缺少 mime type、runId 或 draftVersion 时拒绝。

### Task 4.2：接入 Web 渲染截图和布局诊断

**Files:**
- Create: `apps/web/src/agent/renderEvidence.ts`
- Create: `apps/web/src/agent/visualVerifier.ts`
- Modify: `apps/web/src/agent/agentRuntime.ts`
- Test: `apps/web/src/agent/renderEvidence.test.ts`
- Test: `apps/web/src/agent/visualVerifier.test.ts`

- [ ] 从当前工作区渲染层取得截图或等价 SVG artifact。
- [ ] 计算目标对象 bounds、viewport 覆盖、裁剪和标签重叠。
- [ ] 实现 `render.capture` 和 `render.inspect_layout` 的 dispatcher handler。
- [ ] 将截图和布局诊断绑定到当前 draft version，禁止使用旧草稿截图。
- [ ] 测试空场景、对象越界、标签重叠、对象裁剪和正常布局。

### Task 4.3：接入 provider vision 能力

**Files:**
- Modify: `apps/web/src/agent/modelPlanner.ts`
- Modify: `apps/desktop/src-tauri/src/providers/request.rs`
- Modify: `apps/desktop/src-tauri/src/providers/adapter.rs`
- Test: `apps/web/src/agent/modelPlanner.test.ts`
- Test: `apps/desktop/src-tauri/tests/provider_capability.rs`

- [ ] 只有 `vision === verified` 时才发送截图内容。
- [ ] 保持截图、结构化场景和验证结果属于同一个 draft version。
- [ ] provider 不支持视觉时，改用本地布局诊断和明确的 `not_supported` 结果。
- [ ] 测试带图 provider、无图 provider、图片过期和取消场景。

**阶段门槛：** 至少有一个纯本地视觉/布局验证路径，不依赖 provider vision 才能发现明显布局错误。

---

## Phase 5：Worker 路径和运行一致性

### Task 5.1：决定 Agent Worker 的产品策略

**Files:**
- Modify: `apps/web/src/agent/agent.worker.ts`
- Modify: `apps/web/src/agent/workerContracts.ts`
- Create: `docs/decisions/2026-09-28-agent-worker-strategy.md`
- Test: `apps/web/src/agent/workerRuntime.test.ts`

- [ ] 在“实现真实 Worker 协调器”和“暂时禁用 Worker 入口”之间做明确决策。
- [ ] 如果实现 Worker：定义请求、工具调用、工具结果、取消、失败和完成的完整信封。
- [ ] 如果暂时禁用：让 UI 和构建配置不再把 `AGENT_WORKER_READY` 当作可运行能力。
- [ ] 测试主线程和 Worker 对同一代表任务产生一致的 tool trace、draft diff 和 verification report。

### Task 5.2：统一主线程和 Worker 的能力边界

**Files:**
- Modify: `apps/web/src/agent/agentRuntime.ts`
- Modify: `apps/web/src/agent/geometryWorkerHost.ts`
- Modify: `apps/web/src/agent/workerRuntime.ts`
- Test: `apps/web/src/agent/pipeline.test.ts`

- [ ] 确保主线程和 Worker 都从同一 action/tool schema 构造器获得能力。
- [ ] 确保两条路径都使用相同的 draft version、artifact 校验和取消语义。
- [ ] 测试 Worker 不会绕过 HostBridge、ConsentToken 或 CAS。

**阶段门槛：** 两条运行路径行为一致，或者明确只保留一条生产路径。

---

## Phase 6：评测、观测和回归门禁

### Task 6.1：记录完整 tool trace

**Files:**
- Modify: `packages/agent-core/src/runState.ts`
- Modify: `packages/agent-core/src/events.ts`
- Modify: `apps/web/src/services/runEventClient.ts`
- Test: `packages/agent-core/src/runState.test.ts`
- Test: `apps/web/src/services/runEventClient.test.ts`

- [ ] 每次运行记录 prompt version、tool registry revision、action schema revision、provider capability revision。
- [ ] 每个 tool call 记录输入摘要、结果摘要、diff、verification、draft version 和耗时。
- [ ] 原文日志有界，禁止写入密钥、hidden chain-of-thought 和完整候选文档。
- [ ] 测试取消、重试、工具错误、视觉错误和确认提交的 trace 完整性。

### Task 6.2：实现代表任务自动评测

**Files:**
- Create: `scripts/agent-eval.ts`
- Create: `apps/web/src/agent/fixtures/agentEvalRunner.ts`
- Test: `apps/web/src/agent/fixtures/agentEvalRunner.test.ts`
- Modify: `package.json`

- [ ] 增加 `npm.cmd run eval:agent`，支持本地确定性 planner 和录制 provider response。
- [ ] 输出 pass@1、pass@3、工具错误率、平均修复次数、语义验证率、视觉验证率、平均延迟和成本。
- [ ] 为每个失败任务输出最后一个失败步骤、诊断路径和停止原因。
- [ ] 评测不得修改真实项目文档，只能运行隔离 draft。

### Task 6.3：建立发布前门禁

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `docs/acceptance/agent-release-gate.md`

- [ ] 类型检查、Agent 核心测试、Web Agent 测试、Rust provider 测试必须通过。
- [ ] 代表任务 pass@1 和语义验证率达到预先约定阈值。
- [ ] 不允许出现模型可见但 dispatcher 未实现的工具。
- [ ] 不允许出现未验证却声称完成的运行记录。
- [ ] 视觉能力不可用时，必须有本地布局验证结果或明确 `not_supported`。

**最终阶段门槛：** 只有所有门禁通过，才允许把 typed tool loop 设为默认运行路径。

---

## 执行顺序与暂停点

### 第一批：只做基线，不改行为

- [ ] 完成 Task 0.1。
- [ ] 完成 Task 0.2。
- [ ] 用户确认评分标准和任务集。

### 第二批：先修工具协议

- [ ] 完成 Task 1.1。
- [ ] 完成 Task 1.2。
- [ ] 完成 Task 1.3。
- [ ] 通过“工具目录 = schema = dispatcher”阶段门槛。

### 第三批：接入真实循环

- [ ] 完成 Task 2.1。
- [ ] 完成 Task 2.2。
- [ ] 完成 Task 2.3。
- [ ] 用代表任务验证模型能观察、行动和继续决策。

### 第四批：保证结果可信

- [ ] 完成 Task 3.1。
- [ ] 完成 Task 3.2。
- [ ] 完成 Task 3.3。
- [ ] 通过“无验证不成功”阶段门槛。

### 第五批：解决画图不准

- [ ] 完成 Task 4.1。
- [ ] 完成 Task 4.2。
- [ ] 根据 provider 能力决定是否完成 Task 4.3。

### 第六批：统一运行路径和评测

- [ ] 完成 Task 5.1。
- [ ] 完成 Task 5.2。
- [ ] 完成 Task 6.1。
- [ ] 完成 Task 6.2。
- [ ] 完成 Task 6.3。

## 暂不进入实施的决策项

1. Agent Worker 是实现还是暂时禁用。
2. native tools 是否作为默认通道，还是先以文本 fallback 运行。
3. provider vision 是否作为增强能力，而不是硬依赖。
4. 每步最大重试次数、整轮最大工具调用数和 token/网络预算。
5. 视觉验收阈值：标签重叠、对象裁剪、最小可见面积和视口占比。
6. 第一批上线支持的工具集合，未实现工具必须从模型菜单中移除。

## 计划完成标准

- [ ] 所有任务都能独立测试，不依赖未定义的接口。
- [ ] 计划中没有占位符、未定义接口或“之后补充”的实现步骤。
- [ ] 每个目标都有对应文件、测试和阶段门槛。
- [ ] 所有修改前必须先由用户确认本计划。
