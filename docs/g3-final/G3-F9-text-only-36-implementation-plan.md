# G3-F9 Text-Only 36 Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改写旧冻结36题的前提下，构建并实测来源可核对、无原题配图的独立36题真实 DS 作图集。

**Architecture:** 规划清单锁定旧23候选与13个空槽位，读取器/测试禁止空槽位当成实测题；新原题 source manifest 与合同独立版本化，完成独立审核方可生成可运行 suite。原生 DS runner 的请求、合同、截图、用户确认沿既有路径，只对新 suite 加强无图、预算和分母门禁。

**Tech Stack:** TypeScript、JSON、Vitest、Tauri 原生 DS 通道、现有合同验证器/浏览器 E2E。

**Spec:** [纯文字36题规格](G3-F9-text-only-36-suite-spec.md)

## Global Constraints

- 旧 `drawing-contracts-36.json`、`docs/audit/2026-11-15-drawing-baseline/manifest.json`、旧91次回执均不可改写；新分母未冻结前不得产生新集成功率。
- 保留18道平面 + 18道立体，GK/JT × plane/solid 各9；原图依赖或图示中含题意的题目直接排除。
- 真实 DS 请求必须取得新的明确费用授权；所有本地测试仅作防回归，不等于实测。
- 每区块验收后同步五份进度、审查、提交推送；任何失败保存原始指标与首断点。

---

### Task 1: 规划清单与冻结集隔离（当前区块）

**Files:**
- Create: `test-fixtures/reliability/text-only-36-plan.json`
- Test: `scripts/reliability-eval/textOnly36Plan.test.ts`
- Modify: `docs/g3-final/G3-F9-live-36-root-cause-and-repair-plan.md`、五份进度文档

**Interfaces:** 旧 `drawing-contracts-36.json` 的 `cases[].id/inputMode/examType/category` 只读；输出一个 `runnable=false`、23个旧 ID 和13个 `pending_source_review` 空槽位的数据清单。

- [ ] RED：测试读取清单并断言23个旧候选都为 text_only、没有任何旧有图 ID、13个空槽位各8 GK-S/5 JT-S、无 prompt/contract 可伪作题目、整体不允许运行；先运行 Vitest 验证缺失清单报错。
- [ ] GREEN：填入最少 JSON 元数据，不放伪造真题文本；重跑定向 Vitest、typecheck、docs、一致性检验。
- [ ] 更新主计划及五份状态，封存旧成绩；审查并提交/推送。

### Task 2: 逐题来源核验与题意准入（依赖人工资料；0 付费 DS）

**Files:**
- Create: `docs/audit/<date>-g3-text-only-36-selection/README.md` 和逐题核对表
- Modify: `test-fixtures/reliability/text-only-36-plan.json`（仅更新查证状态/来源，不将草稿标 runnable）

**Interfaces:** 每题来源文件/页面、考试/题号、原题 SHA、题图依赖判定、文本可绘制条件、分支/拓扑；每个拒选题留下原因。旧23复审失败时按同一象限补位。

- [ ] 收集至少13道同规格真题来源，先检索官方/考试组织方文件，再核验题干（不能从 AI 重述生成原题）；旧23逐一复查。
- [ ] 每个候选做图示依赖和歧义审查：图是纯装饰也仍跳过“原题带图”情形；若需要图片才能确定任一关系则拒绝。
- [ ] 两名独立审阅者记录题意、绘图义务及重复指纹；不足36时阻断 Task 3/付费运行。

**2026-11-19 第一轮线索**：[来源初筛审计](../audit/2026-11-19-g3-text-only-source-triage/README.md)记录8个高考转录来源+5个联考 PDF 原卷页候选，均未独立批准。旧23仅复核文本/哈希，原卷无图需复审；另有题干未写“如图”但 PDF 带图的否决实例。本任务保持未完成。

### Task 3: 新黄金合同与隔离加载（依赖 Task 2）

**Files:**
- Create: `test-fixtures/reliability/text-only-36-source-manifest.json`、`test-fixtures/reliability/text-only-drawing-contracts-36.json`
- Modify: `scripts/reliability-eval/drawingContracts.ts` 或增设专用验证器（保持旧 manifest 测试不变）
- Test: `scripts/reliability-eval/textOnly36Contracts.test.ts`

**Interfaces:** 36条新题原文/哈希、合法分支、源段及可度量绘图义务。新 suite 独立 `suiteId/version/hash` 且所有 `inputMode=text_only`，来源错误和不足36都 fail closed。

- [ ] RED：拒绝缺题/图题/重复/源 hash 错/图元义务不足/原题篡改/旧成绩误并表；新题针对形状+关系+分支各有一正一负。
- [ ] GREEN：按照真实题面填合同并过类型/测试；独立审查通过才标 `runnable=true`，锁定版本 hash，审核签字与变更留痕。

### Task 4: 新版原生 DS 验收与成本门禁（需新授权）

**Files:**
- Modify: `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts` 或新建仅新集入口、`scripts/reliability-eval` 实测命令
- Test: `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts` 和现场原生/浏览器候选核验
- Create: `docs/audit/<date>-g3-text-only-36-live/README.md`

**Interfaces:** 显式 suite/hash/commit/profile 修订、预算/每题请求上限、trace+candidateHash、证书+可读预览+确认前后写入观测。

- [ ] RED：旧图题/未审草稿/旧 suite hash 伪装成新 suite/预算未知时请求前拒绝；确认失败不得伪报端到端成功。
- [ ] GREEN：先3个旧真实失败族样本；满足合同、证书、画面与原生确认后，另按新授权扩展到36题。
- [ ] 汇报首次成功、终态成功、失败类别、费用未知与重复轮次；旧/新分表；五份进度文档对齐、提交推送。Goal 仅在真实验收达标后才完成。
