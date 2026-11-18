# 下一轮工作导航

> **2026-11-18 最终版 B→C 路线执行更新（Task F0–F1 完成，0 付费；真实 DS 仍 0/36）**：已完成 **Task F0**（`f118c721`，[2026-11-17-92981 基线](g3-final/retests/2026-11-17-92981/README.md)）与 **Task F1**（[Task F1 审计](audit/g3-final-f1/README.md)，`speculativeCanvas` 探索隔离层 + `draftStore`/`hostBridge` `speculativeOnly` 硬阻断，`3` 文件 `47 passed` + `typecheck` + `lint` + `test:docs` 全过）。真实 DS 仍 `0/36`，**当前执行入口推进至 Task F2（动作级 DS ToolSpec `dsActionTools.ts`）**；**Task F9（分层真实 DS 复测）仍需独立付费授权**。

> **2026-11-17 最新DS实测**：最新 `92981ebd` 全36题强制DS完整合同仍**0/36**，有候选2题、34题无候选；此前7个工具混批本轮0个。优先修结构化施工单的未声明实体/必需参数/格式协议，不以加请求、离线36/36或浏览器工程通过替代。逐题见[本轮审计](audit/2026-11-17-g3-ds-live-retest-92981/README.md)，再次付费需新授权。

> **2026-11-17 Task 0–Task 5 完成 + 零付费加固更新（停机等待 Task 6 付费授权）**：已完成 [Task 0](audit/g3-ds-failure-driven-t0/README.md)（`6747fb72`）、[Task 1](audit/g3-ds-failure-driven-t1/README.md)（`3a803541`）、[Task 2](audit/g3-ds-failure-driven-t2/README.md)（`524b92f2`）、[Task 3](audit/g3-ds-failure-driven-t3/README.md)（`375bb194`）、[Task 4](audit/g3-ds-failure-driven-t4/README.md)（`332d8e47`）、[Task 5](audit/g3-ds-failure-driven-t5/README.md)（`b776d609`）及 [零付费加固轮](audit/g3-ds-failure-driven-hardening/README.md)（修复 `ds_intent` 提示词/schema 参数契约冲突、`g3DsFrozenCaseRunner` `plan.set_plan`/`AbortSignal` 接线与 Task 6 预检熔断门禁、`dsDrawingIntent` 公切线/源绑定切线/垂直平行线/缩放方程/多点折叠/未解步骤 fail-closed；全仓 `npm test` `550` 文件 `5850 passed | 1 todo`、`typecheck`、`lint` 与 `test:docs` 全过）；真实 DS 成绩仍为 `0/36`，**当前执行严格停在 Task 6（Live 预检 + 36 题在线复测）之前，等待用户显式付费授权**。
> **2026-11-17 G3-DS 新执行入口**：先读[当前状态](current-status.md)、[新设计](superpowers/specs/2026-11-17-g3-ds-failure-driven-design.md)与[失败驱动实施计划](superpowers/plans/2026-11-17-g3-ds-failure-driven-implementation-plan.md)。Task 0诊断→Task 1工具协议→Task 2数学参数来源→Task 3候选与约束→Task 4多状态合同→Task 5同版画布→Task 6新授权实测；下文旧“下一步”只作历史导航。DS真实合同仍0/36，不启动新付费调用。
> **2026-11-17 36题真实DS复测优先导航**：完整36题已按用户要求跑完，当前强制DS路线完整合同**0/36**、3 partial、33 failed、93原生请求；根因先查[逐题审计](audit/2026-11-17-g3-ds5-live-36/README.md)的混合工具批次、26题零候选及10题不完整候选。不得只增加重试、拿离线36/36抵账或沿用已耗尽的本轮付费授权。实时进度见[当前状态](current-status.md)。
> **2026-11-17 DS5 预检更新**：已按用户额度真实请求4次，4题均未生成候选（完整合同0/4），受单题1请求限制；至少3题首轮出现 `tool_calls`，须先查工具环与预算诊断。证据见[DS5否定性预检](audit/2026-11-17-g3-ds5-live-preflight/README.md)。本次请求额度耗尽，新的2–3次/题或36题整批需重新授权；不继承旧的“DS未测”导航。

> **2026-11-17 DS4 收口更新**：已完成 `DS0`（[DS0 基线与边界定位](audit/2026-11-16-g3-ds-live-baseline/README.md)）、`DS1`（[DS1 结构化施工单与紧凑协议](audit/2026-11-17-g3-ds1-intent/README.md)）、`DS2`（[DS2 义务族求解与作用域隔离](audit/2026-11-17-g3-ds2-partial-families/README.md)）、`DS3`（[DS3 生产证书双向闭环与有界修复](audit/2026-11-17-g3-ds3-certificate-repair/README.md)）与 `DS4`（[DS4 同候选浏览器渲染与受控交付](audit/2026-11-17-g3-ds4-render-delivery/README.md)，0 付费调用，全量 Vitest `547/5824`、Playwright `40/40`、desktop 构建过）。**当前停在 `DS5` 付费实测授权门禁前**：需先由用户明确授权目标模型/题集、预检批量、最大请求数与 token/费用上限及停机条件，同时另行安排教师人工可读性与实机桌面窗口 UIA 签收。实时分数只看[当前状态](current-status.md)。

> **2026-11-17 G3区块更新**：[G3真实浏览器渲染审阅包](audit/2026-11-17-g3-render-exit/README.md)：36题自动化渲染和全量E2E已验证；25题仍有视觉警告，人工可读性与Windows桌面窗口签收待办。下一步先逐题审阅，不把AI抽检或DS未测结果当成人工通过。

最后更新：2026-11-17（真实候选渲染与确认链已闭环；下一区块为 36 题审阅包、桌面 UIA 与最终复核；DeepSeek 实测按用户指示保留后继）。

**实时进度只看[当前状态](current-status.md)，执行顺序只看[完整实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)与当前[G3续作计划](superpowers/plans/2026-11-16-g3-completion-plan.md)。** 本页不再保存第二份完成数字、测试读数或发布判断。

## 从哪里开始

1. 先读[当前状态](current-status.md)、[真实候选渲染与确认链](audit/2026-11-17-g3-candidate-render/README.md)、[G3 阶段总验收汇总](audit/2026-11-17-g3-final/README.md)、[Task 6 交互与全量回归证据](audit/2026-11-17-g3-interaction-exit/README.md)、[Task 4 G3-Math 36/36 退出证据](audit/2026-11-17-g3-math-exit/README.md)、[Task 3 平面 18 题证据](audit/2026-11-17-g3-planar-18/README.md)、[Task 2 证书接线证据](audit/2026-11-17-g3-certificate-wiring/README.md)、[P0 / T01 R4 终审与基线](audit/2026-11-17-g3-contract-review-r4/README.md)、[P7 / T15渲染可见性证据](audit/2026-11-17-p7-render-visibility/README.md)、[DeepSeek真实结果](audit/2026-11-16-g3-deepseek-provider/README.md)和[G3续作计划](superpowers/plans/2026-11-16-g3-completion-plan.md)。真实候选渲染续作为 **544 文件 / 5796 passed + 1 todo**、目标 Playwright **5/5**；下一区块生成 36 题截图/联系表，再做桌面 UIA 与最终独立复核。
2. 应用户明确指示，**已保存 DeepSeek 真实模型画图测试暂留由用户本人后续执行**；非沙盒交互式桌面 UIA 走查、教师/用户人工可读性签收与 `P8` 仍保持未完成，不以浏览器 E2E 或 AI 抽检冒充人工签收。
3. 每个区块执行 RED→GREEN、生产接线、反例/兼容和独立复核，随后同步活动进度文档、提交并推送 `feature/drawing-reliability-execution`，核对远端 ahead/behind 均为0。
4. 仅用户本次明确授权的保存 DeepSeek 可进行真实评测；其他付费 provider、P8、安装包/冷机与正式发布不在本 goal 内。实际 Windows 桌面 no-bundle 交互验证属于 G3-UX，不能用浏览器 mock 代替。AI 截图审查与用户/教师人工签收分开记录。

## 历史和证据边界

[版本决定](audit/2026-11-15-main-restart/README.md)固定59ea3613代码基线，be033b71为已完成的重启提交；旧线47提交已舍弃且有备份。正文带历史标记的N/V/W/Task计划只用于追溯，不计本轮已完成。

[项目审查报告](audit/2026-11-15-project-review/README.md)、[36题原始证据](audit/2026-11-15-drawing-baseline/README.md)和[原件归档](audit/2026-11-15-pre-reset/README.md)保持原样。历史E2E/基线读数、只读探针、工作包GREEN和本次G3实核不是同一类证据；以当前状态中的分层说明为准。

[本次对齐清单](audit/2026-11-15-progress-alignment/README.md)列出活动文件与历史导航处理范围。RustSec因未装 `cargo-audit` 留为 `unknown`；本次安装出现的新公告只作环境信号，未授权在本区块升级依赖。
