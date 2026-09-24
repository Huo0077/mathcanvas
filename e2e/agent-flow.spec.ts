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

test("adds a second object to a canvas that already holds one", async ({ page }) => {
  /**
   * **真实现场的回归用例**（2026-09-21）。画布上已经有一个手工建的立方体 `solid-1` 时，
   * 用户让 Agent 再建一个同类对象 —— 分配器的计数器从 1 重数，又发 `solid-1`，
   * `validatePatch` 判 `duplicate object id`，运行直接以 `compile_failed` 结束。
   *
   * 这条用例走的是**真实链路**（本地确定性规划器 → 真实编译器 → 真实草稿 → 真实提交），
   * 只是不依赖网络与模型服务：它的关键断言是"第二份草稿**能出现**" ——
   * 撞 id 的话草稿根本进不了确认面板。
   */
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()

  await sendPrompt(page, "建一个棱长 3 的立方体")
  await page.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(() => objectRows(page).count()).toBeGreaterThan(0)
  const before = await objectRows(page).count()

  // 画布非空了：第二次请求必须落在已有对象旁边，而不是撞上它们的 id。
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, "建一个棱长 2 的立方体")

  /**
   * 第一轮的确认面板还留在对话记录里，所以这里取**最后一份**（`.last()`）——
   * 界面本来就允许历史草稿面板与当前这一份同时存在（`strict mode` 因此会报两个元素，
   * 那不是缺陷，是这条用例第一版写错的地方）。
   */
  const draft = page.getByRole("region", { name: "确认改动" }).last()
  await expect(draft).toBeVisible()
  /**
   * 关键断言：第二份草稿是**接着**已有对象算的 —— 撞 id 时它根本到不了这一步。
   *
   * **这里断言的是"分层"而不是某个固定数字**（改动前这一版写的是 `共 2 个` /
   * `会新增 1 个对象`，那是"一个立方体 = 一个对象"时代的期望）。方案 1（P0）之后，
   * 一个模板实体会把它的拓扑**一起物化**，所以"再建一个立方体"报的是它那一族对象的数量
   *（同批 e2e 里 `solid-prism.spec.ts` 断言 27、`agent-oblique-prism.spec.ts` 断言 32，
   * 口径见 `draftCounts.test.ts`）。
   *
   * 于是判据换成一条**不会随计数口径漂移**的性质："共 N 个"是改动后的总数，
   * 它必须**大于**本次新增数 —— 空画布上两者相等，只有"落在已有内容之上"才会大于。
   */
  const panelText = await draft.innerText()
  const added = Number(panelText.match(/会新增\s*(\d+)\s*个对象/)?.[1] ?? "0")
  const total = Number(panelText.match(/共\s*(\d+)\s*个/)?.[1] ?? "0")
  expect(added).toBeGreaterThan(0)
  expect(total).toBeGreaterThan(added)
  await expect(page.getByRole("region", { name: "运行状态" }).last()).not.toContainText("duplicate object id")
  await draft.getByRole("button", { name: "确认并提交" }).click()

  await page.getByRole("button", { name: "返回画布" }).click()
  await expect.poll(() => objectRows(page).count()).toBeGreaterThan(before)
})

test("still drafts after a reload restored and migrated the document", async ({ page }) => {
  /**
   * **第二个真实故障的浏览器级回归**（2026-09-21）。应用**启动时的恢复**会走
   * `migrateLegacySolids`（把实体的子对象物化出来），而那些子对象带着 `style: undefined` /
   * `label: undefined`。规范化哈希此前把 `undefined` 当垃圾抛出去，于是"画布上有一个立体"
   * 就等于"Agent 必然失败"：`canonicalContentHash: unsupported value of type undefined`。
   *
   * 所以这条用例的关键动作是**刷新一次**（等于重启应用、恢复草稿、迁移），然后再发一条请求。
   */
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, "建一个棱长 3 的立方体")
  await page.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()

  // 重启/重新打开 = 恢复草稿 + `migrateLegacySolids`。
  await page.reload()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, "建一个棱长 2 的立方体")

  const draft = page.getByRole("region", { name: "确认改动" }).last()
  await expect(draft).toBeVisible()
  /**
   * 恢复之后文档里**不只是那个立方体**：`migrateLegacySolids` 把它的子对象也物化出来了。
   * 所以这里断言的是"草稿确实落在已有的内容之上"，而不是某个固定数字 ——
   * 固定数字会把"迁移有没有跑"变成一条脆弱的断言（这一版初稿写的是 `会新增 1 个对象`，
   * 那也是"一个立方体 = 一个对象"时代的期望，改动见上一条用例的注释）。
   */
  const panelText = await draft.innerText()
  const total = Number(panelText.match(/共\s*(\d+)\s*个/)?.[1] ?? "0")
  const added = Number(panelText.match(/会新增\s*(\d+)\s*个对象/)?.[1] ?? "0")
  expect(total).toBeGreaterThan(1)
  expect(added).toBeGreaterThan(0)
  await expect(page.getByRole("region", { name: "运行状态" }).last()).not.toContainText("canonicalContentHash")
})

test("refuses to keep a draft when the user discards it", async ({ page }) => {  await page.goto("/")
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
