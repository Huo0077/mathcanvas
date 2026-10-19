import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * **状态快照只许有一份**：除"唯一现在时"与本仓的审查取证目录外，任何文档都不许自称"当前口径"。
 *
 * ## 为什么加这一条（2026-10-20 文档审查查实的结构性缺陷）
 *
 * 同一份 2026-10-16 的状态文本被复制进 **13 个受跟踪文档**：marker 块 6 份、blockquote 变体 7 份，
 * 其中 4 份**逐字相同**、`current-status.md` 里那份已经漂成 1551 字符。同步方式是**手工粘贴到 4 个文件**
 * （`4ad5fc6` / `f3cdc95` / `5ddd6d7` 的 diff 形状可证），所以它必然漏更新 —— 事实上已经漏了：
 * 10-17 的 Task 18/20/21 记录没有回填到那 7 份里。
 *
 * 既有四条判据都只要求"链到 current-status"，**没有一条禁止别处再抄一份**。于是在 13 个文件里
 * 各自维护同一段读数，读到哪一份取决于先翻到哪一页。
 *
 * ## 这条只钉两件可判定的事
 *
 * 1. 受跟踪 `.md` 里出现 `<!-- functional-checkpoint-`（检查点块）的文件，只能是
 *    `docs/current-status.md`，或位于 `audit-*` 这类**审查取证目录**（那里保存的是当时的快照，是证据）；
 * 2. 受跟踪 `.md` 里出现「当前口径」字样的文件，同上（现在是零处，但留着防它回来）。
 *
 * 不比对正文措辞、不要求某一段必须写成什么 —— 只要求"这种自封状态的东西别到处复制"。
 */

const ALLOWED = (file: string): boolean => {
  const normalized = path.normalize(file).replace(/\\/g, "/")
  if (normalized === "docs/current-status.md") return true
  // 审查取证目录：`audit-20261016/functional-review.md` 这类保存的是**当时**的快照，属于证据。
  return normalized.split("/").some((segment) => segment.startsWith("audit-"))
}

function trackedMarkdown(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "*.md"], { cwd: process.cwd() })
  return new TextDecoder()
    .decode(output)
    .split("\0")
    .filter((entry) => entry.length > 0)
}

describe("状态快照的唯一性", () => {
  it("**检查点块（`<!-- functional-checkpoint-`）只许出现在唯一现在时或审查取证目录里**", () => {
    const offenders = trackedMarkdown().filter(
      (file) => !ALLOWED(file) && readFileSync(path.join(process.cwd(), file), "utf8").includes("<!-- functional-checkpoint-")
    )
    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `这些文件里又抄了一份状态快照（状态只在 docs/current-status.md 维护，历史快照放 audit-*/）：\n${offenders
            .map((file) => `  ${file}`)
            .join("\n")}`
    ).toEqual([])
  })

  it("**自我声明「本节为当前口径 / 状态同步（当前口径）」只许出现在唯一现在时或审查取证目录里**", () => {
    // 只钉**自我声明**这两句 —— 正文里顺口提到"当前口径"（例如"这条看着像 bug、其实是当前口径的行为"）
    // 不是在复制状态快照，不该红。审查报告自己论证过：措辞门禁要窄，否则会造出"一改措辞就红"的假门禁。
    const SELF_CLAIMS = [/本节为当前口径/, /状态同步（当前口径）/]

    const offenders = trackedMarkdown().filter((file) => {
      if (ALLOWED(file)) return false
      const text = readFileSync(path.join(process.cwd(), file), "utf8")
      return SELF_CLAIMS.some((pattern) => pattern.test(text))
    })

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `这些文件在自称"当前口径"（读者会不知道该信哪一份）：\n${offenders.map((file) => `  ${file}`).join("\n")}`
    ).toEqual([])
  })
})
