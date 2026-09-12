import { expect, test } from "@playwright/test"
import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"

let previewServer: ChildProcess | undefined

test.beforeAll(async () => {
  const vitePath = path.resolve(process.cwd(), "node_modules", "vite", "bin", "vite.js")
  previewServer = spawn(process.execPath, [vitePath, "preview", "--host", "127.0.0.1", "--strictPort"], {
    cwd: path.resolve(process.cwd(), "apps", "web"),
    stdio: "ignore"
  })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4173/")
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error("Vite preview server did not start")
})

test.afterAll(() => {
  previewServer?.kill()
})

test("workbench updates the intersection and adds a point", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("img", { name: "几何画布" })).toBeVisible()
  await expect(page.getByText(/交点 P \(0\.00, 0\.00\)/)).toBeVisible()

  await page.getByRole("slider", { name: "直线斜率" }).fill("0.25")
  await expect(page.getByText(/交点 P \(8\.00, 0\.00\)/)).toBeVisible()

  await page.getByRole("button", { name: "添加点" }).click()
  await expect(page.getByText("新点 A").first()).toBeVisible()
})
