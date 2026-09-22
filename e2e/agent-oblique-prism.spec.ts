import { expect, test } from "@playwright/test"

import { OBLIQUE_PRISM_PROMPT } from "../apps/web/src/agent/representativeFixtures"

/**
 * **代表题一：斜四棱柱截面**（Agent DSL 切片 Task 6；规格 §8.1）。
 *
 * 一句话 → 真实协调器 → 传输校验 → **六层编译**（依赖顺序：截面引用同一批里刚建的棱柱）
 * → 隔离草稿 → 用户确认 → 文档真的变了 → **一步撤销**回到原样。
 *
 * 规划器用的是**确定性本地规划器**（浏览器里没有模型服务），它产出的计划与模型给出的
 * 走完全相同的下游；两份计划夹具本身在 `apps/web/src/agent/representativeFixtures.ts`。
 */
async function sendPrompt(page: import("@playwright/test").Page, prompt: string) {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

/** 画布上的对象数量：3D 画布是 WebGL，对象列表是唯一稳定可断言的抓手。 */
function objectRows(page: import("@playwright/test").Page) {
  return page.locator(".algebra-panel .object-row")
}

/** `data-content-bounds` 的格式：`x,y,z size x,y,z`。 */
function parseBounds(bounds: string | null): number[] {
  const [centre, size] = (bounds ?? "").split(" size ")
  const values = [...(centre ?? "").split(","), ...(size ?? "").split(",")].map(Number)
  return values.length === 6 && values.every(Number.isFinite) ? values : Array<number>(6).fill(Number.NaN)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
})

test("drafts the oblique prism with its section, then commits and undoes in one step", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await expect(objectRows(page)).toHaveCount(0)

  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, OBLIQUE_PRISM_PROMPT)

  // 1) 停在确认：一份真正的草稿，而不是一句"已完成"。
  const draft = page.getByRole("region", { name: "确认改动" }).last()
  await expect(draft).toBeVisible()
  await expect(draft).toContainText("确认之后会发生什么")
  // 棱柱 27 个对象 + 三个中点 + 一个动点 + 一个截面 = 32。
  await expect(draft).toContainText(/会新增 32 个对象/)
  // 界面不打印候选文档内容（历史缺陷：确认面板里印过整份 primitives）。
  await expect(draft).not.toContainText("basePolygon")
  await expect(draft).not.toContainText("hostSub")

  // 2) **审计补出来的默认值必须看得见**：动点位置未指定 → 取参数 0.4。
  const assumptions = page.getByRole("region", { name: "确认改动" }).last().locator(".agent-assumptions")
  await expect(assumptions).toContainText("0.4")

  // 3) 确认之前真文档一个字节都没变。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(objectRows(page)).toHaveCount(0)

  // 4) 确认 → 落盘 → 画布上出现实体，而且整批只占一步撤销。
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await draft.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(() => objectRows(page).count()).toBeGreaterThan(0)

  await page.keyboard.press("Control+z")
  await expect.poll(() => objectRows(page).count()).toBe(0)
})

test("the committed prism is oblique, and the batch is one undo step", async ({ page }) => {
  /**
   * 几何层面的验收（规格 §8.1 的第一条）：棱柱是**斜**的 —— 顶面被向量 `(1,0,4)` 整个挪过，
   * 所以包围盒 x 方向的跨度比 y 方向大出一个水平偏移，而 z 方向跨 4（高度）。
   *
   * 不写死小数位：`data-content-bounds` 是画布上所有东西的包围盒（含顶点手柄的笔宽），
   * 而且读数经过 `.toFixed(2)`。断言的是**那个偏移本身**。
   */
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, OBLIQUE_PRISM_PROMPT)
  await page.getByRole("region", { name: "确认改动" }).last().getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()

  await expect.poll(() => objectRows(page).count()).toBeGreaterThan(0)
  const bounds = parseBounds(await page.locator("[data-3d-scene]").getAttribute("data-content-bounds"))
  // 底面菱形 x 跨度 3 + 向量 x 分量 1 → 约 4；z 跨度 = 向量 z 分量 4。
  expect(bounds[3]).toBeGreaterThan(3.8)
  expect(bounds[5]).toBeGreaterThan(3.8)
  // 斜的关键判据：x 跨度明显大于 y 跨度（y 只有菱形的高 √3 ≈ 1.73）。
  expect(bounds[3] - bounds[4]).toBeGreaterThan(1.5)
})

test("its section is cut through the midpoints and shows up as its own object", async ({ page }) => {
  /**
   * 第二条验收（规格 §8.1）：截面**切到了实体**，三个中点的参数是**题目的显式约束 0.5**，
   * 动点位置未指定 → 审计回填 0.4（假设里可见）。
   *
   * 断言打在 `data-binding-parameter` 上而不是行文案上（Fix round 1 / I11）：
   * 标签写着"中点"而参数其实是 0.4 这种回归，必须先被这条用例挡住。
   */
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, OBLIQUE_PRISM_PROMPT)
  const draft = page.getByRole("region", { name: "确认改动" }).last()
  await expect(draft).toBeVisible()
  // 27（棱柱本体：8 顶点 + 12 棱 + 6 面 + 1 实体）+ 3 中点 + 1 动点 + 1 截面 = 32。
  await expect(draft).toContainText(/会新增 32 个对象/)
  // 审计补出来的默认值必须看得见。
  await expect(draft.locator(".agent-assumptions")).toContainText("0.4")
  await draft.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()

  const rows = objectRows(page)
  // 对象列表把一只实体收成一行（顶点/棱/面是它的子树），三个中点与动点各占一行，
  // 截面也是一行 —— 所以"计划真的长成规格要求的样子"在这里是可读的。
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(6)
  // 属性在**行本身**上（`data-binding-parameter`），不是它的子节点。
  const bound = page.locator(".algebra-panel .object-row[data-binding-parameter]")
  await expect(bound).toHaveCount(4)
  // 三个中点是 0.5、动点是审计回填的 0.4 —— 参数而不是文案。
  await expect(page.locator('.algebra-panel .object-row[data-binding-parameter="0.5"]')).toHaveCount(3)
  await expect(page.locator('.algebra-panel .object-row[data-binding-parameter="0.4"]')).toHaveCount(1)
  // 四个点都绑在同一只实体的棱上（`solid-1:e…`）。
  const hosts = await bound.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-binding-host")))
  for (const host of hosts) expect(host).toMatch(/^solid-1:e\d+$/)
  /**
   * 而**动点与其中一个中点共用同一条宿主棱** —— 那条棱正是截面多边形的一条边
   *（Fix round 1 / C2：P 因此始终落在截面边界上；宿主棱的端点是不是截面顶点，
   *  由 `representativeFixtures.test.ts` 从编译产物上验证）。
   */
  const movingHost = await page.locator('.algebra-panel .object-row[data-binding-parameter="0.4"]').getAttribute("data-binding-host")
  const midpointHosts = await page.locator('.algebra-panel .object-row[data-binding-parameter="0.5"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-binding-host")))
  expect(midpointHosts).toContain(movingHost)

  const labels = await rows.allInnerTexts()
  expect(labels.some((text) => text.includes("斜四棱柱"))).toBe(true)
  expect(labels.some((text) => text.includes("section-1"))).toBe(true)
})
