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
