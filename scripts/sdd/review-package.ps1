#Requires -Version 5.1
<#
.SYNOPSIS
  生成复核包：`BASE..HEAD` 的提交列表 + stat 摘要 + 带上下文的完整 diff，写成**一个文件**并打印其路径。

.DESCRIPTION
  `@zfdx123/dsh-superpowers` 的 `scripts/review-package`（bash）的 PowerShell 移植。

  为什么必须是一个文件：复核者拿到路径后一次 Read 就能看到提交列表、改动统计与
  完整 diff；而把这些打回控制器上下文再由控制器转述，会让每个 diff 常驻控制器
  上下文的每一轮。

  **BASE 必须是"派发实施者之前记下的那个 HEAD"**，不能用 `HEAD~1` ——
  一个 Task 可能有好几个提交，`HEAD~1` 会**静默丢掉除最后一个之外的全部改动**，
  于是复核者看到的是一份被截断的 diff、却以为看全了。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PlanFile,
  [Parameter(Mandatory = $true)][string]$Base,
  [Parameter(Mandatory = $true)][string]$Head
)

$ErrorActionPreference = "Stop"

$workspace = & (Join-Path $PSScriptRoot "sdd-workspace.ps1") -PlanFile $PlanFile
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($workspace)) {
  [Console]::Error.WriteLine("could not resolve the SDD workspace")
  exit 2
}

$baseSha = (git rev-parse --verify "$Base^{commit}").Trim()
if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("bad BASE ref: $Base"); exit 2 }
$headSha = (git rev-parse --verify "$Head^{commit}").Trim()
if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("bad HEAD ref: $Head"); exit 2 }

$base7 = $baseSha.Substring(0, 7)
$head7 = $headSha.Substring(0, 7)

$parts = @()
$parts += "# Review package: $base7..$head7"
$parts += ""
$parts += "## Commits"
$parts += ""
$parts += (& git log --oneline "$baseSha..$headSha" | Out-String).TrimEnd()
$parts += ""
$parts += "## Diff stat"
$parts += ""
$parts += (& git diff --stat "$baseSha..$headSha" | Out-String).TrimEnd()
$parts += ""
$parts += "## Full diff (unified, 10 lines of context)"
$parts += ""
$parts += (& git diff -U10 "$baseSha..$headSha" | Out-String).TrimEnd()
$parts += ""

$body = ($parts -join "`n") + "`n"
$out = Join-Path $workspace "review-$base7..$head7.md"
[System.IO.File]::WriteAllText($out, $body, (New-Object System.Text.UTF8Encoding($false)))
# 只写 stdout 的那一行路径（与 sdd-workspace 同理）。
[Console]::Out.WriteLine((Resolve-Path -LiteralPath $out).Path)
