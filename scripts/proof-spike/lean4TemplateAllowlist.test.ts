import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  buildLineInPlaneStatement,
  buildLinePlanePerpendicularStatement,
  buildPerpendicularStatement,
  buildTangentSlopeStatement,
  type Lean4ProofGoalInput
} from "@draw/agent-core"

/**
 * **跨语言的那条耦合**：适配器生成什么，桌面命令就允许执行什么。
 *
 * ## 为什么它必须有一条判据
 *
 * 两份清单住在两个语言里：
 * - **TS**（`packages/agent-core/src/proof/lean4Adapter.ts`）决定**生成什么文本**；
 * - **Rust**（`apps/desktop/src-tauri/src/proof/source.rs`）决定**允许执行什么文本**。
 *
 * 它们靠人记得同步。忘了同步的后果不是"某处报个错"，而是**桌面侧把一条我们自己生成的、
 * 完全正确的文件拒掉**（或者更糟：白名单里留着一条早就没人生成的进口）。
 * 所以这里**读那个 Rust 文件**，把适配器三个模板的产物逐条对过去。
 *
 * **它不需要 Lean**（只读文件 + 生成字符串），所以每次全库都跑。
 *
 * ## 为什么它住在 `scripts/` 而不是 `packages/agent-core/`
 *
 * 因为它要读文件与用 `process.cwd()` —— `packages/agent-core` 的 tsconfig **没有 node 类型**
 *（2026-10-10 实测：放那边 `typecheck` 报 TS2307/TS2580）。这条判据本来就跨包，
 * 住在 `scripts/proof-spike/` 与那条真跑 Lean 的 gated 用例同一个位置，更合适。
 */

/** 仓内那份白名单（路径按仓库根算，与 `lean4EndToEnd.test.ts` 同一条纪律）。 */
export const RUST_SOURCE_PATH = path.join(process.cwd(), "apps", "desktop", "src-tauri", "src", "proof", "source.rs")

const MINIMAL: Omit<Lean4ProofGoalInput, "goalKind"> = { prompt: "p", claimSourceText: "c", proof: "x" }

describe("适配器输出 与 桌面白名单 的一致性（读 Rust 源文件）", () => {
  it("**每一个模板生成的 import / 定理名，都在桌面白名单里**", () => {
    const rust = readFileSync(RUST_SOURCE_PATH, "utf8")

    const specs = [
      buildPerpendicularStatement(
        { ...MINIMAL, goalKind: "perpendicular", perpendicular: { lineA: { first: "P", second: "A" }, planePoints: ["A", "B", "C"], lineB: { first: "B", second: "D" } } },
        400_000
      ),
      buildLinePlanePerpendicularStatement(
        {
          ...MINIMAL,
          goalKind: "linePlanePerpendicular",
          linePlanePerpendicular: { line: { first: "P", second: "A" }, planeLines: [{ first: "A", second: "B" }, { first: "A", second: "C" }] }
        },
        400_000
      ),
      buildTangentSlopeStatement({ ...MINIMAL, goalKind: "tangentSlope", tangentSlope: { functionName: "f" } }, 400_000),
      buildLineInPlaneStatement({ ...MINIMAL, goalKind: "lineInPlane", lineInPlane: { line: { first: "B", second: "D" }, planePoints: ["A", "B", "C"] } }, 400_000)
    ]

    for (const spec of specs) {
      // 定理名（`#print axioms` 后面那个）必须在白名单里，否则桌面侧拿不到报告。
      expect(rust, `${spec.theoremName} 不在桌面白名单里`).toContain(`"${spec.theoremName}"`)
      // 生成文件用的那条 import 也必须在里面（白名单是"允许执行哪些文本"的唯一记录）。
      const importLine = spec.source.split("\n").find((line) => line.startsWith("import "))
      expect(importLine, "生成的每份文件都必须恰好带一条 import").toBeDefined()
      expect(rust, `${String(importLine)} 不在桌面白名单里`).toContain(`"${String(importLine)}"`)
    }
  })

  it("**反过来也要对得上**：白名单里的每一条，都还真的有人生成", () => {
    // 这一半挡的是"白名单越攒越长"：一条没人再生成的 import / 定理名留在里面，
    // 就等于我们**继续允许执行**一类其实已经不产生的文本。
    const rust = readFileSync(RUST_SOURCE_PATH, "utf8")
    const imported = [...rust.matchAll(/"(import Mathlib[^"]*)"/g)].map((match) => match[1]!)
    const theorems = [...rust.matchAll(/"(draw_[a-z_]+)"/g)].map((match) => match[1]!)

    expect(imported.length).toBeGreaterThan(0)
    expect(theorems.length).toBeGreaterThan(0)

    const generatedImports = new Set(
      [
        buildPerpendicularStatement({ ...MINIMAL, goalKind: "perpendicular", perpendicular: { lineA: { first: "P", second: "A" }, planePoints: ["A", "B", "C"], lineB: { first: "B", second: "D" } } }, 1),
        buildTangentSlopeStatement({ ...MINIMAL, goalKind: "tangentSlope", tangentSlope: { functionName: "f" } }, 1)
      ].map((spec) => spec.source.split("\n").find((line) => line.startsWith("import ")) ?? "")
    )
    const generatedTheorems = new Set(
      [
        buildPerpendicularStatement({ ...MINIMAL, goalKind: "perpendicular", perpendicular: { lineA: { first: "P", second: "A" }, planePoints: ["A", "B", "C"], lineB: { first: "B", second: "D" } } }, 1),
        buildLinePlanePerpendicularStatement(
          {
            ...MINIMAL,
            goalKind: "linePlanePerpendicular",
            linePlanePerpendicular: { line: { first: "P", second: "A" }, planeLines: [{ first: "A", second: "B" }, { first: "A", second: "C" }] }
          },
          1
        ),
        buildTangentSlopeStatement({ ...MINIMAL, goalKind: "tangentSlope", tangentSlope: { functionName: "f" } }, 1),
        buildLineInPlaneStatement({ ...MINIMAL, goalKind: "lineInPlane", lineInPlane: { line: { first: "B", second: "D" }, planePoints: ["A", "B", "C"] } }, 1)
      ].map((spec) => spec.theoremName)
    )

    for (const line of imported) expect([...generatedImports], `${line} 在白名单里但没人生成`).toContain(line)
    for (const name of theorems) expect([...generatedTheorems], `${name} 在白名单里但没人生成`).toContain(name)
  })
})
