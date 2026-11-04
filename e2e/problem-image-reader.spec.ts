import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { createEmptyDocument, decodeMgeo, encodeMgeo } from "@draw/dsl"
import { commandButton } from "./command-menu"

const png = readFileSync("apps/desktop/src-tauri/src/providers/vision_probe.b64", "utf8").trim()
const PRISM = String.raw`15\. 如图，在直三棱柱 $ABC-A_1B_1C_1$ 中，$\angle ACB=90^\circ$，$AC=BC$，$D$，$E$ 分别为 $AB$，$AC_1$ 的中点。
(1) 证明：$DE\parallel$ 平面 $BCC_1B_1$；
(2) 设 $CC_1=2$，直线 $DE$ 与平面 $ACC_1A_1$ 所成的角为 $45^\circ$，求直线 $DE$ 到平面 $BCC_1B_1$ 的距离。`

test("reads two images and sends the corrected problem with optional diagram references", async ({ page }) => {
  await page.addInitScript((problem) => {
    let requestCount = 0
    let conversation: Record<string, unknown> | undefined
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          if (command === "read_conversation") {
            if (!conversation) throw new Error("no conversation for that id")
            return { conversation, messages: [], facts: [] }
          }
          if (command === "create_conversation") {
            conversation = { ...args?.conversation as object, status: "active", createdAt: 0, updatedAt: 0, summary: "", summaryVersion: 0 }
            return conversation
          }
          if (command === "append_conversation_message") return true
          if (command === "list_provider_profiles") return [
            { id: "text", name: "文字模型", modelId: "text-only", revision: 1, capabilities: [], networkPolicy: "local" },
            { id: "vision", name: "读图模型", modelId: "vision-test", revision: 2, capabilities: [], networkPolicy: "local" }
          ]
          if (command === "active_provider_profile") return "text"
          if (command === "provider_health") return args?.profileId === "vision"
            ? { profileRevision: 2, capabilityEvidence: [{ feature: "vision_read_v1", status: "verified" }] }
            : { profileRevision: 1, capabilityEvidence: [{ feature: "vision", status: "verified" }] }
          if (command === "provider_run") {
            requestCount += 1
            const messages = args?.messages as { role: string; images?: string[] }[]
            document.body.dataset.imageRequests = String(requestCount)
            if (args?.profileId !== "vision" || args.profileRevision !== 2 || args.tools !== undefined
              || messages[1].role !== "user" || messages[1].images?.length !== 2
              || !messages[1].images.every((image) => image.startsWith("iVBORw0KGgo"))) throw new Error("invalid visual request")
            if (requestCount === 1) return { kind: "failed", failure: "transport", message: "test connection interrupted", retryable: true }
            const reading = {
              problem: problem.replace("CC_1=2", "CC_1=[看不清]"),
              diagram: [
                { text: "图中 AB=4", image: 2, box: [0.1, 0.2, 0.4, 0.5] },
                { text: "图中线段 DE 为虚线", image: 2, box: [0.4, 0.5, 0.8, 0.9] }
              ],
              uncertainties: [{ text: "侧棱的长度数字模糊", image: 1, box: [0.2, 0.2, 0.5, 0.6] }]
            }
            return [{ kind: "delta", text: JSON.stringify(reading) }, { kind: "completed", stopReason: "stop" }]
          }
          return null
        }
      }
    })
  }, PRISM)
  await page.goto("/")
  await (await commandButton(page, "图片识题")).click()
  const panel = page.getByRole("region", { name: "题图识别" })
  await expect(panel).toBeVisible()
  const composer = page.getByRole("textbox", { name: "对话输入" })
  // A real PNG goes through decode and PNG normalization, using both supported input routes.
  await composer.evaluate((element, encoded) => {
    const data = new DataTransfer()
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    data.items.add(new File([bytes], "题干.png", { type: "image/png" }))
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }))
  }, png)
  await expect(panel.getByRole("button", { name: /图 1 · 题干/ })).toBeVisible()
  await panel.getByLabel("选择题图文件").setInputFiles({ name: "配图.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") })
  await expect(panel.getByRole("button", { name: /图 2 · 配图/ })).toBeVisible()
  await expect(panel.getByRole("combobox", { name: "视觉模型" })).toHaveValue("vision")
  await expect(panel.getByRole("option")).toHaveCount(1)
  await expect(page.locator("body")).not.toHaveAttribute("data-image-requests", "1")

  await panel.getByRole("button", { name: "识别题图" }).click()
  await expect(panel.getByRole("alert")).toContainText("图像识别请求失败")
  await expect(panel.getByRole("button", { name: /图 2 · 配图/ })).toBeVisible()
  await panel.getByRole("button", { name: "识别题图" }).click()
  const transcription = panel.getByRole("textbox", { name: "识别的题干" })
  await expect(transcription).toHaveValue(/CC_1=\[看不清\]/)
  const send = panel.getByRole("button", { name: "发送给 Agent" })
  await expect(send).toBeDisabled()
  await panel.getByRole("button", { name: /侧棱的长度数字模糊/ }).click()
  await expect(panel.locator("[data-image-highlight]")).toBeVisible()
  await expect(panel.getByRole("button", { name: "定位配图读数 1" })).toBeHidden()
  await panel.getByText("配图参考 · 2 条").click()
  await panel.getByRole("button", { name: "定位配图读数 1" }).click()
  await expect(panel.getByRole("img", { name: "图 2 预览" })).toBeVisible()
  await expect(panel.getByRole("checkbox")).toHaveCount(0)
  await transcription.fill(PRISM)
  await send.click()
  await expect(panel).toHaveCount(0)
  const message = page.locator('.agent-message[data-message-role="user"]').last()
  await expect(message).toContainText("配图参考")
  await expect(message).not.toContainText("配图已核对")
  await expect(page.locator('.agent-message[data-message-role="assistant"] .agent-bubble')).toContainText("距离为 t/2=1。")
  await expect(page.getByRole("region", { name: "确认改动" })).toBeVisible()
  await expect(page.locator("body")).toHaveAttribute("data-image-requests", "2")
})

test("replays the original image handoff and commits one verified prism draft", async ({ page }) => {
  const document = createEmptyDocument("geometry3d")
  document.primitives.push({ id: "existing-i", type: "point3", label: "I", position: { x: 4, y: 4, z: 4 } })
  await page.addInitScript((draft) => {
    localStorage.setItem("mathcanvas:active-workspace", "geometry3d")
    localStorage.setItem("mathcanvas:draft:geometry3d", draft)
  }, encodeMgeo(document))
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill("配图已核对：$C_1$；$A_1$；$B_1$；$A$；$B$；$C$；$D$；$E$；虚线 $CD$；虚线 $C_1D$；虚线 $C_1B$；虚线 $AD$；虚线 $DE$。\n" + PRISM)
  await page.getByRole("button", { name: "发送", exact: true }).click()
  const draft = page.getByRole("region", { name: "确认改动" })
  await expect(draft).toBeVisible({ timeout: 30_000 })
  await expect(draft.getByRole("region", { name: "题设核验" })).toHaveAttribute("data-status", "passed")
  await expect(page.locator('.agent-message[data-message-role="assistant"] .agent-bubble')).toContainText("距离为 t/2=1。")
  await draft.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  const saved = await page.evaluate(() => localStorage.getItem("mathcanvas:draft:geometry3d")!)
  const primitives = decodeMgeo(saved).primitives
  expect(primitives.filter((item) => item.type === "point3").map((item) => item.label)).toEqual(expect.arrayContaining(["I", "A", "B", "C", "A₁", "B₁", "C₁", "D", "E"]))
  const de = primitives.find((item) => item.type === "segment3" && item.label === "DE")
  if (de?.type !== "segment3") throw new Error("提交后的场景缺少 DE")
  const endpoints = de.pointIds.map((id) => primitives.find((item) => item.id === id))
  expect(endpoints.map((point) => point?.label)).toEqual(["D", "E"])
})
