> **2026-10-16 状态同步（当前口径）**：四家族 21 Task 为 **16 完成（1–15、17）/ 3 部分完成（16、18、19）/ 2 未完成或未发行验收（20、21）**。本文件下文保留专题/历史范围，不代表全部任务或发行完成。历史提交 `7efd0ce` 的 GitHub CI checks 在 Vitest 失败，六份日志的 UTF-16 编码违反 UTF-8 判据；后续 `1add886` 已修复，其远端运行 `38995619547` 已成功。本次文档提交的 CI 需另行验证；真实模型、人评、完整视觉与干净/离线发行验收仍缺。统一读数与剩余项见[当前状态](../../docs/current-status.md)。本次仅更新文档。

# SDD 辅助脚本（PowerShell 移植版）

`@zfdx123/dsh-superpowers` 自带的 subagent-driven-development 三个脚本是 bash 的
（`scripts/sdd-workspace`、`scripts/task-brief`、`scripts/review-package`），而本机
**没有 bash**（`Get-Command bash` 为空）。所以这里按它们的行为逐条移植成 PowerShell，
保留同一套目录约定与输出（打印路径、由调用方 Read）。

为什么不让子智能体自己想办法：这三个脚本是**控制器每一轮都要跑**的东西，
一旦某个 Task 里现编一段命令，目录就会漂移（工作区认领、简报命名、复核包命名
三处必须同一套约定），而漂移的后果是"另一个计划的产物被当成本计划的进度"。

## 用法

```powershell
# 解析（必要时创建）本计划的工作区，打印绝对路径
pwsh -File scripts\sdd-workspace.ps1 -PlanFile docs\superpowers\plans\xxx.md

# 抽出第 N 个 Task 的正文到一个唯一命名的文件，打印路径
pwsh -File scripts\task-brief.ps1 -PlanFile docs\superpowers\plans\xxx.md -Task 3

# 把 BASE..HEAD 的提交列表 + stat + 带上下文的完整 diff 写成一个文件，打印路径
pwsh -File scripts\review-package.ps1 -PlanFile docs\superpowers\plans\xxx.md -Base <sha> -Head <sha>
```

三个脚本都从**当前目录**解析计划文件，并用 `git rev-parse --show-toplevel` 定位仓库根，
与 bash 版一致。
