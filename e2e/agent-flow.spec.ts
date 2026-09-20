import { expect, test } from "@playwright/test"

/**
 * **Agent 的完整链路，在浏览器里走一遍**（Task 2.5 Step 5）。
 *
 * 这条用例守的是计划 G2 Gate 那句
 * "A text request can inspect, construct, preview, confirm, commit, and undo a supported planar and spatial task"：
 * 一句话 → 真实协调器 → 草稿预览 → 用户确认 → 文档真的变了 → **一步撤销**回到原样。
 *
 * 规划器用的是**本地确定性规划器**（没有接入模型服务时的那条路径），所以这条用例不依赖任何网络。
 * 它不是"演示回复"的替代品：动作真的过了编译器、真的进了草稿、提交真的经了 `HostBridge`
 * 的一次性同意与 Compare-and-Swap。
 */
async function sendPrompt(page: import("@playwright/test").Page, prompt: string) {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

/** 画布上出现的对象数量：对象列表是唯一稳定可断言的抓手（3D 画布是 WebGL，没有 DOM 图元）。 */
function objectRows(page: import("@playwright/test").Page) {
  return page.locator(".algebra-panel .object-row")
}

test("turns one sentence into a confirmed commit, then undoes it in one step", async ({ page }) => {
  await page.goto("/")

  // 从平面几何出发：对话框里说"建一个立方体"时，画布并不在立体几何工作区。
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, "建一个棱长 3 的立方体")

  // 1) 真实运行留下了轨迹，并停在"等待你确认"。
  const status = page.getByRole("region", { name: "运行状态" })
  await expect(status).toBeVisible()
  await expect(status.locator(".agent-run-state")).toHaveText("等待你确认")

  // 2) 确认面板出现了：它说清"会新增多少"，并且**不在界面上打印整份文档**。
  const draft = page.getByRole("region", { name: "确认改动" })
  await expect(draft).toBeVisible()
  await expect(draft).toContainText("确认之后会发生什么")
  await expect(draft).toContainText(/会新增 \d+ 个对象/)
  // 计划要求的"exact one-undo statement"。
  await expect(draft).toContainText("只占一步撤销")
  // 界面上**没有**候选文档的内容（曾经打印过整份文档，见进度文档第二十一批）。
  await expect(draft).not.toContainText("primitives")

  // 3) 确认之前，画布上**什么都没有**。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(objectRows(page)).toHaveCount(0)
  await page.getByRole("button", { name: "Agent 工作区" }).click()

  // 4) 点确认 → 真的落盘（提交要经过宿主桥的一次性同意）。
  await page.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()

  // 5) 回到画布：对象出现了，而且**工作区被切到了立体几何**
  //（否则编译器会以 workspace_mismatch 拒绝这个动作）。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".app-shell")).toHaveAttribute("data-app-module", "traditional")
  await expect.poll(() => objectRows(page).count()).toBeGreaterThan(0)

  // 6) 一步撤销回到原样 —— 整批提交只占一步历史。
  await page.keyboard.press("Control+z")
  await expect.poll(() => objectRows(page).count()).toBe(0)
})

test("refuses to keep a draft when the user discards it", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, "建一个棱长 3 的立方体")

  const draft = page.getByRole("region", { name: "确认改动" })
  await expect(draft).toBeVisible()
  await draft.getByRole("button", { name: "丢弃草稿" }).click()

  // 丢弃之后没有草稿，也没有"已提交"，画布上什么都没有。
  await expect(page.getByText("已提交")).toHaveCount(0)
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(objectRows(page)).toHaveCount(0)
})

test("asks for information instead of inventing an answer", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  // 本地规划器认不出这条：正确的行为是**问**，而不是编一段回答。
  await sendPrompt(page, "把这个四面体的外接球半径和外心都算出来并画出来")

  const status = page.getByRole("region", { name: "运行状态" })
  await expect(status.locator(".agent-run-state")).toHaveText("没有完成")
  await expect(status).toContainText("needs_more_information")

  // 没有任何草稿，也没有任何对象被创建。
  await expect(page.getByRole("region", { name: "确认改动" })).toHaveCount(0)
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(objectRows(page)).toHaveCount(0)
})
