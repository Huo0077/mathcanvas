import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * **三张"能力表"必须指向唯一现在时**（`docs/current-status.md`）。
 *
 * ## 为什么要有一条机器判据，而不是再写一句约定
 *
 * 第 25 / 33 / 43 轮我**三次**修同一个毛病，而且每次都是**撞见**的：
 * `feature-catalog.md` 的"N3–N5 仍为设计阶段"、发布门禁里缺 N5 那一节、
 * 记分卡的"Formal proof | design only"。共同根因是：**新写的进度会回流到 `current-status.md`
 * （我会一直更新它），但不会自动回流到这些"按能力 / 按门槛列"的表里**。
 *
 * 写第四句"记得改"没有用 —— 前三句就没拦住。所以这里只钉一件**结构性**的事：
 * **每张能力表都必须链到 `current-status.md`**。这样至少读者永远找得到活读数，
 * 而"这张表停在某个旧阶段"不会变成一个走不出去的坑。
 *
 * ## 为什么只钉这一条，而不去比对三张表的文字
 *
 * 三张表**故意用不同的切面**：feature-catalog 按能力、发布门禁按门槛、记分卡按阶段与 flag。
 * 用"每张表都必须提到某几个词"去钉它们，会造出一条**一改措辞就红**的假门禁
 *（第 40 轮的教训：`grep it(` 数用例就制造过一次假缺陷）。
 * 所以这里只钉"链得上、且链得对"这两件**确定的事**。
 */

const CURRENT_STATUS = "docs/current-status.md"

/** 三张能力表：它们各自按不同切面描述"做到哪一步"。 */
const CAPABILITY_TABLES = [
  "docs/feature-catalog.md",
  "docs/acceptance/agent-release-gate.md",
  "docs/acceptance/agent-tool-loop-scorecard.md"
]

describe("能力表与唯一现在时的一致性", () => {
  it("唯一现在时本身在位", () => {
    expect(existsSync(CURRENT_STATUS)).toBe(true)
  })

  it.each(CAPABILITY_TABLES)("%s 必须链到 docs/current-status.md，且链接真的指得到那个文件", (file) => {
    const text = readFileSync(file, "utf8")

    expect(text, `${file} 没有指向 ${CURRENT_STATUS} —— 它的读数迟早会自己漂（第 25 / 33 / 43 轮各漂过一次）`).toMatch(/current-status\.md/)

    // 链接写对还不够：相对路径得**真的**指到那个文件（在 `docs/acceptance/` 下要写 `../current-status.md`）。
    const links = [...text.matchAll(/\]\(([^)]*current-status\.md)\)/g)].map((match) => match[1])
    expect(links.length, `${file} 里有 current-status.md 的字样，但不是一个 markdown 链接`).toBeGreaterThan(0)
    for (const link of links) {
      const target = path.normalize(path.join(path.dirname(file), link))
      expect(existsSync(target), `${file} 里的链接「${link}」指向 ${target}，但那个文件不存在`).toBe(true)
    }
  })

  it("唯一现在时反过来也链到这三张表（导航是双向的）", () => {
    const text = readFileSync(CURRENT_STATUS, "utf8")

    for (const file of CAPABILITY_TABLES) {
      const relative = path.relative(path.dirname(CURRENT_STATUS), file).replace(/\\/g, "/")
      expect(text, `${CURRENT_STATUS} 没有链到 ${file}（写「${relative}」即可）`).toContain(relative)
    }
  })
})
