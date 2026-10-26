import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath, URL } from "node:url"

/**
 * **`npm run eval:reliability` 的入口**（T01，2026-10-26）。
 *
 * 三种模式互相排斥：
 * - `--offline`（缺省）：确定性本地规划器，**不产生任何费用**；
 * - `--replay FILE`：回放记录的逐轮信封（不会补出记录里没有的轮次）；
 * - `--allow-paid --max-requests N`：真实 provider。必须另有 `DEEPSEEK_API_KEY`；
 *   缺一样就**拒绝启动**（不是跑到一半才失败）。
 *
 * 报告目录每次唯一（`eval-results/reliability/<mode>-<时间>-<pid>/`），
 * 里面逐题一个 JSON（原子写入）+ `summary.json` + `replay.json`。
 * 真实费用今天无法可靠计量 ⇒ 报告里 `costUsd: null`、`costKnown: false`，**不写 0**。
 */
export function parseReliabilityArgs(args) {
  const options = { mode: "offline" }
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === "--help") return { help: true }
    if (flag === "--offline") {
      options.mode = "offline"
      continue
    }
    if (flag === "--allow-paid") {
      options.mode = "live"
      continue
    }
    const field = { "--replay": "replay", "--max-requests": "maxRequests", "--out": "out", "--cases": "cases" }[flag]
    if (!field || args[index + 1] === undefined || args[index + 1].startsWith("--")) throw new Error(`Unknown or incomplete option: ${flag}`)
    options[field] = args[++index]
  }
  if (options.replay !== undefined) {
    if (options.mode === "live") throw new Error("--replay does not accept --allow-paid")
    options.mode = "replay"
  }
  if (options.mode === "live") {
    const value = Number(options.maxRequests)
    if (!Number.isInteger(value) || value < 1 || value > 60) throw new Error("Live evaluation requires --max-requests N (integer 1..60)")
  } else if (options.maxRequests !== undefined) {
    throw new Error("--max-requests only applies to --allow-paid")
  }
  return options
}

const root = fileURLToPath(new URL("../../", import.meta.url))

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseReliabilityArgs(process.argv.slice(2))
    if (options.help) {
      console.log(
        [
          "Offline smoke (local planner, no cost): npm run eval:reliability -- --offline [--cases FILE]",
          "Replay recorded rounds:               npm run eval:reliability -- --replay FILE",
          "Live provider (explicit):             npm run eval:reliability -- --allow-paid --max-requests N",
          "",
          "Cases default to test-fixtures/reliability/dev-smoke.json (dev smoke, NOT the T02 acceptance set).",
          "Live also requires DEEPSEEK_API_KEY. Reports land in eval-results/reliability/<mode>-<time>-<pid>/.",
          "Cost is reported as unknown, not zero."
        ].join("\n")
      )
    } else {
      if (!options.out && !options.replay && options.mode === "live" && !process.env.DEEPSEEK_API_KEY?.trim()) {
        throw new Error("live mode requires DEEPSEEK_API_KEY; refusing to start (no automatic spend)")
      }
      const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" })
      const stamp = new Date().toISOString().replaceAll(":", "-")
      const outDir = path.resolve(options.out ?? path.join(root, "eval-results", "reliability", `${options.mode}-${stamp}-${process.pid}`))
      const env = { ...process.env }
      delete env.MATHCANVAS_RELIABILITY_LIVE
      delete env.MATHCANVAS_RELIABILITY_REPLAY
      delete env.MATHCANVAS_RELIABILITY_MAX_REQUESTS
      env.MATHCANVAS_RELIABILITY_REPORT = outDir
      env.MATHCANVAS_RELIABILITY_REVISION = revision.status === 0 ? revision.stdout.trim() : "unknown"
      env.MATHCANVAS_RELIABILITY_CASES = path.resolve(options.cases ?? path.join(root, "test-fixtures", "reliability", "dev-smoke.json"))
      if (options.mode === "replay") env.MATHCANVAS_RELIABILITY_REPLAY = path.resolve(options.replay)
      if (options.mode === "live") Object.assign(env, { MATHCANVAS_RELIABILITY_LIVE: "1", MATHCANVAS_RELIABILITY_MAX_REQUESTS: String(options.maxRequests) })
      const result = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.reliability.config.ts"], { cwd: root, env, stdio: "inherit" })
      console.log(`Report directory: ${outDir}`)
      process.exitCode = result.status ?? 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  }
}
