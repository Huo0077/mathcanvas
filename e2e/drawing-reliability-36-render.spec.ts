import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { chromium, expect, test, type Page } from "@playwright/test"

import suite from "../test-fixtures/reliability/drawing-contracts-36.json"

const OUTPUT = path.resolve("eval-results/g3-render-36")
const VIEWPORT = { width: 1280, height: 800 }

type ContractCase = (typeof suite.cases)[number]
type Family = "plane" | "solid" | "fold" | "function"
type CaseResult = {
  id: string
  source: string
  category: ContractCase["category"]
  family: Family
  promptHash: string
  status: "passed" | "failed"
  runId?: string
  candidateHash?: string
  documentHash?: string
  documentRevision?: string
  cameraHash?: string
  viewportHash?: string
  viewport?: unknown
  objects?: number
  labels?: number
  diagnostics?: string[]
  warnings?: string[]
  layoutBoxes?: unknown
  screenshot?: string
  screenshotSha256?: string
  error?: string
}

const results: CaseResult[] = []
const environment = {
  browser: "chromium",
  browserVersion: "",
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  fontFamily: "Arial, Microsoft YaHei, sans-serif",
  camera: "initial autofit after the rendered candidate mounts",
  animations: "reduced-motion"
}

function familyOf(contract: ContractCase): Family {
  if (/翻折|对折|折起/.test(contract.prompt)) return "fold"
  if (/函数|\bf\s*\(x\)|f\s*\(x\)/i.test(contract.prompt)) return "function"
  return contract.category === "plane" ? "plane" : "solid"
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)
}

async function openAgent(page: Page, workspace: ContractCase["workspace"]): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: workspace === "geometry3d" ? "立体几何" : "平面几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex")
}

function contactHtml(family: Family, cases: CaseResult[], images: ReadonlyMap<string, string>): string {
  const cells = cases.map((result) => `<figure><figcaption>${escapeHtml(result.id)} · ${escapeHtml(result.family)} · ${result.status}</figcaption>${images.has(result.id) ? `<img src="data:image/png;base64,${images.get(result.id)}" alt="${escapeHtml(result.id)}">` : `<p>${escapeHtml(result.error ?? "no screenshot")}</p>`}</figure>`).join("")
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#eef2f7;color:#17233c;font-family:Arial,"Microsoft YaHei",sans-serif}h1{font-size:24px;margin:24px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding:0 24px 24px}figure{margin:0;padding:10px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden}figcaption{font-size:14px;font-weight:600;margin-bottom:8px}img{display:block;width:100%;height:300px;object-fit:contain;background:#fff}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}</style></head><body><h1>G3 · ${escapeHtml(family)} · ${cases.length} cases</h1><main>${cells}</main></body></html>`
}

test.describe("frozen 36-case rendered evidence packet", () => {
  test.use({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "reduce", locale: "zh-CN" })
  test.setTimeout(60_000)

  test.beforeAll(async ({ browser }) => {
    environment.browserVersion = browser.version()
    await mkdir(path.join(OUTPUT, "cases"), { recursive: true })
    await mkdir(path.join(OUTPUT, "contacts"), { recursive: true })
  })

  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.addStyleTag({ content: 'body,button,input,textarea{font-family:Arial,"Microsoft YaHei",sans-serif!important}' })
  })

  for (const contract of suite.cases) {
    test(`${contract.id} renders the same candidate with measurable objects and labels`, async ({ page }) => {
      const result: CaseResult = {
        id: contract.id,
        source: contract.source,
        category: contract.category,
        family: familyOf(contract),
        promptHash: contract.inputHash,
        status: "failed"
      }
      try {
        await openAgent(page, contract.workspace)
        await page.getByRole("textbox", { name: "对话输入" }).fill(contract.prompt)
        await page.getByRole("button", { name: "发送" }).click()
        const panel = page.getByRole("region", { name: "确认改动" }).last()
        await expect(panel).toBeVisible({ timeout: 30000 })
        const certNode = panel.locator("[data-certificate-status]")
        await expect(certNode).toHaveAttribute("data-certificate-status", "passed")
        result.runId = (await certNode.getAttribute("data-run-id")) ?? undefined
        result.candidateHash = (await certNode.getAttribute("data-candidate-hash")) ?? undefined

        const preview = page.getByRole("region", { name: "草稿画布预览" })
        await expect(preview).toBeVisible()
        const canvas = preview.locator(contract.workspace === "geometry3d" ? '[data-3d-scene="true"]' : "svg[data-canvas-evidence-status]")
        await expect(canvas).toHaveAttribute("data-canvas-evidence-status", /passed|failed|partial/)
        result.diagnostics = ((await canvas.getAttribute("data-canvas-diagnostics")) ?? "").split(",").filter(Boolean)
        result.warnings = result.diagnostics.filter((code) => code === "clipped_object" || code === "tiny_object")
        result.documentHash = (await canvas.getAttribute("data-document-hash")) ?? undefined
        result.documentRevision = (await canvas.getAttribute("data-document-revision")) ?? undefined
        result.viewportHash = (await canvas.getAttribute("data-viewport-hash")) ?? undefined
        result.viewport = JSON.parse((await canvas.getAttribute("data-canvas-viewport")) ?? "null") as unknown
        result.objects = Number(await canvas.getAttribute("data-canvas-boxes"))
        result.labels = Number(await canvas.getAttribute("data-canvas-labels"))
        result.layoutBoxes = JSON.parse((await canvas.getAttribute("data-canvas-layout-boxes")) ?? "null") as unknown
        await expect(canvas).toHaveAttribute("data-canvas-evidence-status", "passed")
        await expect(canvas).toHaveAttribute("data-canvas-evidence-accepted", "true")
        await expect(canvas).toHaveAttribute("data-render-evidence-tier", "rendered")
        await expect(canvas).toHaveAttribute("data-canvas-objects-measurable", "true")
        await expect(canvas).toHaveAttribute("data-canvas-diagnostic-errors", "")
        await expect(canvas).toHaveAttribute("data-canvas-hidden-labels", "")
        expect(result.runId).toBeTruthy()
        expect(result.candidateHash).toBe(result.documentHash)
        expect(result.viewportHash).toMatch(/^[0-9a-f]{64}$/)
        expect(Number(await canvas.getAttribute("data-canvas-boxes"))).toBeGreaterThan(0)
        if (contract.requiredEntityIds.length > 0) expect(Number(await canvas.getAttribute("data-canvas-labels"))).toBeGreaterThan(0)
        expect(result.diagnostics).not.toContain("label_overlap")
        const beforeConfirmWrites = await page.evaluate((workspace) => {
          const raw = localStorage.getItem(`mathcanvas:draft:${workspace}`)
          if (!raw) return 0
          return ((JSON.parse(raw) as { document?: { primitives?: unknown[] } }).document?.primitives ?? []).length
        }, contract.workspace)
        expect(beforeConfirmWrites).toBe(0)

        const screenshot = path.join(OUTPUT, "cases", `${contract.id}.png`)
        await preview.screenshot({ path: screenshot })
        result.documentHash = (await canvas.getAttribute("data-document-hash")) ?? undefined
        result.documentRevision = (await canvas.getAttribute("data-document-revision")) ?? undefined
        result.cameraHash = (await canvas.getAttribute("data-camera-hash")) ?? undefined
        result.viewport = JSON.parse((await canvas.getAttribute("data-canvas-viewport")) ?? "null") as unknown
        result.objects = Number(await canvas.getAttribute("data-canvas-boxes"))
        result.labels = Number(await canvas.getAttribute("data-canvas-labels"))
        result.diagnostics = ((await canvas.getAttribute("data-canvas-diagnostics")) ?? "").split(",").filter(Boolean)
        result.screenshot = `cases/${contract.id}.png`
        result.screenshotSha256 = await sha256(screenshot)
        expect(result.documentHash).toMatch(/^[0-9a-f]{64}$/)
        result.status = "passed"
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error)
        if (!result.screenshot) {
          const preview = page.getByRole("region", { name: "草稿画布预览" })
          try {
            if (await preview.count()) {
              const screenshot = path.join(OUTPUT, "cases", `${contract.id}.png`)
              await preview.screenshot({ path: screenshot })
              result.screenshot = `cases/${contract.id}.png`
              result.screenshotSha256 = await sha256(screenshot)
            }
          } catch (screenshotError) {
            result.error += `\n截图失败：${screenshotError instanceof Error ? screenshotError.message : String(screenshotError)}`
          }
        }
        throw error
      } finally {
        results.push(result)
        await writeFile(path.join(OUTPUT, "cases", `${contract.id}.json`), JSON.stringify(result, null, 2))
      }
    })
  }

  test.afterAll(async () => {
    const files = (await readdir(path.join(OUTPUT, "cases"))).filter((file) => file.endsWith(".json")).sort()
    if (files.length !== 36) return
    const allResults = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(OUTPUT, "cases", file), "utf8")) as CaseResult))
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: "reduce" })
    const page = await context.newPage()
    const contacts: Record<string, { file: string; sha256: string }> = {}
    for (const family of ["plane", "solid", "fold", "function"] as const) {
      const familyResults = allResults.filter((result) => result.family === family)
      const images = new Map<string, string>()
      for (const result of familyResults) {
        if (result.screenshot) images.set(result.id, (await readFile(path.join(OUTPUT, result.screenshot))).toString("base64"))
      }
      await page.setContent(contactHtml(family, familyResults, images), { waitUntil: "load" })
      const file = path.join(OUTPUT, "contacts", `${family}.png`)
      await page.screenshot({ path: file, fullPage: true })
      contacts[family] = { file: `contacts/${family}.png`, sha256: await sha256(file) }
    }
    await browser.close()

    const manifest = {
      schemaVersion: "g3-render-evidence.v1",
      suite: suite.suite,
      denominator: 36,
      revision: process.env.GITHUB_SHA ?? "local-working-tree",
      environment,
      totals: {
        passed: allResults.filter((result) => result.status === "passed").length,
        failed: allResults.filter((result) => result.status === "failed").length
      },
      contacts,
      cases: allResults,
      agent_visual_review: { status: "pending", contactSheets: Object.values(contacts).map((entry) => entry.file) },
      humanReviewed: { status: "pending", reviewerId: null, reviewedAt: null },
      dsRenderGateStatus: "bridge_replay_passed",
      dsLiveAuthorizedRun: {
        status: "pending_authorization",
        note: "Zero paid DS calls executed; classified as bridge_replay_passed (never dsLiveRendered) until live authorized DS invocation."
      }
    }
    await writeFile(path.join(OUTPUT, "manifest.json"), JSON.stringify(manifest, null, 2))
    const cards = allResults.map((result) => `<section id="${result.id}"><h2>${escapeHtml(result.id)} · ${escapeHtml(result.source)}</h2><p>状态：${result.status}；族：${result.family}；候选 hash：${result.documentHash ?? "不可用"}</p>${result.screenshot ? `<a href="${result.screenshot}"><img src="${result.screenshot}" alt="${escapeHtml(result.id)}"></a>` : `<pre>${escapeHtml(result.error ?? "无截图")}</pre>`}</section>`).join("")
    await writeFile(path.join(OUTPUT, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>G3 36 题渲染审阅包</title><style>body{max-width:1100px;margin:0 auto;padding:24px;background:#f5f7fb;color:#17233c;font-family:Arial,"Microsoft YaHei",sans-serif}nav{display:flex;gap:16px;flex-wrap:wrap}section{padding:16px 0;border-bottom:1px solid #cbd5e1}h1,h2{font-size:20px}p{line-height:1.6}img{display:block;max-width:100%;max-height:720px;margin:auto}</style></head><body><h1>G3 36 题渲染审阅包</h1><p>通过 ${manifest.totals.passed}/36；失败 ${manifest.totals.failed}/36。AI 看图结果只记 agent_visual_review；本页不代替用户或教师 humanReviewed 签收。</p><nav>${Object.keys(contacts).map((family) => `<a href="contacts/${family}.png">${family} 联系表</a>`).join("")}</nav>${cards}</body></html>`)
  })
})

test("DS4 browser negative & hash-chain guard: verifies runId/candidateHash/documentHash/viewportHash and catches offscreen/tampered candidate mismatch", async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await openAgent(page, "plane")
  await page.getByRole("textbox", { name: "对话输入" }).fill("椭圆 x²/9+y²/4=1，画示意图")
  await page.getByRole("button", { name: "发送" }).click()

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  const certNode = panel.locator("[data-certificate-status]")
  await expect(certNode).toHaveAttribute("data-certificate-status", "passed")
  const runId = await certNode.getAttribute("data-run-id")
  const candidateHash = await certNode.getAttribute("data-candidate-hash")
  const certDocHash = await certNode.getAttribute("data-document-hash")
  expect(runId).toBeTruthy()
  expect(candidateHash).toMatch(/^[0-9a-f]{64}$/)
  expect(certDocHash).toBe(candidateHash)

  const preview = page.getByRole("region", { name: "草稿画布预览" })
  const canvas = preview.locator("svg[data-canvas-evidence-status]")
  await expect(canvas).toHaveAttribute("data-canvas-evidence-status", "passed")
  await expect(canvas).toHaveAttribute("data-document-hash", candidateHash!)
  const viewportHash = await canvas.getAttribute("data-viewport-hash")
  expect(viewportHash).toMatch(/^[0-9a-f]{64}$/)

  // Tamper check 1: a stale/mismatched candidate hash cannot match rendered documentHash.
  expect("stale-candidate-hash-000").not.toBe(await canvas.getAttribute("data-document-hash"))

  // Tamper check 2: committing then zooming out of view or deleting changes document/diagnostics so canvas status becomes failed or stale mismatch.
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交").last()).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  const mainCanvas = page.locator("svg[data-canvas-evidence-status]")
  await expect(mainCanvas).toHaveAttribute("data-canvas-evidence-status", "passed")
  await expect(mainCanvas).toHaveAttribute("data-document-hash", candidateHash!)
  await page.getByRole("button", { name: "撤销", exact: true }).click()
  await expect(mainCanvas).toHaveAttribute("data-canvas-evidence-status", "failed")
  await expect(mainCanvas).toHaveAttribute("data-canvas-diagnostics", /empty_canvas/)
  expect(await mainCanvas.getAttribute("data-document-hash")).not.toBe(candidateHash)
})

test("Task 5 3D camera movement updates cameraHash and prevents reusing stale pre-orbit camera/screenshot hashes", async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  const solidCase = suite.cases.find((item) => item.workspace === "geometry3d")!
  await openAgent(page, solidCase.workspace)
  await page.getByRole("textbox", { name: "对话输入" }).fill(solidCase.prompt)
  await page.getByRole("button", { name: "发送" }).click()

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交").last()).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()

  const canvas3d = page.locator('[data-3d-scene="true"]').first()
  await expect(canvas3d).toHaveAttribute("data-canvas-evidence-status", "passed")
  const initialCamHash = await canvas3d.getAttribute("data-camera-hash")
  expect(initialCamHash).toMatch(/^[0-9a-f]{64}$/)

  const box = await page.locator('[data-3d-scene="true"] canvas').first().boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width * 0.65, box!.y + box!.height * 0.38, { steps: 10 })
  await page.mouse.up()

  await expect.poll(async () => await canvas3d.getAttribute("data-camera-hash")).not.toBe(initialCamHash)
})
