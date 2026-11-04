import { expect, test, type Locator } from "@playwright/test"
import { commandButton } from "./command-menu"
import { projectWorldPoint } from "./helpers/projection"

async function screenCircle(shape: Locator) {
  return shape.evaluate((node: SVGCircleElement) => {
    const matrix = node.getScreenCTM()!
    const center = new DOMPoint(node.cx.baseVal.value, node.cy.baseVal.value).matrixTransform(matrix)
    return { x: center.x, y: center.y, radius: node.r.baseVal.value * Math.hypot(matrix.a, matrix.b) }
  })
}

test("line and circle use the same screen coordinates for preview and placement", async ({ page }) => {
  await page.setViewportSize({ width: 1160, height: 950 })
  await page.goto("/")
  const svg = page.getByRole("img", { name: "几何画布" })
  const box = (await svg.boundingBox())!
  const a = { x: Math.round(box.x + box.width * 0.3), y: Math.round(box.y + box.height * 0.4) }
  const b = { x: Math.round(box.x + box.width * 0.68), y: Math.round(box.y + box.height * 0.55) }
  await (await commandButton(page, "添加直线")).click()
  await page.mouse.click(a.x, a.y)
  const anchor = await screenCircle(svg.locator(".creation-preview-anchor").first())
  expect(Math.hypot(anchor.x - a.x, anchor.y - a.y)).toBeLessThan(1)
  await page.mouse.click(b.x, b.y)
  const line = svg.locator('[data-primitive-type="line"] line[data-hit-target]')
  const distances = await line.evaluate((node: SVGLineElement, points) => {
    const matrix = node.getScreenCTM()!
    const p = new DOMPoint(node.x1.baseVal.value, node.y1.baseVal.value).matrixTransform(matrix)
    const q = new DOMPoint(node.x2.baseVal.value, node.y2.baseVal.value).matrixTransform(matrix)
    return points.map(({ x, y }) => Math.abs((q.x - p.x) * (p.y - y) - (p.x - x) * (q.y - p.y)) / Math.hypot(q.x - p.x, q.y - p.y))
  }, [a, b])
  expect(Math.max(...distances)).toBeLessThan(1)

  await page.keyboard.press("Escape")
  await (await commandButton(page, "添加圆")).click()
  const center = { x: a.x, y: Math.round(box.y + box.height * 0.64) }
  const rim = { x: center.x + 55, y: center.y + 35 }
  await page.mouse.click(center.x, center.y)
  await page.mouse.move(rim.x, rim.y)
  const preview = await screenCircle(svg.locator("circle.creation-preview-stroke"))
  await page.mouse.click(rim.x, rim.y)
  const circle = await screenCircle(svg.locator('[data-primitive-type="circle"] circle[data-hit-target]'))
  expect(Math.hypot(circle.x - center.x, circle.y - center.y)).toBeLessThan(1)
  expect(Math.abs(circle.radius - Math.hypot(55, 35))).toBeLessThan(1)
  expect(circle.radius).toBeCloseTo(preview.radius, 2)
})

test("the property divider resizes the canvas and remembers the width", async ({ page }) => {
  await page.goto("/")
  const panel = page.locator("#properties-dock")
  const divider = page.getByRole("separator", { name: "调整属性栏宽度" })
  const before = (await panel.boundingBox())!
  const handle = (await divider.boundingBox())!
  const y = handle.y + handle.height / 2
  await page.mouse.move(before.x, y)
  await page.mouse.down()
  await page.mouse.move(before.x - 80, y, { steps: 8 })
  await page.mouse.up()
  const width = (await panel.boundingBox())!.width
  expect(width).toBeCloseTo(before.width + 80, 0)
  await divider.press("ArrowRight")
  expect((await panel.boundingBox())!.width).toBeCloseTo(width - 16, 0)
  await page.reload()
  expect((await panel.boundingBox())!.width).toBeCloseTo(width - 16, 0)
  await page.getByRole("button", { name: "立体几何" }).click()
  expect((await panel.boundingBox())!.width).toBeCloseTo(width - 16, 0)
  await page.getByRole("button", { name: "工程制图" }).click()
  expect((await page.locator("#engineering-properties-dock").boundingBox())!.width).toBeCloseTo(width - 16, 0)
})

test("a right click on a spatial primitive opens its actions", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await (await commandButton(page, "添加空间点")).click()
  const position = await projectWorldPoint(page, { x: 0, y: 0, z: 0 })
  await page.mouse.click(position.x, position.y, { button: "right" })
  const menu = page.getByRole("menu", { name: "画布上下文菜单" })
  await expect(menu).toContainText("空间点")
  await menu.getByRole("menuitem", { name: "锁定几何位置" }).click()
  await expect(page.getByRole("button", { name: "解锁图元" })).toBeVisible()
  await page.mouse.click(position.x, position.y, { button: "right" })
  await expect(menu.getByRole("menuitem", { name: "级联删除" })).toBeDisabled()
  await menu.press("Escape")
  await expect(menu).toHaveCount(0)
})
