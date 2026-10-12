import { expect, test } from "@playwright/test"

/**
 * **Task 15：函数与导数真题纵向交付的浏览器证据**。
 *
 * 走的是**产品路径**：题面 → 本地规划器 → 隔离草稿 → 题设核验 → 确认 → 落盘 / 或 fail-closed。
 *
 * 两条用例各钉一件事：
 *
 * ① **定义域 / 断点**：`f(x) = 1/x` 在 `x = 0` 没有定义，图上必须是断开的两段。
 *    旧判据在这条题面上只会给出一句"尚未被可靠解析"（采样碰到 `Infinity` 就整条放弃），
 *    用户既不知道曲线对不对、也不知道断在哪。现在核验器把**断点集合**单独判，
 *    面板上要说清"断开"，并且把证据范围写成"一个图形实例"。
 * ② **尖点处没有切线**：`f(x) = |x|` 在 `x = 0` 是尖点。题面照样要求作切线 ⇒ 必须挡住。
 *    浏览器这一层的证据是 **fail-closed**（确认面板根本不出现，用户不会被邀请去确认一张错的图）；
 *    判据"红 + 说出左右导数"由 `diagramVerification.test.ts` 钉死。
 *
 * 用例自己回代：草稿里那条函数的表达式与定义域由测试读出来，**测试自己**在区间上扫一遍，
 * 数出"题面那条函数在图上这段定义域里到底有没有无定义点" —— 拿面板的结论证明面板，等于没证。
 */

const DOMAIN_PROMPT = "画出 f(x)=1/x 的图像"
const CORNER_PROMPT = "画出 f(x)=|x| 的图像与它在 x=0 处的切线"

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到平面几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

async function send(page: import("@playwright/test").Page, prompt: string): Promise<void> {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

/** 草稿键的**原始值** —— fail-closed 那一条要断言"逐字未变"。 */
const draftKey = (page: import("@playwright/test").Page): Promise<string | null> =>
  page.evaluate(() => window.localStorage.getItem("mathcanvas:draft:conics"))

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("keeps the two branches of 1/x apart and says where the curve breaks", async ({ page }) => {
  await openAgent(page)
  await send(page, DOMAIN_PROMPT)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  const check = panel.getByRole("region", { name: "题设核验" })
  await expect(check).toHaveAttribute("data-status", "passed")
  await expect(check).toContainText("1/x")
  // 走通过的那条路，理由里必须说清断在哪 —— 否则用户看不出这条"通过"是真比过两侧。
  await expect(check).toContainText("断开")
  /**
   * **证据范围写在面板上**（Task 15 的出口之一）：采样折线上的比较只是 `plot-only`，
   * 而这一轮核验的是一个图形实例 —— 两句话都不许被读成"这条函数已被证明"。
   */
  await expect(check).toHaveAttribute("data-proof-scope", "figure-instance")
  await expect(check).toHaveAttribute("data-universal-claims", "not-proven")
  await expect(check.locator('[data-evidence="plot-only"]')).toHaveCount(1)

  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(async () => draftKey(page)).not.toBeNull()

  /**
   * **测试自己回代**：读草稿里那条函数，在它自己的定义域上扫 129 个点，
   * 数出"题面这条函数在图上这段区间里有几处没有定义"。
   * 这一条成立，才谈得上"面板说断开"是有依据的。
   */
  const read = await page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:conics")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: { type: string; expression?: string; domain?: [number, number] }[] } }
    const curve = (parsed.document?.primitives ?? []).find((primitive) => primitive.type === "function")
    if (!curve?.expression || !curve.domain) throw new Error("草稿里没有函数曲线")
    // 这条用例只准备了一条表达式：换了一条就说明画错了，直接抛，而不是拿它去比。
    if (curve.expression.replace(/\s+/g, "") !== "1/x") throw new Error(`草稿里的函数是 ${curve.expression}，不是题面那条 1/x`)
    const value = (x: number) => 1 / x
    let undefinedPoints = 0
    for (let index = 0; index <= 128; index += 1) {
      const x = curve.domain[0] + (curve.domain[1] - curve.domain[0]) * index / 128
      if (!Number.isFinite(value(x))) undefinedPoints += 1
    }
    return { domain: curve.domain, undefinedPoints }
  })
  expect(read.domain[0]).toBeCloseTo(-2, 9)
  expect(read.domain[1]).toBeCloseTo(2, 9)
  // 题面那条函数在这段定义域里恰好有一处没有定义（x = 0）：这就是"必须断开"的理由。
  expect(read.undefinedPoints).toBe(1)

  await page.screenshot({ path: "test-results/task15-function-domain.png" })
})

test("fails closed at a corner: |x| has no tangent at x = 0", async ({ page }) => {
  await openAgent(page)
  const before = await draftKey(page)

  await send(page, CORNER_PROMPT)

  /**
   * 四条断言抄的是本仓既有那套 fail-closed 口径（`agent-unreadable-prompt.spec.ts`）：
   * 没草稿 / 运行落定且有话说 / 文档逐字未变 / 不占撤销历史。
   */
  await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)

  const status = page.getByRole("region", { name: "运行状态" }).last()
  await expect(status).toBeVisible()
  await expect(status.locator(".agent-run-state")).not.toHaveText("进行中")
  await expect(status.locator(".agent-run-state")).not.toHaveText("已提交")
  await expect(status).not.toBeEmpty()

  expect(await draftKey(page)).toBe(before)

  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeDisabled()
})
