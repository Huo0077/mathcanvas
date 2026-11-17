# 下一轮工作导航

> **2026-11-16（America/Los_Angeles）新决议，优先于下方旧“DS留待用户执行”的导航**：先按[G3-DS实测升级计划](superpowers/plans/2026-11-16-g3-ds-live-upgrade-plan.md)执行 DS0 脱敏归因，再依次 DS1–DS4；DS5 的新付费预检/整批需先取得独立预算授权。强制DS旧基线2/36；不是下方确定性浏览器36/36。实时分数只看[当前状态](current-status.md)。

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
