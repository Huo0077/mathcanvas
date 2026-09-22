import { expect, test, type Page } from "@playwright/test"

/**
 * **派生读数在浏览器里看得见**（Solid/Prism 切片 Task 5 的后半；规格 §3.4 / §6.2 / §9）。
 *
 * `solidStatusReport` 早就把内核那三个求解器的四态结论读了出来，但此前**没有任何界面渲染它**，
 * Agent 的观察里也没有它 —— 于是"精确 / 数值近似 / 不存在 / 退化"这四个状态在真实产品里
 * 一句话都读不到。这条用例钉两条真实的路径：
 *
 * 1. **属性检查器**：选中一只实体（立方体那样的模板实体、或棱柱那样的多面体）时，
 *    它的外接球 / 内切球 / 截面读数出现，`data-derived-status` 上写着内核给的状态；
 *    `undefined` 的那一行必须显示**原因**（不是空白、也不是一个假值）。
 * 2. **Agent 的观察**：真实运行一轮（本地确定性规划器 + 真实协调器 + 真实观察器）之后，
 *    开发者详细视图里那行 `[observation] …` 里写着这一轮带走的状态 ——
 *    这是浏览器里唯一能断言"观察路径真的走过"的抓手（3D 画布是 WebGL，模型服务在浏览器里没接）。
 *
 * `approximate` 这一态**目前没有生产来源**（内核那三个求解器只会给 `exact` / `undefined` /
 * `degenerate`），所以它的渲染由单元用例用生产形状喂进去钉住（`EngineeringInspector.test.tsx`），
 * 这里如实只覆盖 `exact` 与 `undefined` 两种真实可达的状态。
 */

function objectRows(page: Page) {
  return page.locator(".algebra-panel .object-row")
}

/** 一行派生读数（按内核的 code 定位，断言的是状态本身而不是中文）。 */
function derivedRow(page: Page, code: string) {
  return page.locator(`[data-derived-code="${code}"]`)
}

async function sendPrompt(page: Page, prompt: string) {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

/** 最后一条助手消息里的 `[observation] …` 行（默认折叠的开发者详细视图，`textContent` 读得到）。 */
async function lastObservationLine(page: Page): Promise<string> {
  const message = page.locator("[data-message-role='assistant']").last()
  const text = (await message.textContent()) ?? ""
  return text.split("\n").find((line) => line.includes("[observation]")) ?? ""
}

/** 走一遍"一句话 → 确认提交"（与 `solid-prism.spec.ts` 同一条路，两条用例各自独立）。 */
async function draftAndConfirmPrism(page: Page) {
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, "画一个斜棱柱")

  const draft = page.getByRole("region", { name: "确认改动" })
  await expect(draft).toBeVisible()
  await expect(draft).toContainText(/会新增 27 个对象/)
  await draft.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
}

/** 这只棱柱是自己被选中的那一行（对象列表把子对象收在它的子树里）。 */
async function selectFirstSolid(page: Page) {
  await objectRows(page).first().click()
  await expect(objectRows(page).first()).toHaveClass(/selected/)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
})

test("shows a solid's exact and undefined derived readings side by side in the property inspector", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  // 立方体一建出来就是选中状态（`addSolidTemplate` 选中模板实体）。
  await page.getByRole("button", { name: "添加立方体" }).click()

  const panel = page.locator("[data-derived-panel]")
  await expect(panel).toBeVisible()
  /**
   * `exact` 与 `undefined` **在同一只实体上并存**，这就是这一层存在的全部意义。
   *
   * 应用默认的"立方体"其实是 `4×4×2` 的长方体（`App.addDefaultCube`）：它有闭式外接球
   *（包围盒中心 + 体对角线半径 = 3），但**没有内切球** —— 最大内接球半径是 1，
   * 只贴住上下两个面，不贴四个侧面。内核因此如实报 `undefined` 而**不是**交一个半径 1 的球
   *（那正是规格 §3.4/§10 禁止的"拿近似冒充精确"）。
   *
   * 断言打在 `data-derived-status`（状态本身）与内核写下的原因上，而不是中文文案上。
   */
  await expect(derivedRow(page, "derived.circumsphere")).toHaveAttribute("data-derived-status", "exact")
  await expect(derivedRow(page, "derived.insphere")).toHaveAttribute("data-derived-status", "undefined")
  // 精确那一行给的是**结论**（半径 / 球心），而不是一句"有球"。
  await expect(derivedRow(page, "derived.circumsphere")).toContainText("半径")
  // "不存在"那一行给的是**原因**，不是空白。
  await expect(derivedRow(page, "derived.insphere")).toContainText("没有内切球")
  // 读数挂在这只实体的拓扑上：`data-derived-solid` 是文档里那只多面体的 id。
  expect(await derivedRow(page, "derived.circumsphere").getAttribute("data-derived-solid")).toMatch(/^cube-1/)
})

test("shows an oblique prism's undefined readings with their reasons, and carries them into the Agent's observation", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await draftAndConfirmPrism(page)
  await expect.poll(() => objectRows(page).count()).toBe(1)

  /**
   * ---- 路径二：观察 ----
   *
   * 再问一句**只读**的话（本地规划器认这句）：这一轮的真实观察里现在有那只棱柱，
   * 所以那行诊断必须报告它被带走的状态。少了这一步，"读数进了提示词"就只能靠读代码相信。
   */
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, "画布上有什么")
  await expect.poll(() => lastObservationLine(page)).toContain("circumsphere=undefined")
  const observation = await lastObservationLine(page)
  expect(observation).toContain("insphere=undefined")
  // 观察里报的就是这只实体（诊断行用的是文档里的 id）。
  expect(observation).toContain("solid-1")
  await page.getByRole("button", { name: "返回画布" }).click()

  /**
   * ---- 路径一：属性检查器 ----
   *
   * 斜棱柱是一般多面体：不一定有外接球 / 内切球。两个都必须如实报"不存在"，
   * 并给出内核写下的原因（不是空白、也不是一个编出来的球）。
   */
  await selectFirstSolid(page)
  await expect(page.locator("[data-derived-panel]")).toBeVisible()
  await expect(derivedRow(page, "derived.circumsphere")).toHaveAttribute("data-derived-status", "undefined")
  await expect(derivedRow(page, "derived.circumsphere")).toContainText("没有外接球")
  await expect(derivedRow(page, "derived.insphere")).toHaveAttribute("data-derived-status", "undefined")
  await expect(derivedRow(page, "derived.insphere")).toContainText("没有内切球")

  /**
   * 截面读数：`创建截面` 会把选择切到**新建的截面**上，所以创建之后**这一刀自己的读数**
   * 必须立刻看得见（Fix round 1 / M2）—— 前一版在这里什么都不显示，用户得先点回实体。
   * 读数的 `data-derived-source` 就是那条截面图元，归属是精确的（不是"按顺序猜"）。
   */
  await page.getByRole("button", { name: "创建截面" }).click()
  await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-section-count", "1")
  await expect(derivedRow(page, "derived.section")).toHaveAttribute("data-derived-status", "exact")
  await expect(derivedRow(page, "derived.section")).toHaveAttribute("data-derived-source", "section-1")
  // `exact` 的截面给的是形状读数（分类 + 顶点数），由内核算出，而不是图元上那个可能过期的字段。
  await expect(derivedRow(page, "derived.section")).toContainText("polygon")
  // 选中的是截面时只显示这一刀，不把球体读数一起堆上来。
  expect(await page.locator("[data-derived-status]").count()).toBe(1)

  // 把实体选回来：三种读数在同一块面板上并存，各自的状态互不覆盖。
  await selectFirstSolid(page)
  await expect(derivedRow(page, "derived.circumsphere")).toHaveAttribute("data-derived-status", "undefined")
  await expect(derivedRow(page, "derived.insphere")).toHaveAttribute("data-derived-status", "undefined")
  await expect(derivedRow(page, "derived.section")).toHaveAttribute("data-derived-status", "exact")
  await expect(derivedRow(page, "derived.section")).toContainText("polygon")
  expect(await page.locator("[data-derived-status]").count()).toBe(3)
})
