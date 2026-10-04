import { describe, expect, it } from "vitest"

import { AGENT_NEXT_PHASE_FLAG_NAMES, createAgentNextPhaseFlags, type AgentNextPhaseFlags } from "./featureFlags"

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
})
