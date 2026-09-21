import { expect, test } from "@playwright/test"

/**
 * **项目包面板**（Task 1.6 Step 4/5 的界面入口）。
 *
 * e2e 跑在**浏览器**里，所以这里能验证的是两件真事：
 * 1. 入口确实在（文件命令那一组里的「项目包…」），面板打得开，三个小节都在；
 * 2. 在没有桌面外壳时**如实说"需要桌面版"**，而不是给一句含糊的失败，
 *    也不假装附件已经存进去了。
 *
 * 真正的导出/导入/附件往返需要桌面外壳（IPC + SQLite + 附件库），
 * 那一条由 `ProjectPackagePanel.test.tsx` 用假 IPC 覆盖，并由 Rust 侧的
 * `repository_package` / `project_repository` 用例保证语义。
 */
test("opens the project package panel from the file commands", async ({ page }) => {
  await page.goto("/")

  await page.getByRole("button", { name: "项目包…" }).click()

  const panel = page.getByRole("dialog", { name: "项目包" })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole("heading", { name: "导出 .mcanvas" })).toBeVisible()
  await expect(panel.getByRole("heading", { name: "导入 .mcanvas" })).toBeVisible()
  await expect(panel.getByRole("heading", { name: "附件" })).toBeVisible()
  // 浏览器的正常状态要在面板里说得清清楚楚，而不是等用户点了才发现。
  await expect(panel.getByRole("note")).toContainText("桌面版")

  await panel.getByRole("button", { name: "关闭项目包面板" }).click()
  await expect(page.getByRole("dialog", { name: "项目包" })).toHaveCount(0)
})

test("says the export needs the desktop build instead of failing vaguely", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "项目包…" }).click()

  const panel = page.getByRole("dialog", { name: "项目包" })
  await panel.getByLabel("导出到").fill("D:\\out\\demo")
  await panel.getByRole("button", { name: "导出 .mcanvas" }).click()

  const status = panel.getByRole("status")
  await expect(status).toContainText("需要桌面版")
  await expect(status).toHaveAttribute("data-kind", "error")
})

test("does not pretend an attachment was stored when there is no project library", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "项目包…" }).click()

  const panel = page.getByRole("dialog", { name: "项目包" })
  await panel.getByLabel("选择附件").setInputFiles({ name: "abc.png", mimeType: "image/png", buffer: Buffer.from([0x61, 0x62, 0x63]) })

  // 附件挂在快照上，而浏览器里没有仓储 —— 如实说清，而不是显示"已附加"。
  await expect(panel.getByRole("status")).toContainText("还没有在项目库里落过盘")
  // 列举那一半也需要仓储，所以这里如实显示"这一版还没有引用任何附件"，而不是伪造一份列表。
  await expect(panel.getByText("这一版快照还没有引用任何附件。")).toBeVisible()
})
