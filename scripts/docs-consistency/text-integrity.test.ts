import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * **文本完整性：受跟踪文本里不许出现连续三个以上半角问号。**
 *
 * ## 为什么需要这一条（2026-10-24 审查查实）
 *
 * 2026-10-17 的几次提交（`65bd8b6`、`4e0354a`、`6397a21`、`8136553`、`600dff2`）把中文写成了
 * 连续的半角问号：`docs/current-status.md:1794-1798`、Task 16 的 F1 记录在四个文件里都不可读，
 * 连 `apps/web/src/curveTangents.ts:63` 返回给用户的切线标签都成了一串问号。
 *
 * 现有 `file-hygiene` 只验 **UTF-8 合法性** 与 **BOM**；半角问号是合法 UTF-8，所以它一路放行。
 * 这类损坏的典型来源是"用错误的编码转了一次"或"复制粘贴时丢了字符"——字节层面完全合法，
 * 只有语义没了。这里钉的是**可判定的痕迹**：正文里连续三个以上的 ASCII `?`。
 *
 * ## 为什么是三个
 *
 * 两个 `?` 在 TypeScript 里是 nullish coalescing（`a ?? b`），不能碰；文档里引用代码时也常见。
 * 三个以上在正常中文与代码里都没有正当用途。历史命中已逐条看过：全是损坏。
 *
 * ## 假阳性怎么办
 *
 * 如果将来确实要引用一段含 `???` 的代码，请把它放进**围栏代码块并转义**，或在本文件
 * `ALLOWED` 里登记**文件 + 原因**——不要默默放宽整条判据。
 */

/** 受跟踪的文件（相对仓库根）。untracked 的构建产物不参与。 */
function trackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: process.cwd() })
  return new TextDecoder().decode(output).split("\0").filter(Boolean)
}

/** 只扫文本类；二进制类连解码都不该做。 */
const TEXT_EXTENSIONS = new Set([".md", ".ts", ".tsx", ".json", ".yml", ".yaml", ".txt", ".mjs", ".cjs", ".css", ".html"])

/** 允许例外（目前为空）。登记一行就必须写清理由。 */
const ALLOWED = new Set<string>()

describe("文本完整性：中文不许被半角问号顶掉", () => {
  it("**受跟踪文本里不得出现连续三个以上 ASCII 问号**", () => {
    const offenders: string[] = []
    for (const file of trackedFiles()) {
      if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue
      if (ALLOWED.has(file)) continue
      const lines = readFileSync(path.join(process.cwd(), file), "utf8").split(/\r?\n/)
      lines.forEach((line, index) => {
        if (/\?\?\?/.test(line)) offenders.push(`${file}:${index + 1}`)
      })
    }

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `这些行里出现连续三个以上半角问号（典型的编码损坏痕迹）：\n${offenders
            .slice(0, 40)
            .map((entry) => `  ${entry}`)
            .join("\n")}${offenders.length > 40 ? `\n  …共 ${offenders.length} 行` : ""}\n` +
          "修法：按上下文重写中文；不要用会改编码的批量替换工具。"
    ).toEqual([])
  })
})
