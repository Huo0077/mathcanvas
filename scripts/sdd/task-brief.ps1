#Requires -Version 5.1
<#
.SYNOPSIS
  抽出实施计划里第 N 个 Task 的**完整正文**到一个唯一命名的文件，打印该文件路径。

.DESCRIPTION
  `@zfdx123/dsh-superpowers` 的 `scripts/task-brief`（bash）的 PowerShell 移植。

  为什么要单独抽成文件而不把任务正文粘进派发提示：**粘进去的东西会一直留在
  控制器的上下文里**，之后每一轮都要重读一遍。交给子智能体的应该是一个路径。

  边界规则与 bash 版一致：从 `## Task N: ...` 这一行开始，到**同级的**下一个
  `## ` 标题或文件结尾为止（`###` 不算边界 —— 计划里的 Step 就是 `###`？不是，
  本仓库的计划用 `- [ ] **Step k:**`，但通用地按 `## ` 判边界更稳）。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PlanFile,
  [Parameter(Mandatory = $true)][int]$Task
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PlanFile -PathType Leaf)) {
  [Console]::Error.WriteLine("no such plan file: $PlanFile")
  exit 2
}

$workspace = & (Join-Path $PSScriptRoot "sdd-workspace.ps1") -PlanFile $PlanFile
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($workspace)) {
  [Console]::Error.WriteLine("could not resolve the SDD workspace")
  exit 2
}

$lines = Get-Content -LiteralPath $PlanFile -Encoding UTF8
$startPattern = [regex]::Escape("## Task $Task") + "\s*:"
$start = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match $startPattern) { $start = $i; break }
}
if ($start -lt 0) {
  # 变量名后面紧跟冒号会被解析成"驱动器限定变量"（`$Task:`），必须用 ${} 断开。
  [Console]::Error.WriteLine("no '## Task ${Task}:' heading in $PlanFile")
  exit 2
}

$end = $lines.Count
for ($i = $start + 1; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^## ') { $end = $i; break }
}

$brief = $lines[$start..($end - 1)] -join "`n"
$out = Join-Path $workspace "task-$Task-brief.md"
[System.IO.File]::WriteAllText($out, "$brief`n", (New-Object System.Text.UTF8Encoding($false)))
# 只写 stdout 的那一行路径：不能用 Resolve-Path 的管道输出（会多出一段目录清单，
# 被调用方 `$b = & script` 一并捕获，于是"路径"变成多行、后续 Read 直接失败）。
[Console]::Out.WriteLine((Resolve-Path -LiteralPath $out).Path)
