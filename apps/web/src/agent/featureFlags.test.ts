import { describe, expect, it } from "vitest"

import { NEXT_PHASE_PREFERENCES_KEY, saveWitnessSearchEnabled } from "../persistence/nextPhasePreferences"

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
   * **R6：应用层持有的那一份就是"开关从哪来"的答案。**
   *
   * **2026-10-05 更新（用户批准的改动）**：这一处现在会读**用户偏好** —— N3 的第一个产品入口
   *（"设置 → 实验性功能 → 约束拖动"），所以"全关"这句话要说得更准：**没有存过偏好时全关**。
   *
   * **这条判据真正盯的东西没变**：生产缺省不许自己变成开。上面第一条（`createAgentNextPhaseFlags()`
   * 全关）仍然把"有人把缺省改成 true"挡着；而"只有偏好能开、且只能开那一个"由下面两条钉住。
   */
  it("keeps the application-owned flags fully off when no preference is stored", () => {
    localStorage.clear()

    expect(agentNextPhaseFlags()).toEqual({
      obligationIR: false, witnessSearch: false, constrainedDrag: false, openProblemCompiler: false, proofExport: false
    })
  })

  /**
   * **偏好可单独打开已验收的两个实验能力，另外三个必须保持关闭。**
   *
   * 存储里可能是任何东西：旧版本写的、手改的、别的程序写的。**那四个开关不许被它打开**，理由是各不相同
   * 而都必须成立：`witnessSearch` 打开后会替换被物化的坐标与点名（它有自己的接线前提，见
   * `featureFlags.ts` 的说明），`openProblemCompiler` 至今没有读取点（N4 交付的是评测面板与只读状态面），而 `proofExport` **2026-10-10 起有了一个读取点**（`draftStore.stage` 的第八个参数）—— 但它**仍然不许被偏好打开**：要开得有实验入口 + 验收证据，而那份证据还差一步（桌面命令不报后端版本 ⇒ 产物绑不上），
   * `obligationIR` 同理。**一个"存了就能全开"的偏好等于把另外四个开关一起打开（其中两个至今没有读取点）。**
   */
  it("enables only the explicitly stored witness-search flag on the real application path", () => {
    localStorage.clear()
    saveWitnessSearchEnabled(true)
    expect(agentNextPhaseFlags()).toEqual({
      obligationIR: false, witnessSearch: true, constrainedDrag: false, openProblemCompiler: false, proofExport: false
    })
    saveWitnessSearchEnabled(false)
    expect(agentNextPhaseFlags().witnessSearch).toBe(false)
  })
  it("ignores other unsupported flags in stored preferences", () => {
    localStorage.setItem(NEXT_PHASE_PREFERENCES_KEY, JSON.stringify({
      obligationIR: true, witnessSearch: true, constrainedDrag: true, openProblemCompiler: true, proofExport: true
    }))

    const flags = agentNextPhaseFlags()

    expect(flags.constrainedDrag).toBe(true)
    for (const name of ["obligationIR", "openProblemCompiler", "proofExport"] as const) {
      expect(flags[name], `${name} 不许被偏好打开`).toBe(false)
    }
    localStorage.clear()
  })
})
