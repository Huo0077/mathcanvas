import { describe, expect, it } from "vitest"

import { CHANGELOG, newestChangelogDate, newestRelease } from "./releaseFacts"

/**
 * **发了版就必须在 CHANGELOG 里留一笔**。
 *
 * ## 为什么加这一条（2026-10-20 文档审查查实的漂移）
 *
 * v4.0 发布当天（2026-10-20）CHANGELOG 的最新条目还停在 **2026-10-12** ——
 * 中间 **183 个提交 / 481 个文件 / +58,096 行**（含 `v4.0` 这次跨大版本发布本身）没有任何记录。
 * CHANGELOG 开头写着它的职责是"记改了什么"；一个跨大版本发布没有条目，等于这条职责断了 8 天。
 *
 * ## 为什么跟"发布说明"比，而不是跟"今天"比
 *
 * "CHANGELOG 距今天不得超过 N 天"是个**任意阈值**：连续几天只写文档、只重构时，它天然会红，
 * 那就成了"一改节奏就红的假门禁"。真正该成立的不变量是：
 * **一旦有正式发布，CHANGELOG 的最新日期不得早于那份发布说明的发布日期。**
 * 两个日期都在仓库里，不需要网络、不需要 git tag（CI 的浅克隆拿不到 tag）。
 */
describe("CHANGELOG 不得落后于最新一次正式发布", () => {
  it("**最新一条 `## YYYY-MM-DD` 不早于最新发布说明的发布日期**", () => {
    const release = newestRelease()
    const changelogDate = newestChangelogDate()

    expect(changelogDate, `${CHANGELOG} 里一条 \`## YYYY-MM-DD\` 标题都没有`).toBeDefined()
    expect(release.published, `${release.file} 里读不出发布日期，这条判据的前提不成立`).toBeDefined()

    expect(
      changelogDate! >= release.published!,
      `最新发布说明 ${release.file} 的日期是 ${release.published}，` +
        `而 ${CHANGELOG} 的最新条目停在 ${changelogDate} —— 发版了却没写变更记录`
    ).toBe(true)
  })
})
