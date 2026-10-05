import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  buildPerpendicularStatement,
  resolveLean4Toolchain,
  runLean4ClosedLoop,
  type Lean4ProofGoalInput
} from "@draw/agent-core"
import { createLean4Runner } from "@draw/agent-core/lean4Runner"

/**
 * **真实端到端：一条真目标真的被 Lean 内核接受、并升到 `formally_proved`**（N5b）。
 *
 * ## 这个文件是**显式 gated** 的（这是本任务两条设计约束里的第二条）
 *
 * 它需要两样 CI 上**没有**的东西：
 * 1. 本机装了 Lean（`resolveLean4Toolchain` 找得到）；
 * 2. 仓内那个小工程 `proof/lean4` 已经把 mathlib 取下来并展开过（`.lake` 有 7.5 GB）。
 *
 * 所以这里的用例**分两类**，而且分得清清楚楚：
 * - **永远跑**：环境探针本身（"找不到就说找不到"，绝不能悄悄通过）；
 * - **gated**：真的去跑 Lean。条件不满足时**跳过并写明理由**（打印 `SKIP: …`），
 *   **绝不静默通过** —— 一条"没跑却绿"的用例比一条红的用例危险得多。
 *
 * **CI 上真正跑的是判据层**（`packages/agent-core/src/proof/lean4Adapter.test.ts`，用假输出），
 * 不是这里。报告里分开写"CI 上跑什么 / 只在本地跑过什么"。
 */

/**
 * 仓内那个 Lean 小工程（见 `proof/lean4/README.md`）。
 *
 * 路径用**相对 cwd**（vitest 从仓库根启动，与 `scripts/` 里既有用例同一条纪律：
 * 本仓的用例跑在 jsdom 里，`import.meta.url` 不是 `file:` 协议）。
 */
export const LEAN4_PROJECT_DIR = path.join(process.cwd(), "proof", "lean4")

/** mathlib 展开之后才算"工程可用" —— 没取缓存时 `.lake/packages/mathlib` 里没有 `.olean`。 */
function mathlibOleanPresent(projectDir: string): boolean {
  return existsSync(path.join(projectDir, ".lake", "packages", "mathlib", ".lake", "build", "lib", "lean", "Mathlib.olean"))
}

const toolchain = resolveLean4Toolchain({
  fileExists: (candidate) => existsSync(candidate),
  listDir: (dir) => {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  }
})

const skipReason =
  toolchain === null
    ? "本机没有找到 Lean 可执行文件（`resolveLean4Toolchain` 返回 null）—— 这条真实端到端用例只在装了 Lean 的机器上跑。"
    : !existsSync(LEAN4_PROJECT_DIR)
      ? `仓内 Lean 工程不存在：${LEAN4_PROJECT_DIR}`
      : !mathlibOleanPresent(LEAN4_PROJECT_DIR)
        ? `mathlib 还没取下来/没展开（缺 .lake/packages/mathlib/.../Mathlib.olean）—— 首次使用见 proof/lean4/README.md（约 27 min、7.5 GB）。`
        : null

const REAL_AVAILABLE = skipReason === null
if (skipReason !== null) {
  // **把跳过的理由打印出来**：一条静默的 skip 与一条静默的通过一样坏。
  console.log(`SKIP: proof-spike 的真实 Lean 端到端用例没有跑 —— ${skipReason}`)
}

const GOAL: Lean4ProofGoalInput = {
  prompt: "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD",
  claimSourceText: "PA ⊥ BD",
  goalKind: "perpendicular",
  assumptions: [],
  /**
   * 证明正文（**模型可以给的那一份**）。两处实测出来的讲究：
   *
   * - **要 `inner_eq_zero_symm`**：`ᗮ` 那一支给的是 `∀ x ∈ D, inner ℝ x (A - P) = 0`
   *   —— 也就是 `⟪x, A - P⟫`，而目标是 `inner ℝ (A - P) (D - B)`（**两个参数换了位置**）。
   *   实测：`exact hu (D - B) hv` 与不带 `inner_eq_zero_symm` 的 `simpa using` 都会留下
   *   `unsolved goals`；带上对称引理就过了。
   * - 那个 `(D - B)` **必须写成生成文件里真有的表达式**：我第一版写的是 `exact hu v hv`，
   *   而生成的命题里根本没有 `v` 这个名字，于是 Lean 报出 `unsolved goals` +
   *   `sorryAx` —— **看起来像"证明是空的"，实际是名字写错了**。
   *   这条教训记在 `lean4Adapter.ts` 的 `LEAN4_BINDER_NAMES` 注释里。
   *
   * ⚠️ **这也是"适配器不判断证明成立"的一个正面例子**：上面这两条都不是我读出来的，
   * 是 Lean 内核说"没证完"逼出来的。正文对不对，只有内核能回答。
   */
  proof: "simpa [inner_eq_zero_symm] using hu (D - B) hv",
  perpendicular: {
    lineA: { first: "P", second: "A" },
    planePoints: ["A", "B", "C"],
    lineB: { first: "B", second: "D" }
  }
}

describe("真实 Lean 端到端（显式 gated）", () => {
  it("环境探针：**找不到就说找不到**（绝不静默通过）", () => {
    if (toolchain === null) {
      console.log("环境探针：本机没有 Lean ⇒ 后面的用例全部 skip。")
      expect(toolchain).toBeNull()
    } else {
      // 找到了就把它**怎么找到的**打出来 —— 报告里要写清这条（垫片 vs 工具链自己的 bin）。
      console.log(`环境探针：Lean 在 ${toolchain.leanPath}（resolvedBy=${toolchain.resolvedBy}，lake=${toolchain.lakePath ?? "(无)"}）`)
      expect(toolchain.leanPath.length).toBeGreaterThan(0)
    }
  })

  it.skipIf(!REAL_AVAILABLE)("**真证明 ⇒ `formally_proved`**（跑真的 `lake env lean`）", async () => {
    const runner = createLean4Runner()
    const outcome = await runLean4ClosedLoop("verified_instance", GOAL, "claim-lean4-e2e", {
      runner,
      projectDir: LEAN4_PROJECT_DIR,
      toolchain,
      backendVersion: `Lean (reported by ${toolchain!.resolvedBy})`,
      timeoutMs: 300_000,
      maxHeartbeats: 400_000
    })

    // 这条用例要打印的读数（报告里的原始证据就是它）：
    console.log(`E2E 真证明：status=${outcome.status} judgement=${outcome.judgement.status} exit=${String(outcome.run?.exitCode)} ${outcome.run?.durationMs} ms`)
    console.log(`E2E axioms: ${JSON.stringify(outcome.judgement.axioms)}`)
    console.log(`E2E statement:\n${outcome.statement}`)

    expect(outcome.judgement.status, `判定不是 verified：${outcome.judgement.detail}`).toBe("verified")
    expect(outcome.status).toBe("formally_proved")
    expect(outcome.verification.artifact?.backend.name).toBe("lean4")
    // 真证明依赖的公理必须**全部**在白名单里（否则判据层会把它拒掉，这里就看不到 verified）。
    for (const axiom of outcome.judgement.axioms ?? []) expect(["propext", "Classical.choice", "Quot.sound"]).toContain(axiom)
  }, 600_000)

  it.skipIf(!REAL_AVAILABLE)("**`sorry` 的正文 ⇒ 绝不升级**（同一台机器、同一条命题，只换正文）", async () => {
    const runner = createLean4Runner()
    const outcome = await runLean4ClosedLoop(
      "verified_instance",
      { ...GOAL, proof: "sorry" },
      "claim-lean4-e2e-cheat",
      {
        runner,
        projectDir: LEAN4_PROJECT_DIR,
        toolchain,
        backendVersion: `Lean (reported by ${toolchain!.resolvedBy})`,
        timeoutMs: 300_000
      }
    )

    // **这就是"只看退出码"会踩的那个坑**：Lean 对 `sorry` 是 exit 0（只给 warning）。
    console.log(`E2E sorry：exit=${String(outcome.run?.exitCode)} status=${outcome.status} judgement=${outcome.judgement.status}`)
    console.log(`E2E sorry detail: ${outcome.judgement.detail}`)

    expect(outcome.run?.exitCode, "Lean 对 `sorry` 的退出码应当是 0（这正是坑之所在）").toBe(0)
    expect(outcome.judgement.status).toBe("failed")
    expect(outcome.status).toBe("verified_instance")
  }, 600_000)

  it.skipIf(!REAL_AVAILABLE)("**窄 import 与 `import Mathlib` 的成本各是多少**（简报 §一.1 的成本纪律）", async () => {
    const runner = createLean4Runner()
    const narrow = buildPerpendicularStatement(GOAL, 400_000)

    const narrowRun = await runner({
      source: narrow.source,
      leanPath: toolchain!.leanPath,
      lakePath: toolchain!.lakePath,
      projectDir: LEAN4_PROJECT_DIR,
      timeoutMs: 600_000
    })
    const wideRun = await runner({
      // 只把 import 换成整个 Mathlib：**同一套文件、同一条命题**，差的就是导入宽度。
      source: narrow.source.replace("import Mathlib.Analysis.InnerProductSpace.Orthogonal", "import Mathlib"),
      leanPath: toolchain!.leanPath,
      lakePath: toolchain!.lakePath,
      projectDir: LEAN4_PROJECT_DIR,
      timeoutMs: 900_000
    })

    // 这次**不用**判据层（这里量的是耗时，不是成没成），但两条都必须 exit 0 —— 否则数字没有意义。
    console.log(`IMPORT-WIDTH narrow=${narrowRun.durationMs} ms exit=${String(narrowRun.exitCode)} / full=${wideRun.durationMs} ms exit=${String(wideRun.exitCode)}`)
    console.log(`IMPORT-WIDTH narrow stdout: ${narrowRun.stdout.trim().split("\n").pop()}`)
    console.log(`IMPORT-WIDTH full   stdout: ${wideRun.stdout.trim().split("\n").pop()}`)

    expect(narrowRun.exitCode).toBe(0)
    expect(wideRun.exitCode).toBe(0)
    // **窄 import 必须真的更窄**（否则"换个 import 试试"这件事就没有意义）。
    expect(narrowRun.durationMs).toBeLessThan(wideRun.durationMs)
  }, 1_800_000)
})
