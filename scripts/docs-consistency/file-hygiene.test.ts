import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * **文件卫生**（V3 的"旧问题归属"里点名的那一条：BOM / 换行 / 链接 / **日期**卫生）。
 *
 * 链接那一半已经由 `progress-claims` / `capability-tables` 两个门禁覆盖，这里补另外三样。
 *
 * ## 为什么 BOM 值得一条判据（2026-10-10 查实：仓里当时有 **30 个**受跟踪文件带 BOM）
 *
 * BOM 对 TypeScript / Vite / vitest 是**无害**的 —— 所以它能悄悄留在源码里好几个月，谁都不报错。
 * 但它有真实代价，而且这个仓已经付过：
 * - **不可见**：文件第一行在 diff / 编辑器 / `grep` 里多出三个字节，比对"逐字相同"时会莫名不一致；
 * - **工具链**：JSON 解析、某些 CLI、把文件内容拼进另一个文件时，BOM 是纯噪声；
 * - **提交信息**：本仓有一次提交标题就带着 BOM（`Set-Content -Encoding UTF8` 干的），
 *   而那种东西只有肉眼盯着 `git log` 才看得见。
 *
 * ## 一条**例外**，而且是有理由的例外（不是"懒得改"）
 *
 * **`*.ps1` 允许带 BOM**：Windows PowerShell 5.1 读 UTF-8 **无 BOM** 的文件时按 ANSI 解，
 * 仓里的 `scripts/sdd/*.ps1` 满是中文 ⇒ 去掉 BOM 会让它们在 5.1 下变乱码甚至语法错。
 * 这是"为了兼容而保留"，写在这里，免得下一个人把它们也"顺手清掉"。
 *（PowerShell 7 两种都读对，所以这条例外只对 5.1 有意义。）
 *
 * ## 日期卫生
 *
 * 两份追踪文档与当前状态页头的 `最后更新` 必须是**真日期**、且**不许在未来**
 *（容忍 1 天，避开时区边界）。写错年份（`2027-…`）是这类文档最常见也最难自己发现的错。
 */

/** 受跟踪的文件（相对仓库根）。**用 git 列举**：untracked 的构建产物、临时文件不该进这条判据。 */
function trackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: process.cwd() })
  return new TextDecoder().decode(output)
    .split("\0")
    .filter((entry) => entry.length > 0)
}

/** BOM 的例外：PowerShell 脚本（理由见文件头）。 */
const BOM_ALLOWED = [".ps1"]

describe("文件卫生：编码（BOM / UTF-8）", () => {
  it("**除 PowerShell 脚本外，受跟踪文件都不许带 BOM**", () => {
    const offenders: string[] = []
    for (const file of trackedFiles()) {
      if (BOM_ALLOWED.includes(path.extname(file))) continue
      const bytes = readFileSync(path.join(process.cwd(), file))
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offenders.push(file)
    }

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `这些文件带 UTF-8 BOM（\`.ps1\` 之外一律不许带）：\n${offenders.map((file) => `  ${file}`).join("\n")}\n` +
          "去掉它们的方式：**按字节**去掉开头三个字节（不要用会改换行/重编码的文本工具）。"
    ).toEqual([])
  })

  it("**受跟踪的文本文件都是合法 UTF-8**（切坏的多字节字符会让下游 JSON 化失败）", () => {
    const decoder = new TextDecoder("utf-8", { fatal: true })
    const offenders: string[] = []
    // 二进制类（图片 / 字体 / 压缩包）不做文本判据。
    const binaryLike = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".icns", ".webp", ".woff", ".woff2", ".ttf", ".zip", ".gz", ".exe", ".dll", ".so", ".dylib", ".pdf"]
    for (const file of trackedFiles()) {
      if (binaryLike.includes(path.extname(file).toLowerCase())) continue
      const bytes = readFileSync(path.join(process.cwd(), file))
      try {
        decoder.decode(bytes)
      } catch {
        offenders.push(file)
      }
    }

    expect(offenders, `这些文件不是合法 UTF-8：${offenders.join("、")}`).toEqual([])
  })
})

describe("文件卫生：日期", () => {
  /** 文档页头的 `最后更新：2026-10-10` / `Updated: 2026-10-10`。 */
  /**
   * **只覆盖真的带这一行的文档**（`feature-catalog.md` 没有页头日期 —— 不给它编一个，也就不把它列进来）。
   */
  const DATED_DOCS = ["docs/current-status.md", "docs/agent-next-round-progress.md", "docs/acceptance/agent-tool-loop-scorecard.md"]

  it("**页头日期必须是真日期、且不在未来**（容忍 1 天，避开时区边界）", () => {
    const limit = Date.now() + 24 * 60 * 60 * 1000
    for (const file of DATED_DOCS) {
      const text = readFileSync(path.join(process.cwd(), file), "utf8")
      const matched = text.match(/(?:最后更新|Updated)[：:]\s*\**\s*(\d{4})-(\d{2})-(\d{2})/)
      expect(matched, `${file} 的页头里读不出「最后更新：YYYY-MM-DD」`).not.toBeNull()
      if (matched === null) continue
      const stamp = Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
      expect(Number.isNaN(stamp), `${file} 的日期不是真日期：${matched[0]}`).toBe(false)
      expect(stamp, `${file} 的日期在**未来**：${matched[1]}-${matched[2]}-${matched[3]}`).toBeLessThan(limit)
    }
  })
})
