import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath, URL } from "node:url"

export function parseSolidEvalArgs(args) {
  const options = { allowPaid: false, suite: "all" }
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i]
    if (flag === "--help") return { help: true }
    if (flag === "--allow-paid") { options.allowPaid = true; continue }
    const field = { "--max-requests": "maxRequests", "--timeout-ms": "timeoutMs", "--max-tokens": "maxTokens", "--suite": "suite", "--replay": "replay" }[flag]
    if (!field || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Unknown or incomplete option: ${flag}`)
    options[field] = args[++i]
  }
  if (!["all", "solid30", "folds"].includes(options.suite)) throw new Error("--suite must be all, solid30 or folds")
  if (options.replay) {
    if (options.allowPaid || options.maxRequests) throw new Error("Replay does not accept paid-run options")
    return options
  }
  if (!options.allowPaid || options.maxRequests === undefined) throw new Error("Live evaluation requires --allow-paid --max-requests N; replay uses --replay FILE")
  for (const [field, minimum, maximum] of [["maxRequests", 1, 60], ["timeoutMs", 100, 180000], ["maxTokens", 1, 131072]]) {
    if (options[field] === undefined) continue
    const value = Number(options[field])
    if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${field}: expected integer ${minimum}..${maximum}`)
  }
  return options
}

const root = fileURLToPath(new URL("../../", import.meta.url))
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseSolidEvalArgs(process.argv.slice(2))
    if (options.help) {
      console.log("Live: npm run eval:solid -- --allow-paid --max-requests N [--suite solid30|folds|all] [--timeout-ms 60000] [--max-tokens 4096]\nOffline: npm run eval:solid -- --replay eval-results/solid/RUN.json")
    } else {
      if (!options.replay && !process.env.DEEPSEEK_API_KEY?.trim()) throw new Error("DEEPSEEK_API_KEY is required")
      const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" })
      const env = { ...process.env, MATHCANVAS_SOLID_EVAL_REVISION: revision.status === 0 ? revision.stdout.trim() : "unknown" }
      // Erase inherited mode flags; each invocation chooses exactly one mode.
      delete env.MATHCANVAS_SOLID_EVAL_PAID
      delete env.MATHCANVAS_SOLID_EVAL_REPLAY
      if (options.replay) env.MATHCANVAS_SOLID_EVAL_REPLAY = path.resolve(options.replay)
      else Object.assign(env, { MATHCANVAS_SOLID_EVAL_PAID: "1", DEEPSEEK_MAX_REQUESTS: options.maxRequests,
        MATHCANVAS_SOLID_EVAL_SUITE: options.suite,
        ...(options.timeoutMs === undefined ? {} : { DEEPSEEK_TIMEOUT_MS: options.timeoutMs }),
        ...(options.maxTokens === undefined ? {} : { DEEPSEEK_MAX_TOKENS: options.maxTokens }) })
      const runName = `${options.replay ? "replay" : options.suite}-${new Date().toISOString().replaceAll(":", "-")}-${process.pid}.json`
      env.MATHCANVAS_SOLID_EVAL_REPORT = path.join(root, "eval-results", "solid", runName)
      const result = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.solid-eval.config.ts"], { cwd: root, env, stdio: "inherit" })
      console.log(`Report path: ${env.MATHCANVAS_SOLID_EVAL_REPORT}`)
      process.exitCode = result.status ?? 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  }
}
