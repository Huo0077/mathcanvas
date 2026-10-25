import { expect, it } from "vitest"
import { readSolidReport, writeSolidReport } from "../../../../../scripts/solid-eval/report-files.mjs"
import { FOLD_PROBLEMS, SOLID_PROBLEMS } from "./examSolid30.problems"
import { replaySolidReport, runSolidEvaluation } from "./solidModelEval"
import { solidEvalConfig } from "./solidEvalTransport"

declare const process: { env: Record<string, string | undefined> }
const env = process.env
const replay = env.MATHCANVAS_SOLID_EVAL_REPLAY
// This configuration is explicit-only. Missing authorization is an error, never a silent 0/30.
const config = replay ? undefined : solidEvalConfig(env)

it(replay ? "replays saved solid plans offline" : "evaluates solid plans with bounded, explicit paid requests", async ({ signal }) => {
  const filename = env.MATHCANVAS_SOLID_EVAL_REPORT
  if (!filename) throw new Error("Use npm run eval:solid to select a unique report file")
  if (replay) {
    const report = replaySolidReport(await readSolidReport(replay))
    await writeSolidReport(filename, { ...report, replayedAt: new Date().toISOString(), replayRevision: env.MATHCANVAS_SOLID_EVAL_REVISION }, [env.DEEPSEEK_API_KEY ?? ""])
    console.log(`Offline replay: ${JSON.stringify(report.summary)}\nReport: ${filename}`)
    return
  }
  const suite = env.MATHCANVAS_SOLID_EVAL_SUITE ?? "all"
  if (!["all", "solid30", "folds"].includes(suite)) throw new Error("Invalid evaluation suite")
  const problems = suite === "solid30" ? SOLID_PROBLEMS : suite === "folds" ? FOLD_PROBLEMS : [...SOLID_PROBLEMS, ...FOLD_PROBLEMS]
  const report = await runSolidEvaluation({ config: config!, problems, signal,
    sourceRevision: env.MATHCANVAS_SOLID_EVAL_REVISION ?? "unknown",
    save: snapshot => writeSolidReport(filename, snapshot, [config!.apiKey]) })
  console.log(`Evaluation: ${JSON.stringify(report.summary)}\nRequests: ${report.requests}; tokens: ${report.inputTokens}/${report.outputTokens}\nReport: ${filename}`)
  expect(report.requests).toBeLessThanOrEqual(config!.maxRequests)
}, config === undefined ? 60000 : config.maxRequests * (config.timeoutMs + 5000) + 30000)
