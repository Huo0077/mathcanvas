import { expect, test, type Page } from "@playwright/test"

/**
 * **会话之间不串消息、事实或对象引用**（对话切片 Fix round 1；规格 §5.1/§5.4/§9）。
 *
 * 这条用例在真实浏览器里走三步：
 * ① **两条会话**（A 里有提交、B 是新的）：B 的一轮上下文里没有 A 说过的话、没有 A 的事实；
 * ② **回到 A 接着原来的对象继续**：A 那一轮带着自己的长期记忆，而它的草稿是**接着 A 建出来的
 *    对象**算的（引用在 A 里解析得出来）；
 * ③ **换一份文档**（平面几何）：侧栏换成它的会话列表，A 在立体几何里确认的事实**不许**跟过来
 *    （§5.1 的绑定 + 事实按文档筛）。
 *
 * 判据放在两处真实可观察的地方：
 * - 对话记录（DOM）：说过什么、提交回执、草稿面板的"共 N 个"（它由**真实文档**算出）；
 * - 开发者详细视图里的那一行上下文计数（`[context] …`）：这一轮的规划上下文里有几条已确认事实、
 *   几条历史消息 —— 计数是"模型看到了什么"的诚实摘要，不打印内容，也不需要模型服务。
 */
const STORAGE_KEY = "mathcanvas:agent-conversations"

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

interface StoredConversation {
  id: string
  title: string
  messages: { id: string }[]
  facts: { key: string; valueJson: unknown }[]
}

/** 当前存储里的会话记录（浏览器兜底就是 localStorage 那一份）。 */
async function storedConversations(page: Page): Promise<StoredConversation[]> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]") as never, STORAGE_KEY)
}

/** 最后一条助手消息里那行上下文计数（`[context] …`）。它默认折叠，但 `textContent` 读得到。 */
async function lastContextLine(page: Page): Promise<string> {
  const message = page.locator("[data-message-role='assistant']").last()
  const text = (await message.textContent()) ?? ""
  return text.split("\n").find((line) => line.includes("[context]")) ?? ""
}

/** 确认面板里"共 N 个"的那个 N（由宿主侧从**真实文档**算出，界面不自己数）。 */
async function draftTotal(page: Page): Promise<number> {
  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toContainText(/共 \d+ 个/)
  const text = await panel.innerText()
  return Number(text.match(/共\s*(\d+)\s*个/)?.[1] ?? "0")
}

test("keeps two conversations' transcripts, facts and object references apart", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto("/")
  // 从**立体几何**起步：这一轮不会触发工作区自动切换，A/B 落在同一份文档里。
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()

  // ---- 会话 A：建一个立方体并**真的提交**（对象落在文档里） ----
  await sendPrompt(page, "建一个棱长 3 的立方体")
  await page.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()

  const afterCommit = await storedConversations(page)
  expect(afterCommit).toHaveLength(1)
  const conversationA = afterCommit[0]!
  // 提交留下了长期记忆，而且那条事实**写明它是在哪份文档上确认的**（跨文档筛的依据）。
  expect(conversationA.facts).toHaveLength(1)
  expect(conversationA.facts[0]!.key).toMatch(/^commit:/)
  expect((conversationA.facts[0]!.valueJson as { documentId?: string }).documentId).toBeTruthy()

  // ---- 会话 B：新建对话，历史是空的，A 说过的话一句都不在 ----
  await page.getByRole("button", { name: "新建对话" }).click()
  const transcript = page.getByRole("log", { name: "对话记录" })
  await expect(transcript).toContainText("发送第一条指令后")

  /**
   * B 这里问一句**只读**的（本地规划器认"有什么"）：它不改文档，也不换工作区 ——
   * 而工作区在这个应用里就是文档（换文档 = 换会话列表），所以用例必须待在同一个工作区里，
   * 否则它证明的是"换文档"而不是"换会话"。
   */
  await sendPrompt(page, "画布上有什么")
  await expect(transcript).toContainText("画布上有什么")
  expect(await transcript.innerText()).not.toContain("建一个棱长 3 的立方体")
  // B 的那一轮上下文是**空的**：0 条已确认事实、0 条历史消息。
  await expect.poll(() => lastContextLine(page)).toContain("0 confirmed fact(s)")
  expect(await lastContextLine(page)).toContain("0 message(s)")

  const withB = await storedConversations(page)
  expect(withB).toHaveLength(2)
  const conversationB = withB.find((record) => record.id !== conversationA.id)!
  expect(conversationB.facts).toHaveLength(0)

  // ---- 回到 A：历史还在，而且这一轮**接着 A 建出来的对象**继续 ----
  await page.getByRole("button", { name: /^建一个棱长 3 的立方体/ }).click()
  await expect(page.getByRole("log", { name: "对话记录" })).toContainText("建一个棱长 3 的立方体")

  await sendPrompt(page, "再建一个棱长 2 的立方体")
  // A 的上下文里带着自己的长期记忆（1 条已确认事实 + 之前说过的话）。
  await expect.poll(() => lastContextLine(page)).toContain("1 confirmed fact(s)")
  const contextInA = await lastContextLine(page)
  expect(contextInA).not.toContain("0 message(s)")
  // **引用解析得出来**：这一轮的草稿接着 A 建出来的那个对象算（不止 1 个）。
  const totalInA = await draftTotal(page)
  expect(totalInA).toBeGreaterThan(1)

  await page.getByRole("region", { name: "确认改动" }).last().getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交").last()).toBeVisible()

  const finished = await storedConversations(page)
  const finalA = finished.find((record) => record.id === conversationA.id)!
  const finalB = finished.find((record) => record.id === conversationB.id)!
  expect(finalA.messages.length).toBeGreaterThan(conversationA.messages.length)
  // B 的消息数在 A 那一轮之后**一条都没变**（旧事件写回原会话，不写进新会话）。
  expect(finalB.messages).toHaveLength(conversationB.messages.length)

  // ---- 换到**另一份文档**（平面几何）：列表是它的，A 的事实不许跟过来 ----
  await page.getByRole("button", { name: "返回画布" }).click()
  await page.getByRole("button", { name: "跳转到平面几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()

  const sidebar = page.getByRole("complementary", { name: "对话列表" })
  await expect(sidebar).not.toContainText("建一个棱长 3 的立方体")
  await sendPrompt(page, "画一个点")
  // 这一轮的上下文里**没有**立体几何那份文档确认的事实（跨文档不串事实）。
  await expect.poll(() => lastContextLine(page)).toContain("0 confirmed fact(s)")
  // 它的草稿也不是在立体几何那份文档上算的：新文档里只有一个点。
  const totalInPlanar = await draftTotal(page)
  expect(totalInPlanar).toBeLessThan(totalInA)
})
