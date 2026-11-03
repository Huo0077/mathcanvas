import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { BRAND_TEXT, brandParticles } from "../brandParticles"
import { WorkspaceHeader } from "./WorkspaceHeader"

describe("workspace top bar", () => {
  it("shows the static MathCanvas brand", () => {
    render(<WorkspaceHeader />)
    expect(screen.getByRole("banner").textContent).toBe(BRAND_TEXT)
  })
})

describe("brand particles", () => {
  it("is deterministic, so screenshots and assertions are reproducible", () => {
    const first = brandParticles()
    const second = brandParticles()

    expect(first).toEqual(second)
    expect(first).toHaveLength(20)
  })

  it("keeps particles small, translucent and inside the stage", () => {
    const particles = brandParticles()

    for (const particle of particles) {
      expect(particle.size).toBeGreaterThanOrEqual(2)
      expect(particle.size).toBeLessThanOrEqual(4.8)
      expect(particle.opacity).toBeGreaterThanOrEqual(0.4)
      expect(particle.opacity).toBeLessThanOrEqual(0.8)
      expect(particle.left).toBeGreaterThanOrEqual(0)
      expect(particle.left).toBeLessThanOrEqual(100)
      expect(particle.top).toBeGreaterThanOrEqual(0)
      expect(particle.top).toBeLessThanOrEqual(100)
      // 上浮为负位移：粒子往上飘，和"科技感"的方向一致。
      expect(particle.rise).toBeLessThan(0)
      /**
       * 周期拉长、幅度压小（用户口径："把周期拉长、幅度调小"）。
       * 高刷屏上"看起来不流畅"的主因是每帧位移太大，所以这里同时钉住**速度**：
       * 120Hz 一帧 8.3ms，实测约 0.003–0.011 px/帧，远低于人眼能看出台阶的量级。
       */
      expect(particle.duration).toBeGreaterThanOrEqual(8)
      expect(particle.duration).toBeLessThanOrEqual(15)
      expect(particle.rise).toBeGreaterThanOrEqual(-11)
      expect(particle.rise).toBeLessThanOrEqual(-5)
      const pixelsPerFrameAt120Hz = Math.abs(particle.rise) / (particle.duration * 120)
      expect(pixelsPerFrameAt120Hz).toBeLessThan(0.05)
    }
  })
})
