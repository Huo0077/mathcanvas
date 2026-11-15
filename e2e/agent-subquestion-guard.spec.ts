import { expect, test, type Page } from "@playwright/test"
import type { PlanEnvelope } from "@draw/agent-core"

const candidatePlan: PlanEnvelope = {
  schemaVersion: "mathcanvas.plan.v1",
  kind: "plan",
  goal: "小问覆盖回归",
  factIds: [],
  actions: [{
    actionId: "solid.create_polyhedron",
    actionKey: "pyramid",
    factIds: [],
    inputs: {
      alias: "pyramid",
      vertexNames: ["P", "A", "B", "C", "D"],
      vertices: [
        { x: 0, y: 0, z: 2 },
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 }
      ],
      faces: [[1, 2, 3, 4], [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4]]
    }
  }]
}

async function installProviderMock(page: Page) {
  await page.addInitScript((envelope) => {
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
          if (command === "append_conversation_message" || command === "append_run_event" || command === "provider_cancel") return true
          if (command === "list_conversations") return []
          if (command === "list_provider_profiles") return [{
            id: "test",
            name: "离线测试模型",
            protocol: "openai_compatible",
            dialect: "openai_native",
            baseUrl: "https://example.invalid/v1",
            modelId: "fake",
            secretRef: "test",
            capabilities: [],
            networkPolicy: "local",
            revision: 1
          }]
          if (command === "active_provider_profile") return "test"
          if (command === "provider_health") return {
            status: "ok",
            checkedAt: 1,
            profileRevision: 1,
            capabilityEvidence: [{ feature: "json_mode_v1", status: "verified" }]
          }
          if (["read_document_head", "read_latest_document_head", "create_document", "commit_document", "lookup_commit", "replace_document_epoch", "read_document_snapshot", "document_history_length"].includes(command)) {
            const error = new Error("repository unavailable in this browser-only test")
            error.name = "NoDesktopShellError"
            throw error
          }
          if (command === "provider_run") {
            return [
              { kind: "delta", requestId: "req-1", attemptId: "attempt-1", text: JSON.stringify(envelope) },
              { kind: "completed", stopReason: "stop" }
            ]
          }
          return null
        }
      }
    })
  }, candidatePlan)
}

async function send(page: Page, prompt: string) {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

async function livePrimitiveCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) return 0
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] } }
    return parsed.document?.primitives?.length ?? 0
  })
}

for (const prefix of ["", "设", "且", "若"]) {
  test(`blocks an unscoped subquestion for prefix ${prefix}`, async ({ page }) => {
    await installProviderMock(page)
    await send(page, `四棱锥P-ABCD中，PA=2。（1）证明AD∥平面PBC；（2）${prefix}AD⊥DC，求AD。`)

    await expect(page.getByRole("alert").filter({ hasText: "题设尚未核验" })).toBeVisible()
    await expect(page.getByRole("region", { name: "确认改动" })).toHaveCount(0)
    await expect.poll(() => livePrimitiveCount(page)).toBe(0)
  })
}

test("allows an ordinary single-question candidate through confirmation", async ({ page }) => {
  await installProviderMock(page)
  await send(page, "四棱锥P-ABCD中，PA=2，画出这个四棱锥。")

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible()
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await expect.poll(() => livePrimitiveCount(page)).toBeGreaterThan(0)
})
