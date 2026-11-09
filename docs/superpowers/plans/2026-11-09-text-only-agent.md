# Agent 文字题专用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 移除图片读题生产入口，保留文字解题、文字作图和历史消息查看。

**Architecture:** UI 改用现有文字输入组件；Ribbon 入口切至 Agent 文字输入；AgentRunner 在生产调用前拒绝历史图片信封并只传文字上下文。历史消息显示沿用只读解析器。

**Tech Stack:** React、TypeScript、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-09-text-only-agent-design.md`

## Global Constraints
- 不删除或迁移历史对话/项目文档；不影响文字生成图元。
- 不读取/展示密钥，不调用付费图片识别模型。
- 图片信封重放须在请求前拒绝，不默默清空其来源信息继续当文字题求解。

---

### Task 1: UI/Ribbon
**Files:** `apps/web/src/components/agent/AgentWorkspace.tsx`, `apps/web/src/App.tsx`, `apps/web/src/ribbonCommands.ts`, associated tests.
- [x] 写失败测试：Agent 区只含文字输入，Ribbon 只含文字解题。
- [x] 运行失败测试并确认失败原因在图片入口。
- [x] 用 `AgentComposer` 替换 `ProblemImageComposer`，移除图片 Ribbon 命令，启用文字命令导航。
- [x] 运行定向测试，确认文字作图示例仍可发送。

### Task 2: Agent 信任边界
**Files:** `apps/web/src/agent/agentRunner.ts` 和测试、历史消息只读 parser。
- [x] 写失败测试：旧图片信封重发不能请求模型，但旧消息依旧可查看；纯文字作图/解题仍可用。
- [x] 在 AgentRunner 运行之前拒绝图片信封；生成纯文字 SolveContext；不再领取视觉会话。
- [x] 清理旧图像调用组件及专属测试，保留必要的历史格式兼容（旧浏览器识图用例存档在 `docs/audit/artifacts/retired-tests/`）。
- [x] 跑 agent、消息展示与历史对话定向回归。

### Task 3: 验证及文档
**Files:** `docs/current-status.md`, `scripts/real-exam-eval/README.md`, `scripts/docs-consistency/*.test.ts`, Web e2e。
- [x] 类型、lint、定向与全量单测、浏览器文字 Agent e2e；保留失败原样报告（首次作图用例因检查旧文案失败，现场显示“已按确认提交。”且确认面板依旧可见；更新断言后单跑及整组 8/8 通过）。
- [x] 更新“只做文字题”的当前状态与被停用入口、历史查看边界，图题旧成绩保留为历史。
- [x] 不额外调用模型、不推送 GitHub，除非用户另行要求。