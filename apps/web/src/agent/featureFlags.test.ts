import { describe, expect, it } from "vitest"

import { AGENT_NEXT_PHASE_FLAG_NAMES, agentNextPhaseFlags, createAgentNextPhaseFlags, type AgentNextPhaseFlags } from "./featureFlags"

describe("agent next phase feature flags", () => {
  it("defaults every next-phase capability to off so the shipped agent path is unchanged", () => {
    const flags = createAgentNextPhaseFlags()
    expect(flags).toEqual({
      obligationIR: false, witnessSearch: false, constrainedDrag: false, openProblemCompiler: false, proofExport: false
    })
    expect(AGENT_NEXT_PHASE_FLAG_NAMES).toEqual([
      "obligationIR", "witnessSearch", "constrainedDrag", "openProblemCompiler", "proofExport"
    ])
  })

  it("declares each flag exactly once so a stage cannot borrow another stage's switch", () => {
    expect(new Set(AGENT_NEXT_PHASE_FLAG_NAMES).size).toBe(AGENT_NEXT_PHASE_FLAG_NAMES.length)
    const namesAreKeys: Record<keyof AgentNextPhaseFlags, true> = {
      obligationIR: true, witnessSearch: true, constrainedDrag: true, openProblemCompiler: true, proofExport: true
    }
    expect([...AGENT_NEXT_PHASE_FLAG_NAMES].sort()).toEqual(Object.keys(namesAreKeys).sort())
  })

  it("lets a caller open one flag without opening the others", () => {
    const flags = createAgentNextPhaseFlags({ obligationIR: true })
    expect(flags.obligationIR).toBe(true)
    expect(flags.witnessSearch).toBe(false)
    expect(flags.proofExport).toBe(false)
  })

  /**
   * **R6：应用层持有的那一份就是"开关从哪来"的答案，而且它现在必须是关的。**
   *
   * 这条判据看着像重复（上面已经断言过 `createAgentNextPhaseFlags()` 全关），
   * 但它盯的是**另一个对象**：生产接线读的是这一处。
   * 哪天有人为了"先跑起来"把这里的缺省改成 `true`，上面那条仍然全绿，
   * 而"生产默认走旧路径"这条验收条件会静默失效 —— 正是 R6 要防的那种改动。
   */
  it("keeps the application-owned flags fully off", () => {
    expect(agentNextPhaseFlags()).toEqual({
      obligationIR: false, witnessSearch: false, constrainedDrag: false, openProblemCompiler: false, proofExport: false
    })
  })
})
