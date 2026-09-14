import { expect, test } from "@playwright/test"

test("opens the 3D workspace and adds a parameterized cube", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toBeVisible()
  await expect(page.getByRole("button", { name: "重置3D视角" })).toBeVisible()
  await page.getByRole("button", { name: "重置3D视角" }).click()
  for (const label of ["透明面", "隐藏边", "法向量"]) {
    const control = page.getByRole("button", { name: label })
    await expect(control).toHaveAttribute("aria-pressed", "false")
    await control.click()
    await expect(control).toHaveAttribute("aria-pressed", "true")
  }
  const unfold = page.getByRole("button", { name: "展开" })
  await expect(unfold).toHaveAttribute("aria-pressed", "false")
  await unfold.click()
  await expect(page.getByRole("button", { name: "折叠" })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "测量二面角" }).click()
  await expect(page.getByText(/二面角：90\.0°/)).toBeVisible()
  await expect(page.getByText("添加立方体")).toBeVisible()

  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect(page.getByText("立方体 1").first()).toBeVisible()
  await page.getByRole("spinbutton", { name: "尺寸 X" }).fill("5")
  await expect(page.getByRole("spinbutton", { name: "尺寸 X" })).toHaveValue("5")
  await page.getByRole("button", { name: "创建截面" }).click()
  await expect(page.getByText("截面 1").first()).toBeVisible()
  await page.getByRole("button", { name: "添加棱锥" }).click()
  await expect(page.getByText("棱锥 1").first()).toBeVisible()
  await page.getByRole("spinbutton", { name: "高度" }).fill("5")
  await expect(page.getByRole("spinbutton", { name: "高度" })).toHaveValue("5")
  await page.getByRole("button", { name: "添加圆柱" }).click()
  await expect(page.getByText("圆柱 1").first()).toBeVisible()
  await page.getByRole("spinbutton", { name: "半径 3D" }).fill("2")
  await expect(page.getByRole("spinbutton", { name: "半径 3D" })).toHaveValue("2")
  await page.getByRole("button", { name: "添加圆锥" }).click()
  await expect(page.getByText("圆锥 1").first()).toBeVisible()
  await page.getByRole("spinbutton", { name: "高度" }).fill("6")
  await expect(page.getByRole("spinbutton", { name: "高度" })).toHaveValue("6")
  await expect(scene).toHaveAttribute("aria-label", "3D 几何场景")
})

test("picks spatial points and turns them into a teaching measurement", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()

  const algebra = page.locator(".algebra-panel")
  await algebra.getByText("A", { exact: true }).click()
  await algebra.getByText("B", { exact: true }).click({ modifiers: ["Shift"] })

  await page.locator('[aria-label="三维测量工具"]').getByRole("button", { name: "距离", exact: true }).click()

  await expect(algebra.getByText("教学测量")).toBeVisible()
  await expect(algebra.getByText("距离测量")).toBeVisible()
  await expect(algebra.getByText(/由两个空间点/)).toBeVisible()
  await expect(page.locator(".measurement-status")).toHaveAttribute("data-status", "valid")
})

test("nests spatial topology under an expandable algebra row", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const algebra = page.locator(".algebra-panel")
  const expand = algebra.getByRole("button", { name: "展开 立方体 1 拓扑 的子对象" })
  await expand.click()

  await expect(algebra.getByText("顶点", { exact: true })).toBeVisible()
  await expect(algebra.getByText("棱", { exact: true })).toBeVisible()
  await expect(algebra.getByText("面", { exact: true })).toBeVisible()
  await expect(algebra.getByRole("button", { name: "收起 立方体 1 拓扑 的子对象" })).toBeVisible()
})
