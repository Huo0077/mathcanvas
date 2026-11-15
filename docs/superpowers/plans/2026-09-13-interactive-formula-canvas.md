# Interactive Formula Canvas Implementation Plan

<!-- progress-scope: historical-before-main-restart -->
> **历史计划/过程记录（2026-11-15 主线重启后已被替代为历史参考）**：下文的“当前”“下一步”“已完成/未完成”、任务编号、勾选、工期和测试读数均属于原记录时点，不是本轮执行授权或验收进度；已有基线代码不因文档标记而删除，也不把旧完成项折算成本轮完成。
> 实时进度只看[当前状态](../../current-status.md)；执行顺序统一按[完整实施主计划](2026-11-15-main-restart-master-plan.md)和[任务合同](2026-11-15-implementation-task-ledger.json)。旧正文原样保留，历史链接按当时语境阅读。
<!-- /progress-scope -->

> **状态（2026-09-17 复核）**：本计划范围内的功能**已交付**——计算器式公式键盘与模板插入、画布实时坐标读数、交点预览与点击创建、右侧属性面板分节都已进入产品（见 `docs/feature-catalog.md` 的「公式键盘 / 悬停坐标 / 交点预览与点击创建」条目与 `e2e/workbench.spec.ts`）。下面的复选框保留历史原貌（未逐条勾选）；本仓库的**单一进度记录**是 [`docs/project-progress.md`](../../project-progress.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make function authoring calculator-like, expose live canvas coordinates and intersections, and give the right properties panel a coherent, stable UI.

**Architecture:** Keep formula insertion and expression normalization in focused helpers, derive hover/intersection previews from the current scene without persisting them, and keep persistence limited to explicit user-created intersection primitives. Refine the existing right panel with reusable sections and token-based layout styles.

**Tech Stack:** React, TypeScript, SVG, Vitest, Vite, existing geometry-kernel expression and intersection utilities.

**Spec:** User-approved interactive formula, hover coordinate, automatic intersection, and properties-panel design from this task.

## Global Constraints

- Preserve the existing `.mgeo` document format unless a user explicitly creates a persistent intersection.
- Use the existing expression parser and geometry kernel; do not evaluate arbitrary JavaScript.
- Keep all visible UI changes accessible with keyboard labels and minimum touch targets.
- Write failing tests before production changes and run verification before each completion claim.

---

### Task 1: Formula keyboard and expression templates

**Files:**
- Create: `apps/web/src/formulaEditor.ts`
- Test: `apps/web/src/formulaEditor.test.ts`
- Modify: `apps/web/src/components/PropertiesBar.tsx`
- Modify: `packages/geometry-kernel/src/function-presets.ts`

- [ ] Write tests for cursor-aware nested function insertion, classroom notation, and logarithm base templates.
- [ ] Run focused tests and confirm the new behavior fails.
- [ ] Implement template insertion and connect grouped function buttons below the formula editor.
- [ ] Run focused tests and existing function tests.

### Task 2: Hover coordinates and transient intersections

**Files:**
- Create: `apps/web/src/intersectionPreview.ts`
- Test: `apps/web/src/intersectionPreview.test.ts`
- Modify: `apps/web/src/components/GraphicsView.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] Write tests for deduplicated line, circle, and sampled-curve intersection previews.
- [ ] Run focused tests and confirm preview behavior fails.
- [ ] Implement pointer coordinate state, hover readout, transient intersection rendering, and click-to-create callbacks.
- [ ] Run focused interaction and geometry tests.

### Task 3: Properties panel visual system

**Files:**
- Modify: `apps/web/src/components/PropertiesBar.tsx`
- Modify: `apps/web/src/styles/global.css`
- Test: `apps/web/src/App.test.tsx`

- [ ] Add UI regression coverage for grouped sections, formula keyboard visibility, and responsive panel behavior.
- [ ] Refactor the panel into stable titled sections without changing domain behavior.
- [ ] Add token-based section, toolbar, status, and scroll styling with visible focus states.
- [ ] Run focused UI tests and inspect the rendered browser surface.

### Task 4: Documentation and release verification

**Files:**
- Modify: `docs/annotation-feature.md`
- Modify: `docs/feature-catalog.md`

- [ ] Document formula keyboard, hover coordinates, transient intersections, and click-to-create persistence.
- [ ] Run `npm.cmd test`, `npm.cmd run typecheck`, and `npm.cmd run build`.
- [ ] Review the diff, commit the complete slice, and push `origin/main`.
