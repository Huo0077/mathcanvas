# 下一轮工作导航

最后更新：2026-11-16（G3 实核与第二独立审题后）。

**实时进度只看[当前状态](current-status.md)，执行顺序只看[完整实施主计划](superpowers/plans/2026-11-15-main-restart-master-plan.md)与当前[G3续作计划](superpowers/plans/2026-11-16-g3-completion-plan.md)。** 本页不再保存第二份完成数字、测试读数或发布判断。

## 从哪里开始

1. 先读[当前状态](current-status.md)、[函数表达式与公共切线参数域](audit/2026-11-16-g3-function-domains/README.md)、[结构化不可行诊断](audit/2026-11-16-g3-infeasible-evidence/README.md)、[跨状态折叠谱系](audit/2026-11-16-g3-fold-lineage/README.md)、[DeepSeek真实结果](audit/2026-11-16-g3-deepseek-provider/README.md)和[G3续作计划](superpowers/plans/2026-11-16-g3-completion-plan.md)。G3-Math **尚未退出**；最近一次已保存的离线36题为0 passed/11 partial/25 failed，最近合同区块均未重跑离线评测，不能替代 provider 结果。
2. DeepSeek 最小验证为 **1 planned / 2 clarification / 0 error**。GK-P04/P09 已补全局表达式与公共切线下界，JT-P01/P04/P06 已绑定指定scope和代数不可行证据。下一步处理 **其余最值、完整棱向量、其他折叠及生产接线**，不得把 suite/case 自签为 `approved`。
3. 合同复核关闭后依次执行：生产完整证书与统一评测入口 → 平面18题 → 立体/折叠18题及 G3-Math → `B5`（`T15 → T16`）真实渲染与交互生命周期 → G3 总验收。
4. 每个区块执行 RED→GREEN、生产接线、反例/兼容和独立复核，随后同步活动进度文档、提交并推送 `feature/drawing-reliability-execution`，核对远端 ahead/behind 均为0。
5. 仅用户本次明确授权的保存 DeepSeek 可进行真实评测；其他付费 provider、P8、安装包/冷机与正式发布不在本 goal 内。实际 Windows 桌面 no-bundle 交互验证属于 G3-UX，不能用浏览器 mock 代替。AI 截图审查与用户/教师人工签收分开记录。

## 历史和证据边界

[版本决定](audit/2026-11-15-main-restart/README.md)固定59ea3613代码基线，be033b71为已完成的重启提交；旧线47提交已舍弃且有备份。正文带历史标记的N/V/W/Task计划只用于追溯，不计本轮已完成。

[项目审查报告](audit/2026-11-15-project-review/README.md)、[36题原始证据](audit/2026-11-15-drawing-baseline/README.md)和[原件归档](audit/2026-11-15-pre-reset/README.md)保持原样。历史E2E/基线读数、只读探针、工作包GREEN和本次G3实核不是同一类证据；以当前状态中的分层说明为准。

[本次对齐清单](audit/2026-11-15-progress-alignment/README.md)列出活动文件与历史导航处理范围。RustSec因未装 `cargo-audit` 留为 `unknown`；本次安装出现的新公告只作环境信号，未授权在本区块升级依赖。
