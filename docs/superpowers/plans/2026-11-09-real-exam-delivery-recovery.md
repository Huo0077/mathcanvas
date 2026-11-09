# 真题选择题交付链路恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在不放宽已知错误和图像缺口门禁的前提下，让单选真题能够进入正确的只读答题及可追溯交付路径。

**Architecture:** 保持题意层为目标唯一来源；规划器只按宿主目标约束可用动作；答案适配器只解析明确选项。协调器的作图验收、真实图像缺口及宿主否证代码不降级。

**Tech Stack:** TypeScript、Vitest、React、Tauri provider（仅最终授权的真实评测会调用）。

**Spec:** `docs/superpowers/specs/2026-11-09-real-exam-delivery-recovery-design.md`

## Global Constraints

- 默认可靠性灰度为 0%，不得自动启用第二模型或自动写入草稿。
- `sourceText` 必须等于原题 `prompt.slice(start,end)`，不能使用参考答案构造目标。
- 显式作图、图像必要事实缺口和宿主否证仍按原门禁处理；无证明的答案只标“未核验”。
- 所有修复在付费调用前先以冻结题集离线测试；不能以通道切换前后的分数直接说明数学能力变化。

---

### Task 1: 单选目标抽取

**Files:**
- Modify: `packages/agent-core/src/problemUnderstanding.ts`, `packages/agent-core/src/solveContext.ts`（本次未改）
- Test: `packages/agent-core/src/problemUnderstanding.test.ts`, `packages/agent-core/src/solveContext.test.ts`

**Interfaces:** 输入 `understandProblem({prompt,problemRevision})`，输出恰好一个 `single_choice` goal 与来源 span；既有多问与绘图保持原状。

- [x] 在测试里写“则（ ）”与有序 A/B/C/D、带图选项仅题干、显式证明/作图、多小问的反例，断言目标类型及 span。
- [x] 运行定向 Vitest，确认目标测试因缺失单选目标而失败（已记录 3 个失败）。
- [x] 只调整 `problemUnderstanding` 的单问目标建立与优先级；不使用答案键和模型文本。
- [x] 重新运行定向测试、既有 134 项相关回归（包含在全量测试中）。

### Task 2: 只读答题候选与动作路由

**Files:**
- Modify: `packages/agent-core/src/answerEnvelopeAdapter.ts`, `packages/agent-core/src/answerAcceptance.ts`, `packages/agent-core/src/coordinator.ts`, `apps/web/src/agent/problemSolveService.ts`, `apps/web/src/agent/modelPlanner.ts`
- Test: `packages/agent-core/src/answerEnvelopeAdapter.test.ts`, `packages/agent-core/src/answerAcceptance.test.ts`, `apps/web/src/agent/problemSolveService.test.ts`, `apps/web/src/agent/modelPlanner.test.ts`

**Interfaces:** 仅有唯一明确“最终答案：X”的文本可产生 `single_choice` 候选；生产 `selectProblemPlanner` 面对单选目标只声明只读能力，不为单选注入作图动作；显式作图目标保留原动作。

- [x] 写结构化/自由文本选项、重复/错 goalId、图题缺口与否证的失败测试；写选择题规划器实际可用动作和无写入测试。
- [x] 定向跑测试看预期失败，修正提取或规划器；协调器仅加只读禁止草稿安全闸，不动几何与数学门禁。
- [x] 定向跑测试及全量 agent-core/Web agent 相关回归，检查“未核验”而非“已核验”。

### Task 3: 冻结题集回归、产品入口与报告

**Files:**
- Create: `scripts/real-exam-eval/production-entry-regression.test.ts`（或适当位置）
- Modify: `docs/audit/2026-11-09-full-upgrade-real-exam-retest.md`, `docs/current-status.md`

**Interfaces:** 仅消费冻结题集的题面及类型，不把参考答案喂给运行时；报告复测和未测边界。

- [x] 用全部 50 题测试目标准备/路由，再加非选择题与缺证据的对抗用例；先看到回归红后再绿。
- [x] 跑全项目 typecheck、相关 Vitest、文档检查和必要的 UI 测试；逐项复核日志与退出码（尚无新版本桌面 UI 真题人工抽测）。
- [x] 记录实际通过/失败数和剩余风险；无授权不重复进行付费评测；保留当前未提交用户工作文件，不自动推送。
