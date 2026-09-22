import { expect, test, type Page } from "@playwright/test"

/**
 * **两条会话互不串线**（对话切片 Task 5；规格 §5.1/§5.4）。
 *
 * 这条用例要证的是"多会话"这件事**在真实浏览器里成立**，而不只是 store 的单测成立：
 * ① 在 A 里说过的话、确认过的事实，不会出现在 B 里；
 * ② 切回 A，历史与**长期记忆**都还在，这一轮继续引用原来的东西；
 * ③ 反过来，B 的那一轮上下文里**没有** A 的东西。
 *
 * 判据放在两处**真实可观察**的地方：
 * - 对话记录（DOM）：说过什么、提交回执；
 * - 开发者详细视图里的那一行上下文计数（`[context] …`）：这一轮的规划上下文里有
 *   **几条已确认事实、几条历史消息** —— 计数是"模型看到了什么"的诚实摘要，
 *   它既不打印内容，也不需要模型服务（浏览器里用的是本地确定性规划器）。
 */

const STORAGE_KEY = "mathcanvas:agent-conversations"

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

/** 当前存储里的会话记录（浏览器兜底就是 localStorage 那一份）。 */
async function storedConversations(page: Page): Promise<{ id: string; title: string; messages: { id: string }[]; facts: { key: string; valueJson: unknown }[] }[]> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]") as never, STORAGE_KEY)
}

/** 最后一条助手消息里那行上下文计数（`[context] …`）。它默认折叠，但 `textContent` 读得到。 */
async function lastContextLine(page: Page): Promise<string> {
  const message = page.locator("[data-message-role='assistant']").last()
  const text = (await message.textContent()) ?? ""
  return text.split("\n").find((line) => line.includes("[context]")) ?? ""
}

test("keeps two conversations' transcripts, facts and planning context apart", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()

  // ---- 会话 A：建一个立方体并**真的提交** ----
  await sendPrompt(page, "建一个棱长 3 的立方体")
  await page.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()

  const afterCommit = await storedConversations(page)
  expect(afterCommit).toHaveLength(1)
  const conversationA = afterCommit[0]!
  // 提交在**长期记忆**里留下了一条已确认事实（代数 + 创建的对象）。
  expect(conversationA.facts).toHaveLength(1)
  expect(conversationA.facts[0]!.key).toMatch(/^commit:/)

  // ---- 会话 B：新建对话，历史是空的，A 说过的话一句都不在 ----
  await page.getByRole("button", { name: "新建对话" }).click()
  const transcript = page.getByRole("log", { name: "对话记录" })
  await expect(transcript).toContainText("发送第一条指令后")

  await sendPrompt(page, "画一个点")
  await expect(transcript).toContainText("画一个点")
  expect(await transcript.innerText()).not.toContain("建一个棱长 3 的立方体")
  // B 的那一轮上下文是**空的**：0 条已确认事实、0 条历史消息（会话之间不串历史）。
  await expect.poll(() => lastContextLine(page)).toContain("0 confirmed fact(s)")
  expect(await lastContextLine(page)).toContain("0 message(s)")

  const withB = await storedConversations(page)
  expect(withB).toHaveLength(2)
  const conversationB = withB.find((record) => record.id !== conversationA.id)!
  // B 里没有 A 的事实（"不能跨会话引用"这条在事实层同样成立）。
  expect(conversationB.facts).toHaveLength(0)

  // ---- 切回 A：历史还在，而且这一轮**接着原来的引用**继续 ----
  await page.getByRole("button", { name: /^建一个棱长 3 的立方体/ }).click()
  await expect(page.getByRole("log", { name: "对话记录" })).toContainText("建一个棱长 3 的立方体")

  await sendPrompt(page, "再建一个棱长 2 的立方体")
  // A 的那一轮上下文里有那条已确认事实与之前的消息 —— 这就是"继续原来的引用"的判据。
  await expect.poll(() => lastContextLine(page)).toContain("1 confirmed fact(s)")
  const contextInA = await lastContextLine(page)
  expect(contextInA).toMatch(/\d+ message\(s\)/)
  // 与 B 那一轮正好相反：A 的这一轮**带着自己的历史**。
  expect(contextInA).not.toContain("0 message(s)")

  // 而且这一次运行的事件与回执落在 A 上，**没有**写进 B。
  await page.getByRole("region", { name: "确认改动" }).last().getByRole("button", { name: "确认并提交" }).click()
  // A 的对话记录里现在有**两次**提交（第一条立方体与这一次），所以取最后一条状态。
  await expect(page.getByText("已提交").last()).toBeVisible()

  const finished = await storedConversations(page)
  const finalA = finished.find((record) => record.id === conversationA.id)!
  const finalB = finished.find((record) => record.id === conversationB.id)!
  expect(finalA.messages.length).toBeGreaterThan(conversationA.messages.length)
  // B 的消息数在 A 那一轮之后**一条都没变**。
  expect(finalB.messages).toHaveLength(conversationB.messages.length)
})
