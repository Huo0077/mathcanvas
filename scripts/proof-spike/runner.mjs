#!/usr/bin/env node
/**
 * **`npm run proof:smoke` 的入口**（实施计划 N5 的 `scripts/proof-spike/runner.mjs`）。
 *
 * 与 `scripts/agent-eval.mjs` / `scripts/agent-benchmark/runner.mjs` **同一条纪律**：
 * 这个仓库刻意没有 TS 运行器，而这一遍要 import 工作区的 TS 源码
 *（`@draw/agent-core` 的 `exports` 指向 `./src/index.ts`），所以真正的运行放在 `smoke.test.ts` 里
 * —— 那是唯一能同时解析 workspace 入口、又能打印读数的执行环境 —— 这个文件只做两件事：
 * 接上命令、**把退出码如实传出去**。
 *
 * ## 只有一种模式，而且它**不**证明任何东西
 *
 * `--mode=smoke` 验的是**边界**："一个后端都没接的时候，有没有可能假装证明成功"。
 * 它**不**产生任何 `formally_proved`，也**不**接触任何证明后端 —— 那是 N5 后一步的事，
 * 而且要先过依赖与许可证审查。别的 `--mode` 一律直接失败：宁可报错，也不要让一个不存在的模式
 * 看起来"跑过了"。
 *
 * 用法：
 * ```
 * npm run proof:smoke
 * ```
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { once } from "node:events"
import path from "node:path"

/** 真正的运行入口（见文件头注释：只有 vitest 能跑它）。 */
const SMOKE_TEST = path.join("scripts", "proof-spike", "smoke.test.ts")
const MODES = ["smoke"]

function parseMode(argv) {
  const raw = argv.find((entry) => entry.startsWith("--mode="))
  return raw === undefined ? "smoke" : raw.slice("--mode=".length)
}

/** 解析 vitest 的 CLI 入口；解析不出来或文件不存在时返回 `null`。 */
function resolveVitestCli() {
  try {
    const require = createRequire(path.join(process.cwd(), "package.json"))
    const pkgPath = require.resolve("vitest/package.json")
    const bin = require(pkgPath).bin
    const entry = typeof bin === "string" ? bin : bin?.vitest
    const cli = entry ? path.join(path.dirname(pkgPath), entry) : null
    return cli && existsSync(cli) ? cli : null
  } catch {
    return null
  }
}

const mode = parseMode(process.argv.slice(2))
const cli = resolveVitestCli()

if (!MODES.includes(mode)) {
  console.error(`[proof:smoke] unknown --mode=${mode}`)
  console.error(`[proof:smoke] expected one of: ${MODES.join(", ")} — there is no backend mode yet, and pretending there is would be worse than failing.`)
  process.exitCode = 1
} else if (cli === null) {
  console.error("[proof:smoke] could not locate the vitest CLI.")
  console.error("[proof:smoke] run `npm install` first — this repo has no TS runner, so the smoke reuses vitest.")
  process.exitCode = 1
} else if (!existsSync(path.join(process.cwd(), SMOKE_TEST))) {
  console.error(`[proof:smoke] missing smoke entry: ${SMOKE_TEST}`)
  console.error("[proof:smoke] the smoke is the only place this boundary check is implemented; do not fork it.")
  process.exitCode = 1
} else {
  const child = spawn(process.execPath, [cli, "run", SMOKE_TEST, "--silent=false"], {
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "0", PROOF_SPIKE_MODE: mode }
  })
  const [code] = await once(child, "exit")
  process.exitCode = typeof code === "number" ? code : 1
}
