import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  buildPerpendicularStatement,
  buildLinePlanePerpendicularStatement,
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

    expect(
      outcome.judgement.status,
      `判定不是 verified：${outcome.judgement.detail}` +
        /**
         * **超时这一支要自己解释"冷"与"真的慢"的区别**（2026-10-10 实测）：
         * 同一棵树、同一条命题 —— **冷缓存的第一次跑**撞上 300 s 墙钟被杀（实测 300015 ms），
         * 紧接着**热跑**只用 **69071 ms** 就 `verified`（与历史 68277 ms 吻合）。
         * mathlib 展开后每工程 7.5 GB，第一次要把那些 olean 从磁盘读进页缓存，成本全在这一趟。
         * **所以红一次不要急着改预算或改判据**：再跑一次就能把两者分开 —— 这条提示就是为此写的。
         */
        (outcome.judgement.status === "timeout"
          ? "（**本机实测**：冷缓存的第一次跑会超预算 —— 冷跑 300015 ms 被杀、随后热跑 69071 ms 通过。**再跑一次**即可区分「冷」与「真的慢」；不要因此调预算或放宽判据。）"
          : "")
    ).toBe("verified")
    expect(outcome.status).toBe("formally_proved")
    expect(outcome.verification.artifact?.backend.name).toBe("lean4")
    // 真证明依赖的公理必须**全部**在白名单里（否则判据层会把它拒掉，这里就看不到 verified）。
    for (const axiom of outcome.judgement.axioms ?? []) expect(["propext", "Classical.choice", "Quot.sound"]).toContain(axiom)
  }, 600_000)

  it.skipIf(!REAL_AVAILABLE)("**第二个目标类（线⊥面）也真的被内核接受**（判定定理那一半，2026-10-10 加）", async () => {
    /**
     * 这一条是 V2 GREEN 缺口①（"逐类可信翻译只到一类"）的**实测那一半**：
     * 光有单元测试只能说"模板生成了我们以为的那串字符"，**能不能被内核接受只有真跑才知道**。
     *
     * 与第一类的关系：第一类是**性质定理**（已知⊥面 ⇒ ⊥面内任意线，前提 `hu` 是模板给的），
     * 这一条是**判定定理**（⊥面内两条相交线 ⇒ ⊥面，两个前提正好是题面那两条垂直）。
     * **前提桥仍未完成**（原题别的题设不在命题里），这里不冒充。
     */
    const planeGoal: Lean4ProofGoalInput = {
      prompt: "在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC",
      claimSourceText: "PA ⊥ 平面 ABC",
      goalKind: "linePlanePerpendicular",
      assumptions: [],
      /**
       * 证明正文。**这三行不是猜的，是内核逼出来的**（三步都在本机跑红过）：
       * ① `induction hy using Submodule.span_induction` 必须**显式给 motive**
       *    （`refine … ?_ ?_ ?_ ?_` 会让 Lean 把目标猜成 `∀ x ∈ ?m, …`，报 Type mismatch）；
       * ② 这个 mathlib revision 的 `span_induction` 的 `p` 作用在**成员证明**上
       *    （`p : ∀ x, x ∈ span … → Prop`），所以要用 `induction … with | mem/_/add/smul` 那种写法；
       * ③ 两个前提的**方向恰好和结论一致**（都是 `inner (A - P) _`），所以 `simpa using h1` 就够 ——
       *    不需要第一类里那个 `inner_eq_zero_symm`（那一类要它是因为 `ᗮ` 给的是反过来的方向）。
       */
      proof: [
        "rw [Submodule.mem_orthogonal']",
        "intro y hy",
        "induction hy using Submodule.span_induction with",
        "| mem z hz =>",
        "    rcases hz with rfl | rfl",
        "    · simpa using h1",
        "    · simpa using h2",
        "| zero => simp",
        "| add x y hx hy ihx ihy => rw [inner_add_right, ihx, ihy, add_zero]",
        "| smul a x hx ih => rw [inner_smul_right, ih, mul_zero]"
      ].join("\n"),
      linePlanePerpendicular: {
        line: { first: "P", second: "A" },
        planeLines: [{ first: "A", second: "B" }, { first: "A", second: "C" }]
      }
    }

    const runner = createLean4Runner()
    // 先把模板生成的那串字符本身钉一下（这一步不花时间），再拿去交给内核。
    const spec = buildLinePlanePerpendicularStatement(planeGoal, 400_000)
    expect(spec.statement).toContain("h1 : inner ℝ (A - P) (B - A) = 0")
    const outcome = await runLean4ClosedLoop("verified_instance", planeGoal, "claim-lean4-plane-e2e", {
      runner,
      projectDir: LEAN4_PROJECT_DIR,
      toolchain,
      backendVersion: `Lean (reported by ${toolchain!.resolvedBy})`,
      timeoutMs: 300_000,
      maxHeartbeats: 400_000
    })

    console.log(`E2E 线⊥面：status=${outcome.status} judgement=${outcome.judgement.status} exit=${String(outcome.run?.exitCode)} ${outcome.run?.durationMs} ms`)
    console.log(`E2E 线⊥面 axioms: ${JSON.stringify(outcome.judgement.axioms)}`)
    console.log(`E2E 线⊥面 statement:\n${outcome.statement}`)

    expect(outcome.judgement.status, `判定不是 verified：${outcome.judgement.detail}`).toBe("verified")
    expect(outcome.status).toBe("formally_proved")
    // 命题形状也逐字钉住：它必须是**这一类**的定理名与**这一类**的结论，
    // 而不是"随便生成了一条能过的命题"。
    expect(outcome.statement).toContain("theorem draw_line_plane_perpendicular_goal")
    expect(outcome.statement).toContain("(A - P) ∈ (Submodule.span ℝ ({B - A, C - A} : Set E))ᗮ")
    for (const axiom of outcome.judgement.axioms ?? []) expect(["propext", "Classical.choice", "Quot.sound"]).toContain(axiom)
  }, 600_000)

  it.skipIf(!REAL_AVAILABLE)("**第三个目标类（切线/导数）也真的被内核接受**（换了一座数学塔，2026-10-10 加）", async () => {
    /**
     * 前两类住在**内积空间**里，这一条住在**实分析**里（`HasDerivAt` / `Tendsto` / `slope`），
     * 所以它的 import 与两行 `open` 都不同 —— 桌面命令的白名单也跟着加了（那是这块的台阶之一）。
     *
     * **诚实的边界（比另两类更远）**：命题关于**任意**函数与**任意**横坐标 ——
     * 题面那条具体曲线（`f(x)=x³−3x`）与那个点都**不进命题**。它证的是"切线斜率就是导数"
     * 这条**定义性质**，不是"这道题的结论"。
     */
    const tangentGoal: Lean4ProofGoalInput = {
      prompt: "已知函数 f(x)=x³−3x，求曲线在 x=1 处的切线",
      claimSourceText: "在 x=1 处的切线斜率等于 f′(1)",
      goalKind: "tangentSlope",
      assumptions: [],
      /**
       * 证明正文就是 mathlib 里现成的那一步。**两行 `open` 不在正文里** —— 它们在生成文件的前导里
       *（`buildTangentSlopeStatement` 负责），这是实测逼出来的：不加就报 `unknown identifier`，
       * 而报错之后 Lean 会补一个 `sorry`，于是在 axioms 报告里**看起来像"证明是空的"**。
       */
      proof: "exact hasDerivAt_iff_tendsto_slope.mp h",
      tangentSlope: { functionName: "f" }
    }

    const runner = createLean4Runner()
    const outcome = await runLean4ClosedLoop("verified_instance", tangentGoal, "claim-lean4-tangent-e2e", {
      runner,
      projectDir: LEAN4_PROJECT_DIR,
      toolchain,
      backendVersion: `Lean (reported by ${toolchain!.resolvedBy})`,
      timeoutMs: 300_000,
      maxHeartbeats: 400_000
    })

    console.log(`E2E 切线斜率：status=${outcome.status} judgement=${outcome.judgement.status} exit=${String(outcome.run?.exitCode)} ${outcome.run?.durationMs} ms`)
    console.log(`E2E 切线斜率 axioms: ${JSON.stringify(outcome.judgement.axioms)}`)

    expect(outcome.judgement.status, `判定不是 verified：${outcome.judgement.detail}`).toBe("verified")
    expect(outcome.status).toBe("formally_proved")
    expect(outcome.statement).toContain("theorem draw_tangent_slope_goal")
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
