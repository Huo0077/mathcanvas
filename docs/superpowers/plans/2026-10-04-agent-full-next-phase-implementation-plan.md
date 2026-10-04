# 下一阶段 Agent 完整升级实施计划

> **For agentic workers:** 这是架构级计划，必须先评审设计规格；每个 Phase 独立 RED→GREEN→全量门禁，不能一次性合并四条主线。

**Goal:** 在静态示意图核验之后，逐步实现受控约束求解、拖动保持、形式证明出口和开放题编译，并让每一层都有独立证据。

**Architecture:** 统一 `Obligation/Constraint/Claim` IR；解析、求解、交互、证明和 Agent 编排分别拥有适配器边界。模型提出候选和草稿，系统拥有数学状态与提交权。

**Spec:** `docs/superpowers/specs/2026-10-04-agent-full-next-phase-design.md`。

## Global Constraints

- 任何数值模型都必须回到独立 verifier；求解器不能自证。
- `verified_instance`、`sampled`、`formally_proved` 三种证据不可混用。
- 所有 solver 都必须返回 `model / unsat / unknown / timeout / diverged` 之一，并保留残差、自由度和失败约束。
- 拖动关系必须进入文档约束/事务，不允许只在画布层补坐标。
- 外部项目只作为参考或可替换后端；先做许可证、线程、WASM/原生依赖和性能评估。
- 每个阶段都要有人工可读的真实浏览器验收，不把单元测试绿色当作数学正确率。

## Phase N1：统一约束与声明中间表示

**Files:** Create `packages/agent-core/src/obligationIR.ts`, `constraintIR.ts`, `claimEvidence.ts`; modify current diagram/relation/constraint contracts and exports.

- [ ] RED：同一题面能区分 given/construction/goal/free_choice；同一约束有 sourceText、targets、tolerance、judgeability；未知条件不会丢失。
- [ ] GREEN：把现有 `DiagramObligation`、`PlanRelation`、三维诊断适配到 IR；旧 JSON 和 `.mgeo` 不迁移，新增字段可选。
- [ ] 增加自由度报告：对象、约束、剩余自由度、冲突约束、未支持约束。
- [ ] 验证：全量 Vitest、typecheck、Worker/同步结果逐字段一致。

## Phase N2：受控解析构造与数值求解适配器

**Files:** Create `packages/geometry-kernel/src/witness/`, `packages/agent-core/src/solver/`; tests and worker contracts.

- [ ] RED：直角底面/垂足/中点/比例/单角度题，解析构造能给出模型或明确 no_witness；极大长宽比、退化、矛盾、超预算分别有反例。
- [ ] 实现解析构造器；候选统一经过当前 `diagramVerification` 和拓扑构造。
- [ ] 增加有限预算数值适配器；输入固定 seed、最大迭代、残差阈值和超时，输出模型/无解/未知/超时/发散。
- [ ] 可选后端只通过 adapter 接入；先做 Z3/NLSAT feasibility spike，不直接把 solver 绑定到 UI。
- [ ] 验证：Worker、主线程和失败恢复一致；benchmark 记录候选数、残差和耗时。

## Phase N3：动态拖动保持约束

**Files:** Modify scene graph constraint storage, `threeScene` drag pipeline, undo/redo, inspector; add kernel solver and e2e.

- [ ] RED：拖动自由点保持垂直/中点/固定距离；拖动造成过约束时拒绝并显示约束名；欠约束时显示自由度；一次拖动一步撤销。
- [ ] 增加临时 pointer constraint → solve → commit transaction 流程；禁止直接 mutate render state。
- [ ] 设计冲突 UI：被拒原因、保留条件、恢复方式；不靠颜色单独表达。
- [ ] 验证：浏览器拖动正/反例、保存/重开、撤销/重做、性能护栏。

## Phase N4：开放题编译与真实 Provider Benchmark

**Files:** Create `scripts/agent-benchmark/`, dataset schema, redaction/reporting; modify planner prompts/tool contracts only after dataset exists.

- [ ] RED：题集缺来源、缺模型/成本、secret 泄露、claim 无证据时报告拒绝生成。
- [ ] 建分层题集：欠定、矛盾、未支持表达式、点名打乱、二面角/比例、动态请求、普遍证明请求。
- [ ] 每题最多 3 轮，记录抽取、求解、验证、确认、人工可读性各层状态；输出 real_provider 与 deterministic_local 两套模式。
- [ ] 先跑小样本真实 provider baseline，再决定 prompt/tool loop/model 调整；无凭据就写 not_measured，不伪造数据。
- [ ] 开放题流程：原文切句 → Obligation IR → 计划/求解 → verifier → UI；不支持时给出具体缺口。

## Phase N5：形式证明出口

**Files:** Create `packages/agent-core/src/proof/`, proof artifact schema, external backend adapters, proof-focused e2e/docs.

- [ ] RED：实例通过或采样通过不得生成 formally_proved；伪造/不完整 proof artifact 必须拒绝。
- [ ] 先支持 5~10 个短目标：共线/共面、平行/垂直、等长、勾股等；生成可追溯中间语言。
- [ ] 适配 Lean/mathlib 或 AlphaGeometry/Newclid 风格后端，后端只返回 artifact/unsupported/failed。
- [ ] UI 和长期记忆显示证据类型，不把 proof 结论塞进普通示意图摘要。
- [ ] 验证：独立校验证书、失败目标、反例、版本锁定、超时处理。

## Phase N6：发布与维护

- [ ] 更新 `current-status`、`feature-catalog`、`project-progress`、`CHANGELOG`、release gate、scorecard。
- [ ] 所有新能力进入独立 feature flag；默认关闭直到真实 provider、动态拖动和证明试点分别达到门槛。
- [ ] 运行全量 unit/typecheck/lint/build/e2e/rust/perf/eval；记录非确定性测试重跑和环境限制。
- [ ] 代码审查重点：证据状态是否混用、solver 是否自证、拖动是否绕过事务、外部依赖许可证和线程安全。

## 阶段门槛

- N1：IR 覆盖现有题设，零行为回退。
- N2：首批题型可重复生成 verified_instance/no_witness，失败有原因。
- N3：拖动不静默破坏关系，冲突可恢复。
- N4：真实 provider 有 pass@1/pass@3、成本、延迟和人工可读性基线。
- N5：至少一类目标有可独立验证的 proof artifact。
- N6：所有旧门禁通过，默认路径仍 fail-closed。