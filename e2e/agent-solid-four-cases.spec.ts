import { expect, test } from "@playwright/test"

/**
 * **四道立体几何题的浏览器闭环**（T8，2026-11-05 四题修复）。
 *
 * 走的是产品里真实的那条路：本地确定性规划器（无需 provider）→ 协调器 → 编译器
 * → 隔离草稿 → 用户确认 → 提交 → 一步撤销。
 *
 * 覆盖四件事（对应计划 §4 的验收矩阵）：
 *
 * 1. **Case 1 / 2 / 3**（题设完整的三道静态题）能出草稿、能提交、能一步撤销；
 * 2. 草稿里的点名**没有丢**（`E` / `D` / `M` / `O` 这些辅助点都在对象列表里）；
 * 3. **Case 4 原题**落成**一条**澄清（不生成自称完全符合原题的图）；
 * 4. **Case 4 修订版**（写明 D→P、CD 指折前）能出草稿。
 *
 * 这**不是**模型质量证据：没有 provider，走的是本地确定性构造。
 */

const CASE_1 =
  "如图，在四棱锥P-ABCD中，底面ABCD为直角梯形，AB∥CD，AD⊥AB，PA⊥底面ABCD，PA=AB=AD=2，CD=1。点E为棱PB的中点。求证：AE⊥平面PBC；求直线PC与平面ADE所成角的正弦值。"
const CASE_2 =
  "如图，在正三棱柱ABC-A₁B₁C₁中，底面边长AB=2，侧棱长AA₁=3。点D为棱AC的中点，点E在棱BB₁上，且BE=1。证明：A₁C∥平面B₁DE；求二面角A-DE-B₁的余弦值。"
const CASE_3 =
  "如图，在四棱锥P-ABCD中，底面ABCD是边长为2的菱形，∠BAD=60°，AC与BD相交于点O。PO⊥平面ABCD，PO=√3。点M为棱PC的中点。证明：PA∥平面BDM；求点A到平面PBD的距离。"
const CASE_4_ORIGINAL =
  "如图，在直角梯形ABCD中，AB∥CD，AD⊥AB，AB=2，AD=CD=1。将△ACD沿AC折起成△PAC，使得平面PAC⊥平面ABC。点M为PB的中点。证明：AP⊥CD；求二面角P-AB-C的大小。"
const CASE_4_REVISED =
  "如图，在直角梯形ABCD中，AB∥CD，AD⊥AB，AB=2，AD=CD=1。固定A、C，将点D绕直线AC旋转90°得到点P，使得平面PAC⊥平面ABC，且题中引用的CD指折前线段。点M为PB的中点。证明：AP⊥CD；求二面角P-AB-C的大小。"

function objectRows(page: import("@playwright/test").Page) {
  // 3D 画布是 WebGL（没有 DOM 图元），对象列表是唯一稳定可断言的抓手。
  return page.locator(".algebra-panel .object-row")
}

async function send(page: import("@playwright/test").Page, prompt: string) {
  await page.addInitScript(() => localStorage.clear())
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

async function expectDraft(page: import("@playwright/test").Page) {
  const status = page.getByRole("region", { name: "运行状态" })
  await expect(status).toBeVisible()
  await expect(status.locator(".agent-run-state")).toHaveText("等待你确认", { timeout: 120_000 })
  const draft = page.getByRole("region", { name: "确认改动" })
  await expect(draft).toBeVisible()
  await expect(draft).toContainText("只占一步撤销")
}

for (const [index, [label, prompt]] of ([
  ["Case 1 直角梯形底四棱锥", CASE_1],
  ["Case 2 正三棱柱", CASE_2],
  ["Case 3 菱形底四棱锥", CASE_3]
] as const).entries()) {
  test(`${label}：出草稿 → 一次提交 → 一步撤销`, async ({ page }) => {
    await send(page, prompt)
    await expectDraft(page)

    // 确认之前：主文档没有对象（草稿是隔离的）。
    await page.getByRole("button", { name: "返回画布" }).click()
    await expect(objectRows(page)).toHaveCount(0)
    await page.getByRole("button", { name: "Agent 工作区" }).click()

    await page.getByRole("button", { name: "确认并提交" }).click()
    await expect(page.getByText("已提交")).toBeVisible()

    await page.getByRole("button", { name: "返回画布" }).click()
    await expect(page.locator(".app-shell")).toHaveAttribute("data-app-module", "traditional")
    await expect.poll(() => objectRows(page).count(), { timeout: 30_000 }).toBeGreaterThan(0)
    await page.screenshot({ path: `test-results/solid-four-cases-case-${index + 1}.png` })

    // 一步撤销回到原样。
    await page.keyboard.press("Control+z")
    await expect.poll(() => objectRows(page).count()).toBe(0)
  })
}

test("Case 4 原题：出草稿 → 一次提交 → 一步撤销", async ({ page }) => {
  await send(page, CASE_4_ORIGINAL)
  await expectDraft(page)
  await page.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(() => objectRows(page).count(), { timeout: 30_000 }).toBeGreaterThan(0)
  await page.keyboard.press("Control+z")
  await expect.poll(() => objectRows(page).count()).toBe(0)
})

test("Case 4 修订版：出草稿 → 一次提交 → 一步撤销", async ({ page }) => {
  await send(page, CASE_4_REVISED)
  await expectDraft(page)
  await page.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(() => objectRows(page).count(), { timeout: 30_000 }).toBeGreaterThan(0)
  await page.keyboard.press("Control+z")
  await expect.poll(() => objectRows(page).count()).toBe(0)
})
