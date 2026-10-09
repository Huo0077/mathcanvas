import { describe, expect, it } from "vitest"

import { evidenceStatusWithProof, proofInputHash, PROOF_ARTIFACT_VERSION, verifyProofArtifact, type ProofExpectation, type ProofRejectionCode } from "./proofArtifact"
import {
  buildPerpendicularStatement,
  buildLinePlanePerpendicularStatement,
  checkAxiomsReport,
  judgeLean4Run,
  LEAN4_ALLOWED_AXIOMS,
  LEAN4_BACKEND_NAME,
  LEAN4_LINE_PLANE_PERPENDICULAR_THEOREM_NAME,
  LEAN4_SUPPORTED_GOAL_KINDS,
  LEAN4_THEOREM_NAME,
  produceLean4Artifact,
  runLean4ClosedLoop,
  type Lean4ProofGoalInput,
  type Lean4RunResult,
  type Lean4Runner
} from "./lean4Adapter"

/**
 * **N5b 的判据层**：这些用例**全部**在 CI 上跑，**不需要** Lean、也不需要 7 GB 的 mathlib。
 *
 * 做法是：**判"证明成没成"的那一层**（`checkAxiomsReport` / `judgeLean4Run` / 产物构造与绑定）
 * 与"真的去起 `lean.exe`"那一步**分开** —— `Lean4Runner` 是注入的，这里用**假的**。
 *
 * ## 为什么这样切（这是本任务两条设计约束里的第一条）
 *
 * CI 上没有 Lean（更没有 mathlib），所以任何"靠真的跑一次 Lean 才知道对不对"的判据
 * 在 CI 上要么变成 skip、要么变成撒谎。而这批判据恰恰是**最要紧的那批**：
 * axioms 白名单、拒 `sorry`、篡改必拒、`formally_proved` 只能由真证明换来。
 * 它们的输入是**字符串输出**（Lean 的 stdout），所以**用假输出就能把逻辑钉死**，
 * 而"真 Lean 会吐这样的字符串吗"由**另一条显式 gated 的端到端用例**回答（见报告）。
 */

const GOAL: Lean4ProofGoalInput = {
  prompt: "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD",
  claimSourceText: "PA ⊥ BD",
  goalKind: "perpendicular",
  assumptions: ["系统替你定的假设：底面 ABCD 是正方形"],
  proof: "rw [Submodule.mem_orthogonal'] at hu\n  exact hu v hv",
  perpendicular: {
    lineA: { first: "P", second: "A" },
    planePoints: ["A", "B", "C"],
    lineB: { first: "B", second: "D" }
  }
}

/** 一条**真**证明的 axioms 报告（控制器在 mathlib 上实测过的形状）。 */
const HONEST_STDOUT = `'${LEAN4_THEOREM_NAME}' depends on axioms: [propext, Classical.choice, Quot.sound]\n`
/** 一条用 `sorry` 收尾的证明：**exit 0**，但 axioms 里多了 `sorryAx`。 */
const CHEAT_STDOUT = `'${LEAN4_THEOREM_NAME}' depends on axioms: [propext, sorryAx, Classical.choice, Quot.sound]\n`
/** 依赖**用户自定义 `axiom`**：同样 exit 0，表外公理叫 `magic`。 */
const CUSTOM_AXIOM_STDOUT = `'${LEAN4_THEOREM_NAME}' depends on axioms: [magic]\n`

const okRun = (stdout: string): Lean4RunResult => ({ exitCode: 0, stdout, stderr: "", durationMs: 52_000, timedOut: false })

function fakeRunner(outputs: Lean4RunResult[]): Lean4Runner {
  let index = 0
  return async () => {
    const value = outputs[Math.min(index, outputs.length - 1)]
    index += 1
    return value ?? okRun("")
  }
}

const PRODUCE = {
  projectDir: "/repo/proof/lean4",
  toolchain: { leanPath: "/tc/bin/lean", lakePath: "/tc/bin/lake" },
  backendVersion: "Lean 4.34.1 (commit 5045d005…)"
}

describe("axioms 判据（`#print axioms` 的解析）", () => {
  it("**白名单不是空的** —— 空白名单会把真证明也拒掉（那个坑会静默让一切失败）", () => {
    expect(LEAN4_ALLOWED_AXIOMS.length).toBeGreaterThan(0)
    expect(LEAN4_ALLOWED_AXIOMS).toEqual(["propext", "Classical.choice", "Quot.sound"])
    // `sorryAx` **永远不在**白名单里。
    expect(LEAN4_ALLOWED_AXIOMS).not.toContain("sorryAx")
  })

  it("真证明的报告通过，而且把三个公理如实报出来", () => {
    const report = checkAxiomsReport(HONEST_STDOUT, LEAN4_THEOREM_NAME)

    expect(report.passed).toBe(true)
    expect(report.axioms).toEqual(["propext", "Classical.choice", "Quot.sound"])
    expect(report.rejection).toBeNull()
  })

  it("**`sorry` 必须被拒** —— 它的 exit code 是 0，所以退出码在这里不算数", () => {
    const report = checkAxiomsReport(CHEAT_STDOUT, LEAN4_THEOREM_NAME)

    expect(report.passed).toBe(false)
    expect(report.rejection).toContain("sorryAx")
    expect(report.rejection).toContain("空的")
  })

  it("**用户自定义 `axiom` 也必须被拒**（表外公理，含它自己的名字）", () => {
    const report = checkAxiomsReport(CUSTOM_AXIOM_STDOUT, LEAN4_THEOREM_NAME)

    expect(report.passed).toBe(false)
    expect(report.rejection).toContain("magic")
  })

  it("`does not depend on any axioms` 也通过（**没有公理**是好事，不是「没证据」）", () => {
    const report = checkAxiomsReport(`'${LEAN4_THEOREM_NAME}' does not depend on any axioms\n`, LEAN4_THEOREM_NAME)

    expect(report.passed).toBe(true)
    expect(report.reportedNoAxioms).toBe(true)
    expect(report.axioms).toEqual([])
  })

  it("**报告缺失就拒**（fail-closed）—— 没看到报告 ≠ 没有公理", () => {
    const report = checkAxiomsReport("", LEAN4_THEOREM_NAME)

    expect(report.passed).toBe(false)
    expect(report.rejection).toContain("没有证据不等于没有公理")
  })

  it("报告是**别的定理**的（例如只报了一个引理）也拒：名字必须逐字对上", () => {
    const report = checkAxiomsReport("'some_other_lemma' depends on axioms: [propext]\n", LEAN4_THEOREM_NAME)

    expect(report.passed).toBe(false)
  })

  it("形状不认识的报告一律拒（以后 Lean 换了输出格式，这里是**拒**而不是放行）", () => {
    for (const weird of [
      `'${LEAN4_THEOREM_NAME}' depends on axioms: [propext, Classical.choice, Quot.sound]\n`,
      `'${LEAN4_THEOREM_NAME}' depends on axioms []\n`,
      `'${LEAN4_THEOREM_NAME}' depends on axioms: [propext\n`,
      `'${LEAN4_THEOREM_NAME}' depends on axioms: []\n`
    ]) {
      // 期望：要么通过（第一条是正常形状），要么被拒且**不抛**。
      const report = checkAxiomsReport(weird, LEAN4_THEOREM_NAME)
      if (report.passed) expect(report.axioms).toEqual(["propext", "Classical.choice", "Quot.sound"])
      else expect(report.rejection).not.toBeNull()
    }
    // 空公理列表这种"像但没有"的形状必须**拒**（不认识的形状不当作证据）。
    expect(checkAxiomsReport(`'${LEAN4_THEOREM_NAME}' depends on axioms: []\n`, LEAN4_THEOREM_NAME).passed).toBe(false)
  })

  it("同一行重复出现两次 ⇒ 拒（不知道哪一条算数）", () => {
    const doubled = HONEST_STDOUT + CHEAT_STDOUT

    expect(checkAxiomsReport(doubled, LEAN4_THEOREM_NAME).passed).toBe(false)
  })
})

describe("一次运行的判定（`judgeLean4Run`）", () => {
  it("**Exit code 单独不算数**：`sorry` 那次 exit 0，判定必须是 failed", () => {
    const judgement = judgeLean4Run(okRun(CHEAT_STDOUT), LEAN4_THEOREM_NAME, GOAL.proof)

    expect(judgement.status).toBe("failed")
    expect(judgement.axioms).toBeNull()
  })

  it("真证明 exit 0 + 报告通过 ⇒ verified，并带上公理列表", () => {
    const judgement = judgeLean4Run(okRun(HONEST_STDOUT), LEAN4_THEOREM_NAME, GOAL.proof)

    expect(judgement.status).toBe("verified")
    expect(judgement.axioms).toEqual(["propext", "Classical.choice", "Quot.sound"])
  })

  it("**exit 0 但没有任何 axioms 报告 ⇒ failed**（不是「没报公理所以没公理」）", () => {
    const judgement = judgeLean4Run(okRun(""), LEAN4_THEOREM_NAME, GOAL.proof)

    expect(judgement.status).toBe("failed")
    expect(judgement.detail).toContain("没有证据")
  })

  it("编译错误（exit ≠ 0）⇒ failed，并把诊断带出来", () => {
    const judgement = judgeLean4Run(
      { exitCode: 1, stdout: "", stderr: "error: unknown identifier 'mem_orthogonal''", durationMs: 3000, timedOut: false },
      LEAN4_THEOREM_NAME,
      GOAL.proof
    )

    expect(judgement.status).toBe("failed")
    expect(judgement.detail).toContain("unknown identifier")
  })

  it("**进程级墙钟超时 ⇒ `timeout`**，绝不把被杀掉的那次算作通过", () => {
    // 注意：这次运行**同时**有一份看起来完美的 axioms 报告 —— 判据不能被它骗过去。
    const judgement = judgeLean4Run(
      { exitCode: null, stdout: HONEST_STDOUT, stderr: "", durationMs: 180_001, timedOut: true },
      LEAN4_THEOREM_NAME,
      GOAL.proof
    )

    expect(judgement.status).toBe("timeout")
    expect(judgement.axioms).toBeNull()
  })

  it("**后端不可用 ⇒ `unsupported`**，而且不是 `failed`（「没装」与「证不出来」是两件事）", () => {
    const judgement = judgeLean4Run(
      { exitCode: null, stdout: "", stderr: "", durationMs: 0, timedOut: false, unavailableReason: "没有找到 lean 可执行文件" },
      LEAN4_THEOREM_NAME,
      GOAL.proof
    )

    expect(judgement.status).toBe("unsupported")
    expect(judgement.detail).toContain("后端不可用")
  })

  it("Lean 自己的确定性预算（heartbeats）报错也是 failed —— 它是**报错**不是挂死", () => {
    const judgement = judgeLean4Run(
      {
        exitCode: 1,
        stdout: "",
        stderr: "error: (deterministic) timeout at `whnf`, maximum number of heartbeats (100) has been reached",
        durationMs: 4200,
        timedOut: false
      },
      LEAN4_THEOREM_NAME,
      GOAL.proof
    )

    expect(judgement.status).toBe("failed")
    expect(judgement.detail).toContain("deterministic")
  })
})

describe("IR → Lean 命题的模板（可审计的那张小表）", () => {
  it("生成的命题**是一般命题**（任意内积空间 + 任意子空间），不是某一组坐标", () => {
    const spec = buildPerpendicularStatement(GOAL, 400_000)

    // 量词与结构：`{E : Type*} [.. InnerProductSpace ℝ E]` + 任意子空间 `D` + `u ∈ Dᗮ` / `v ∈ D`。
    expect(spec.statement).toContain("{E : Type*} [NormedAddCommGroup E] [InnerProductSpace ℝ E]")
    expect(spec.statement).toContain("Submodule.span ℝ")
    expect(spec.statement).toContain("∈ (Submodule.span ℝ")
    expect(spec.statement).toContain("ᗮ)")
    expect(spec.statement).toContain("inner ℝ")
    expect(spec.statement).toContain("= 0")
    // **没有坐标浮点数**：`1.5` / `0.0` 这类字面量出现就说明模板把"命题"降级成了"某一组坐标的实例"（R55）。
    expect(spec.statement).not.toMatch(/\d+\.\d+/)
    expect(spec.source).not.toMatch(/\d+\.\d+/)
  })

  it("**同一份 IR 永远生成逐字相同的命题**（模板是确定性的，没有外部状态）", () => {
    // 这条同时是一条**结构性**证据：模板的入参里根本没有坐标，
    // 所以"两份 IR 只差坐标"这种输入在这一层**不存在**（它连表达都表达不出来）。
    expect(buildPerpendicularStatement(GOAL, 400_000).statement).toBe(buildPerpendicularStatement({ ...GOAL }, 400_000).statement)
    // 而**点名**这种真正会影响命题的东西，改了它命题必须变（否则模板把两个不同的几何对象当成同一个）。
    const renamed = buildPerpendicularStatement(
      { ...GOAL, perpendicular: { ...GOAL.perpendicular!, lineA: { first: "P", second: "B" } } },
      400_000
    )
    expect(renamed.statement).not.toBe(buildPerpendicularStatement(GOAL, 400_000).statement)
  })

  it("**每个点在各处是同一个变量**（P/A/B/C/D 各只声明一次，差向量用的是它们）", () => {
    const spec = buildPerpendicularStatement(GOAL, 400_000)

    for (const point of ["P", "A", "B", "C", "D"]) {
      const declarations = spec.statement.split(`(${point} : E)`).length - 1
      expect(declarations, `${point} 声明了 ${declarations} 次`).toBe(1)
    }
    expect(spec.statement).toContain("(A - P)")
    expect(spec.statement).toContain("(D - B)")
  })

  it("命题原文进 `statement` 那一栏 —— 它就是 R56 绑的东西（模板一改，它必变）", () => {
    const a = buildPerpendicularStatement(GOAL, 400_000)
    const b = buildPerpendicularStatement(
      { ...GOAL, perpendicular: { ...GOAL.perpendicular!, lineB: { first: "B", second: "C" } } },
      400_000
    )

    expect(a.statement).not.toBe(b.statement)
  })

  it("`maxHeartbeats` 写进生成的文件（后端自带的确定性预算）", () => {
    const spec = buildPerpendicularStatement(GOAL, 1234)

    expect(spec.source).toContain("set_option maxHeartbeats 1234")
    expect(spec.source).toContain(`#print axioms ${LEAN4_THEOREM_NAME}`)
    expect(spec.source).toContain("import Mathlib.Analysis.InnerProductSpace.Orthogonal")
  })

  it("证明正文**原样照抄**（适配器不解释、不改写、不「修一下」）", () => {
    const spec = buildPerpendicularStatement(GOAL, 400_000)

    for (const line of GOAL.proof.split("\n")) expect(spec.source).toContain(`  ${line}`)
  })

  it("点名不像点名 / 平面点少于三个 ⇒ **抛**（调用方给错了，不是「证明失败」）", () => {
    expect(() => buildPerpendicularStatement({ ...GOAL, perpendicular: { ...GOAL.perpendicular!, planePoints: ["A", "B"] } }, 400_000)).toThrow(/至少要有三个点/)
    expect(() => buildPerpendicularStatement({ ...GOAL, perpendicular: { ...GOAL.perpendicular!, lineA: { first: "1x", second: "A" } } }, 400_000)).toThrow(/点名/)
    expect(() => buildPerpendicularStatement({ ...GOAL, perpendicular: undefined }, 400_000)).toThrow(/必须给出 perpendicular/)
  })
})

/**
 * **第二个目标类：线 ⊥ 面**（`planePerpendicular`）—— V2 GREEN 缺口①"逐类可信翻译只到一类"的第一刀。
 *
 * ## 为什么这一类是**另一个定理**，而不是第一类的另一种写法
 *
 * 第一类（`perpendicular`）证的是**性质定理**：**已知**线 ⊥ 面（`hu : u ∈ Dᗮ`）⇒ 线 ⊥ 面里任意一条线。
 * 这一类证的是**判定定理**：线 ⊥ 平面内两条**相交**直线 ⇒ 线 ⊥ 这个平面。
 * 两者前提与结论方向**相反**，合起来才是立体几何里关于线面垂直的那两步。
 *
 * ## 前提是"题面给的"，不是模板塞的（这与第一类**不一样**，必须说清）
 *
 * 第一类的 `hu : u ∈ Dᗮ` 是**模板给的** —— 也就是说它把"AB ⊥ AA′"这类题设直接当成了假设，
 * 那句假设怎么来的是适配器文件头写明的那条诚实边界。这一类的两个前提 `h1` / `h2`
 * **正好就是题面里那两条垂直**（"PA ⊥ AB"、"PA ⊥ AC"），所以它更接近"把原题前提接上来"。
 * **但仍然不是完整的前提桥**（原题别的题设，例如"底面是正方形"，不在里面）。
 */
describe("第二个目标类：线⊥面（判定定理那一半）", () => {
  const PLANE_GOAL: Lean4ProofGoalInput = {
    prompt: "在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC",
    claimSourceText: "PA ⊥ 平面 ABC",
    goalKind: "linePlanePerpendicular",
    proof: "rw [Submodule.mem_orthogonal']\n  intro y hy\n  induction hy using Submodule.span_induction with\n  | mem z hz =>\n      rcases hz with rfl | rfl\n      · simpa using h1\n      · simpa using h2\n  | zero => simp\n  | add x y hx hy ihx ihy => rw [inner_add_right, ihx, ihy, add_zero]\n  | smul a x hx ih => rw [inner_smul_right, ih, mul_zero]",
    linePlanePerpendicular: {
      line: { first: "P", second: "A" },
      planeLines: [{ first: "A", second: "B" }, { first: "A", second: "C" }]
    }
  }

  it("生成的命题里**两个前提正好是题面那两条垂直**，结论是「线 ⊥ 那个平面」", () => {
    const spec = buildLinePlanePerpendicularStatement(PLANE_GOAL, 400_000)

    // 前提：同一条线的方向向量，分别与平面内两条线的方向向量内积为 0。
    expect(spec.statement).toContain("h1 : inner ℝ (A - P) (B - A) = 0")
    expect(spec.statement).toContain("h2 : inner ℝ (A - P) (C - A) = 0")
    // 结论：方向向量落进**由那两条线张成的平面**的正交补（`Dᗮ`）—— 这就是"线 ⊥ 面"。
    expect(spec.statement).toContain("(A - P) ∈ (Submodule.span ℝ ({B - A, C - A} : Set E))ᗮ")
    // 一般命题：任意内积空间、任意点，**没有坐标**。
    expect(spec.statement).toContain("{E : Type*} [NormedAddCommGroup E] [InnerProductSpace ℝ E]")
    expect(spec.statement).not.toMatch(/\d+\.\d+/) // 一个具体数值都没有
  })

  it("**两类用两个不同的定理名** —— 否则一份 `#print axioms` 报告能互相冒充", () => {
    const plane = buildLinePlanePerpendicularStatement(PLANE_GOAL, 400_000)

    expect(plane.theoremName).not.toBe(LEAN4_THEOREM_NAME)
    expect(plane.source).toContain(`#print axioms ${plane.theoremName}`)
    expect(plane.source).not.toContain(`#print axioms ${LEAN4_THEOREM_NAME}`)
  })

  it("**「相交」这件事是输入必须给的**：两条平面线不共点 / 是同一对点 ⇒ 抛（不猜一个平面出来）", () => {
    const withLines = (planeLines: readonly [{ first: string; second: string }, { first: string; second: string }]) =>
      ({ ...PLANE_GOAL, linePlanePerpendicular: { ...PLANE_GOAL.linePlanePerpendicular!, planeLines } })

    // 两条平行线（AB 与 CD）张不出"由两条相交直线确定的平面"——判定定理的前提不成立。
    expect(() => buildLinePlanePerpendicularStatement(withLines([{ first: "A", second: "B" }, { first: "C", second: "D" }]), 400_000))
      .toThrow(/相交|共点/)
    // 同一对点写两遍：那是同一条线，其中一个前提是多余的。
    expect(() => buildLinePlanePerpendicularStatement(withLines([{ first: "A", second: "B" }, { first: "A", second: "B" }]), 400_000))
      .toThrow(/相交|共点|同一条/)
  })

  it("缺字段 / 点名不像点名 ⇒ 抛（调用方给错了，不是「证明失败」）", () => {
    expect(() => buildLinePlanePerpendicularStatement({ ...PLANE_GOAL, linePlanePerpendicular: undefined }, 400_000)).toThrow(/必须给出 linePlanePerpendicular/)
    expect(() => buildLinePlanePerpendicularStatement({ ...PLANE_GOAL, linePlanePerpendicular: { ...PLANE_GOAL.linePlanePerpendicular!, line: { first: "1x", second: "A" } } }, 400_000)).toThrow(/点名/)
  })

  it("`planePerpendicular` 进**声称覆盖**的清单（覆盖范围是一处改、覆盖消息跟着变）", () => {
    expect(LEAN4_SUPPORTED_GOAL_KINDS).toContain("linePlanePerpendicular")
    expect(LEAN4_SUPPORTED_GOAL_KINDS).toContain("perpendicular")
  })

  it("闭环（假 runner）：真报告 ⇒ `formally_proved`；`sorry` ⇒ 停在原地", async () => {
    const planeStdout = `'${LEAN4_LINE_PLANE_PERPENDICULAR_THEOREM_NAME}' depends on axioms: [propext, Classical.choice, Quot.sound]\n`
    const planeCheat = `'${LEAN4_LINE_PLANE_PERPENDICULAR_THEOREM_NAME}' depends on axioms: [propext, sorryAx, Classical.choice, Quot.sound]\n`

    const good = await runLean4ClosedLoop("verified_instance", PLANE_GOAL, "claim-plane", {
      ...PRODUCE,
      runner: fakeRunner([okRun(planeStdout)])
    })
    expect(good.status).toBe("formally_proved")
    expect(good.verification.artifact?.claimId).toBe("claim-plane")

    const cheat = await runLean4ClosedLoop("verified_instance", PLANE_GOAL, "claim-plane", {
      ...PRODUCE,
      runner: fakeRunner([okRun(planeCheat)])
    })
    expect(cheat.status).toBe("verified_instance")
    expect(cheat.judgement.status).toBe("failed")
  })

  it("**报告是另一类的**（拿第一类的报告来充第二类）⇒ 拒 —— 名字必须逐字对上", async () => {
    // 这条挡的是"定理名两处共用一个常量"这类实现：那时第一类的一份真报告
    // 会让第二类的目标也升到 `formally_proved`，而**它证的根本不是同一条命题**。
    const wrong = await runLean4ClosedLoop("verified_instance", PLANE_GOAL, "claim-plane", {
      ...PRODUCE,
      runner: fakeRunner([okRun(HONEST_STDOUT)])
    })

    expect(wrong.status).toBe("verified_instance")
    expect(wrong.judgement.status).toBe("failed")
  })
})

describe("产物与绑定（假 runner，CI 上跑）", () => {
  it("真报告 ⇒ 产出**合格产物**，且 `inputHash` 覆盖了 `statement`", async () => {
    const produced = await produceLean4Artifact(GOAL, { ...PRODUCE, runner: fakeRunner([okRun(HONEST_STDOUT)]), claimId: "claim-1" })

    expect(produced.artifact).not.toBeNull()
    expect(produced.artifact?.backend.name).toBe(LEAN4_BACKEND_NAME)
    expect(produced.artifact?.result.status).toBe("verified")
    // **R56**：`inputHash` 必须随 `statement` 变 —— 这条是"模板改弱了旧产物还配得上"那个洞的钉子。
    expect(produced.inputHash).toBe(proofInputHash({
      prompt: GOAL.prompt,
      claimSourceText: GOAL.claimSourceText,
      goal: GOAL.goalKind,
      assumptions: GOAL.assumptions,
      statement: produced.statement
    }))
    expect(produced.inputHash).not.toBe(proofInputHash({ prompt: GOAL.prompt, claimSourceText: GOAL.claimSourceText }))
  })

  it("`sorry` 的报告 ⇒ **不产出产物**（不是「产出但标 failed」）", async () => {
    const produced = await produceLean4Artifact(GOAL, { ...PRODUCE, runner: fakeRunner([okRun(CHEAT_STDOUT)]), claimId: "claim-1" })

    expect(produced.judgement.status).toBe("failed")
    expect(produced.artifact).toBeNull()
    // 命题原文**仍然照实给出** —— 它是"我们证了什么"的记录，不因为失败而消失。
    expect(produced.statement.length).toBeGreaterThan(0)
  })

  it("没有 `claimId` / 没有实测版本 ⇒ 不产出产物（适配器不猜这两件事）", async () => {
    expect((await produceLean4Artifact(GOAL, { ...PRODUCE, runner: fakeRunner([okRun(HONEST_STDOUT)]) })).artifact).toBeNull()
    expect((await produceLean4Artifact(GOAL, { ...PRODUCE, backendVersion: "  ", runner: fakeRunner([okRun(HONEST_STDOUT)]), claimId: "c" })).artifact).toBeNull()
  })

  it("表外目标类**抛**（不许悄悄走到这里）", async () => {
    await expect(produceLean4Artifact({ ...GOAL, goalKind: "parallel" }, { ...PRODUCE, runner: fakeRunner([okRun(HONEST_STDOUT)]), claimId: "c" })).rejects.toThrow(/只覆盖/)
  })
})

describe("最小闭环：一条真目标走到 `formally_proved`（假 runner，CI 上跑）", () => {
  const options = { ...PRODUCE, runner: fakeRunner([okRun(HONEST_STDOUT)]) }

  it("**真报告 ⇒ 证据状态升到 `formally_proved`**", async () => {
    const outcome = await runLean4ClosedLoop("verified_instance", GOAL, "claim-1", options)

    expect(outcome.status).toBe("formally_proved")
    expect(outcome.verification.status).toBe("verified")
    expect(outcome.verification.artifact?.claimId).toBe("claim-1")
    expect(outcome.judgement.status).toBe("verified")
  })

  it("**`sorry` 的报告 ⇒ 停在原地**（`verified_instance` 不许变成 `formally_proved`）", async () => {
    const outcome = await runLean4ClosedLoop("verified_instance", GOAL, "claim-1", {
      ...PRODUCE,
      runner: fakeRunner([okRun(CHEAT_STDOUT)])
    })

    expect(outcome.status).toBe("verified_instance")
    expect(outcome.verification.status).toBe("unsupported")
  })

  it("后端不可用 ⇒ 停在原地（「没装」不许读成「证过了」）", async () => {
    const outcome = await runLean4ClosedLoop("sampled", GOAL, "claim-1", {
      ...PRODUCE,
      runner: fakeRunner([{ exitCode: null, stdout: "", stderr: "", durationMs: 0, timedOut: false, unavailableReason: "没找到 lean" }])
    })

    expect(outcome.status).toBe("sampled")
    expect(outcome.judgement.status).toBe("unsupported")
  })

  it("超时 ⇒ 停在原地，且状态如实是 timeout", async () => {
    const outcome = await runLean4ClosedLoop("sampled", GOAL, "claim-1", {
      ...PRODUCE,
      runner: fakeRunner([{ exitCode: null, stdout: HONEST_STDOUT, stderr: "", durationMs: 180_001, timedOut: true }])
    })

    expect(outcome.status).toBe("sampled")
    expect(outcome.judgement.status).toBe("timeout")
  })

  it("**表外目标类 ⇒ 停在原地**（不是抛、也不是升级）：这个闭环只覆盖一个目标类", async () => {
    const outcome = await runLean4ClosedLoop("verified_instance", { ...GOAL, goalKind: "dihedral" }, "claim-1", options)

    expect(outcome.status).toBe("verified_instance")
    expect(outcome.verification.status).toBe("unsupported")
    // 拒绝理由必须点名**收到的那个类**，而不是含糊地说"不支持"。
    expect(outcome.judgement.detail).toContain("dihedral")
    expect(outcome.verification.reasons[0]?.detail).toContain("perpendicular")
  })
})

describe("**篡改必拒**：同一份产物逐字段被改，逐条都被现有的拒绝码拒掉", () => {
  /**
   * 这一组是"绑定到底绑没绑住"的判据。**复用既有拒绝码**（发明新的就等于给了一条
   * "这是另一类问题"的出路，而实际上它们全都是同一件事：这份产物不再配这条 claim / 这份输入）。
   */
  async function honestArtifact(): Promise<Record<string, unknown>> {
    const produced = await produceLean4Artifact(GOAL, { ...PRODUCE, runner: fakeRunner([okRun(HONEST_STDOUT)]), claimId: "claim-1" })
    expect(produced.artifact).not.toBeNull()
    return produced.artifact as unknown as Record<string, unknown>
  }

  async function expectationFor(artifact: Record<string, unknown>): Promise<ProofExpectation> {
    return { claimId: "claim-1", inputHash: artifact.inputHash as string, goalKind: "perpendicular" }
  }

  it("未篡改的产物**过**（否则下面每一条都可能是「反正什么都拒」）", async () => {
    const artifact = await honestArtifact()
    const verification = verifyProofArtifact(artifact, await expectationFor(artifact))

    expect(verification.status).toBe("verified")
  })

  it("改 `claimId` ⇒ `claim-mismatch`", async () => {
    const artifact = await honestArtifact()
    const tampered = { ...artifact, claimId: "claim-2" }
    const verification = verifyProofArtifact(tampered, await expectationFor(artifact))

    expect(verification.status).toBe("failed")
    expect(verification.reasons[0]?.code).toBe<ProofRejectionCode>("claim-mismatch")
  })

  it("改 `inputHash` ⇒ `input-mismatch`", async () => {
    const artifact = await honestArtifact()
    const tampered = { ...artifact, inputHash: "0".repeat(64) }
    const verification = verifyProofArtifact(tampered, await expectationFor(artifact))

    expect(verification.reasons[0]?.code).toBe<ProofRejectionCode>("input-mismatch")
  })

  it("**改命题模板（等价于 R56 那个洞）⇒ 哈希失配** —— 旧产物配不上新命题", async () => {
    const artifact = await honestArtifact()
    // 模拟"模板被改弱了"：换一条**不同的**命题，于是输入的哈希也变。
    const weaker = buildPerpendicularStatement(
      { ...GOAL, perpendicular: { ...GOAL.perpendicular!, lineB: { first: "B", second: "C" } } },
      400_000
    )
    const weakerHash = proofInputHash({
      prompt: GOAL.prompt,
      claimSourceText: GOAL.claimSourceText,
      goal: GOAL.goalKind,
      assumptions: GOAL.assumptions,
      statement: weaker.statement
    })

    expect(weakerHash).not.toBe(artifact.inputHash)
    const verification = verifyProofArtifact(artifact, { claimId: "claim-1", inputHash: weakerHash, goalKind: "perpendicular" })
    expect(verification.reasons[0]?.code).toBe<ProofRejectionCode>("input-mismatch")
  })

  it("改正文（`proof`）为空 ⇒ `empty-proof`", async () => {
    const artifact = await honestArtifact()
    const tampered = { ...artifact, proof: "   " }
    const verification = verifyProofArtifact(tampered, await expectationFor(artifact))

    expect(verification.reasons[0]?.code).toBe<ProofRejectionCode>("empty-proof")
  })

  it("改后端名（换成一个**没接上**的）⇒ `backend-not-wired`", async () => {
    const artifact = await honestArtifact()
    const tampered = { ...artifact, backend: { name: "newclid", version: "1.0" } }
    const verification = verifyProofArtifact(tampered, await expectationFor(artifact))

    expect(verification.reasons[0]?.code).toBe<ProofRejectionCode>("backend-not-wired")
  })

  it("改后端名成空 ⇒ `unnamed-backend`（说不清是谁证的不算证）", async () => {
    const artifact = await honestArtifact()
    const tampered = { ...artifact, backend: { name: "  ", version: "1.0" } }
    const verification = verifyProofArtifact(tampered, await expectationFor(artifact))

    expect(verification.reasons[0]?.code).toBe<ProofRejectionCode>("unnamed-backend")
  })

  it("改版本号（产物格式版本）⇒ `version-mismatch`", async () => {
    const artifact = await honestArtifact()
    const tampered = { ...artifact, version: PROOF_ARTIFACT_VERSION + 1 }
    const verification = verifyProofArtifact(tampered, await expectationFor(artifact))

    expect(verification.reasons[0]?.code).toBe<ProofRejectionCode>("version-mismatch")
  })

  it("**删掉 `inputHash` 字段** ⇒ `missing-field`（不是「没有绑定所以放行」）", async () => {
    const artifact = await honestArtifact()
    const tampered = { ...artifact }
    delete tampered.inputHash
    const verification = verifyProofArtifact(tampered, await expectationFor(artifact))

    expect(verification.reasons[0]?.code).toBe<ProofRejectionCode>("missing-field")
  })

  it("把篡改过的产物喂回闭环 ⇒ 状态**不升**（`formally_proved` 只能由真产物换来）", async () => {
    const artifact = await honestArtifact()
    const tampered = { ...artifact, claimId: "claim-2" }
    const outcome = evidenceStatusWithProof("verified_instance", await expectationFor(artifact), [tampered])

    expect(outcome.status).toBe("verified_instance")
    expect(outcome.verification.reasons[0]?.code).toBe<ProofRejectionCode>("claim-mismatch")
  })
})
