import { readFile } from "node:fs/promises"
import { decodeMgeo, encodeMgeo, type GeometryDocument } from "@draw/dsl"
import { expect, test, type Page } from "@playwright/test"
import { projectWorldPoint } from "./helpers/projection"

const FIXED_VIEWPORT = { width: 1280, height: 800 }

const CONIC = "椭圆 x²/9+y²/4=1 与直线 y=0 相交于 A、B 两点"
const FUNCTION_CURVE = "画出 f(x)=x³−3x 的图像与它在 x=1 处的切线"
const SOLID_FOLD = [
  "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。",
  "点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。",
  "将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。"
].join("")
const BOUND_POINT_PROMPT = "如图，在正四棱柱 ABCD-A₁B₁C₁D₁ 中，AB=2，AA₁=4。点 A₂，B₂，C₂，D₂ 分别在棱 AA₁，BB₁，CC₁，DD₁ 上，AA₂=1，BB₂=DD₂=2，CC₂=3。（1）证明：B₂C₂∥A₂D₂；（2）点 P 在棱 BB₁ 上，当二面角 P-A₂C₂-D₂ 为 120° 时，求 BP 的长。"

const IGNORED_KEYS = new Set([
  "viewport", "zoom", "panX", "panY", "selection", "selectedIds", "hoveredId",
  "updatedAt", "createdAt", "timestamp", "logs", "transcript", "cursor"
])

function canonicalize(value: unknown): string {
  if (value === undefined || value === null) return "null"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number")
    return JSON.stringify(value)
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`
  if (typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .filter((key) => !IGNORED_KEYS.has(key) && (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`)
    return `{${entries.join(",")}}`
  }
  throw new Error(`unsupported type ${typeof value}`)
}

async function computeSha256(page: Page, doc: unknown): Promise<string> {
  return page.evaluate(async (canonical) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
  }, canonicalize(doc))
}

async function openAgent(page: Page, workspace: "平面几何" | "立体几何"): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: workspace }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

async function readCommittedDoc(page: Page, storageKey: "conics" | "geometry3d"): Promise<GeometryDocument | null> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(`mathcanvas:draft:${key}`), storageKey)
  if (!raw) return null
  return ((JSON.parse(raw) as { document?: GeometryDocument }).document) ?? null
}

async function savedDownloadDoc(page: Page) {
  const pending = page.waitForEvent("download")
  await page.getByRole("button", { name: "保存 .mgeo", exact: true }).click()
  const path = await (await pending).path()
  if (!path) throw new Error("Missing saved .mgeo download path")
  return decodeMgeo(await readFile(path, "utf8"))
}

test.use({ viewport: FIXED_VIEWPORT, deviceScaleFactor: 1 })

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("enforces zero-write pre-confirmation, atomic one-time commit, undo/redo, and save/reload lifecycle", async ({ page }) => {
  await openAgent(page, "立体几何")
  await sendPrompt(page, SOLID_FOLD)

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })

  // 1. Certificate must be passed and zero scene primitives may be committed before explicit confirmation.
  await expect(panel.locator("[data-certificate-status]")).toHaveAttribute("data-certificate-status", "passed")
  const candidatePreview = page.getByRole("region", { name: "草稿画布预览" })
  await expect(candidatePreview).toBeVisible()
  await expect(candidatePreview.locator('[data-3d-scene="true"]')).toHaveAttribute("data-canvas-evidence-status", "passed")
  const beforeConfirmDoc = await readCommittedDoc(page, "geometry3d")
  expect(beforeConfirmDoc?.primitives ?? []).toHaveLength(0)

  // 2. Rapid double-click confirmation must commit cleanly once without duplicating primitives.
  const confirm = panel.getByRole("button", { name: "确认并提交" })
  await expect(confirm).toBeEnabled()
  await confirm.dblclick()
  await expect(page.getByText("已提交").last()).toBeVisible()

  const committed = await readCommittedDoc(page, "geometry3d")
  expect(committed).not.toBeNull()
  const committedPrimitivesCount = committed!.primitives.length
  expect(committedPrimitivesCount).toBeGreaterThan(0)
  const expectedHash = await computeSha256(page, committed!)

  // 3. Return to canvas -> Undo clears scene in one step -> Redo restores identical hash.
  await page.getByRole("button", { name: "返回画布" }).click()
  const scene3d = page.locator('[data-3d-scene="true"]')
  await expect(scene3d).toBeVisible()
  await expect(scene3d).toHaveAttribute("data-document-hash", expectedHash)

  await page.getByRole("button", { name: "撤销", exact: true }).click()
  await expect.poll(async () => (await readCommittedDoc(page, "geometry3d"))?.primitives.length ?? -1).toBe(0)

  await page.getByRole("button", { name: "重做", exact: true }).click()
  await expect.poll(async () => (await readCommittedDoc(page, "geometry3d"))?.primitives.length ?? 0).toBe(committedPrimitivesCount)
  await expect(scene3d).toHaveAttribute("data-document-hash", expectedHash)

  // 4. Reload persistence preserves the exact committed primitives & decoded hash.
  await page.reload()
  const reloaded = await readCommittedDoc(page, "geometry3d")
  expect(reloaded).not.toBeNull()
  expect(reloaded!.primitives).toEqual(committed!.primitives)
  const reloadedHash = await computeSha256(page, reloaded!)
  await expect(page.locator('[data-3d-scene="true"]')).toHaveAttribute("data-document-hash", reloadedHash)

  // 5. Save .mgeo -> clear workspace -> re-import saved .mgeo restores exact document hash.
  const downloaded = await savedDownloadDoc(page)
  expect(downloaded.primitives).toEqual(committed!.primitives)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByLabel("加载 .mgeo 文件").setInputFiles({
    name: "roundtrip-solid.mgeo",
    mimeType: "application/json",
    buffer: Buffer.from(encodeMgeo(downloaded))
  })
  const importedHash = await computeSha256(page, downloaded)
  await expect(page.locator('[data-3d-scene="true"]')).toHaveAttribute("data-document-hash", importedHash)
  await page.screenshot({ path: "test-results/t16-solid-lifecycle.png" })
})

test("verifies discard zero-write, cross-conversation isolation, infeasible clarification guard, and bound-point drag undo", async ({ page }) => {
  // 1. Planar conic stage & discard -> zero writes.
  await openAgent(page, "平面几何")
  await sendPrompt(page, CONIC)
  const conicPanel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(conicPanel).toBeVisible({ timeout: 30000 })
  await expect(conicPanel.locator("[data-certificate-status]")).toHaveAttribute("data-certificate-status", "passed")
  await conicPanel.getByRole("button", { name: "丢弃草稿" }).click()
  await expect(page.getByText("无需改动").last()).toBeVisible()
  await expect(conicPanel.getByRole("button", { name: "确认并提交" })).toHaveCount(0)
  const afterDiscard = await readCommittedDoc(page, "conics")
  expect(afterDiscard?.primitives ?? []).toHaveLength(0)

  // 2. Function curve commit + new conversation isolation.
  await sendPrompt(page, FUNCTION_CURVE)
  const fnPanel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(fnPanel).toBeVisible({ timeout: 30000 })
  await fnPanel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交").last()).toBeVisible()

  // New conversation starts fresh without leaking previous confirmation panel or transcript.
  await page.getByRole("button", { name: "新建对话" }).click()
  await expect(page.getByRole("region", { name: "确认改动" })).toHaveCount(0)
  await expect(page.getByRole("log", { name: "对话记录" })).toContainText("把数学想法，画出来。")

  // 3. Contradictory/underdetermined prompt refuses auto-commit (clarification/no confirm button).
  const beforeConflictCount = (await readCommittedDoc(page, "conics"))?.primitives.length ?? 0
  expect(beforeConflictCount).toBeGreaterThan(0)
  await sendPrompt(page, "平面三角形 ABC 中，AB=3 且 AB=5")
  await expect(page.locator("[data-message-role='assistant']").last().locator(".agent-bubble-pending")).toHaveCount(0, { timeout: 15000 })
  await expect(page.getByRole("region", { name: "确认改动" })).toHaveCount(0)
  const afterConflict = await readCommittedDoc(page, "conics")
  expect(afterConflict?.primitives.length ?? 0).toBe(beforeConflictCount)

  // 4. Driven bound-point drag in 3D + one-step undo integrity on solid prism GK-S05.
  await openAgent(page, "立体几何")
  await sendPrompt(page, BOUND_POINT_PROMPT)
  const prismPanel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(prismPanel).toBeVisible({ timeout: 30000 })
  await expect(prismPanel.locator("[data-certificate-status]")).toHaveAttribute("data-certificate-status", "passed")
  await prismPanel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交").last()).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()

  const prismCommitted = await readCommittedDoc(page, "geometry3d")
  const pointB2 = prismCommitted?.primitives.find((p) => p.type === "point3" && p.label === "B₂")
  expect(pointB2?.type).toBe("point3")
  if (pointB2?.type === "point3") {
    const start = await projectWorldPoint(page, pointB2.position)
    const target = await projectWorldPoint(page, { x: pointB2.position.x, y: pointB2.position.y, z: pointB2.position.z + 1 })
    await page.locator(".algebra-panel").getByText("B₂", { exact: true }).first().click()
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => Number(await page.getByRole("spinbutton", { name: "坐标 Z" }).inputValue())).toBeGreaterThan(pointB2.position.z + 0.3)

    // One-step Undo reverts bound-point drag back to exact committed Z coordinate.
    await page.getByRole("button", { name: "撤销", exact: true }).click()
    await expect.poll(async () => Number(await page.getByRole("spinbutton", { name: "坐标 Z" }).inputValue())).toBeCloseTo(pointB2.position.z, 2)
  }
  await page.screenshot({ path: "test-results/t16-bound-drag-lifecycle.png" })
})
