import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { loadConstrainedDragEnabled, loadWitnessSearchEnabled } from "../../persistence/nextPhasePreferences"
import { ExperimentalFeatures } from "./ExperimentalFeatures"

/**
 * **N3 的产品入口：用户在「设置 → 实验性功能」里打开约束拖动**（2026-10-05，用户批准）。
 *
 * 这一组用例守三件事：
 * 1. **初始状态跟着存下来的偏好**（没存过就是关）—— 界面不许自己"默认打开"；
 * 2. **点一下就落到存储里**，并立刻反映在界面上（用户要知道自己现在处于哪一档）；
 * 3. **说清打开与关着分别是什么行为** —— 一个只有"约束拖动"四个字的开关，
 *    用户没法判断该不该开；而这个开关会**换掉拖动路径**。
 */
describe("设置 → 实验性功能", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("开关初始是关（没存过偏好时）", () => {
    render(<ExperimentalFeatures />)

    expect(screen.getByRole("switch", { name: /约束拖动/ }).getAttribute("aria-checked")).toBe("false")
  })

  it("点一下既落到存储里、也立刻反映在界面上", () => {
    render(<ExperimentalFeatures />)

    fireEvent.click(screen.getByRole("switch", { name: /约束拖动/ }))

    expect(loadConstrainedDragEnabled()).toBe(true)
    expect(screen.getByRole("switch", { name: /约束拖动/ }).getAttribute("aria-checked")).toBe("true")
  })

  it("存过偏好时，挂载后就是开着（界面读存储，不是自己存一份状态）", () => {
    localStorage.setItem("mathcanvas:next-phase-preferences", JSON.stringify({ constrainedDrag: true }))

    render(<ExperimentalFeatures />)

    expect(screen.getByRole("switch", { name: /约束拖动/ }).getAttribute("aria-checked")).toBe("true")
  })

  it("offers a default-off witness-search switch with honest coverage and persists the choice", () => {
    render(<ExperimentalFeatures />)
    const toggle = screen.getByRole("switch", { name: "示意图见证搜索" })
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    expect(screen.getByText(/只覆盖部分棱锥题型/)).toBeTruthy()
    expect(screen.getByText(/题设核验/)).toBeTruthy()
    fireEvent.click(toggle)
    expect(loadWitnessSearchEnabled()).toBe(true)
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    expect(loadConstrainedDragEnabled()).toBe(false)
  })
  it("说清打开与关着分别是什么行为（这个开关会换掉拖动路径）", () => {
    render(<ExperimentalFeatures />)

    // 关着 = 原来的自由拖动；打开 = 受约束的点沿约束走。两句话都要在。
    expect(screen.getByText(/自由拖动/)).toBeTruthy()
    expect(screen.getByText(/沿约束/)).toBeTruthy()
    // 并且如实标注它是实验性的。
    expect(screen.getByText(/实验性/)).toBeTruthy()
  })
})
