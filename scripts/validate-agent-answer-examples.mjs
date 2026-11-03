import { readFile, writeFile, mkdir } from "node:fs/promises"
import { fileURLToPath, URL } from "node:url"
import path from "node:path"
import { createServer } from "vite"

// Independent expected values live in the fixture; this evaluates results, not full proofs.
// Default: diagnostic report. --strict: nonzero exit when any expected result is missing.
const root = fileURLToPath(new URL("../", import.meta.url))
const examples = JSON.parse(await readFile(path.join(root, "test-fixtures/agent-answer-validation-20261102.json"), "utf8"))
const server = await createServer({ root, configFile: false, server: { middlewareMode: true }, appType: "custom" })
try {
  const { solveRectangleFold } = await server.ssrLoadModule("/packages/agent-core/src/rectangleFoldPlan.ts")
  const results = examples.map((example) => {
    const solved = solveRectangleFold(example.prompt)
    const findings = solved.findings ?? []
    const lengths = findings.filter((finding) => finding.kind === "length").map((finding) => finding.value)
    const numericValues = example.expectedKind === "angle" ? [solved.geometry?.angleDegrees] : lengths
    const numbersMatch = numericValues.length === example.values.length && numericValues.every((value, i) => Number.isFinite(value) && Math.abs(value - example.values[i]) <= 1e-8 * Math.max(1, Math.abs(example.values[i])))
    const verdict = example.expectedKind === "inconsistent" ? solved.code === "inconsistent_conditions"
      : example.expectedKind === "clarify" ? solved.status === "clarification" && solved.reason === "needs_fold_angle"
      : example.expectedKind === "refute" ? numbersMatch && findings.some((finding) => finding.status === "disproved")
      : example.expectedKind === "true" ? numbersMatch && findings.some((finding) => finding.status === "holds")
      : numbersMatch
    return { ...example, corePass: verdict, status: solved.status, code: solved.code, angleDegrees: solved.geometry?.angleDegrees, lengths, answer: solved.answer ?? solved.plan?.answer, explanation: solved.reason ?? solved.questions, findings }
  })
  const directory = path.join(root, "output/playwright/agent-answer-validation")
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "core-results.json"), JSON.stringify(results, null, 2) + "\n")
  for (const result of results) console.log(`${result.id} ${result.corePass ? "PASS" : "REVIEW"} ${result.name}: ${result.status}; ${JSON.stringify(result.lengths)}${result.explanation ? `; ${result.explanation}` : ""}`)
  console.log(`Core oracle: ${results.filter((result) => result.corePass).length}/${results.length}; browser answer delivery must be checked separately.`)
  if (process.argv.includes("--strict") && results.some((result) => !result.corePass)) process.exitCode = 1
} finally {
  await server.close()
}
