import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath, URL } from "node:url"

/**
 * **明确球体 / 棱柱 54 条离线验收入口**（2026-11-01）。
 *
 * 只跑确定性本地规划器与编译器，不调用付费模型。题单必须先在
 * `test-fixtures/explicit-solid-acceptance/manifest.json` 固定；报告目录每次唯一。
 */

export function parseArgs(args) {
  const options = { cases: undefined, out: undefined }
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === "--help") return { help: true }
    if (flag === "--offline") continue
    const field = { "--cases": "cases", "--out": "out" }[flag]
    if (!field || args[index + 1] === undefined || args[index + 1].startsWith("--")) throw new Error(`Unknown or incomplete option: ${flag}`)
    options[field] = args[++index]
  }
  return options
}

const root = fileURLToPath(new URL("../../", import.meta.url))

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      console.log("Offline explicit-solid acceptance: npm run eval:explicit-solid -- --offline [--cases FILE] [--out DIR]")
    } else {
      const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" })
      const stamp = new Date().toISOString().replaceAll(":", "-")
      const outDir = path.resolve(options.out ?? path.join(root, "eval-results", "explicit-solid-acceptance", `offline-${stamp}-${process.pid}`))
      const env = { ...process.env }
      env.MATHCANVAS_EXPLICIT_ACCEPTANCE_REPORT = outDir
      env.MATHCANVAS_EXPLICIT_ACCEPTANCE_CASES = path.resolve(options.cases ?? path.join(root, "test-fixtures", "explicit-solid-acceptance", "manifest.json"))
      env.MATHCANVAS_EXPLICIT_ACCEPTANCE_REVISION = revision.status === 0 ? revision.stdout.trim() : "unknown"
      const result = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.explicit-solid.config.ts"], { cwd: root, env, stdio: "inherit" })
      console.log(`Report directory: ${outDir}`)
      process.exitCode = result.status ?? 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  }
}
