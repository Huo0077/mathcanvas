import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * **Task 19 的"先固定现状"**：把 `proof/lean4/` 那份工程定义**逐字钉住**。
 *
 * ## 为什么这一层要有判据（而不是靠人看一眼）
 *
 * 计划原文："**先固定现状**：比较 `lean-toolchain`、mathlib `rev = c20717ea…` 与
 * `lake-manifest.json`，记录实测输出……现有工程 README 原来误称'四个工程文件'，
 * lockfile 已在仓，文档纠为五个工程文件（另有 README）**而不假称工具链随包**"。
 *
 * 三件事靠人守都会腐烂：
 *
 * - **两处 rev 必须一致**：`lakefile.toml` 钉了 mathlib 的 commit，而"这份依赖闭包到底是哪些"
 *   写在 `lake-manifest.json` 里。只改一处、忘了重跑 `lake update` 的那次编辑**看起来完全正常**，
 *   却让"我们用的是哪一版 mathlib"在两个文件里给出两个答案。
 * - **钉的必须是 commit**：`rev = "master"` 那种写法让"两次运行可比"失去保证
 *   （README 里那条已知取舍就是这个形态，已经在 2026-10-10 修掉）。
 * - **README 不许说过期的话**：manifest 已经进仓、rev 已经钉住，而旧 README 还写着
 *   "它不进仓库""换台机器复跑不保证同一份 mathlib"。这类句子比没有文档更坏 ——
 *   它让人以为今天的保证比实际更弱（于是不去复算），或者更强。
 *
 * ## 这份用例**不碰网络**（也不需要 Lean）
 *
 * 它只读三个文本文件。真正要 GB 级下载/工具链升级的动作**不在**这里 ——
 * 那要用户单独同意（见任务卡）。
 */

const CANDIDATES = [
  path.resolve(process.cwd(), "proof/lean4"),
  path.resolve(process.cwd(), "../../proof/lean4")
]
const DIR = CANDIDATES.find((candidate) => existsSync(path.join(candidate, "lean-toolchain"))) ?? ""

function read(name: string): string {
  return readFileSync(path.join(DIR, name), "utf8")
}

describe("Task 19: 钉住 proof/lean4 的工程定义", () => {
  it("三个工程文件都在仓库里（工具链与 mathlib 不在）", () => {
    expect(DIR, "找不到 proof/lean4（进程的工作目录不对？）").not.toBe("")
    for (const name of ["lean-toolchain", "lakefile.toml", "lake-manifest.json", "README.md", "DrawProof.lean", ".gitignore"]) {
      expect(existsSync(path.join(DIR, name)), `${name} 应当在仓库里`).toBe(true)
    }
  })

  it("**两处 mathlib rev 必须逐字相同**（只改一处就红）", () => {
    const lakefile = read("lakefile.toml")
    const manifest = JSON.parse(read("lake-manifest.json")) as { packages: { name: string; rev: string; inputRev: string; url: string }[] }

    const pinnedInLakefile = lakefile.match(/name\s*=\s*"mathlib"[\s\S]*?rev\s*=\s*"([^"]+)"/)?.[1]
    expect(pinnedInLakefile, "lakefile.toml 里应当有一条钉住 rev 的 mathlib 依赖").toBeDefined()
    // ① 钉的必须是 commit（40 位十六进制），不是 master / main / 标签。
    expect(pinnedInLakefile, "mathlib 的 rev 必须是具体 commit").toMatch(/^[0-9a-f]{40}$/)

    const mathlib = manifest.packages.find((entry) => entry.name === "mathlib")
    expect(mathlib, "manifest 里应当有 mathlib").toBeDefined()
    // ② 三个地方（lakefile / manifest.rev / manifest.inputRev）逐字相同。
    expect(mathlib!.rev).toBe(pinnedInLakefile)
    expect(mathlib!.inputRev).toBe(pinnedInLakefile)
    // ③ 显式写 mathlib4 的 URL（`scope/name` 会解析到 mathlib3 那个同名旧仓库）。
    expect(mathlib!.url).toContain("leanprover-community/mathlib4")
  })

  it("**工具链版本也钉住**：`lean-toolchain` 写具体版本，不是 latest/master", () => {
    const toolchain = read("lean-toolchain").trim()
    expect(toolchain).toMatch(/^leanprover\/lean4:v\d+\.\d+\.\d+(-rc\d+)?$/)
    expect(toolchain).not.toContain("latest")
    /**
     * 与 mathlib 官方缓存对齐这件事**在 README 里有理由**（`-rc3` 不是随手选的），
     * 所以这里只钉"它是个具体版本"，不把 README 的解释抄成第二份判据。
     */
    expect(read("README.md")).toContain(toolchain)
  })

  it("**README 不许说过期的话**：rev 已钉住、manifest 已进仓、工具链不随包", () => {
    const readme = read("README.md")
    // ① 把**当前**钉住的那个 commit 写出来（改 rev 而忘了改 README ⇒ 这里红）。
    const pinned = read("lakefile.toml").match(/name\s*=\s*"mathlib"[\s\S]*?rev\s*=\s*"([^"]+)"/)![1]!
    expect(readme, "README 要写出当前钉住的 mathlib commit").toContain(pinned)
    // ② 不再说"lockfile/manifest 不进仓库"（它进了）——按**那句话的指向**判，不按字面：
    //    "展开目录不进仓库"是事实（`.lake/` 被 gitignore），不许把它也一起判红。
    expect(readme).not.toContain("它不进仓库")
    expect(readme).toContain("lake-manifest.json")
    expect(readme).toContain("一起进仓库")
    // ③ 不再说"换台机器复跑不保证同一份 mathlib"（钉住 + lockfile 进仓之后，这条保证有了）。
    expect(readme).not.toContain("今天没有保证")
    // ④ 明确"不假称工具链随包"。
    expect(readme).toContain("没有 Lean 二进制")
    // ⑤ 工程文件数如实（除 README 外五个）。
    expect(readme).toContain("五个")
  })
})
