import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { BRAND_TEXT, brandParticles } from "../brandParticles"
import { WorkspaceHeader } from "./WorkspaceHeader"

describe("workspace top bar", () => {
  /**
   * 2026-09-18 按用户口径重排：顶栏**只剩品牌**。
   * 文件命令 / 搜索 / 设置已经下沉到标签栏右端（见 `WorkspaceTabs.test.tsx`），
   * 高亮的「用户中心」按钮已删除。
   */
  it("keeps only the brand in the top bar", () => {
    render(<WorkspaceHeader activeWorkspace="conics" onWorkspaceChange={() => {}} />)

    const banner = screen.getByRole("banner")
    expect(banner.textContent).toContain("MathCanvas")
    expect(screen.queryByPlaceholderText("搜索工具、命令或定理...")).toBeNull()
    expect(screen.queryByRole("button", { name: "打开 .mgeo" })).toBeNull()
    expect(screen.queryByRole("button", { name: "用户中心" })).toBeNull()
    expect(screen.queryByRole("button", { name: "设置" })).toBeNull()
    expect(screen.queryByRole("button", { name: "立体几何" })).toBeNull()
  })

  /**
   * 顶栏品牌必须**居中**（用户口径："极简的顶部导航栏（居中显示"MathCanvas"品牌字样）"）。
   * 品牌是顶栏的**直接子元素**，居中由它自己的定位规则负责。
   */
  it("keeps the brand a direct child of the bar so it can be centred", () => {
    render(<WorkspaceHeader />)

    const banner = screen.getByRole("banner")
    const brand = banner.querySelector(".brand")!
    expect(brand.parentElement).toBe(banner)
    expect(brand.closest(".topbar-leading")).toBeNull()
  })

  /**
   * 用户口径：「把动态粒子效果加入到 MathCanvas 一栏，光标中的文字就是 MathCanvas」。
   *
   * 两件事都钉住：粒子确实渲染出来了（且是纯装饰），品牌文字带着方块光标。
   */
  it("adds decorative particles plus a block cursor holding the brand text", () => {
    render(<WorkspaceHeader />)

    const banner = screen.getByRole("banner")
    const particles = banner.querySelector(".brand-particles")!
    expect(particles.getAttribute("aria-hidden")).toBe("true")
    expect(particles.querySelectorAll("i").length).toBe(brandParticles().length)
    expect(particles.querySelectorAll("i").length).toBeGreaterThan(0)

    // 光标「里」的文字就是品牌名：文字是可读文本，光标是纯装饰。
    const type = banner.querySelector(".brand-type")!
    expect(type.getAttribute("aria-label")).toBe(BRAND_TEXT)
    expect(type.querySelector(".brand-text")?.textContent).toBe("MathCanvas")
    expect(type.querySelector(".brand-cursor")?.getAttribute("aria-hidden")).toBe("true")
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
      // 周期够短才看得出"在动"，又不至于晃眼。
      expect(particle.duration).toBeGreaterThanOrEqual(3.6)
      expect(particle.duration).toBeLessThanOrEqual(7.4)
    }
  })
})
