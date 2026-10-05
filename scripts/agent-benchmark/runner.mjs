#!/usr/bin/env node
/**
 * **`npm run bench:agent` 的入口**（实施计划 N4 的 `runner.mjs`）。
 *
 * ## 为什么这里要"绕一圈"调用 vitest
 *
 * 与 `scripts/agent-eval.mjs` **完全同一条理由**，这里不重复论证：这个仓库刻意没有 TS 运行器
 * （不装 `tsx` / `ts-node`），而题集校验与报告组装都要 import 工作区的 TS 源码
 *（`@draw/agent-core` 的 `exports` 直接指向 `./src/index.ts`）。能跑那份 TS 的只有
 * Vite / Vitest，所以真正的运行与报告放在 `run.test.ts` 里 —— 那是**唯一**能同时解析
 * workspace 入口、又能打印读数的执行环境 —— 这个文件只做一件事：把命令接上去，
 * **并把退出码如实传出去**。
 *
 * ## 三条纪律
 *
 * 1. **不自己实现第二份 benchmark**。这里一行测量逻辑都没有；判据只有 `dataset.ts` /
 *    `report.ts` 各一份。
 * 2. **退出码如实传递**：运行红了，`npm run bench:agent` 就必须红。
 *    一个永远退 0 的测量命令会被当成"测过了，没问题"。
 * 3. **不伪造数字**：没有凭据时由 `run.test.ts` 写 `not_measured`，
 *    而不是让这个入口"跳过"或"假装跑过"。
 *
 * 用法：
 * ```
 * npm run bench:agent                     # 默认 deterministic_local
 * npm run bench:agent -- --mode=real_provider
 * ```
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { once } from "node:events"
import path from "node:path"

/** 真正的运行入口（见文件头注释：只有 vitest 能跑它）。 */
const RUN_TEST = path.join("scripts", "agent-benchmark", "run.test.ts")

const MODES = ["deterministic_local", "real_provider"]

/** 从 `--mode=…` 里取模式；缺省 `deterministic_local`。不认识的值**直接失败**，不静默降级。 */
function parseMode(argv) {
  const raw = argv.find((entry) => entry.startsWith("--mode="))
  if (raw === undefined) return "deterministic_local"
  return raw.slice("--mode=".length)
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
  console.error(`[bench:agent] unknown --mode=${mode}`)
  console.error(`[bench:agent] expected one of: ${MODES.join(", ")}`)
  process.exitCode = 1
} else if (cli === null) {
  console.error("[bench:agent] could not locate the vitest CLI.")
  console.error("[bench:agent] run `npm install` first — this repo has no TS runner, so the benchmark reuses vitest.")
  process.exitCode = 1
} else if (!existsSync(path.join(process.cwd(), RUN_TEST))) {
  console.error(`[bench:agent] missing benchmark entry: ${RUN_TEST}`)
  console.error("[bench:agent] the report is the only place the benchmark is implemented; do not fork it.")
  process.exitCode = 1
} else {
  /**
   * 直接起 `node <vitest-cli> run <file>`，不经 shell、不经 `node_modules/.bin`
   * （与 `scripts/toolchain.mjs` / `agent-eval.mjs` 同一条理由：`.bin` 在 Windows 上是 `.cmd`，
   * 依赖它会让"命令找不到"变成一个环境问题）。
   *
   * `--silent=false` 是必须的：报告是 `console.log` 打出来的，静默掉它这条命令就白跑了。
   * 模式经环境变量往下传（而不是拼到 argv 上）：argv 里已经有一串 vitest 的参数，
   * 混在一起会让"这到底是 vitest 的参数还是我们的"变得分不清。
   */
  const child = spawn(process.execPath, [cli, "run", RUN_TEST, "--silent=false"], {
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "0", BENCHMARK_MODE: mode }
  })
  const [code] = await once(child, "exit")
  process.exitCode = typeof code === "number" ? code : 1
}
