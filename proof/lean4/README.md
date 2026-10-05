# `proof/lean4/` —— 形式证明后端用的那个**仓内 Lean 小工程**（N5b）

这个目录**只有四个文件**（`lakefile.toml` / `lean-toolchain` / `.gitignore` / `DrawProof.lean`）。
**7 GB 的 mathlib 不在仓库里**：它展开在 `.lake/`，而这一层被上面那份 `.gitignore`（一行 `/.lake`）挡住。

## 它为什么在仓库里（而不是像探针那样放在仓外）

适配器要跑 Lean，就得有一个**工程根**：`lake env lean` 要找到 `import Mathlib...` 的 `.olean`。
"工程根"必须是**可复算的相对路径**，所以它跟着仓库走 —— 否则适配器只能写死某台机器的绝对路径，
而那正是简报 §三明令禁止的（"Lean 可执行文件不要写绝对路径进产品代码"）。

**放的是工程定义，不是工具链、也不是缓存。** 这份仓库里没有 Lean 二进制，也没有 mathlib 源码。

## 第一次用（要下 GB 级的东西，**不在证明路径上**）

```powershell
# 1. 取包（mathlib 的 postUpdate 会自动去取官方缓存；压缩包落在 ~/.cache/mathlib，可复用）
& "$env:USERPROFILE\.elan\bin\lake.exe" update
# 2. 确信缓存到位（第二次跑会打印 `No files to download` / `Already decompressed …`）
& "$env:USERPROFILE\.elan\bin\lake.exe" exe cache get
# 3. 跑那条一般命题
& "$env:USERPROFILE\.elan\bin\lake.exe" env lean DrawProof.lean
```

实测代价（控制器 2026-10-06 在仓外探针上量的，同一份 mathlib）：从零到可用 **1617 s ≈ 27 min**
（`lake update` 1040 s 含 postUpdate 自动取缓存 + `cache get` 440 s + `build` 66 s + `lean` 71 s）；
压缩缓存 **0.42 GB / 9001 文件**；**展开后 7.5 GB（每工程一份）**。

## ⚠️ 工具链为什么钉 `v4.35.0-rc3` 而不是 `v4.34.1`

`lean-toolchain` 里写的是 **`leanprover/lean4:v4.35.0-rc3`**。这不是随手选的：

- **mathlib 的官方预编译缓存（`.olean`）是用 `v4.35.0-rc3` 建出来的** ——
  `.lake/packages/mathlib/lean-toolchain` 里就是那个版本。
- 用本机默认的 `v4.34.1` 去读它，Lean **读得进文件、但报**
  `failed to read file '...\Mathlib.olean', incompatible header`（实测原文见 `task-5b-report.md`）。
- 也就是说：**跑这个工程必须用 `v4.35.0-rc3`**。适配器不猜这件事 —— 它调 `lake`，
  由 `lake` 按这份 `lean-toolchain` 决定工具链；产物里的 `backend.version` 用调用方从
  `lean --version` 拿到的**实测**串。

本机两个工具链都在（`~/.elan/toolchains/` 下 `v4.34.1` 与 `v4.35.0-rc3`），
`v4.34.1` 那份是 elan 的默认，`v4.35.0-rc3` 是 mathlib 闭包真正需要的那个。

## 这个目录**不参与**默认构建

证明后端**不接进普通静态图的默认运行**（设计：证明是显式调用的一条路）。
`packages/agent-core` 里没有任何生产代码会调用它；调用点是
`lean4Adapter.ts` 的 `runLean4ClosedLoop` / `produceLean4Artifact`（显式入口 + 用例）。
CI（GitHub Actions）里**没有** Lean，也没有这 7 GB，所以 CI 上跑的是**判据层**
（假 runner + 假 Lean 输出），真实端到端那条是**显式 gated** 的（工具链/工程不在就 skip 并写明理由）。

## 一条已知的取舍

`lakefile.toml` 里的 `[[require]] rev = "master"`（mathlib 官方推荐写法）意味着
**`lake update` 会把 mathlib 挪到 master 当时的位置**。要让两次运行可比，
`.lake/lake-manifest.json` 才是真正的锁定处（本次实测的 mathlib commit 是
`0826a5e4ff8877949060d03ce8955545bfb2b47f`），而**它不进仓库**（在 `.lake/` 里）。
所以"换台机器复跑会拿到同一份 mathlib"这件事**今天没有保证** ——
这是本工程已知的一条代价，写在这里而不是藏起来。
