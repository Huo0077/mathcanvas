import { expect, test, type Page } from "@playwright/test"

/**
 * **明确尺寸的浏览器闭环**（2026-11-01）。
 *
 * 判据不读确认面板的 `passed` 自述就结束：提交之后直接从应用写出的
 * `mathcanvas:draft:geometry3d` 读最终图元，自己量球心 / 半径、棱柱底边 / 垂直高。
 * 两条旧故障分别是“球心被写死在原点、半径退回 2”和“棱柱高固定为 3”，
 * 所以这两条断言会分别把它们打红。
 */

const SPHERE_PROMPT = "画一个球体，球心 (1,2,3)，半径 5"
const PRISM_PROMPT = "画一个斜棱柱，底面边长 4，高 8"
const DRAFT_KEY = "mathcanvas:draft:geometry3d"

interface Vec3 {
  x: number
  y: number
  z: number
}

interface Primitive {
  id: string
  type: string
  center?: Vec3
  radius?: number
  vertexIds?: string[]
  position?: Vec3
}

async function openAgent(page: Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

async function send(page: Page, prompt: string): Promise<void> {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

async function readPrimitives(page: Page): Promise<Primitive[]> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { document?: { primitives?: Primitive[] } }
    return parsed.document?.primitives ?? []
  }, DRAFT_KEY)
}

async function commitDraft(page: Page): Promise<void> {
  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
}

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("the committed sphere keeps the explicit center and radius", async ({ page }) => {
  await openAgent(page)
  await send(page, SPHERE_PROMPT)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  const verification = panel.getByRole("region", { name: "题设核验" })
  await expect(verification).toHaveAttribute("data-status", "passed")
  await expect(verification).toContainText("球心 (1,2,3)")
  await expect(verification).toContainText("半径 5")

  // 确认之前真文档里没有球。
  expect((await readPrimitives(page)).some((primitive) => primitive.type === "sphere")).toBe(false)

  await commitDraft(page)
  await expect.poll(async () => (await readPrimitives(page)).some((primitive) => primitive.type === "sphere")).toBe(true)
  const sphere = (await readPrimitives(page)).find((primitive) => primitive.type === "sphere")
  expect(sphere?.center).toEqual({ x: 1, y: 2, z: 3 })
  expect(sphere?.radius).toBe(5)
})

test("the committed oblique prism has base edge 4 and vertical height 8, not side-edge length 8", async ({ page }) => {
  await openAgent(page)
  await send(page, PRISM_PROMPT)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  const verification = panel.getByRole("region", { name: "题设核验" })
  await expect(verification).toHaveAttribute("data-status", "passed")
  await expect(verification).toContainText("底面边长 4")
  await expect(verification).toContainText("高 8")

  await commitDraft(page)
  await expect.poll(async () => (await readPrimitives(page)).some((primitive) => primitive.type === "polyhedron3")).toBe(true)
  const primitives = await readPrimitives(page)
  const solid = primitives.find((primitive) => primitive.type === "polyhedron3")
  expect(solid?.vertexIds).toHaveLength(8)
  const points = (solid?.vertexIds ?? []).map((id) => {
    const point = primitives.find((primitive) => primitive.id === id)
    if (point?.position === undefined) throw new Error(`顶点 ${id} 没有坐标`)
    return point.position
  })
  const base = points.slice(0, 4)
  const top = points.slice(4)
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4
    expect(Math.hypot(base[index]!.x - base[next]!.x, base[index]!.y - base[next]!.y, base[index]!.z - base[next]!.z)).toBeCloseTo(4, 6)
  }
  for (let index = 0; index < 4; index += 1) {
    expect(top[index]!.z - base[index]!.z).toBeCloseTo(8, 6)
    // 侧棱带水平分量，所以比垂直高大的多；把侧棱长当高会在这里露馅。
    expect(Math.hypot(top[index]!.x - base[index]!.x, top[index]!.y - base[index]!.y, top[index]!.z - base[index]!.z)).toBeGreaterThan(8)
  }
})

test("the committed straight prism keeps vertical lateral edges", async ({ page }) => {
  await openAgent(page)
  await send(page, "画一个直棱柱，底面边长 4，高 8")

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  const verification = panel.getByRole("region", { name: "题设核验" })
  await expect(verification).toHaveAttribute("data-status", "passed")
  await expect(verification).toContainText("直棱柱")

  await commitDraft(page)
  await expect.poll(async () => (await readPrimitives(page)).some((primitive) => primitive.type === "polyhedron3")).toBe(true)
  const primitives = await readPrimitives(page)
  const solid = primitives.find((primitive) => primitive.type === "polyhedron3")
  const points = (solid?.vertexIds ?? []).map((id) => {
    const point = primitives.find((primitive) => primitive.id === id)
    if (point?.position === undefined) throw new Error(`顶点 ${id} 没有坐标`)
    return point.position
  })
  const base = points.slice(0, 4)
  const top = points.slice(4)
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4
    expect(Math.hypot(base[index]!.x - base[next]!.x, base[index]!.y - base[next]!.y, base[index]!.z - base[next]!.z)).toBeCloseTo(4, 6)
    expect(top[index]!.x - base[index]!.x).toBeCloseTo(0, 6)
    expect(top[index]!.y - base[index]!.y).toBeCloseTo(0, 6)
    expect(top[index]!.z - base[index]!.z).toBeCloseTo(8, 6)
    expect(Math.hypot(top[index]!.x - base[index]!.x, top[index]!.y - base[index]!.y, top[index]!.z - base[index]!.z)).toBeCloseTo(8, 6)
  }
})

test("the height-only prism uses the disclosed default base edge 4 and commits vertical height 8", async ({ page }) => {
  await openAgent(page)
  await send(page, "画一个斜棱柱，高 8")

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  const verification = panel.getByRole("region", { name: "题设核验" })
  await expect(verification).toHaveAttribute("data-status", "passed")
  await expect(verification).toContainText("高 8")

  await commitDraft(page)
  await expect.poll(async () => (await readPrimitives(page)).some((primitive) => primitive.type === "polyhedron3")).toBe(true)
  const primitives = await readPrimitives(page)
  const solid = primitives.find((primitive) => primitive.type === "polyhedron3")
  const points = (solid?.vertexIds ?? []).map((id) => {
    const point = primitives.find((primitive) => primitive.id === id)
    if (point?.position === undefined) throw new Error(`顶点 ${id} 没有坐标`)
    return point.position
  })
  const base = points.slice(0, 4)
  const top = points.slice(4)
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4
    expect(Math.hypot(base[index]!.x - base[next]!.x, base[index]!.y - base[next]!.y, base[index]!.z - base[next]!.z)).toBeCloseTo(4, 6)
    expect(top[index]!.z - base[index]!.z).toBeCloseTo(8, 6)
    expect(Math.hypot(top[index]!.x - base[index]!.x, top[index]!.y - base[index]!.y, top[index]!.z - base[index]!.z)).toBeGreaterThan(8)
  }
})

test("a spaced fraction asks for clarification and never produces a draft", async ({ page }) => {
  await openAgent(page)
  const before = await readPrimitives(page)
  await send(page, "画一个球体，半径 1 / 2")

  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)
  const status = page.getByRole("region", { name: "运行状态" }).last()
  await expect(status).toBeVisible()
  await expect(status.locator(".agent-run-state")).not.toHaveText("进行中")
  await expect(status).not.toBeEmpty()
  await expect(page.getByText(/分数|不支持/).first()).toBeVisible()

  expect(await readPrimitives(page)).toEqual(before)
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeDisabled()
})

test("an unsupported explicit value asks for clarification instead of defaulting", async ({ page }) => {
  await openAgent(page)
  const before = await readPrimitives(page)
  await send(page, "画一个球体，半径 1/2")

  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)
  const status = page.getByRole("region", { name: "运行状态" }).last()
  await expect(status).toBeVisible()
  await expect(status.locator(".agent-run-state")).not.toHaveText("进行中")
  await expect(status).not.toBeEmpty()
  await expect(page.getByText(/分数|不支持/).first()).toBeVisible()

  expect(await readPrimitives(page)).toEqual(before)
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeDisabled()
})
