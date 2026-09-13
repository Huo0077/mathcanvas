import { describe, expect, it } from "vitest"

import { advanceAnimation, type AnimationState } from "./animation"

const session: AnimationState = { value: 0.5, direction: 1, mode: "loop", playing: true, speed: 1 }

describe("animation state", () => {
  it("loops from the maximum back into the parameter range", () => {
    const next = advanceAnimation({ ...session, value: 0.9 }, 0.3, [0, 1])
    expect(next.value).toBeCloseTo(0.2)
    expect(next).toMatchObject({ direction: 1, playing: true })
  })

  it("stops at the boundary in once mode", () => {
    expect(advanceAnimation({ ...session, mode: "once", value: 0.9 }, 0.3, [0, 1])).toEqual({ value: 1, direction: 1, mode: "once", playing: false, speed: 1 })
  })

  it("reverses direction in ping-pong mode", () => {
    expect(advanceAnimation({ ...session, mode: "pingPong", value: 0.9 }, 0.3, [0, 1])).toMatchObject({ value: 0.8, direction: -1, playing: true })
  })
})
