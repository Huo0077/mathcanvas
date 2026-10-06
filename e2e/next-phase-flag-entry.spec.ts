import { expect, test } from "@playwright/test"

/**
 * **N3 的产品入口：浏览器验收**（2026-10-05）。
 *
 * 这份用例覆盖的是**本次交付的那件事**：顶栏「设置」此前是个**死按钮**（没有 `onClick`，
 * `WorkspaceTabs` 也没有 `onSettings`），于是 `constrainedDrag` 开关**没有任何产品入口能打开** ——
 * 浏览器验收根本写不出来（`docs/current-status.md` §一.2 第 1 条挂了很久）。
 *
 * 现在这条路径是：点「设置」→ 到设置模块 → 「实验性功能 → 约束拖动」→ 打开 → **刷新后仍然是开**。
 *
 * ## 为什么"必须由用户点开"这件事值得单独一组浏览器用例
 *
 * 因为 N2 的先例明令禁止**测试后门**：如果"打开开关"只有测试能办到，那它就不是入口。
 * 这组用例走的正是用户会走的那条路（真实按钮 + 真实开关 + 应用自己的偏好存储）。
 *
 * ## 还没覆盖的（不许含糊）
 *
 * **拖动本身的行为**（受约束的点是否沿约束走、关着时是否照旧自由走）**还没有用例** ——
 * 那一半要先把 3D 里"拖动单个 `point3`"的指针交互钉住。`e2e/agent-constrained-drag.spec.ts`
 * 仍然不存在，所以 N3 的 RED 后半段仍未完成。
 */
/**
 * **隔离方式要小心**：一开始这里用的是 `page.addInitScript(() => localStorage.clear())`，
 * 而 `addInitScript` 会在**每一次**页面加载时重跑 —— 包括用例里那个 `page.reload()`。
 * 于是"刷新后偏好还在吗"这条用例**永远看不到自己刚存的那份**（它被自己的隔离脚本清掉了），
 * 报出来的却像产品缺陷。改成"载入一次 → 清一次 → 再载入"，隔离照旧，而刷新不再被清。
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("顶栏「设置」能到设置模块，那里有约束拖动的实验性开关", async ({ page }) => {
  await page.goto("/")

  await page.getByRole("button", { name: "设置" }).click()

  await expect(page.locator('.app-module[data-module="settings"]')).toBeVisible()
  const toggle = page.getByRole("switch", { name: "约束拖动" })
  await expect(toggle).toBeVisible()
  // **默认必须是关**：关着时 `App.tsx` 走的是原来那一次 `translatePrimitive3`。
  await expect(toggle).not.toBeChecked()
})

test("打开之后刷新仍然是开（偏好跨会话保留）", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "设置" }).click()

  const toggle = page.getByRole("switch", { name: "约束拖动" })
  await toggle.click()
  await expect(toggle).toBeChecked()

  await page.reload()
  await page.getByRole("button", { name: "设置" }).click()

  await expect(page.getByRole("switch", { name: "约束拖动" })).toBeChecked()
})

test("仅切约束拖动时，偏好里没有见证搜索及其它未启用能力", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("switch", { name: "约束拖动" }).click()

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mathcanvas:next-phase-preferences") ?? "null"))

  // 只切约束拖动时不会连带开启见证搜索，更不能开启尚无产品入口的三个能力。
  // 都不在这里，因为 `agentNextPhaseFlags()` **故意不读**它们。
  expect(stored).toEqual({ constrainedDrag: true })
})
test("用户可显式启用见证搜索，刷新保留，且不会同时打开其它能力", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "设置" }).click()
  const search = page.getByRole("switch", { name: "示意图见证搜索" })
  await expect(search).not.toBeChecked()
  await expect(page.getByText(/只覆盖部分棱锥题型/)).toBeVisible()
  await expect(page.getByText(/题设核验和手动确认不会跳过/)).toBeVisible()
  await search.click()
  await expect(search).toBeChecked()
  const first = await page.evaluate(() => JSON.parse(localStorage.getItem("mathcanvas:next-phase-preferences") ?? "null"))
  expect(first).toEqual({ witnessSearch: true })
  await page.reload()
  await page.getByRole("button", { name: "设置" }).click()
  await expect(page.getByRole("switch", { name: "示意图见证搜索" })).toBeChecked()
  await expect(page.getByRole("switch", { name: "约束拖动" })).not.toBeChecked()
  await page.getByRole("switch", { name: "示意图见证搜索" }).click()
  await expect(page.getByRole("switch", { name: "示意图见证搜索" })).not.toBeChecked()
})
