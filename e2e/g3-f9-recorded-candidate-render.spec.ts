import { createBudget } from "@draw/agent-core"
import { encodeMgeo } from "@draw/dsl"
import { expect, test } from "@playwright/test"

import { runFrozenDsCaseTraced, type VerifiedFrozenCandidate } from "../apps/web/src/agent/fixtures/g3DsFrozenCaseRunner"
import suite from "../test-fixtures/reliability/drawing-contracts-36.json"
import type { DrawingContractCase } from "../scripts/reliability-eval/drawingContracts"

const frozen = (suite as { cases: DrawingContractCase[] }).cases.find((item) => item.id === "GK-S09")!

test("recorded ds_action GK-S09 candidate is rendered as the same certified prism and sphere", async ({ page }) => {
  let turn = 0
  const candidates: VerifiedFrozenCandidate[] = []
  const outcome = await runFrozenDsCaseTraced(
    { id: frozen.id, prompt: frozen.prompt, workspace: "geometry3d" },
    createBudget({ network: 8, generation: 8, tool: 12 }),
    {
      intentMode: "ds_action",
      resolveProvider: async () => ({ ok: true, provider: {
        id: "recorded-provider", modelId: "recorded", dialect: "openai", revision: 1,
        capabilities: { tools: "verified", json: "verified", vision: "unknown" }
      } }),
      runModel: async () => {
        turn += 1
        const sequence = [
          { toolId: "construct_solid", input: { id: "prism", kind: "triangular_prism", symbol: "a", displayScale: 2,
            vertexNames: ["A", "B", "C", "A₁", "B₁", "C₁"] } },
          { toolId: "construct_circumsphere", input: { id: "sphere", solidId: "prism" } },
          { toolId: "finish_candidate", input: { goal: "right triangular prism and circumsphere" } }
        ] as const
        const action = sequence[Math.min(turn - 1, sequence.length - 1)]!
        return { ok: true, events: [{ kind: "tool_call" as const, requestId: `r-${turn}`, attemptId: `a-${turn}`,
          toolCallId: `tc-${turn}`, toolId: action.toolId, input: action.input }] }
      }
    },
    { contract: frozen, revision: "recorded-e2e", runId: "gks09-e2e", onTrace: () => {},
      onVerifiedCandidate: (candidate) => candidates.push(candidate) }
  )
  expect(outcome.contractStatus).toBe("passed")
  expect(outcome.candidateSet[0]?.certificateStatus).toBe("passed")
  expect(candidates).toHaveLength(1)
  const candidate = candidates[0]!
  expect(candidate.candidateHash).toBe(outcome.candidateSet[0]?.candidateHash)
  expect(candidate.document.primitives.some((primitive) => primitive.type === "polyhedron3")).toBe(true)
  expect(candidate.document.primitives.some((primitive) => primitive.type === "sphere")).toBe(true)

  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.locator('input[aria-label="加载 .mgeo 文件"]').setInputFiles({
    name: "recorded-gks09.mgeo", mimeType: "application/json", buffer: Buffer.from(encodeMgeo(candidate.document))
  })
  const scene = page.locator('[data-3d-scene="true"]')
  await expect(scene).toBeVisible()
  await expect(scene).toHaveAttribute("data-canvas-evidence-status", "passed")
  await expect(scene).toHaveAttribute("data-canvas-evidence-accepted", "true")
  await expect(scene).toHaveAttribute("data-render-evidence-tier", "rendered")
  await expect(scene).toHaveAttribute("data-document-hash", candidate.candidateHash)
  await expect(scene).toHaveAttribute("data-candidate-hash", candidate.candidateHash)
  expect(Number(await scene.getAttribute("data-canvas-boxes"))).toBeGreaterThan(0)
  expect(Number(await scene.getAttribute("data-canvas-labels"))).toBeGreaterThanOrEqual(6)
  await expect(scene).toHaveAttribute("data-canvas-objects-measurable", "true")
  await expect(scene).toHaveAttribute("data-canvas-hidden-labels", "")
  await expect(scene).toHaveAttribute("data-canvas-diagnostic-errors", "")
})
