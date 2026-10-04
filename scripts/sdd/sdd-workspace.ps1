#Requires -Version 5.1
<#
.SYNOPSIS
  SDD 工作区解析：打印（必要时创建）本计划的工作区绝对路径。

.DESCRIPTION
  `@zfdx123/dsh-superpowers` 的 `scripts/sdd-workspace`（bash）的 PowerShell 移植。
  行为逐条对齐，**包括那条最容易搞错的所有权规则**：

  - 工作区在 `<repo-root>/.superpowers/sdd/<plan-basename>/`，一个计划一个目录；
  - 目录里写 `plan-path` 标记（仓库内用仓库相对路径，仓库外用绝对路径）；
  - 已有标记且**不是**本计划 → 换 `<slug>-<plan 父目录名>`，再冲突就续 `-2`、`-3`…；
  - 没有标记（新建的，或标记方案之前的遗留目录）→ **认领**并写下标记。

  为什么要移植而不是"让子智能体自己拼一条命令"：这三个脚本是控制器每一轮都要跑的，
  简报命名与复核包命名必须共用同一套目录约定；一旦某处现编路径，产物就会漂移，
  而漂移的后果是**把另一个计划的进度当成本计划的**。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$PlanFile
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PlanFile -PathType Leaf)) {
  [Console]::Error.WriteLine("no such plan file: $PlanFile")
  exit 2
}

$root = (git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($root)) {
  [Console]::Error.WriteLine("not inside a git working tree")
  exit 2
}
$root = $root -replace '\\', '/'

$base = "$root/.superpowers/sdd"

$planFileName = Split-Path -Leaf $PlanFile
$slug = $planFileName -replace '\.md$', ''
if ([string]::IsNullOrWhiteSpace($slug)) {
  [Console]::Error.WriteLine("cannot derive a workspace name from: $PlanFile")
  exit 2
}

$planDirName = Split-Path -Parent $PlanFile
if ([string]::IsNullOrWhiteSpace($planDirName)) { $planDirName = "." }

# 规范化计划路径：物理目录 + 文件名（相对 / 绝对 / 带 .. 的写法都归一成同一个标记值）。
$planDirPhysical = (Resolve-Path -LiteralPath $planDirName).Path -replace '\\', '/'
$planAbs = "$planDirPhysical/$planFileName"
$planId = if ($planAbs.StartsWith("$root/")) { $planAbs.Substring($root.Length + 1) } else { $planAbs }

function Test-Owns {
  param([string]$Dir)
  $marker = Join-Path $Dir "plan-path"
  if (Test-Path -LiteralPath $marker) {
    return ((Get-Content -LiteralPath $marker -Raw -Encoding UTF8).Trim() -eq $planId)
  }
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  [System.IO.File]::WriteAllText($marker, "$planId`n", (New-Object System.Text.UTF8Encoding($false)))
  return $true
}

$dir = Join-Path $base $slug
if (-not (Test-Owns -Dir $dir)) {
  $parent = Split-Path -Leaf $planDirPhysical
  $dir = Join-Path $base "$slug-$parent"
  if (-not (Test-Owns -Dir $dir)) {
    $n = 2
    while (-not (Test-Owns -Dir (Join-Path $base "$slug-$parent-$n"))) { $n++ }
    $dir = Join-Path $base "$slug-$parent-$n"
  }
}

# 自忽略的 .gitignore：让所有工作区都不进 git status、也不会被误提交。
New-Item -ItemType Directory -Force -Path $base | Out-Null
[System.IO.File]::WriteAllText((Join-Path $base ".gitignore"), "*`n", (New-Object System.Text.UTF8Encoding($false)))

# 只写 stdout 的那一行路径。
#
# 两个 PowerShell 特有的坑，都实测踩过：
# ① 不能用**裸的** Resolve-Path 收尾 —— 它会把路径对象和目录清单一起写进管道，
#    `$ws = & script` 捕获到的就不是一个纯字符串；用 Write-Output 只发一个字符串。
# ② 不能用 [Console]::Out.WriteLine —— 它绕过 PowerShell 管道直接写控制台，
#    外部进程能做到"stdout 被抓"，进程内 `&` 调用**抓不到**。
#
# 收尾用 `return` 而不是 `exit 0`：`&` 调用是**在同一个会话里**执行脚本的，
# `exit` 会把整个会话一起结束掉，调用方（task-brief / review-package）就此静默停住，
# 表现为"脚本跑了但什么都没发生"。
Write-Output ((Resolve-Path -LiteralPath $dir).Path -join '')
return
