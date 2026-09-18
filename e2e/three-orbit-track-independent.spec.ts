import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * 轨道圆**自带圆心**（slice 1）：圆是独立对象，点是乘客。
 *
 * 用户口径："轨道圆的内容做的很差，根本不是我要的那种，我要的轨道圆是点在圆上而不是圆跟着点走，
 * 而且圆要可以缩放旋转。"
 *
 * 改动前的实测（同一段脚本）：拖点 A 时轨道「圆心 X」跟着变成 -0.959（圆就是那个点的派生物），
 * 删除 A 得到 `object is referenced by another object: point3-1`。这两条现在都要反过来。
 */
test("moves the track by itself and leaves the construction points alone", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const algebra = page.locator(".algebra-panel")
  const placePoint = async (label: string, position: [string, string, string]) => {
    await page.getByRole("button", { name: "添加空间点" }).click()
    await algebra.getByText(label, { exact: true }).click()
    for (const [axis, value] of [["X", position[0]], ["Y", position[1]], ["Z", position[2]]] as const) {
      await page.getByRole("spinbutton", { name: `坐标 ${axis}` }).fill(value)
    }
  }
  await placePoint("A", ["0", "0", "0"])
  await placePoint("B", ["3", "0", "0"])
  await algebra.getByText("A", { exact: true }).click()
  await algebra.getByText("B", { exact: true }).click({ modifiers: ["Shift"] })
  await page.getByRole("button", { name: "添加空间圆轨道" }).click()
  await expect(page.getByRole("spinbutton", { name: "圆轨道半径" })).toHaveValue("3")

  // 记住两个点的坐标：拖圆之后它们必须**一个字都没变**。
  const pointPositions = async () => {
    const values: string[][] = []
    for (const label of ["A", "B"]) {
      await algebra.getByText(label, { exact: true }).click()
      values.push(await Promise.all(["X", "Y", "Z"].map(async (axis) => page.getByRole("spinbutton", { name: `坐标 ${axis}` }).inputValue())))
    }
    return values
  }
  const before = await pointPositions()

  // 开「自由拖动」，从圆周上的一点抓住**圆本体**拖走（圆心不在那一点上，所以抓的是圆）。
  await page.getByRole("button", { name: "自由拖动" }).click()
  const rim = await projectWorldPoint(page, { x: 0, y: 3, z: 0 })
  await page.mouse.move(rim.x, rim.y)
  await page.mouse.down()
  await page.mouse.move(rim.x + 70, rim.y + 30, { steps: 6 })
  await page.mouse.up()

  // 圆真的动了（包围盒中心变了）……
  await expect(page.getByRole("spinbutton", { name: "圆心 X" })).not.toHaveValue("0")
  // ……而两个点一动不动：圆不再牵着它们（这就是"点在圆上，而不是圆跟着点走"的另一半）。
  expect(await pointPositions()).toEqual(before)
})

test("lets the point that used to define the centre be deleted, and keeps the editable centre", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  const algebra = page.locator(".algebra-panel")
  await page.getByRole("button", { name: "添加空间点" }).click()
  await algebra.getByText("A", { exact: true }).click()
  await page.getByRole("button", { name: "添加空间圆轨道" }).click()

  // 圆心是**可编辑的真实字段**（以前是只读读数，因为它是别人的坐标）。
  const centreX = page.getByRole("spinbutton", { name: "圆心 X" })
  await centreX.fill("4")
  await centreX.blur()
  await expect(centreX).toHaveValue("4")

  // 删掉当初用来定圆心的那个点：轨道还在（它不再引用谁）。
  await algebra.getByText("A", { exact: true }).click()
  await page.getByRole("button", { name: "快速删除对象" }).click()
  await expect(algebra.getByText("A", { exact: true })).toHaveCount(0)

  await algebra.getByText("圆轨道 1", { exact: true }).click()
  await expect(page.getByRole("spinbutton", { name: "圆心 X" })).toHaveValue("4")
  await expect(page.getByRole("spinbutton", { name: "圆轨道半径" })).toHaveValue("1.5")
})
