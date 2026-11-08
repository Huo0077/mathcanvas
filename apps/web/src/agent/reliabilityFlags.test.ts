import { describe, expect, it } from "vitest"

import {
  AGENT_RELIABILITY_FLAG_NAMES,
  RELIABILITY_FLAGS_FOR_TESTS,
  agentReliabilityFlags,
  createAgentReliabilityFlags
} from "./reliabilityFlags"

/**
 * **W9 / T9：灰度开关默认全关、互相独立、名字只有一处。**
 *
 * 这四条判据保证"合了代码不等于开了能力"：
 * ① 生产默认全关；② 五个开关彼此独立；③ 名字表与接口等集；
 * ④ 未知开关名直接拒绝（防止拼写错的开关被静默忽略）。
 */

describe("W9 — reliability flags", () => {
  it("defaults every capability to off in production", () => {
    const flags = agentReliabilityFlags()
    for (const name of AGENT_RELIABILITY_FLAG_NAMES) expect(flags[name]).toBe(false)
  })

  it("keeps the five capabilities independent", () => {
    for (const name of AGENT_RELIABILITY_FLAG_NAMES) {
      const flags = createAgentReliabilityFlags({ [name]: true })
      expect(flags[name]).toBe(true)
      for (const other of AGENT_RELIABILITY_FLAG_NAMES.filter((candidate) => candidate !== name)) {
        expect(flags[other], `${name} 不该连带动到 ${other}`).toBe(false)
      }
    }
  })

  it("has one name table and no extra keys", () => {
    const flags = createAgentReliabilityFlags()
    expect(Object.keys(flags).sort()).toEqual([...AGENT_RELIABILITY_FLAG_NAMES].sort())
  })

  it("refuses an unknown flag name instead of silently ignoring it", () => {
    expect(() => createAgentReliabilityFlags({ answerSemanticsV2: true } as never)).toThrow(/unknown reliability flag/)
  })

  it("offers an explicit all-on profile for tests", () => {
    for (const name of AGENT_RELIABILITY_FLAG_NAMES) expect(RELIABILITY_FLAGS_FOR_TESTS[name]).toBe(true)
  })
})
