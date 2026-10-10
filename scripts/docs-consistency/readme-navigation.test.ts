import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * **README 的导航与链接**（`capability-tables.test.ts` 管的是三张能力表，README 一直没人管）。
 *
 * ## 为什么值得一条判据
 *
 * README 是**外人第一个读的文件**，而它最危险的失效方式与 `current-status.md` 那次同型：
 * 它写着"当前待完成…"，读者就把它当现在时 —— 一旦它没链到那份**唯一的现在时**
 *（`docs/current-status.md`），或者链到了一个**已经改名/搬走的文件**，读者会毫无察觉地
 * 拿着三个月前的结论做事。
 *
 * ## 这一条只钉**结构**，不钉措辞
 *
 * 两条判据都是可判定的：① README 必须链到那几份"导航文件"，且**相对路径真的指得到**；
 * ② README 里**每一个**指向仓库内文件的 markdown 链接都必须存在。
 * **不比对任何正文句子的写法** —— 那是"一改措辞就红的假门禁"（见 `progress-claims.test.ts` 的论证）。
 */

const README = "README.md"

/**
 * README 必须链到的几份（用户收口清单点名的那一套导航：现在时 / 进度 / 门禁 / 归档 / 能力目录）。
 *
 * 只要求"链到"，不要求写在某一节里 —— 位置由写文档的人决定。
 */
const REQUIRED_TARGETS = [
  "docs/current-status.md",
  "docs/agent-next-round-progress.md",
  "docs/acceptance/agent-release-gate.md",
  "docs/feature-catalog.md",
  "docs/project-progress.md"
]

describe("README 的导航与链接", () => {
  it("**必须链到那几份导航文件，而且链接真的指得到**（写对了但路径错 = 没链）", () => {
    const text = readFileSync(README, "utf8")
    for (const target of REQUIRED_TARGETS) {
      // README 在**仓库根**，所以链接里的相对路径就等于仓库相对路径 —— 不需要 `path.basename`
      //（`scripts/nodeTypes.d.ts` 是最小声明，没那一条；为这个去加宽它不值得）。
      // **两边都要过 `path.normalize`**：Windows 上它把 `/` 变成 `\`，只规范化一边就会永远比不中。
      const links = [...text.matchAll(/\]\(([^)]+)\)/g)]
        .map((match) => match[1]!)
        .filter((link) => path.normalize(link.split("#")[0]!) === path.normalize(target))
      expect(links.length, `README 里没有链到 ${target}（导航缺一份，读者就找不到现在时）`).toBeGreaterThan(0)
      for (const link of links) {
        const resolved = path.normalize(path.join(path.dirname(README), link.split("#")[0]!))
        expect(existsSync(resolved), `README 里的链接「${link}」指向 ${resolved}，但那个文件不存在`).toBe(true)
      }
    }
  })

  it("**README 里每一个指向仓库内文件的链接都存在**（改了文件名却忘了改 README 是常见漂移）", () => {
    const text = readFileSync(README, "utf8")
    const broken: string[] = []
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1]!
      // 只查**仓库内相对路径**：外链（http/https/mailto）与锚点不归这条判据管。
      if (/^(https?:|mailto:|#)/.test(link)) continue
      const resolved = path.normalize(path.join(path.dirname(README), link.split("#")[0]!))
      if (!existsSync(resolved)) broken.push(`${link} → ${resolved}`)
    }

    expect(broken, `README 里这些链接指不到文件：\n${broken.map((line) => `  ${line}`).join("\n")}`).toEqual([])
  })
})
