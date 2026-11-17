import { expect, test, type Page } from "@playwright/test"

const FIXED_VIEWPORT = { width: 1280, height: 800 }

const CONIC = "椭圆 x²/9+y²/4=1 与直线 y=0 相交于 A、B 两点"
const PLANAR_TRIANGLE = "平面三角形ABC中，AB=8，∠BAC=30°，△ABC的面积为6"
const FUNCTION_CURVE = "画出 f(x)=x³−3x 的图像与它在 x=1 处的切线"
const SOLID_FOLD = [
  "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。",
  "点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。",
  "将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。"
].join("")

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

async function runAndCommit(page: Page, prompt: string, workspace: "平面几何" | "立体几何"): Promise<void> {
  await openAgent(page, workspace)
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交").last()).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
}

async function readCanvasEvidence(page: Page, mode: "2d" | "3d" = "2d") {
  return page.evaluate((targetMode) => {
    const root = targetMode === "3d"
      ? document.querySelector('[data-3d-scene="true"]')
      : document.querySelector("svg[data-canvas-evidence-status]") ?? document.querySelector("[data-canvas-evidence-status]")
    if (!root) throw new Error(`missing rendered canvas root for ${targetMode}`)
    const get = (k: string) => root.getAttribute(k) ?? ""
    return {
      status: get("data-canvas-evidence-status"),
      accepted: get("data-canvas-evidence-accepted"),
      hash: get("data-document-hash"),
      revision: get("data-document-revision"),
      boxes: Number(get("data-canvas-boxes")),
      labels: Number(get("data-canvas-labels")),
      diagnostics: get("data-canvas-diagnostics"),
      errors: get("data-canvas-diagnostic-errors"),
      hidden: get("data-canvas-hidden-labels"),
      measurable: get("data-canvas-objects-measurable"),
      tier: get("data-render-evidence-tier")
    }
  }, mode)
}

async function readCommittedDoc(page: Page, storageKey: "conics" | "geometry3d"): Promise<unknown> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(`mathcanvas:draft:${key}`)
    if (!raw) throw new Error(`missing draft storage for ${key}`)
    return (JSON.parse(raw) as { document?: unknown }).document
  }, storageKey)
}

test.use({ viewport: FIXED_VIEWPORT, deviceScaleFactor: 1 })

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("verifies live rendered evidence & hash alignment across planar, conic, function, and 3D solid families", async ({ page }) => {
  // 1. Conic family
  await runAndCommit(page, CONIC, "平面几何")
  const conicEv = await readCanvasEvidence(page)
  const conicDoc = await readCommittedDoc(page, "conics")
  expect(conicEv.status).toBe("passed")
  expect(conicEv.accepted).toBe("true")
  expect(conicEv.hash).toBe(await computeSha256(page, conicDoc))
  expect(conicEv.boxes).toBeGreaterThan(0)
  expect(conicEv.labels).toBeGreaterThan(0)
  expect(conicEv.hidden).toBe("")
  expect(conicEv.errors).toBe("")
  expect(conicEv.tier).toBe("rendered")
  await page.screenshot({ path: "test-results/t15-conic-rendered.png" })

  // Undo clears and invalidates canvas evidence
  await page.keyboard.press("Control+z")
  await expect.poll(async () => (await readCanvasEvidence(page, "2d")).status).toBe("failed")

  // 2. Planar triangle family (renders in 3D canvas with point labels A, B, C)
  await runAndCommit(page, PLANAR_TRIANGLE, "平面几何")
  await expect(page.locator('[data-3d-scene="true"]')).toBeVisible()
  const triEv = await readCanvasEvidence(page, "3d")
  const triDoc = await readCommittedDoc(page, "geometry3d")
  expect(triEv.status).toBe("passed")
  expect(triEv.measurable).toBe("true")
  expect(triEv.boxes).toBeGreaterThan(0)
  expect(triEv.hash).toBe(await computeSha256(page, triDoc))
  expect(triEv.labels).toBe(3)
  expect(triEv.hidden).toBe("")
  expect(triEv.diagnostics).not.toContain("label_overlap")
  expect(triEv.tier).toBe("rendered")
  await page.screenshot({ path: "test-results/t15-planar-rendered.png" })

  // 3. Function + tangent family (renders in 2D SVG canvas)
  await page.keyboard.press("Control+z")
  await runAndCommit(page, FUNCTION_CURVE, "平面几何")
  const fnEv = await readCanvasEvidence(page, "2d")
  const fnDoc = await readCommittedDoc(page, "conics")
  expect(fnEv.status).toBe("passed")
  expect(fnEv.hash).toBe(await computeSha256(page, fnDoc))
  expect(fnEv.boxes).toBeGreaterThan(0)
  expect(fnEv.tier).toBe("rendered")
  await page.screenshot({ path: "test-results/t15-function-rendered.png" })

  // 4. 3D solid fold family
  await runAndCommit(page, SOLID_FOLD, "立体几何")
  await expect(page.locator('[data-3d-scene="true"]')).toBeVisible()
  const solidEv = await readCanvasEvidence(page, "3d")
  const solidDoc = await readCommittedDoc(page, "geometry3d")
  expect(solidEv.hash).toBe(await computeSha256(page, solidDoc))
  expect(solidEv.measurable).toBe("true")
  expect(solidEv.status).toBe("passed")
  expect(solidEv.boxes).toBeGreaterThan(0)
  expect(solidEv.labels).toBe(7)
  expect(solidEv.hidden).toBe("")
  expect(solidEv.diagnostics).not.toContain("label_overlap")
  expect(solidEv.tier).toBe("rendered")
  await page.screenshot({ path: "test-results/t15-solid-fold-rendered.png" })
})

test("rejects negative rendered states when objects clip out of canvas, labels go missing, or hash mismatches", async ({ page }) => {
  await runAndCommit(page, CONIC, "平面几何")
  const validEv = await readCanvasEvidence(page, "2d")
  expect(validEv.status).toBe("passed")
  expect(validEv.tier).toBe("rendered")

  // Hide a rendered point label in DOM -> rendered label count check detects hidden label
  const hiddenLabelCount = await page.evaluate(() => {
    const svg = document.querySelector("svg[data-canvas-evidence-status]")
    if (!svg) return -1
    const labels = [...svg.querySelectorAll('[data-primitive-type="point"] text')]
    if (labels[0]) labels[0].setAttribute("hidden", "true")
    return labels.filter((el) => !el.closest("[hidden]")).length
  })
  expect(hiddenLabelCount).toBe(1)

  // Undo moves scene to empty -> DOM evidence must immediately reject with empty_canvas
  await page.keyboard.press("Control+z")
  await expect.poll(async () => (await readCanvasEvidence(page, "2d")).status).toBe("failed")
  const emptyEv = await readCanvasEvidence(page, "2d")
  expect(emptyEv.errors).toContain("empty_canvas")
  expect(emptyEv.accepted).toBe("false")
  expect(emptyEv.hash).not.toBe(validEv.hash)
})

test("renders the complete staged 2D candidate and binds evidence before confirmation", async ({ page }) => {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "平面几何" }).click()
  const canvas = page.locator("svg[data-canvas-evidence-status]")
  const baseHash = await canvas.getAttribute("data-document-hash")

  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill(CONIC)
  await page.getByRole("button", { name: "发送" }).click()
  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  await page.getByRole("button", { name: "返回画布" }).click()

  await expect(page.getByRole("region", { name: "AI 草稿预览" })).toBeVisible()
  await expect(canvas.locator('[data-primitive-type="ellipse"]')).toHaveCount(1)
  await expect(canvas).toHaveAttribute("data-canvas-evidence-status", "passed")
  await expect(canvas).toHaveAttribute("data-canvas-evidence-accepted", "true")
  expect(await canvas.getAttribute("data-document-hash")).not.toBe(baseHash)

  await page.getByRole("button", { name: "✓ 确认写入 (Enter)" }).click()
  await expect(page.getByRole("region", { name: "AI 草稿预览" })).toHaveCount(0)
})
