import type { Page } from "@playwright/test"

/** Reach commands through the compact toolbar, its menus, or the 3D view options. */
export async function commandButton(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true })
  if (await button.isVisible()) return button
  const viewCommands = ["常用立体", "透明面", "隐藏边", "旋转环", "法向量", "展开", "折叠", "测量二面角", "自动取景", "以面为剖切面"]
  if (viewCommands.includes(name)) {
    await page.getByText("视图选项", { exact: true }).click()
  } else {
    const menu = name.startsWith("导出") || name === "打开 .mgeo" || name === "项目包…" ? "文件" : "更多工具"
    const toggle = page.getByRole("button", { name: menu, exact: true })
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click()
  }
  return button
}
