import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { cargoVersion, compareVersions, newestRelease, tauriVersion } from "./releaseFacts"

/**
 * **版本真值只有一个**：`tauri.conf.json`、`Cargo.toml` 与最新一份发布说明必须说同一个版本。
 *
 * ## 为什么加这一条（2026-10-20 文档审查查实的漂移）
 *
 * 审查发现 `README.md:95` 与 `docs/current-status.md` 的四处仍在说"最新 Release 是 `v3.2.0`、
 * 仓内版号 `3.3.14`"，而实际已经是 `v4.0` / `4.0.0`。四处都是**声明性文字**，四条既有判据
 * （链接存在 / 能力表链到唯一现在时 / BOM 与日期 / 计划状态行）**没有一条能看见它**。
 *
 * 这里钉三件**可判定**的事，不比对任何正文措辞：
 * 1. `tauri.conf.json` 的 `version` 与 `Cargo.toml` `[package]` 的 `version` 相同；
 * 2. `docs/release/` 里**版本最高**的那份发布说明，版号与上面两者相同（`v4.0` 归一成 `4.0.0`）；
 * 3. 最新一份发布说明确实写了 `**发布日期：** YYYY-MM-DD`（第 2 条的前提）。
 *
 * 它抓不到"README 里随口写了旧 tag"这种措辞问题 —— 那是人审查的活。它抓的是
 * **三处版本真值互相矛盾**，而那种矛盾一旦出现，至少有一处是在说谎。
 */
describe("版本真值：三处必须说同一个版本", () => {
  it("**`tauri.conf.json` 与 `Cargo.toml` 的版号相同**（两处都是产品版号的声明处）", () => {
    expect(
      compareVersions(tauriVersion(), cargoVersion()),
      `tauri=${tauriVersion()} 与 cargo=${cargoVersion()} 不一致`
    ).toBe(0)
  })

  it("**最新一份发布说明的版号等于产品版号**（发了新版却没写发布说明 = 有一条在说谎）", () => {
    const release = newestRelease()
    expect(
      compareVersions(release.version, tauriVersion()),
      `最新发布说明是 ${release.file}（v${release.version}），产品版号却是 ${tauriVersion()}`
    ).toBe(0)
  })

  it("**最新一份发布说明必须写明发布日期**（下一条判据的前提）", () => {
    const release = newestRelease()
    expect(release.published, `${release.file} 里读不出「**发布日期：** YYYY-MM-DD」`).toBeDefined()
    expect(Number.isNaN(Date.parse(release.published!)), `${release.file} 的发布日期不是真日期`).toBe(false)
  })

  /**
   * **入口与页头必须指向最新版**（2026-10-24 审查查实的漂移）。
   *
   * `current-status.md:463` 的 `最后更新` 一行在 v4.0.1 发布后仍写 `v4.0`，还把
   * `docs-consistency` 写成 4 条时代的 12 项；同页顶部却是 v4.0.1 / 7 条 18 项。
   * 前三条判据都看不见它（它们只比 tauri / Cargo / 发布说明三处）。
   *
   * 这里只钉**可判定的两行**：README 的「最新版本标签」与 current-status 的「最后更新」。
   * 不扫全文，避免把历史叙述里的旧版本号误判成漂移。
   */
  it("**README 与 current-status 的版本声明必须指向最新 tag**", () => {
    const tag = `v${newestRelease().version}`
    for (const [file, marker] of [
      ["README.md", "最新版本标签"],
      ["docs/current-status.md", "最后更新"]
    ] as const) {
      const text = readFileSync(file, "utf8")
      const line = text.split(/\r?\n/).find((entry) => entry.includes(marker))
      expect(line, `${file} 里找不到含「${marker}」的那一行`).toBeDefined()
      expect(line!, `${file} 的「${marker}」一行没有写最新 tag \`${tag}\`：${line!.slice(0, 160)}…`).toContain(tag)
    }
  })
})
