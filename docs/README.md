# MathCanvas 技术文档导航

本目录集中管理 **MathCanvas** 的架构说明、功能清单、实时工程状态、发布说明与历史审计归档。

## 核心入口文档

| 文档 | 说明 |
| --- | --- |
| [`current-status.md`](current-status.md) | **唯一实时状态入口**：当前产品版本、门禁读数与阶段进展 |
| [`feature-catalog.md`](feature-catalog.md) | 全工作区（平面几何、立体几何、高等数学、工程制图、Agent）能力清单 |
| [`architecture.md`](architecture.md) | 前后端、确定性几何/高数内核、响应式场景图与宿主壳分层架构 |
| [`project-progress.md`](project-progress.md) | 按时间倒序记录的研发与实测过程日志（早期归档见 [`project-progress-early.md`](project-progress-early.md)） |
| [`agent-next-round-progress.md`](agent-next-round-progress.md) | Agent 演进与下一阶段工作导航 |
| [`annotation-feature.md`](annotation-feature.md) | 几何与工程制图标注设计说明 |

## 子目录索引

| 子目录 | 内容职责 |
| --- | --- |
| [`release/`](release/v6.0.0.md) | 历次正式版发布说明（最新：[`v6.0.0.md`](release/v6.0.0.md)、[`v5.3.0.md`](release/v5.3.0.md)） |
| [`acceptance/`](acceptance/agent-release-gate.md) | Agent 发布前门禁（[`agent-release-gate.md`](acceptance/agent-release-gate.md)）与工具循环记分卡 |
| [`archive/`](archive/CHANGELOG-2026-09.md) | 早期变更日志归档（[`CHANGELOG-2026-09.md`](archive/CHANGELOG-2026-09.md)） |
| `design/` · `decisions/` · `research/` · `taxonomy/` | 模块设计方案、架构决策记录（ADR）、调研纪要与题型分类规范 |
| `audit/` · `evidence/` · `g3-final/` | 阶段性质量审查、基准测试证据与历史快照归档 |
| `media/` | README 与文档引用的实机界面截图资产 |
