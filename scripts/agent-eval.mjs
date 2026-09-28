#!/usr/bin/env node
/**
 * **`npm run eval:agent` 的入口**（Phase 6 / Task 6.2）。
 *
 * ## 为什么这里要"绕一圈"调用 vitest，而不是直接跑评测
 *
 * 任务计划写的产物是 `scripts/agent-eval.ts`，但**这个仓库里没有 TS 运行器** ——
 * 不装 `tsx` / `ts-node`，那是刻意的（同一条理由见 `docs/current-status.md` 里
 * e2e/scripts 刻意不装 `@types/node`：工具链的便利不该动摇应用侧的类型）。
 * 已有的 `scripts/*.mjs` 全是纯 JavaScript，而评测必须 import 应用包的 TS 源码
 * （`apps/web/src/agent/fixtures/offlineAgentEval.ts` → `@draw/agent-core`）。
 *
 * 能跑那份 TS 的只有两样东西：Vite（构建）与 Vitest（测试）。所以真正的评测与报告放在
 * `apps/web/src/agent/fixtures/agentEvalReport.test.ts` 里 —— 那是**唯一**能同时解析
 * workspace 别名、又能打印读数的执行环境 —— 而这个文件只做一件事：把用户敲的那条命令
 * 接到那个入口上，并把退出码如实传出去。
 *
 * 因此它写成 `.mjs` 而不是 `.ts`：`scripts/tsconfig.json` 只检查 `.ts`（`allowJs: false`），
 * 而这个文件里的逻辑没有一处需要类型（它是 spawn + 退出码）。写一个 `.ts` 反而要
 * 额外声明 node 类型，换不到任何类型安全。
 *
 * ## 三条纪律
 *
 * 1. **不自己实现第二份评测**。这里一行评测逻辑都没有；口径只有 `AgentEvalScorecard` 一份。
 * 2. **退出码如实传递**：评测红了，`npm run eval:agent` 就必须红。
 *    一个永远退 0 的评测命令会被当成"跑过了，没问题"。
 * 3. **缺依赖时说清怎么办**，而不是抛一个 `MODULE_NOT_FOUND` 让调用方猜。
 *
 * 用法：
 * ```
 * npm run eval:agent
 * ```
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { once } from "node:events"
import path from "node:path"

/** 评测真正的入口（见文件头注释：只有 vitest 能跑它）。 */
const EVAL_TEST = path.join("apps", "web", "src", "agent", "fixtures", "agentEvalReport.test.ts")

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

const cli = resolveVitestCli()

if (cli === null) {
  console.error("[eval:agent] could not locate the vitest CLI.")
  console.error("[eval:agent] run `npm install` first — this repo has no TS runner, so the evaluation reuses vitest.")
  process.exitCode = 1
} else if (!existsSync(path.join(process.cwd(), EVAL_TEST))) {
  console.error(`[eval:agent] missing evaluation entry: ${EVAL_TEST}`)
  console.error("[eval:agent] the scorecard report is the only place the evaluation is implemented; do not fork it.")
  process.exitCode = 1
} else {
  /**
   * 直接起 `node <vitest-cli> run <file>`，不经 shell、不经 `node_modules/.bin`
   * （与 `scripts/toolchain.mjs` 同一条理由：`node_modules/.bin` 在 Windows 上是 `.cmd`，
   * 依赖它会让"命令找不到"变成一个环境问题）。
   *
   * `--silent=false` 是必须的：记分卡是 `console.log` 打出来的，静默掉它这条命令就白跑了。
   */
  const child = spawn(process.execPath, [cli, "run", EVAL_TEST, "--silent=false"], {
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "0" }
  })
  const [code] = await once(child, "exit")
  process.exitCode = typeof code === "number" ? code : 1
}
